import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginAttempts, refreshSessions, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { publicUser, type PublicUser } from '../lib/serialize.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, REFRESH_TTL_MS, type TokenPayload,
} from '../lib/tokens.js';

const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 30;
const WINDOW_MINUTES = 15;

/**
 * A fixed, throwaway bcrypt hash computed once (lazily, cost 12 — same as real
 * hashes) and reused for every "no such user" login. Comparing against it
 * keeps the unknown-email path paying the same bcrypt cost as the
 * wrong-password path, so response latency can't be used to distinguish the
 * two — the anti-enumeration guarantee is about timing, not just the body.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('correct horse battery staple 01');
  return dummyHashPromise;
}

function tokensFor(row: { id: string; role: any; tokenVersion: number }, sessionId: string) {
  const payload: TokenPayload = { sub: row.id, role: row.role, tokenVersion: row.tokenVersion };
  return { access: signAccessToken(payload), refresh: signRefreshToken(payload, sessionId) };
}

async function recentFailuresByEmail(email: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(
      sql`lower(${loginAttempts.email}) = ${email}`,
      eq(loginAttempts.succeeded, false),
      gte(loginAttempts.createdAt, since),
    ));
  return row?.n ?? 0;
}

async function recentFailuresByIp(ip: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(
      eq(loginAttempts.ip, ip),
      eq(loginAttempts.succeeded, false),
      gte(loginAttempts.createdAt, since),
    ));
  return row?.n ?? 0;
}

export async function login(rawEmail: string, password: string, ip?: string): Promise<{
  user: PublicUser; access: string; refresh: string;
}> {
  const email = rawEmail.trim().toLowerCase();

  const [emailFailures, ipFailures] = await Promise.all([
    recentFailuresByEmail(email),
    ip ? recentFailuresByIp(ip) : Promise.resolve(0),
  ]);
  if (emailFailures >= MAX_FAILURES_PER_EMAIL || ipFailures >= MAX_FAILURES_PER_IP) {
    throw new AppError('RATE_LIMITED',
      `Too many failed sign-in attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  }

  const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);

  // Identical error for unknown email and wrong password — no account enumeration.
  // Always pay the bcrypt cost, win or lose the row lookup, so the two cases
  // can't be told apart by timing either.
  const okPassword = row
    ? await verifyPassword(password, row.passwordHash)
    : await verifyPassword(password, await dummyHash());

  if (!row || !okPassword) {
    await db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: false });
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (!row.isActive) {
    await db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: false });
    throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated. Contact your Manager.');
  }

  const now = new Date();
  const sessionId = randomUUID();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
  await db.batch([
    db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: true }),
    db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, row.id)),
    db.insert(refreshSessions).values({ id: sessionId, userId: row.id, issuedAt: now, expiresAt }),
  ] as any);

  return { user: publicUser({ ...row, lastLoginAt: now }), ...tokensFor(row, sessionId) };
}

export async function refresh(token: string): Promise<{ access: string; refresh: string }> {
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  const jti = payload.jti;
  if (!jti) throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');

  const [session] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, jti));
  if (!session) throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');

  const [row] = await db.select().from(users).where(eq(users.id, payload.sub));
  if (!row) throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  if (!row.isActive) throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated');
  if (row.tokenVersion !== payload.tokenVersion) {
    throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
  }

  if (session.revokedAt) {
    // Replay of an already-consumed refresh token: assume compromise and kill
    // every session for this user, not just the one being replayed.
    const now = new Date();
    await db.batch([
      db.update(users).set({ tokenVersion: row.tokenVersion + 1, updatedAt: now })
        .where(eq(users.id, row.id)),
      db.update(refreshSessions).set({ revokedAt: now })
        .where(and(eq(refreshSessions.userId, row.id), isNull(refreshSessions.revokedAt))),
    ] as any);
    throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  const now = new Date();
  const newSessionId = randomUUID();
  const newExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
  await db.batch([
    db.update(refreshSessions).set({ revokedAt: now, replacedById: newSessionId })
      .where(eq(refreshSessions.id, jti)),
    db.insert(refreshSessions).values({
      id: newSessionId, userId: row.id, issuedAt: now, expiresAt: newExpiresAt,
    }),
  ] as any);

  return tokensFor(row, newSessionId);
}

/** Revokes the refresh session the presented token maps to, if any. Never throws — logout must always succeed. */
export async function logout(token: string): Promise<void> {
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return;
  }
  if (!payload.jti) return;
  await db.update(refreshSessions).set({ revokedAt: new Date() })
    .where(and(eq(refreshSessions.id, payload.jti), isNull(refreshSessions.revokedAt)));
}

export async function changePassword(
  userId: string, currentPassword: string, newPassword: string,
): Promise<void> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new AppError('USER_NOT_FOUND', 'User not found');

  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect');
  }

  assertPasswordPolicy(newPassword);

  if (await verifyPassword(newPassword, row.passwordHash)) {
    throw new AppError('VALIDATION_ERROR', 'Your new password must differ from your current password');
  }

  await db.update(users).set({
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    tokenVersion: row.tokenVersion + 1, // revokes every existing session
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}
