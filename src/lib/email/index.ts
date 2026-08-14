import { env } from '../env.js';
import { logger } from '../logger.js';
import { AppError } from '../errors.js';
import type { PublicUser } from '../serialize.js';
import type { TaskPriority, TaskStatus } from '../../db/schema.js';
import { deliver, __sentMessages, __resetMailbox } from './transport.js';
import { assignmentHtml, assignmentSubject, assignmentText } from './templates/assignment.js';
import { reminderHtml, reminderSubject, reminderText } from './templates/reminder.js';
import { expiryHtml, expirySubject, expiryText } from './templates/expiry.js';
import { accountCreatedHtml, accountCreatedSubject, accountCreatedText } from './templates/account-created.js';
import { digestHtml, digestSubject, digestText, type DigestContext } from './templates/weekly-digest.js';

export { __sentMessages, __resetMailbox };

export type TaskEmailContext = {
  ref: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: Date | null;
  assignedByName: string;
  assignedToName: string;
  taskUrl: string;
};

export function taskUrlFor(ref: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/#task/${encodeURIComponent(ref)}`;
}

/** Templates receive a context object, never a database row — no internal id can leak. */
async function fanOut(
  recipients: string[], subject: string, html: string, text: string, kind: string,
): Promise<void> {
  const unique = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  const failures: string[] = [];

  for (const to of unique) {
    try {
      await deliver({ to, subject, html, text });
    } catch (err) {
      failures.push(to);
      logger.error(`${kind} email failed`, {
        to, message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failures.length === unique.length && unique.length > 0) {
    throw new AppError('EMAIL_FAILED', `Could not deliver the ${kind} email`);
  }
}

export function sendAssignment(to: string[], c: TaskEmailContext): Promise<void> {
  return fanOut(to, assignmentSubject(c), assignmentHtml(c), assignmentText(c), 'assignment');
}

export function sendReminder(to: string[], c: TaskEmailContext & { hoursPending: number }): Promise<void> {
  return fanOut(to, reminderSubject(c), reminderHtml(c), reminderText(c), 'reminder');
}

export function sendExpiry(to: string[], c: TaskEmailContext): Promise<void> {
  return fanOut(to, expirySubject(c), expiryHtml(c), expiryText(c), 'expiry');
}

/** The Monday roll-up. One recipient per call — each person's digest is their own. */
export function sendWeeklyDigest(to: string, c: DigestContext): Promise<void> {
  return fanOut([to], digestSubject(c), digestHtml(c), digestText(c), 'weekly-digest');
}

export function sendAccountCreated(input: {
  user: PublicUser; tempPassword: string; createdBy: string;
}): Promise<void> {
  return fanOut([input.user.email], accountCreatedSubject(),
    accountCreatedHtml(input), accountCreatedText(input), 'account-created');
}
