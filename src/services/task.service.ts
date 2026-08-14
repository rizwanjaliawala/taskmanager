import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskHistory, tasks, users, type TaskPriority, type TaskStatus } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertCan } from '../lib/permissions.js';
import { isOverdue } from '../lib/serialize.js';
import type { AuthUser } from '../lib/auth.js';
import * as notificationService from './notification.service.js';
import { sendAssignment } from '../lib/email/index.js';

export type TaskRow = typeof tasks.$inferSelect;
export type PublicTask = TaskRow & { isOverdue: boolean };

export type TaskFilters = {
  status?: TaskStatus; priority?: TaskPriority;
  assignedTo?: string; createdBy?: string; project?: string; q?: string;
};

export type CreateTaskInput = {
  title: string; description?: string | null; priority?: TaskPriority;
  assignedTo?: string | null; project?: string | null; tags?: string[];
  startAt?: Date | null; dueAt?: Date | null; notes?: string | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput> & { progress?: number };

export function publicTask(row: TaskRow): PublicTask {
  return { ...row, isOverdue: isOverdue(row) };
}

export async function getById(id: string): Promise<TaskRow> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!row) throw new AppError('TASK_NOT_FOUND', 'Task not found');
  return row;
}

export async function list(f: TaskFilters = {}): Promise<PublicTask[]> {
  const where: SQL[] = [];
  if (f.status) where.push(eq(tasks.status, f.status));
  if (f.priority) where.push(eq(tasks.priority, f.priority));
  if (f.assignedTo) where.push(eq(tasks.assignedTo, f.assignedTo));
  if (f.createdBy) where.push(eq(tasks.createdBy, f.createdBy));
  if (f.project) where.push(eq(tasks.project, f.project));
  if (f.q) {
    const needle = `%${f.q}%`;
    where.push(or(
      ilike(tasks.title, needle), ilike(tasks.description, needle), ilike(tasks.ref, needle),
    )!);
  }

  const rows = await db.select().from(tasks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(tasks.createdAt));

  return rows.map(publicTask);
}

export async function create(actor: AuthUser, input: CreateTaskInput): Promise<PublicTask> {
  assertCan(actor, 'task:create');

  const now = new Date();
  const title = input.title.trim();

  /*
   * Generate the id here rather than letting the column default fire, so the task row
   * and its 'created' history row can go out in one `db.batch` — the history insert
   * needs the id, and reading it back would mean two separate round-trips with a
   * window in between where the task exists with no audit trail.
   */
  const id = randomUUID();

  const [inserted] = await db.batch([
    db.insert(tasks).values({
      id,
      title,
      description: input.description ?? null,
      createdBy: actor.id,               // always the session user; never client-supplied
      assignedTo: input.assignedTo ?? null,
      priority: input.priority ?? 'medium',
      status: 'assigned',
      progress: 0,
      project: input.project ?? null,
      tags: input.tags ?? [],
      notes: input.notes ?? null,
      startAt: input.startAt ?? null,
      dueAt: input.dueAt ?? null,
      assignedAt: input.assignedTo ? now : null,
    }).returning(),
    db.insert(taskHistory).values({
      taskId: id, actorId: actor.id, event: 'created', toValue: title,
    }),
  ] as any);

  return publicTask((inserted as any[])[0]);
}

export async function update(actor: AuthUser, id: string, patch: UpdateTaskInput): Promise<PublicTask> {
  const existing = await getById(id);
  assertCan(actor, 'task:edit', existing);

  const events: (typeof taskHistory.$inferInsert)[] = [];
  const push = (event: any, fromValue: string | null, toValue: string | null) =>
    events.push({ taskId: id, actorId: actor.id, event, fromValue, toValue });

  if (patch.priority !== undefined && patch.priority !== existing.priority) {
    push('priority_changed', existing.priority, patch.priority);
  }
  if (patch.dueAt !== undefined &&
      (patch.dueAt?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null)) {
    push('due_changed', existing.dueAt?.toISOString() ?? null, patch.dueAt?.toISOString() ?? null);
  }
  if (patch.progress !== undefined && patch.progress !== existing.progress) {
    push('progress_changed', String(existing.progress), String(patch.progress));
  }

  // Reaching 100% through a plain PATCH is itself a completion — flip the status too,
  // rather than leaving the task at progress:100 but still "in progress".
  const reaching100 = patch.progress === 100 && existing.status !== 'completed';
  const now = new Date();
  if (reaching100) push('completed', existing.status, 'completed');

  const write = db.update(tasks).set({
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.project !== undefined ? { project: patch.project } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(reaching100 ? { status: 'completed' as const, completedAt: now } : {}),
    updatedAt: now,
  }).where(eq(tasks.id, id)).returning();

  // The mutation and the history rows describing it go out together, so a task can
  // never end up changed with no record of who changed it.
  if (events.length === 0) {
    const [row] = await write;
    return publicTask(row!);
  }

  const [updated] = await db.batch([
    write,
    db.insert(taskHistory).values(events),
  ] as any);

  return publicTask((updated as any[])[0]);
}

export async function remove(actor: AuthUser, id: string): Promise<void> {
  const existing = await getById(id);
  assertCan(actor, 'task:delete', existing);
  await db.delete(tasks).where(eq(tasks.id, id)); // history and comments cascade
}

/**
 * assigned ──► progress ──► completed ──reopen──► progress
 *    │  ▲         │  ▲          │
 *    │  └── hold ─┘  │
 *    └──────► overdue ──► completed
 * cancelled is terminal from anywhere.
 *
 * `completed` has no outbound entries here: leaving `completed` is only ever done
 * through the dedicated `reopen()` action below (POST /:id/reopen), never through the
 * generic POST /:id/status route — this table is what the generic route consults.
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  assigned:  ['progress', 'hold', 'completed', 'overdue', 'cancelled'],
  progress:  ['assigned', 'hold', 'completed', 'overdue', 'cancelled'],
  hold:      ['assigned', 'progress', 'completed', 'overdue', 'cancelled'],
  overdue:   ['progress', 'hold', 'completed', 'cancelled'],
  completed: [],                      // reopen only, via the dedicated endpoint
  cancelled: [],                      // terminal
};

function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new AppError('INVALID_STATUS_TRANSITION',
      `A task cannot move from ${from} to ${to}`);
  }
}

export async function assign(actor: AuthUser, taskId: string, assigneeId: string): Promise<PublicTask> {
  assertCan(actor, 'task:assign');

  const existing = await getById(taskId);
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw new AppError('INVALID_ASSIGNMENT',
      `A ${existing.status} task cannot be assigned`);
  }

  const [assignee] = await db.select().from(users).where(eq(users.id, assigneeId));
  if (!assignee) throw new AppError('INVALID_ASSIGNMENT', 'The selected user does not exist');
  if (!assignee.isActive) {
    throw new AppError('INVALID_ASSIGNMENT', 'The selected user is deactivated');
  }
  if (existing.assignedTo === assigneeId) {
    return publicTask(existing);
  }

  const now = new Date();
  const reassigning = existing.assignedTo !== null;

  // read → validate → batch-write: neon-http has no interactive transaction
  await db.batch([
    db.update(tasks).set({ assignedTo: assigneeId, assignedAt: now, updatedAt: now })
      .where(eq(tasks.id, taskId)),
    db.insert(taskHistory).values({
      taskId, actorId: actor.id,
      event: reassigning ? 'reassigned' : 'assigned',
      fromValue: existing.assignedTo, toValue: assigneeId,
    }),
  ] as any);

  const updated = await getById(taskId);
  await notifyAssignment(updated);
  return publicTask(updated);
}

async function notifyAssignment(task: TaskRow): Promise<void> {
  const recipients = await notificationService.recipientsFor(task);
  if (!recipients.length) return;

  const ctx = await notificationService.emailContextFor(task);

  const rows = await notificationService.createPending(recipients.map((r) => ({
    userId: r.id,
    taskId: task.id,
    type: 'assigned' as const,
    channel: 'email' as const,
    title: 'New task assigned',
    body: `${ctx.assignedByName} assigned "${task.title}" to ${ctx.assignedToName}`,
    dedupeKey: `assign:${task.id}:${r.id}:${task.assignedAt?.getTime() ?? Date.now()}`,
  })));

  const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
  await notificationService.deliverAll(rows, (to) => sendAssignment(to, ctx), emailOf);
}

async function performStatusChange(
  actor: AuthUser, existing: TaskRow, status: TaskStatus,
): Promise<PublicTask> {
  const now = new Date();
  const write = db.update(tasks).set({
    status,
    ...(status === 'completed' ? { completedAt: now, progress: 100 } : {}),
    ...(existing.status === 'completed' && status !== 'completed' ? { completedAt: null } : {}),
    updatedAt: now,
  }).where(eq(tasks.id, existing.id)).returning();

  const event = status === 'completed' ? 'completed'
    : status === 'cancelled' ? 'cancelled'
    : existing.status === 'completed' ? 'reopened'
    : 'status_changed';

  // The status write and the history row describing it go out together, matching the
  // read -> validate -> batch-write shape used by create() and update() above.
  const [row] = await db.batch([
    write,
    db.insert(taskHistory).values({
      taskId: existing.id, actorId: actor.id, event, fromValue: existing.status, toValue: status,
    }),
  ] as any);

  return publicTask((row as any[])[0]);
}

export async function changeStatus(actor: AuthUser, taskId: string, status: TaskStatus): Promise<PublicTask> {
  const existing = await getById(taskId);
  assertCan(actor, 'task:changeStatus', existing);
  assertTransition(existing.status, status);
  return performStatusChange(actor, existing, status);
}

/** The only way out of `completed` — deliberately not gated by ALLOWED_TRANSITIONS. */
export async function reopen(actor: AuthUser, id: string): Promise<PublicTask> {
  const existing = await getById(id);
  assertCan(actor, 'task:changeStatus', existing);
  if (existing.status !== 'completed') {
    throw new AppError('INVALID_STATUS_TRANSITION', 'Only a completed task can be reopened');
  }
  return performStatusChange(actor, existing, 'progress');
}

export const complete = (actor: AuthUser, id: string) => changeStatus(actor, id, 'completed');
export const cancel   = (actor: AuthUser, id: string) => changeStatus(actor, id, 'cancelled');
