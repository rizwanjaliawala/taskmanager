import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  hashPassword, verifyPassword, assertPasswordPolicy,
} from '../src/lib/password.js';
import {
  signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken,
} from '../src/lib/tokens.js';
import { publicUser } from '../src/lib/serialize.js';
import { AppError } from '../src/lib/errors.js';

const payload = { sub: '11111111-1111-1111-1111-111111111111', role: 'manager' as const, tokenVersion: 0 };

describe('password', () => {
  it('produces a bcrypt hash that is not the plain text', async () => {
    const h = await hashPassword('Utopia01');
    expect(h).not.toBe('Utopia01');
    expect(h.startsWith('$2')).toBe(true);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('Utopia01');
    expect(await verifyPassword('Utopia01', h)).toBe(true);
    expect(await verifyPassword('utopia01', h)).toBe(false);
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(() => assertPasswordPolicy('Ab1')).toThrow(AppError);
  });

  it('requires at least one letter and one digit', () => {
    expect(() => assertPasswordPolicy('abcdefgh')).toThrow(AppError);
    expect(() => assertPasswordPolicy('12345678')).toThrow(AppError);
    expect(() => assertPasswordPolicy('abcdefg1')).not.toThrow();
  });
});

describe('tokens', () => {
  it('round-trips an access token', () => {
    const decoded = verifyAccessToken(signAccessToken(payload));
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.role).toBe('manager');
    expect(decoded.tokenVersion).toBe(0);
  });

  it('rejects a tampered token', () => {
    const t = signAccessToken(payload);
    expect(() => verifyAccessToken(t.slice(0, -3) + 'aaa')).toThrow();
  });

  it('will not verify a refresh token as an access token', () => {
    expect(() => verifyAccessToken(signRefreshToken(payload, randomUUID()))).toThrow();
  });

  it('will not verify an access token as a refresh token', () => {
    expect(() => verifyRefreshToken(signAccessToken(payload))).toThrow();
  });

  it('round-trips a refresh token and embeds the jti claim', () => {
    const jti = randomUUID();
    const decoded = verifyRefreshToken(signRefreshToken(payload, jti));
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.jti).toBe(jti);
  });
});

describe('publicUser', () => {
  it('strips passwordHash and tokenVersion', () => {
    const row = {
      id: 'u1', fullName: 'Shahzeb Ali', email: 'shahzeb.ali@utopiabrands.com',
      passwordHash: '$2a$12$secret', role: 'manager', jobTitle: 'Manager',
      department: 'Operations', teamId: 't1', managerId: null, isActive: true,
      mustChangePassword: false, tokenVersion: 3,
      createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null,
    };
    const out = publicUser(row as any) as Record<string, unknown>;
    expect(out.passwordHash).toBeUndefined();
    expect(out.tokenVersion).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('$2a$12$secret');
    expect(out.email).toBe('shahzeb.ali@utopiabrands.com');
    expect(out.role).toBe('manager');
  });

  it('is an allow-list: unknown/future columns on the row never leak through', () => {
    // Simulates a future `users` migration (e.g. adding `mfaSecret`) — publicUser
    // must not pass unknown fields through, and must never leak the hash.
    const row = {
      id: 'u1', fullName: 'Shahzeb Ali', email: 'shahzeb.ali@utopiabrands.com',
      passwordHash: '$2a$12$secret', role: 'manager', jobTitle: 'Manager',
      department: 'Operations', teamId: 't1', managerId: null, isActive: true,
      mustChangePassword: false, tokenVersion: 3,
      createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null,
      mfaSecret: 'totp-secret-should-never-leak',
    };
    const out = publicUser(row as any) as Record<string, unknown>;

    expect(JSON.stringify(out)).not.toContain('$2');
    expect(out.passwordHash).toBeUndefined();
    expect(out.tokenVersion).toBeUndefined();
    expect(out.mfaSecret).toBeUndefined();

    expect(Object.keys(out).sort()).toEqual([
      'createdAt', 'department', 'email', 'fullName', 'id', 'initials',
      'isActive', 'jobTitle', 'lastLoginAt', 'managerId', 'mustChangePassword',
      'role', 'teamId', 'updatedAt',
    ].sort());
    expect(Object.keys(out)).toHaveLength(14);
  });
});
