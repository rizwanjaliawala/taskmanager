import { describe, expect, it } from 'vitest';
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
    expect(() => verifyAccessToken(signRefreshToken(payload))).toThrow();
  });

  it('will not verify an access token as a refresh token', () => {
    expect(() => verifyRefreshToken(signAccessToken(payload))).toThrow();
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
});
