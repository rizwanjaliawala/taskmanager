import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isProd } from './env.js';
import type { Role } from '../db/schema.js';

export type TokenPayload = { sub: string; role: Role; tokenVersion: number };

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const ISSUER = 'utopia-trucking-task-manager';

export const ACCESS_COOKIE = 'utm_access';
export const REFRESH_COOKIE = 'utm_refresh';

export function signAccessToken(p: TokenPayload): string {
  return jwt.sign(p, env.JWT_SECRET, {
    expiresIn: ACCESS_TTL, issuer: ISSUER, audience: 'access', algorithm: 'HS256',
  });
}

export function signRefreshToken(p: TokenPayload): string {
  return jwt.sign(p, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL, issuer: ISSUER, audience: 'refresh', algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: ISSUER, audience: 'access', algorithms: ['HS256'],
  }) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: ISSUER, audience: 'refresh', algorithms: ['HS256'],
  }) as TokenPayload;
}

export function setAuthCookies(res: Response, access: string, refresh: string): void {
  const base = { httpOnly: true, secure: isProd, sameSite: 'lax' as const };
  res.cookie(ACCESS_COOKIE, access, { ...base, path: '/', maxAge: 15 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...base, path: '/api/auth', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
