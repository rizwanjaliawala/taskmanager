import { and, eq, isNotNull, lt, notInArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskHistory, tasks } from '../db/schema.js';
import { sendExpiry } from '../lib/email/index.js';
import { logger } from '../lib/logger.js';
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
      // `processed` means "the job examined this task" — every task in `lapsed`
      // counts, whatever happens to it next. See the JobResult doc comment in
      // runner.ts; this must match the definition reminders.ts uses.
      processed++;

      try {
        const recipients = await notificationService.recipientsFor(task);
        const notifRows = recipients.map((r) => ({
          userId: r.id,
          taskId: task.id,
          type: 'expired' as const,
          channel: 'email' as const,
          title: 'Task time finished',
          body: `The assigned time for "${task.title}" has finished and it is not complete.`,
          dedupeKey: expiryDedupeKey(task.id, r.id),
        }));

        // The status flip, the history row and the notification insert go out as one
        // atomic write. A crash between "status updated" and "notification recorded"
        // (or vice versa) can no longer happen — either all three land, or none do,
        // so a task can never be silently excluded from `lapsed` (via the status
        // filter above) while still owing an expiry notification nobody will retry.
        const statements: unknown[] = [
          db.update(tasks).set({ status: 'overdue', updatedAt: now })
            .where(eq(tasks.id, task.id)),
          db.insert(taskHistory).values({
            taskId: task.id, actorId: null, event: 'status_changed',
            fromValue: task.status, toValue: 'overdue',
            detail: 'Marked overdue automatically — the assigned time finished',
          }),
        ];
        if (notifRows.length) statements.push(notificationService.pendingInsert(notifRows));

        const results = await db.batch(statements as any);
        // The insert (when present) is always the last statement — index depends on
        // whether it was pushed. onConflictDoNothing means an empty result here is
        // legitimate: every recipient's dedupe key already existed, i.e. the expiry
        // event already fired for this task on a previous run. The status transition
        // above still happened; sending is simply skipped.
        const rows = notifRows.length ? ((results[2] as any[]) ?? []) : [];

        if (!rows.length) { skipped++; continue; }

        const ctx = await notificationService.emailContextFor({ ...task, status: 'overdue' });
        const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
        const outcome = await notificationService.deliverAll(
          rows, (to) => sendExpiry(to, ctx), emailOf,
        );
        succeeded += outcome.succeeded;
        failed += outcome.failed;
      } catch (err) {
        // One bad task must not abort the run and discard the counts already
        // gathered for every other task.
        logger.error('expiry job: task failed', {
          taskId: task.id, error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    return { processed, succeeded, failed, skipped };
  });
}
