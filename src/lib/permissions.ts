import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
import type { AuthUser } from './auth.js';

export type Action =
  | 'user:create' | 'user:update' | 'user:activate' | 'user:deactivate' | 'user:list'
  | 'team:manage'
  | 'task:list' | 'task:view' | 'task:create' | 'task:assign' | 'task:comment'
  | 'task:edit' | 'task:delete' | 'task:changeStatus' | 'task:complete'
  | 'password:change'
  | 'notification:read';

export type TaskLike = { createdBy: string; assignedTo: string | null };
export type OwnedLike = { userId: string };
export type Resource = TaskLike | OwnedLike | undefined;

/** Only this role may manage users. Widening authority is a one-line change here. */
const USER_MANAGEMENT_ROLES = new Set<AuthUser['role']>(['manager']);

/** Open to every active user — the organisation operates as one flat team. */
const OPEN_ACTIONS = new Set<Action>([
  'user:list', 'task:list', 'task:view', 'task:create', 'task:assign', 'task:comment',
]);

/** Restricted to the task's creator, its assignee, or a Manager. */
const TASK_MUTATION_ACTIONS = new Set<Action>([
  'task:edit', 'task:delete', 'task:changeStatus', 'task:complete',
]);

const USER_MANAGEMENT_ACTIONS = new Set<Action>([
  'user:create', 'user:update', 'user:activate', 'user:deactivate', 'team:manage',
]);

const isTaskLike = (r: Resource): r is TaskLike =>
  !!r && 'createdBy' in r;
const isOwned = (r: Resource): r is OwnedLike =>
  !!r && 'userId' in r;

export function can(user: AuthUser, action: Action, resource?: Resource): boolean {
  if (!user?.isActive) return false;

  if (USER_MANAGEMENT_ACTIONS.has(action)) return USER_MANAGEMENT_ROLES.has(user.role);

  if (OPEN_ACTIONS.has(action)) return true;

  if (TASK_MUTATION_ACTIONS.has(action)) {
    if (!isTaskLike(resource)) return false;
    if (USER_MANAGEMENT_ROLES.has(user.role)) return true;
    return resource.createdBy === user.id || resource.assignedTo === user.id;
  }

  // Strictly self-scoped: no role, including Manager, may act on another user here.
  if (action === 'password:change' || action === 'notification:read') {
    return isOwned(resource) && resource.userId === user.id;
  }

  return false;
}

export function assertCan(user: AuthUser, action: Action, resource?: Resource): void {
  if (!can(user, action, resource)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to perform this action');
  }
}

/**
 * Route guard for actions that need no resource (e.g. user:create).
 * Resource-scoped actions are checked inside the service, after the row is loaded.
 */
export function requirePermission(action: Action): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Authentication required');
      assertCan(req.user, action);
      next();
    } catch (err) {
      next(err);
    }
  };
}
