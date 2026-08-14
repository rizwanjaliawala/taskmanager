import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications, tasks, users } from '../db/schema.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { isOverdue } from '../lib/serialize.js';
import { sendWeeklyDigest, taskUrlFor } from '../lib/email/index.js';
import type { DigestTask } from '../lib/email/templates/weekly-digest.js';
import * as notificationService from '../services/notification.service.js';
import { runJob, type JobResult } from './runner.js';

/** Statuses that still represent work on someone's plate. */
const OPEN_STATUSES = ['assigned', 'progress', 'hold', 'overdue'] as const;

/**
 * One digest per person per ISO week.
 *
 * The week number — not the date — is what makes this idempotent: running the job twice
 * on Monday, or re-running it on Tuesday after a failure, produces the same key and the
 * unique constraint drops the duplicate. A plain date would send again the next morning.
 */
export function digestDedupeKey(userId: string, now: Date): string {
  return `digest:${userId}:${isoWeek(now)}`;
}

/** e.g. `2026-W33`. ISO weeks start Monday, so a Monday-morning run is stable all week. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current week decides the year, per ISO 8601.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d;
}

const toDigestTask = (t: typeof tasks.$inferSelect, now: Date): DigestTask => ({
  ref: t.ref,
  title: t.title,
  priority: t.priority,
  status: t.status,
  dueAt: t.dueAt,
  isOverdue: isOverdue(t, now),
  taskUrl: taskUrlFor(t.ref),
});

/**
 * Monday roll-up: what each person has open, what slipped, what is due this week.
 *
 * Skips anyone with an empty board and nothing closed — an email saying "you have no
 * tasks" every Monday is how a notification becomes something people filter away.
 */
export function runWeeklyDigest(now = new Date()): Promise<JobResult> {
  return runJob('weekly-digest', async () => {
    let processed = 0, succeeded = 0, failed = 0, skipped = 0;

    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);

    const people = await db.select().from(users).where(eq(users.isActive, true));

    const open = await db.select().from(tasks).where(and(
      inArray(tasks.status, [...OPEN_STATUSES]),
      isNotNull(tasks.assignedTo),
    ));

    const closed = await db.select().from(tasks).where(and(
      eq(tasks.status, 'completed'),
      isNotNull(tasks.completedAt),
      gte(tasks.completedAt, lastWeekStart),
    ));

    for (const person of people) {
      processed++;
      try {
        const mine = open.filter((t) => t.assignedTo === person.id);
        const completedLastWeek = closed.filter((t) => t.assignedTo === person.id).length;

        if (!mine.length && !completedLastWeek) { skipped++; continue; }

        const rows = mine.map((t) => toDigestTask(t, now));
        const overdue = rows.filter((t) => t.isOverdue || t.status === 'overdue');
        const rest = rows.filter((t) => !overdue.includes(t));
        const dueThisWeek = rest.filter((t) =>
          t.dueAt && t.dueAt.getTime() >= weekStart.getTime() && t.dueAt.getTime() < weekEnd.getTime());
        const otherOpen = rest.filter((t) => !dueThisWeek.includes(t));

        const created = await notificationService.createPending([{
          userId: person.id,
          type: 'digest' as const,
          channel: 'email' as const,
          title: 'Your week ahead',
          body: `${rows.length} open task${rows.length === 1 ? '' : 's'}, ${overdue.length} overdue.`,
          dedupeKey: digestDedupeKey(person.id, now),
        }]);

        // Another run this week already owns this person's digest.
        if (!created.length) { skipped++; continue; }

        const row = created[0]!;
        try {
          await sendWeeklyDigest(person.email, {
            recipientName: person.fullName,
            weekOf: weekStart,
            overdue, dueThisWeek, otherOpen,
            completedLastWeek,
            appUrl: env.APP_URL,
          });
          await notificationService.markSent(row.id);
          succeeded++;
        } catch (err) {
          await notificationService.markFailed(row.id, err, row.attempts);
          failed++;
        }
      } catch (err) {
        // One person's bad data must not stop everyone else's digest.
        logger.error('Weekly digest failed for a recipient', {
          userId: person.id, message: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    return { processed, succeeded, failed, skipped };
  });
}
