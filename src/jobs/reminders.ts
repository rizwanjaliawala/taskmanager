import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ACTIVE_STATUSES, notifications, tasks } from '../db/schema.js';
import { sendReminder } from '../lib/email/index.js';
import * as notificationService from '../services/notification.service.js';
import { runJob, type JobResult } from './runner.js';

const MAX_ATTEMPTS = 5;

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
      processed++;
      const recipients = await notificationService.recipientsFor(task);
      if (!recipients.length) { skipped++; continue; }

      const ctx = await notificationService.emailContextFor(task);
      const hoursPending = task.assignedAt
        ? (now.getTime() - task.assignedAt.getTime()) / 3_600_000
        : (now.getTime() - task.createdAt.getTime()) / 3_600_000;

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
    }

    const retried = await retryFailed(now);
    succeeded += retried.succeeded;
    failed += retried.failed;

    return { processed, succeeded, failed, skipped };
  });
}

/**
 * Re-attempts notifications that failed delivery, with a simple attempt ceiling.
 * Scoped to type 'reminder' — this job must never resend a failed 'expired'
 * notification through the reminder template; the expiry job owns retrying those.
 */
async function retryFailed(now: Date): Promise<{ succeeded: number; failed: number }> {
  const stuck = await db.select().from(notifications).where(and(
    eq(notifications.status, 'failed'),
    eq(notifications.type, 'reminder'),
    lt(notifications.attempts, MAX_ATTEMPTS),
  )).limit(50);

  let succeeded = 0, failed = 0;

  for (const n of stuck) {
    if (!n.taskId) { failed++; continue; }
    const [task] = await db.select().from(tasks).where(eq(tasks.id, n.taskId));
    if (!task) { failed++; continue; }

    const recipients = await notificationService.recipientsFor(task);
    const recipient = recipients.find((r) => r.id === n.userId);
    if (!recipient) { failed++; continue; }

    const ctx = await notificationService.emailContextFor(task);
    const hoursPending = (now.getTime() - (task.assignedAt ?? task.createdAt).getTime()) / 3_600_000;

    try {
      await sendReminder([recipient.email], { ...ctx, hoursPending });
      await notificationService.markSent(n.id);
      succeeded++;
    } catch (err) {
      await notificationService.markFailed(n.id, err, n.attempts);
      failed++;
    }
  }

  return { succeeded, failed };
}
