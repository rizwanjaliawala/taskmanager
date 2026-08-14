import { Router } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import { currentUser, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';
import { publicUser } from '../lib/serialize.js';
import { clearAuthCookies, setAuthCookies, REFRESH_COOKIE } from '../lib/tokens.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const authRoutes = Router();

const loginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Your current password is required'),
  newPassword: z.string().min(1, 'A new password is required'),
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'New password and confirmation do not match',
  path: ['confirmPassword'],
});

authRoutes.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { user, access, refresh } = await authService.login(email, password, req.ip);
    setAuthCookies(res, access, refresh);
    ok(res, { user });
  } catch (err) { next(err); }
});

// Path-scoped to /api/auth/refresh, the refresh cookie normally isn't sent here by a
// browser — logout accepts it when present (e.g. a client that forwards it explicitly)
// but never requires it. The access cookie is always cleared; an orphaned refresh
// session just expires naturally (or trips reuse-detection if it's ever replayed).
authRoutes.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      await authService.logout(token);
    } catch {
      // Logout must succeed even if the token is malformed/expired/already revoked.
    }
  }
  clearAuthCookies(res);
  ok(res, { loggedOut: true });
});

authRoutes.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError('UNAUTHORIZED', 'No active session');
    const { access, refresh } = await authService.refresh(token);
    setAuthCookies(res, access, refresh);
    ok(res, { refreshed: true });
  } catch (err) {
    clearAuthCookies(res);
    next(err);
  }
});

// Reachable while mustChangePassword is true — the frontend needs it to route correctly.
authRoutes.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [row] = await db.select().from(users).where(eq(users.id, currentUser(req).id));
    if (!row) throw new AppError('USER_NOT_FOUND', 'User not found');
    ok(res, publicUser(row));
  } catch (err) { next(err); }
});

/*
 * Self-service profile edit. Deliberately separate from PATCH /api/users/:id, which is
 * Manager-only: this accepts a strictly narrower field set, so a user can correct their
 * own name or job title without being able to grant themselves a role. The subject is
 * always the session user — no id is read from the body.
 */
const myProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Your name is required').max(120),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
}).strip();

authRoutes.patch('/me', requireAuth, validate({ body: myProfileSchema }),
  async (req, res, next) => {
    try {
      const me = currentUser(req);
      const [row] = await db.update(users).set({
        fullName: req.body.fullName,
        jobTitle: req.body.jobTitle ?? null,
        department: req.body.department ?? null,
        updatedAt: new Date(),
      }).where(eq(users.id, me.id)).returning();
      ok(res, publicUser(row!));
    } catch (err) { next(err); }
  });

// The subject is always the session user. No userId is read from the body.
authRoutes.post('/change-password', requireAuth, validate({ body: changePasswordSchema }),
  async (req, res, next) => {
    try {
      const me = currentUser(req);
      await authService.changePassword(me.id, req.body.currentPassword, req.body.newPassword);
      clearAuthCookies(res);
      ok(res, { changed: true, reauthenticate: true });
    } catch (err) { next(err); }
  });
