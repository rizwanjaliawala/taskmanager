import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ACTIVE_STATUSES, notifications, tasks } from '../db/schema.js';
import { sendExpiry, sendReminder } from '../lib/email/index.js';
import { logger } from '../lib/logger.js';
import * as notificationService from '../services/notification.service.js';
import { runJob, type JobResult } from './runner.js';

const MAX_ATTEMPTS = 5;

/**
 * A task is reminded only once it has been pending at least this long. 20 hours,
 * not 24: this absorbs cron jitter. On a daily schedule, a task assigned at 09:05
 * Monday must still get its first reminder Tuesday at 09:00 — 23.9 hours later. A
 * strict 24-hour gate would miss that tick (23.9 < 24) and silently push the first
 * reminder to Wednesday.
 */
const MIN_PENDING_HOURS = 20;

/**
 * A 'pending' notification row older than this is an orphan — most likely a crash
 * between the insert and the send — not a row genuinely in flight from this run.
 */
const PENDING_ORPHAN_AGE_MS = 60 * 60 * 1000;

/** One reminder per task, per recipient, per UTC calendar day. */
export function reminderDedupeKey(taskId: string, userId: string, now: Date): string {
  return `reminder:${taskId}:${userId}:${now.toISOString().slice(0, 10)}`;
}

export function runReminders(now = new Date()): Promise<JobResult> {
  return runJob('reminders', async () => {
    let processed = 0, succeeded = 0, failed = 0, skipped = 0;

    // Completed, cancelled and overdue are excluded by this status filter.
    const due = await db.select().from(tasks).where(and(
      inArray(tasks.status, [...ACTIVE_STATUSES]),
      isNotNull(tasks.assignedTo),
    ));

    for (const task of due) {
      // `processed` means "the job examined this task" — every task in `due` counts,
      // whatever happens to it next. See the JobResult doc comment in runner.ts.
      processed++;

      try {
        const hoursPending =
          (now.getTime() - (task.assignedAt ?? task.createdAt).getTime()) / 3_600_000;
        if (hoursPending < MIN_PENDING_HOURS) { skipped++; continue; }

        const recipients = await notificationService.recipientsFor(task);
        if (!recipients.length) { skipped++; continue; }

        const ctx = await notificationService.emailContextFor(task);

        // The unique index on dedupe_key decides who sends. A row that comes back
        // was inserted by THIS run; a conflict means another run already owns it.
        const rows = await notificationService.createPending(recipients.map((r) => ({
          userId: r.id,
          taskId: task.id,
          type: 'reminder' as const,
          channel: 'email' as const,
          title: 'Task still pending',
          body: `"${task.title}" is still open and awaiting completion.`,
          dedupeKey: reminderDedupeKey(task.id, r.id, now),
        })));

        skipped += recipients.length - rows.length;

        const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
        const outcome = await notificationService.deliverAll(
          rows, (to) => sendReminder(to, { ...ctx, hoursPending }), emailOf,
        );
        succeeded += outcome.succeeded;
        failed += outcome.failed;
      } catch (err) {
        // One bad task (a data anomaly, a transient read failure) must not abort the
        // run and discard the counts already gathered for every other task.
        logger.error('reminders job: task failed', {
          taskId: task.id, error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    const retried = await retryFailed(now);
    succeeded += retried.succeeded;
    failed += retried.failed;

    return { processed, succeeded, failed, skipped };
  });
}

/**
 * Re-attempts notifications that never got delivered, with a simple attempt ceiling.
 *
 * Dispatches on each row's own `type` rather than being scoped to one type — a
 * 'reminder' row goes back through the reminder template, an 'expired' row through
 * the expiry template. The expiry dedupe key has no date component, so a transient
 * failure there must not be a permanent loss: this sweep is the only place expiry
 * notifications ever get retried.
 *
 * Two kinds of stuck rows are picked up: 'failed' rows (a send that threw), and
 * 'pending' rows older than an hour (orphaned by a crash between the insert and the
 * send — a genuinely in-flight pending row from the current run is younger than
 * that). Each candidate is claimed atomically before being acted on; a caller that
 * loses the claim race skips the row.
 */
async function retryFailed(now: Date): Promise<{ succeeded: number; failed: number }> {
  const cutoff = new Date(now.getTime() - PENDING_ORPHAN_AGE_MS);

  const stuck = await db.select().from(notifications).where(and(
    inArray(notifications.type, ['reminder', 'expired']),
    lt(notifications.attempts, MAX_ATTEMPTS),
    or(
      eq(notifications.status, 'failed'),
      and(eq(notifications.status, 'pending'), lt(notifications.createdAt, cutoff)),
    ),
  )).limit(50);

  let succeeded = 0, failed = 0;

  for (const n of stuck) {
    try {
      const claimed = await notificationService.claimForRetry(n);
      if (!claimed) continue; // another run claimed this row first

      if (!n.taskId) throw new Error('notification has no taskId');
      const [task] = await db.select().from(tasks).where(eq(tasks.id, n.taskId));
      if (!task) throw new Error('task no longer exists');

      const recipients = await notificationService.recipientsFor(task);
      const recipient = recipients.find((r) => r.id === n.userId);
      if (!recipient) throw new Error('recipient no longer eligible');

      if (n.type === 'expired') {
        const ctx = await notificationService.emailContextFor({ ...task, status: 'overdue' });
        await sendExpiry([recipient.email], ctx);
      } else {
        const ctx = await notificationService.emailContextFor(task);
        const hoursPending =
          (now.getTime() - (task.assignedAt ?? task.createdAt).getTime()) / 3_600_000;
        await sendReminder([recipient.email], { ...ctx, hoursPending });
      }

      await notificationService.markSent(claimed.id);
      succeeded++;
    } catch (err) {
      await notificationService.markRetryFailed(n.id, err);
      failed++;
    }
  }

  return { succeeded, failed };
}
