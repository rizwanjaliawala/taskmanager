import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, type Role } from '../src/db/schema.js';
import { env } from '../src/lib/env.js';
import { hashPassword } from '../src/lib/password.js';
import { ACCESS_COOKIE, signAccessToken, signRefreshToken } from '../src/lib/tokens.js';
import { requireAuth, requirePasswordChanged, type AuthUser } from '../src/lib/auth.js';
import { AppError } from '../src/lib/errors.js';

// Must mirror the private ISSUER constant in src/lib/tokens.ts so hand-signed
// tokens in these tests pass the issuer check and fail (or pass) for the
// reason each test actually wants to exercise.
const ISSUER = 'utopia-trucking-task-manager';

async function createUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const passwordHash = await hashPassword('Utopia01');
  const [row] = await db.insert(users).values({
    fullName: 'Test User',
    email: `test-${randomUUID()}@utopiabrands.com`,
    passwordHash,
    role: 'manager',
    isActive: true,
    mustChangePassword: false,
    ...overrides,
  }).returning();
  return row!;
}

function makeReq(opts: { cookieToken?: string; bearerToken?: string } = {}): Request {
  return {
    cookies: opts.cookieToken ? { [ACCESS_COOKIE]: opts.cookieToken } : {},
    headers: opts.bearerToken ? { authorization: `Bearer ${opts.bearerToken}` } : {},
  } as unknown as Request;
}

const res = {} as Response;

async function runRequireAuth(req: Request) {
  const next = vi.fn();
  await requireAuth(req, res, next);
  return next;
}

describe('requireAuth', () => {
  it('rejects when no token is present at all', async () => {
    const next = await runRequireAuth(makeReq());
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed / tampered token', async () => {
    const user = await createUser();
    const token = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });
    const tampered = token.slice(0, -3) + 'xyz';

    const next = await runRequireAuth(makeReq({ cookieToken: tampered }));
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects an expired access token', async () => {
    const user = await createUser();
    const expired = jwt.sign(
      { sub: user.id, role: user.role as Role, tokenVersion: user.tokenVersion },
      env.JWT_SECRET,
      { expiresIn: -10, issuer: ISSUER, audience: 'access', algorithm: 'HS256' },
    );

    const next = await runRequireAuth(makeReq({ cookieToken: expired }));
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects a refresh token presented as an access token', async () => {
    const user = await createUser();
    const refreshToken = signRefreshToken(
      { sub: user.id, role: user.role, tokenVersion: user.tokenVersion }, randomUUID(),
    );

    const next = await runRequireAuth(makeReq({ cookieToken: refreshToken }));
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects a valid token whose user row no longer exists', async () => {
    const ghostId = randomUUID();
    const token = signAccessToken({ sub: ghostId, role: 'manager', tokenVersion: 0 });

    const next = await runRequireAuth(makeReq({ cookieToken: token }));
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('rejects a valid token for a deactivated account with ACCOUNT_INACTIVE', async () => {
    const user = await createUser({ isActive: false });
    const token = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });

    const next = await runRequireAuth(makeReq({ cookieToken: token }));
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects a valid token whose tokenVersion is stale', async () => {
    const user = await createUser();
    const token = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });

    await db.update(users).set({ tokenVersion: user.tokenVersion + 1 }).where(eq(users.id, user.id));

    const next = await runRequireAuth(makeReq({ cookieToken: token }));
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('authenticates on the happy path: valid token, active user, matching tokenVersion', async () => {
    const user = await createUser({ mustChangePassword: false });
    const token = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });

    const req = makeReq({ cookieToken: token });
    const next = await runRequireAuth(req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);

    const reqUser = req.user as AuthUser;
    expect(reqUser).toBeDefined();
    expect(reqUser.id).toBe(user.id);
    expect(reqUser.email).toBe(user.email);
    expect(reqUser.role).toBe(user.role);
    expect(reqUser.isActive).toBe(true);
    expect(reqUser.mustChangePassword).toBe(false);
  });

  it('also authenticates via the Authorization: Bearer header (deliberate fallback)', async () => {
    const user = await createUser();
    const token = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });

    const req = makeReq({ bearerToken: token });
    const next = await runRequireAuth(req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
    expect((req.user as AuthUser).id).toBe(user.id);
  });
});

describe('requirePasswordChanged', () => {
  function makeUserReq(mustChangePassword: boolean): Request {
    return { user: { mustChangePassword } as AuthUser } as unknown as Request;
  }

  it('blocks with PASSWORD_CHANGE_REQUIRED when the flag is set', () => {
    const next = vi.fn();
    requirePasswordChanged(makeUserReq(true), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('calls next() with no argument when the flag is clear', () => {
    const next = vi.fn();
    requirePasswordChanged(makeUserReq(false), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
  });
});
