import { Router } from 'express';
import { z } from 'zod';
import * as notificationService from '../services/notification.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';

export const notificationRoutes = Router();
const idParam = z.object({ id: z.string().uuid() });

notificationRoutes.use(requireAuth, requirePasswordChanged);

notificationRoutes.get('/', async (req, res, next) => {
  try { ok(res, await notificationService.listFor(currentUser(req).id)); } catch (e) { next(e); }
});

notificationRoutes.patch('/:id/read', validate({ params: idParam }), async (req, res, next) => {
  try {
    await notificationService.markRead(currentUser(req), req.params.id!);
    ok(res, { read: true });
  } catch (e) { next(e); }
});

notificationRoutes.post('/read-all', async (req, res, next) => {
  try {
    await notificationService.markAllRead(currentUser(req).id);
    ok(res, { read: true });
  } catch (e) { next(e); }
});
