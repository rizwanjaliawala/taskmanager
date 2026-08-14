import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { tasks, notifications, taskHistory } from '../src/db/schema.js';
import { createUser } from './helpers.js';
import { runExpiry } from '../src/jobs/expiry.js';
import { runReminders } from '../src/jobs/reminders.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

beforeEach(() => __resetMailbox());
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function overdueTask(status: any = 'assigned', dueAt = hoursAgo(2)) {
  const creator = await createUser({ email: `ec-${crypto.randomUUID()}@utopiabrands.com` });
  const assignee = await createUser({ email: `ea-${crypto.randomUUID()}@utopiabrands.com` });
  const [t] = await db.insert(tasks).values({
    title: 'Past its time', description: 'Not finished.', createdBy: creator.id,
    assignedTo: assignee.id, priority: 'critical', status, assignedAt: hoursAgo(48), dueAt,
  }).returning();
  return { task: t!, creator, assignee };
}

describe('expiry job', () => {
  it('flips a past-due task to overdue', async () => {
    const { task } = await overdueTask();
    const result = await runExpiry();

    expect(result.processed).toBe(1);
    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after!.status).toBe('overdue');
  });

  it('emails both the assignee and the assigner', async () => {
    const { assignee, creator } = await overdueTask();
    await runExpiry();
    expect(__sentMessages.map((m) => m.to).sort()).toEqual([assignee.email, creator.email].sort());
  });

  it('says the assigned time has finished and names the task', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    const body = __sentMessages[0]!.html;
    expect(body).toContain(task.ref);
    expect(body).toContain('Past its time');
    expect(body.toLowerCase()).toContain('finished');
  });

  it('records the notification rows', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === 'expired' && r.status === 'sent')).toBe(true);
  });

  it('writes a status_changed history event', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, task.id));
    const ev = rows.find((r) => r.event === 'status_changed');
    expect(ev!.fromValue).toBe('assigned');
    expect(ev!.toValue).toBe('overdue');
  });

  it('does not send a second expiry email on a later run', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    __resetMailbox();

    const second = await runExpiry();
    expect(second.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('does not resend even if the task is manually reset to pending', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    __resetMailbox();

    // A user reopens it, then it lapses again — the expiry event already fired.
    await db.update(tasks).set({ status: 'assigned' }).where(eq(tasks.id, task.id));
    await runExpiry();

    expect(__sentMessages).toHaveLength(0);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('ignores a completed task past its due date', async () => {
    await overdueTask('completed');
    const result = await runExpiry();
    expect(result.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('ignores a cancelled task past its due date', async () => {
    await overdueTask('cancelled');
    const result = await runExpiry();
    expect(result.processed).toBe(0);
  });

  it('ignores a task that is not yet due', async () => {
    await overdueTask('assigned', new Date(Date.now() + 86_400_000));
    const result = await runExpiry();
    expect(result.processed).toBe(0);
  });

  it('ignores a task with no due date', async () => {
    const creator = await createUser({ email: 'nodue@utopiabrands.com' });
    const assignee = await createUser({ email: 'nodue2@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Open ended', createdBy: creator.id, assignedTo: assignee.id,
      priority: 'low', status: 'assigned', dueAt: null,
    });
    const result = await runExpiry();
    expect(result.processed).toBe(0);
  });

  it('is safe under concurrent invocations', async () => {
    await overdueTask();
    await Promise.all([runExpiry(), runExpiry()]);
    expect(__sentMessages).toHaveLength(2);
  });

  it('stops sending reminders once a task expires', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    __resetMailbox();

    const reminders = await runReminders();
    expect(reminders.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);

    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after!.status).toBe('overdue');
  });
});
