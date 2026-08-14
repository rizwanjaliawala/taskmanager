import { and, eq, isNotNull, lt, notInArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskHistory, tasks } from '../db/schema.js';
import { sendExpiry } from '../lib/email/index.js';
import * as notificationService from '../services/notification.service.js';
import { runJob, type JobResult } from './runner.js';

/** No date component: an expiry event fires exactly once per task, permanently. */
export function expiryDedupeKey(taskId: string, userId: string): string {
  return `expiry:${taskId}:${userId}`;
}

export function runExpiry(now = new Date()): Promise<JobResult> {
  return runJob('expiry', async () => {
    let processed = 0, succeeded = 0, failed = 0, skipped = 0;

    const lapsed = await db.select().from(tasks).where(and(
      isNotNull(tasks.dueAt),
      lt(tasks.dueAt, now),
      notInArray(tasks.status, ['completed', 'cancelled', 'overdue']),
    ));

    for (const task of lapsed) {
      const recipients = await notificationService.recipientsFor(task);

      const rows = recipients.length
        ? await notificationService.createPending(recipients.map((r) => ({
            userId: r.id,
            taskId: task.id,
            type: 'expired' as const,
            channel: 'email' as const,
            title: 'Task time finished',
            body: `The assigned time for "${task.title}" has finished and it is not complete.`,
            dedupeKey: expiryDedupeKey(task.id, r.id),
          })))
        : [];

      // A conflict on every row means the expiry event already fired for this task.
      if (recipients.length && rows.length === 0) {
        await markOverdue(task, now);
        skipped++;
        continue;
      }

      processed++;
      await markOverdue(task, now);

      if (!rows.length) { skipped++; continue; }

      const ctx = await notificationService.emailContextFor({ ...task, status: 'overdue' });
      const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
      const outcome = await notificationService.deliverAll(
        rows, (to) => sendExpiry(to, ctx), emailOf,
      );
      succeeded += outcome.succeeded;
      failed += outcome.failed;
    }

    return { processed, succeeded, failed, skipped };
  });
}

async function markOverdue(task: typeof tasks.$inferSelect, now: Date): Promise<void> {
  await db.batch([
    db.update(tasks).set({ status: 'overdue', updatedAt: now })
      .where(eq(tasks.id, task.id)),
    db.insert(taskHistory).values({
      taskId: task.id, actorId: null, event: 'status_changed',
      fromValue: task.status, toValue: 'overdue',
      detail: 'Marked overdue automatically — the assigned time finished',
    }),
  ] as any);
}
