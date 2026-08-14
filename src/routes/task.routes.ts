import { Router } from 'express';
import { z } from 'zod';
import * as taskService from '../services/task.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { requirePermission } from '../lib/permissions.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';
import { TASK_PRIORITIES, TASK_STATUSES } from '../db/schema.js';

export const taskRoutes = Router();

const idParam = z.object({ id: z.string().uuid('A valid task id is required') });
const isoDate = z.string().datetime().transform((s) => new Date(s));

const createSchema = z.object({
  title: z.string().trim().min(1, 'A task title is required').max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  project: z.string().trim().max(120).optional().nullable(),
  tags: z.array(z.string().trim().max(40)).max(12).optional(),
  startAt: isoDate.optional().nullable(),
  dueAt: isoDate.optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
}).strip(); // drops createdBy, status, ref and anything else a client tries to set

/*
 * `assignedTo` is deliberately omitted. Reassignment goes through
 * POST /api/tasks/:id/assign, which also writes the history event and sends the
 * notification email. Accepting it here and ignoring it — which is what inheriting
 * it from createSchema did — returns 200 on a request that changed nothing, so the
 * API silently lied about a field it appeared to support.
 */
const updateSchema = createSchema.partial().omit({ assignedTo: true }).extend({
  progress: z.number().int().min(0).max(100).optional(),
});

const listQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignedTo: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  project: z.string().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

taskRoutes.use(requireAuth, requirePasswordChanged);

taskRoutes.get('/', requirePermission('task:list'), validate({ query: listQuery }),
  async (req, res, next) => {
    try { ok(res, await taskService.list(req.query as any)); } catch (err) { next(err); }
  });

taskRoutes.post('/', requirePermission('task:create'), validate({ body: createSchema }),
  async (req, res, next) => {
    try { ok(res, await taskService.create(currentUser(req), req.body), 201); }
    catch (err) { next(err); }
  });

taskRoutes.get('/:id', requirePermission('task:view'), validate({ params: idParam }),
  async (req, res, next) => {
    try {
      ok(res, taskService.publicTask(await taskService.getById(req.params.id!)));
    } catch (err) { next(err); }
  });

// task:edit is resource-scoped, so the check happens in the service after the row loads.
taskRoutes.patch('/:id', validate({ params: idParam, body: updateSchema }),
  async (req, res, next) => {
    try { ok(res, await taskService.update(currentUser(req), req.params.id!, req.body)); }
    catch (err) { next(err); }
  });

// task:delete is resource-scoped, so the check happens in the service after the row loads.
taskRoutes.delete('/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    await taskService.remove(currentUser(req), req.params.id!);
    ok(res, { deleted: true });
  } catch (err) { next(err); }
});
