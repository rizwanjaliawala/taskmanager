import { Router, type RequestHandler } from 'express';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/respond.js';
import { runReminders } from '../jobs/reminders.js';
import { runExpiry } from '../jobs/expiry.js';

export const jobRoutes = Router();

/**
 * Vercel Cron issues GET and attaches "Authorization: Bearer $CRON_SECRET"
 * automatically when CRON_SECRET is set as a project environment variable.
 */
export const requireCronSecret: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || supplied !== env.CRON_SECRET) {
    next(new AppError('UNAUTHORIZED', 'Invalid or missing cron credentials'));
    return;
  }
  next();
};

jobRoutes.use(requireCronSecret);

jobRoutes.all('/reminders', async (_req, res, next) => {
  try { ok(res, await runReminders()); } catch (e) { next(e); }
});

jobRoutes.all('/expiry', async (_req, res, next) => {
  try { ok(res, await runExpiry()); } catch (e) { next(e); }
});
