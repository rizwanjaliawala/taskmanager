import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isProd } from './env.js';
import type { Role } from '../db/schema.js';

export type TokenPayload = { sub: string; role: Role; tokenVersion: number };
/** Decoded shape of a refresh token: the base payload plus the JWT `jti`, which is the `refresh_sessions.id` it maps to. */
export type RefreshTokenPayload = TokenPayload & { jti: string };

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
/** Same lifetime as REFRESH_TTL, in milliseconds — for computing `refresh_sessions.expiresAt`. */
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ISSUER = 'utopia-trucking-task-manager';

export const ACCESS_COOKIE = 'utm_access';
export const REFRESH_COOKIE = 'utm_refresh';
/** Refresh cookie is scoped tightly to the one route that reads it — never sent to /login, /logout, /me, /change-password. */
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';

export function signAccessToken(p: TokenPayload): string {
  return jwt.sign(p, env.JWT_SECRET, {
    expiresIn: ACCESS_TTL, issuer: ISSUER, audience: 'access', algorithm: 'HS256',
  });
}

export function signRefreshToken(p: TokenPayload, jti: string): string {
  return jwt.sign(p, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL, issuer: ISSUER, audience: 'refresh', algorithm: 'HS256', jwtid: jti,
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: ISSUER, audience: 'access', algorithms: ['HS256'],
  }) as TokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: ISSUER, audience: 'refresh', algorithms: ['HS256'],
  }) as RefreshTokenPayload;
}

export function setAuthCookies(res: Response, access: string, refresh: string): void {
  const base = { httpOnly: true, secure: isProd, sameSite: 'lax' as const };
  res.cookie(ACCESS_COOKIE, access, { ...base, path: '/', maxAge: 15 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...base, path: REFRESH_COOKIE_PATH, maxAge: REFRESH_TTL_MS });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}
