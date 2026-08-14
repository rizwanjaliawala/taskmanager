import { Router } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { ok } from '../lib/respond.js';

export const dashboardRoutes = Router();
dashboardRoutes.use(requireAuth, requirePasswordChanged);

dashboardRoutes.get('/dashboard', async (req, res, next) => {
  try { ok(res, await dashboardService.summary(currentUser(req).id)); } catch (e) { next(e); }
});

dashboardRoutes.get('/bootstrap', async (req, res, next) => {
  try { ok(res, await dashboardService.bootstrap(currentUser(req).id)); } catch (e) { next(e); }
});
