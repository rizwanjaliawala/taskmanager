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

/*
 * The IP limit is only as trustworthy as the proxy in front of us. `req.ip` derives
 * from `X-Forwarded-For`, which a client can set freely; with `trust proxy: 1` Express
 * accepts one hop, so this control holds only when the app sits behind a proxy that
 * overwrites that header with the real peer address. Vercel does. Run this app exposed
 * directly to the internet and an attacker rotates the header to evade the limit
 * entirely — see docs/DEPLOYMENT.md.
 *
 * The per-email limit does not depend on that assumption and is the primary control:
 * spraying one account is throttled regardless of where the request claims to come from.
 * The IP limit is the secondary net for spraying MANY accounts from one source.
 */
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
    await revokeFamily(row);
    throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  const now = new Date();
  const newSessionId = randomUUID();
  const newExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  /*
   * Claim the session in the same statement that tests it. The `revokedAt IS NULL`
   * guard has to live in the UPDATE itself: the read above happened in a separate
   * round-trip, so two concurrent refreshes presenting the same token would both
   * see `revokedAt: null` there and both proceed. Postgres lets exactly one UPDATE
   * match, so exactly one caller gets a row back and the loser is treated as a replay.
   */
  const claimed = await db.update(refreshSessions)
    .set({ revokedAt: now, replacedById: newSessionId })
    .where(and(eq(refreshSessions.id, jti), isNull(refreshSessions.revokedAt)))
    .returning({ id: refreshSessions.id });

  if (claimed.length === 0) {
    // Someone else consumed this token between our read and our write.
    await revokeFamily(row);
    throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
  }

  await db.insert(refreshSessions).values({
    id: newSessionId, userId: row.id, issuedAt: now, expiresAt: newExpiresAt,
  });

  return tokensFor(row, newSessionId);
}

/**
 * A consumed refresh token was presented again. That means either a stolen token is
 * being replayed or the real one leaked, so we assume compromise and kill every
 * session for the user rather than only the one presented.
 *
 * This is deliberately blunt, and it has a benign trigger worth knowing about: two
 * browser tabs share one refresh cookie but keep independent JS state, so if both
 * access tokens lapse at the same moment both tabs can refresh concurrently. One
 * loses the claim, is read as a replay, and the user is signed out everywhere — from
 * a timing coincidence, not an attack. Support tickets shaped like "it logged me out
 * of everything" are usually this, not a breach.
 *
 * The fix belongs on the client, not here: `assets/js/api.js` coordinates refreshes
 * across tabs so the concurrent case does not arise. Loosening the check on this side
 * — a grace window that accepts a recently-consumed token — would hand a thief the
 * same window, so the detection stays strict.
 */
async function revokeFamily(row: { id: string; tokenVersion: number }): Promise<void> {
  const now = new Date();
  await db.batch([
    db.update(users).set({ tokenVersion: row.tokenVersion + 1, updatedAt: now })
      .where(eq(users.id, row.id)),
    db.update(refreshSessions).set({ revokedAt: now })
      .where(and(eq(refreshSessions.userId, row.id), isNull(refreshSessions.revokedAt))),
  ] as any);
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
