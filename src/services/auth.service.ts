import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginAttempts, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { publicUser, type PublicUser } from '../lib/serialize.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, type TokenPayload,
} from '../lib/tokens.js';

const MAX_FAILURES = 10;
const WINDOW_MINUTES = 15;

function tokensFor(row: { id: string; role: any; tokenVersion: number }) {
  const payload: TokenPayload = { sub: row.id, role: row.role, tokenVersion: row.tokenVersion };
  return { access: signAccessToken(payload), refresh: signRefreshToken(payload) };
}

async function recentFailures(email: string): Promise<number> {
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

export async function login(rawEmail: string, password: string, ip?: string): Promise<{
  user: PublicUser; access: string; refresh: string;
}> {
  const email = rawEmail.trim().toLowerCase();

  if (await recentFailures(email) >= MAX_FAILURES) {
    throw new AppError('RATE_LIMITED',
      `Too many failed sign-in attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  }

  const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);

  // Identical error for unknown email and wrong password — no account enumeration.
  const okPassword = row ? await verifyPassword(password, row.passwordHash) : false;

  if (!row || !okPassword) {
    await db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: false });
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (!row.isActive) {
    await db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: false });
    throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated. Contact your Manager.');
  }

  const now = new Date();
  await db.batch([
    db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: true }),
    db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, row.id)),
  ] as any);

  return { user: publicUser({ ...row, lastLoginAt: now }), ...tokensFor(row) };
}

export async function refresh(token: string): Promise<{ access: string; refresh: string }> {
  let payload: TokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  const [row] = await db.select().from(users).where(eq(users.id, payload.sub));
  if (!row) throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  if (!row.isActive) throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated');
  if (row.tokenVersion !== payload.tokenVersion) {
    throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
  }

  return tokensFor(row);
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
