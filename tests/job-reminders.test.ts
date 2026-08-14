import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, notifications, jobRuns, TASK_STATUSES } from '../src/db/schema.js';
import { createUser } from './helpers.js';
import { runReminders } from '../src/jobs/reminders.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

const app = createApp();
beforeEach(() => __resetMailbox());

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function pendingTask(status: any = 'assigned') {
  const creator = await createUser({ email: `c-${crypto.randomUUID()}@utopiabrands.com`, fullName: 'Shahzeb Ali' });
  const assignee = await createUser({ email: `a-${crypto.randomUUID()}@utopiabrands.com`, fullName: 'John Smith' });
  const [t] = await db.insert(tasks).values({
    title: 'Pending work', description: 'Still open.', createdBy: creator.id,
    assignedTo: assignee.id, priority: 'high', status,
    assignedAt: hoursAgo(30), dueAt: new Date(Date.now() + 86_400_000),
  }).returning();
  return { task: t!, creator, assignee };
}

describe('reminder job', () => {
  it('sends a reminder for a task pending past 24 hours', async () => {
    const { task, assignee, creator } = await pendingTask();
    const result = await runReminders();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(2); // assignee + assigner

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === 'reminder' && r.status === 'sent')).toBe(true);
    expect(__sentMessages.map((m) => m.to).sort())
      .toEqual([assignee.email, creator.email].sort());
  });

  it('does not send a second reminder in the same 24-hour window', async () => {
    const { task } = await pendingTask();

    const first = await runReminders();
    expect(first.succeeded).toBe(2);

    __resetMailbox();
    const second = await runReminders();

    expect(second.succeeded).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect(__sentMessages).toHaveLength(0);

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('sends again on the following day', async () => {
    const { task } = await pendingTask();
    await runReminders();
    __resetMailbox();

    const tomorrow = new Date(Date.now() + 86_400_000);
    const result = await runReminders(tomorrow);

    expect(result.succeeded).toBe(2);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(4);
  });

  it('sends nothing for a completed task', async () => {
    await pendingTask('completed');
    const result = await runReminders();
    expect(result.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('sends nothing for a cancelled task', async () => {
    await pendingTask('cancelled');
    const result = await runReminders();
    expect(result.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('sends nothing for an overdue task — expiry owns that state', async () => {
    await pendingTask('overdue');
    const result = await runReminders();
    expect(result.processed).toBe(0);
  });

  it('reminds for progress and hold, the other active statuses', async () => {
    await pendingTask('progress');
    await pendingTask('hold');
    const result = await runReminders();
    expect(result.processed).toBe(2);
  });

  it('skips a task with no assignee', async () => {
    const creator = await createUser({ email: 'noassignee@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Unassigned', createdBy: creator.id, priority: 'low', status: 'assigned',
    });
    const result = await runReminders();
    expect(result.processed).toBe(0);
  });

  it('is safe under concurrent invocations — no duplicate email', async () => {
    await pendingTask();
    const [a, b] = await Promise.all([runReminders(), runReminders()]);
    expect(a.succeeded + b.succeeded).toBe(2);
    expect(__sentMessages).toHaveLength(2);
  });

  it('writes a job_runs audit row', async () => {
    await pendingTask();
    await runReminders();
    const rows = await db.select().from(jobRuns).where(eq(jobRuns.job, 'reminders'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.finishedAt).not.toBeNull();
  });

  it('retries a previously failed notification', async () => {
    const { task, assignee } = await pendingTask();
    await db.insert(notifications).values({
      userId: assignee.id, taskId: task.id, type: 'reminder', channel: 'email',
      title: 'Reminder', body: 'x', status: 'failed', attempts: 1,
      dedupeKey: `reminder:${task.id}:${assignee.id}:1970-01-01`,
    });

    const result = await runReminders();
    expect(result.succeeded).toBeGreaterThan(0);
  });

  it('does not remind a task assigned only 5 minutes ago', async () => {
    const creator = await createUser({ email: `c-${crypto.randomUUID()}@utopiabrands.com` });
    const assignee = await createUser({ email: `a-${crypto.randomUUID()}@utopiabrands.com` });
    await db.insert(tasks).values({
      title: 'Just assigned', createdBy: creator.id, assignedTo: assignee.id,
      priority: 'medium', status: 'assigned', assignedAt: hoursAgo(5 / 60),
    });

    const result = await runReminders();
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(__sentMessages).toHaveLength(0);
  });

  it('reminds a task assigned 30 hours ago', async () => {
    const { task } = await pendingTask();
    const result = await runReminders();
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(2);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('claims a failed reminder atomically — a concurrent retry sends only once', async () => {
    const creator = await createUser({ email: `c-${crypto.randomUUID()}@utopiabrands.com` });
    const assignee = await createUser({ email: `a-${crypto.randomUUID()}@utopiabrands.com` });
    // Assigned moments ago: the age gate keeps the main loop from also sending a
    // fresh reminder, so any email observed here can only come from the retry sweep.
    const [task] = await db.insert(tasks).values({
      title: 'Recently assigned', createdBy: creator.id, assignedTo: assignee.id,
      priority: 'high', status: 'assigned', assignedAt: hoursAgo(5 / 60),
    }).returning();
    await db.insert(notifications).values({
      userId: assignee.id, taskId: task!.id, type: 'reminder', channel: 'email',
      title: 'Reminder', body: 'x', status: 'failed', attempts: 1,
      dedupeKey: `reminder:${task!.id}:${assignee.id}:1970-01-01`,
    });

    const [a, b] = await Promise.all([runReminders(), runReminders()]);

    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]!.to).toBe(assignee.email);
    expect(a.succeeded + b.succeeded).toBe(1);

    const [row] = await db.select().from(notifications)
      .where(eq(notifications.dedupeKey, `reminder:${task!.id}:${assignee.id}:1970-01-01`));
    expect(row!.status).toBe('sent');
    expect(row!.attempts).toBe(2);
  });
});

describe('job endpoint authorization', () => {
  it('rejects a request with no CRON_SECRET', async () => {
    const res = await request(app).get('/api/jobs/reminders');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong CRON_SECRET', async () => {
    const res = await request(app).get('/api/jobs/reminders')
      .set('Authorization', 'Bearer wrong-secret-value');
    expect(res.status).toBe(401);
  });

  it('accepts a GET with the correct secret — Vercel Cron uses GET', async () => {
    const res = await request(app).get('/api/jobs/reminders')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.data.job).toBe('reminders');
  });

  it('accepts a POST with the correct secret', async () => {
    const res = await request(app).post('/api/jobs/reminders')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
  });

  it('is not reachable with an ordinary user session', async () => {
    const { loginAgent } = await import('./helpers.js');
    await createUser({ email: 'nocron@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'nocron@utopiabrands.com');
    const res = await agent.get('/api/jobs/reminders');
    expect(res.status).toBe(401);
  });
});
