import { Router } from 'express';
import { z } from 'zod';
import * as userService from '../services/user.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { requirePermission } from '../lib/permissions.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';
import { ROLES } from '../db/schema.js';
import { sendAccountCreated } from '../lib/email/index.js';
import { logger } from '../lib/logger.js';

export const userRoutes = Router();

const roleSchema = z.enum(ROLES);
const idParam = z.object({ id: z.string().uuid('A valid user id is required') });

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  role: roleSchema,
  jobTitle: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  role: roleSchema.optional(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
});

const listQuery = z.object({
  role: roleSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
});

userRoutes.use(requireAuth, requirePasswordChanged);

userRoutes.get('/', requirePermission('user:list'), validate({ query: listQuery }),
  async (req, res, next) => {
    try {
      const active = req.query.active === undefined ? undefined : req.query.active === 'true';
      ok(res, await userService.list({ role: req.query.role as any, active }));
    } catch (err) { next(err); }
  });

userRoutes.post('/', requirePermission('user:create'), validate({ body: createSchema }),
  async (req, res, next) => {
    try {
      const { user, tempPassword } = await userService.create(req.body);
      // Email failure must not roll back a created account.
      try {
        await sendAccountCreated({ user, tempPassword, createdBy: currentUser(req).fullName });
      } catch (e) {
        logger.error('Account-created email failed', {
          userId: user.id, message: e instanceof Error ? e.message : String(e),
        });
      }
      ok(res, { user }, 201);
    } catch (err) { next(err); }
  });

userRoutes.get('/:id', requirePermission('user:list'), validate({ params: idParam }),
  async (req, res, next) => {
    try { ok(res, await userService.getById(req.params.id!)); } catch (err) { next(err); }
  });

userRoutes.patch('/:id', requirePermission('user:update'),
  validate({ params: idParam, body: updateSchema }), async (req, res, next) => {
    try { ok(res, await userService.update(req.params.id!, req.body)); } catch (err) { next(err); }
  });

userRoutes.post('/:id/activate', requirePermission('user:activate'), validate({ params: idParam }),
  async (req, res, next) => {
    try {
      ok(res, await userService.setActive(req.params.id!, true, currentUser(req).id));
    } catch (err) { next(err); }
  });

userRoutes.post('/:id/deactivate', requirePermission('user:deactivate'), validate({ params: idParam }),
  async (req, res, next) => {
    try {
      ok(res, await userService.setActive(req.params.id!, false, currentUser(req).id));
    } catch (err) { next(err); }
  });
