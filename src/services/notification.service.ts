import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { taskUrlFor, type TaskEmailContext } from '../lib/email/index.js';
import type { TaskRow } from './task.service.js';

/** Notify the person who assigned the task as well as the assignee. */
export const NOTIFY_ASSIGNER = true;

export type Recipient = { id: string; email: string; fullName: string };
type NewNotification = typeof notifications.$inferInsert;

export async function recipientsFor(task: TaskRow): Promise<Recipient[]> {
  const ids = [task.assignedTo, NOTIFY_ASSIGNER ? task.createdBy : null]
    .filter((v): v is string => !!v);
  if (!ids.length) return [];

  const rows = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, isActive: users.isActive })
    .from(users).where(inArray(users.id, [...new Set(ids)]));

  return rows.filter((r) => r.isActive).map(({ isActive: _a, ...r }) => r);
}

/**
 * Inserts pending notifications, skipping any whose dedupe_key already exists.
 * The unique constraint — not application timing — is what makes this idempotent
 * under concurrent job runs, retries and overlapping schedules.
 */
export async function createPending(rows: NewNotification[]): Promise<(typeof notifications.$inferSelect)[]> {
  if (!rows.length) return [];
  return db.insert(notifications).values(rows)
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
}

export async function markSent(id: string): Promise<void> {
  await db.update(notifications)
    .set({ status: 'sent', sentAt: new Date(), lastError: null })
    .where(eq(notifications.id, id));
}

export async function markFailed(id: string, error: unknown, attempts: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.update(notifications)
    .set({ status: 'failed', attempts: attempts + 1, lastError: message.slice(0, 500) })
    .where(eq(notifications.id, id));
  logger.warn('Notification delivery failed', { id, message });
}

export async function emailContextFor(task: TaskRow): Promise<TaskEmailContext> {
  const ids = [task.createdBy, task.assignedTo].filter((v): v is string => !!v);
  const people = await db.select({ id: users.id, fullName: users.fullName })
    .from(users).where(inArray(users.id, [...new Set(ids)]));
  const nameOf = (id: string | null) =>
    people.find((p) => p.id === id)?.fullName ?? 'Someone';

  return {
    ref: task.ref,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt,
    assignedByName: nameOf(task.createdBy),
    assignedToName: nameOf(task.assignedTo),
    taskUrl: taskUrlFor(task.ref),
  };
}

/** Delivers each pending notification and records the outcome. Never throws. */
export async function deliverAll(
  rows: (typeof notifications.$inferSelect)[],
  send: (emails: string[]) => Promise<void>,
  emailOf: Map<string, string>,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0, failed = 0;
  for (const row of rows) {
    const email = emailOf.get(row.userId);
    if (!email) { failed++; continue; }
    try {
      await send([email]);
      await markSent(row.id);
      succeeded++;
    } catch (err) {
      await markFailed(row.id, err, row.attempts);
      failed++;
    }
  }
  return { succeeded, failed };
}
