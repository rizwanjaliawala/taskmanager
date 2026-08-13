import type { Request, RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, type Role } from '../db/schema.js';
import { AppError } from './errors.js';
import { ACCESS_COOKIE, verifyAccessToken } from './tokens.js';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  teamId: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

function readToken(req: Request): string | null {
  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof cookie === 'string' && cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = readToken(req);
    if (!token) throw new AppError('UNAUTHORIZED', 'Authentication required');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    }

    const [row] = await db.select().from(users).where(sql`${users.id} = ${payload.sub}`);
    if (!row) throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    if (!row.isActive) throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated');
    if (row.tokenVersion !== payload.tokenVersion) {
      throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
    }

    req.user = {
      id: row.id, email: row.email, fullName: row.fullName, role: row.role,
      isActive: row.isActive, mustChangePassword: row.mustChangePassword, teamId: row.teamId,
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Blocks every route except /auth/me and /auth/change-password until the password is changed. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    next(new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing'));
    return;
  }
  next();
};

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError('UNAUTHORIZED', 'Authentication required');
  return req.user;
}
