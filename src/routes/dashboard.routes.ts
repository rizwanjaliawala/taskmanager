import { Router } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { ok } from '../lib/respond.js';

export const dashboardRoutes = Router();

/*
 * The guards are attached per route, not with a path-less `router.use(...)`.
 * This router is mounted at `/api` rather than at its own prefix, so a router-wide
 * middleware would run for every unmatched `/api/*` request too — an unknown endpoint
 * answered `401 UNAUTHORIZED` instead of falling through to the `404 NOT_FOUND`
 * handler, which contradicts the documented error contract. Same shape of bug as
 * mounting this router ahead of `/api/jobs` would cause for the cron endpoints.
 */
const guards = [requireAuth, requirePasswordChanged];

dashboardRoutes.get('/dashboard', ...guards, async (req, res, next) => {
  try { ok(res, await dashboardService.summary(currentUser(req).id)); } catch (e) { next(e); }
});

dashboardRoutes.get('/bootstrap', ...guards, async (req, res, next) => {
  try { ok(res, await dashboardService.bootstrap(currentUser(req).id)); } catch (e) { next(e); }
});
