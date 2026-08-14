import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskHistory, tasks, type TaskPriority, type TaskStatus } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertCan } from '../lib/permissions.js';
import { isOverdue } from '../lib/serialize.js';
import type { AuthUser } from '../lib/auth.js';

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
    updatedAt: new Date(),
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
