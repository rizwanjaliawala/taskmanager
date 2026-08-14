import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

describe('GET /api/dashboard', () => {
  it('counts every status bucket', async () => {
    const me = await createUser({ email: 'dash@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'P1', createdBy: me.id, priority: 'low', status: 'assigned' },
      { title: 'P2', createdBy: me.id, priority: 'low', status: 'assigned' },
      { title: 'IP', createdBy: me.id, priority: 'low', status: 'progress' },
      { title: 'H',  createdBy: me.id, priority: 'low', status: 'hold' },
      { title: 'C',  createdBy: me.id, priority: 'low', status: 'completed' },
      { title: 'O',  createdBy: me.id, priority: 'low', status: 'overdue' },
      { title: 'X',  createdBy: me.id, priority: 'low', status: 'cancelled' },
    ]);

    const agent = await loginAgent(app, 'dash@utopiabrands.com');
    const res = await agent.get('/api/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.data.counts).toMatchObject({
      total: 7, pending: 2, progress: 1, hold: 1, completed: 1, overdue: 1, cancelled: 1,
    });
  });

  it('counts tasks assigned to me', async () => {
    const me = await createUser({ email: 'mine@utopiabrands.com' });
    const other = await createUser({ email: 'notmine@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Mine 1', createdBy: other.id, assignedTo: me.id, priority: 'low' },
      { title: 'Mine 2', createdBy: other.id, assignedTo: me.id, priority: 'low' },
      { title: 'Theirs', createdBy: other.id, assignedTo: other.id, priority: 'low' },
    ]);

    const agent = await loginAgent(app, 'mine@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.counts.assignedToMe).toBe(2);
    expect(res.body.data.myTasks).toHaveLength(2);
  });

  it('separates due today from due soon', async () => {
    const me = await createUser({ email: 'duebuckets@utopiabrands.com' });
    const endOfToday = new Date(); endOfToday.setHours(23, 0, 0, 0);
    await db.insert(tasks).values([
      { title: 'Today',   createdBy: me.id, priority: 'low', dueAt: endOfToday },
      { title: 'In 3d',   createdBy: me.id, priority: 'low', dueAt: hours(72) },
      { title: 'In 30d',  createdBy: me.id, priority: 'low', dueAt: hours(720) },
    ]);

    const agent = await loginAgent(app, 'duebuckets@utopiabrands.com');
    const res = await agent.get('/api/dashboard');

    expect(res.body.data.counts.dueToday).toBe(1);
    expect(res.body.data.dueToday[0].title).toBe('Today');
    expect(res.body.data.dueSoon.map((t: any) => t.title)).toEqual(['In 3d']);
  });

  it('excludes completed and cancelled tasks from the due buckets', async () => {
    const me = await createUser({ email: 'duedone@utopiabrands.com' });
    const endOfToday = new Date(); endOfToday.setHours(23, 0, 0, 0);
    await db.insert(tasks).values([
      { title: 'Done today', createdBy: me.id, priority: 'low', dueAt: endOfToday, status: 'completed' },
      { title: 'Cancelled',  createdBy: me.id, priority: 'low', dueAt: endOfToday, status: 'cancelled' },
    ]);

    const agent = await loginAgent(app, 'duedone@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.counts.dueToday).toBe(0);
  });

  it('does not put a task from an earlier day in Due Today', async () => {
    // "Due today" needs a lower bound as well as an upper one. With only `< endOfDay`
    // a task due last week satisfies it, so the dashboard listed it as due today while
    // also counting it as overdue. A task due earlier *today* is deliberately still in
    // this bucket — that genuinely is today's work, and overlapping with Overdue is
    // correct for it.
    const me = await createUser({ email: 'pastdue@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Lapsed last week', createdBy: me.id, priority: 'high',
        status: 'assigned', dueAt: hours(-24 * 7) },
      { title: 'Lapsed a month ago', createdBy: me.id, priority: 'high',
        status: 'assigned', dueAt: hours(-24 * 30) },
    ]);

    const agent = await loginAgent(app, 'pastdue@utopiabrands.com');
    const res = await agent.get('/api/dashboard');

    expect(res.body.data.counts.dueToday).toBe(0);
    expect(res.body.data.dueToday).toHaveLength(0);
    // They are still visible to the user — as overdue.
    expect(res.body.data.counts.overdue).toBe(2);
  });

  it('counts a lapsed task as overdue before the expiry job has run', async () => {
    // The cron sets status='overdue' on a schedule. Between a task lapsing and the
    // next run it must still be counted somewhere, or it vanishes from the dashboard.
    const me = await createUser({ email: 'notyetcron@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Lapsed, cron has not run', createdBy: me.id, priority: 'high',
      status: 'assigned', dueAt: hours(-2),
    });

    const agent = await loginAgent(app, 'notyetcron@utopiabrands.com');
    const res = await agent.get('/api/dashboard');

    expect(res.body.data.counts.overdue).toBe(1);
    expect(res.body.data.counts.pending).toBe(1); // still stored as 'assigned'
  });

  it('does not count a completed past-due task as overdue', async () => {
    const me = await createUser({ email: 'lateDone@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Finished late', createdBy: me.id, priority: 'low',
      status: 'completed', dueAt: hours(-48),
    });

    const agent = await loginAgent(app, 'lateDone@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.counts.overdue).toBe(0);
  });

  it('lists recently assigned tasks newest first', async () => {
    const me = await createUser({ email: 'recent@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Older', createdBy: me.id, assignedTo: me.id, priority: 'low', assignedAt: hours(-5) },
      { title: 'Newer', createdBy: me.id, assignedTo: me.id, priority: 'low', assignedAt: hours(-1) },
    ]);

    const agent = await loginAgent(app, 'recent@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.recentlyAssigned[0].title).toBe('Newer');
  });

  it('rejects an unauthenticated request', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/bootstrap', () => {
  it('returns me, users, tasks and notifications in one call', async () => {
    await createUser({ email: 'boot@utopiabrands.com', fullName: 'Boot User' });
    await createUser({ email: 'boot2@utopiabrands.com' });

    const agent = await loginAgent(app, 'boot@utopiabrands.com');
    const res = await agent.get('/api/bootstrap');

    expect(res.status).toBe(200);
    expect(res.body.data.me.fullName).toBe('Boot User');
    expect(res.body.data.users).toHaveLength(2);
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
  });

  it('exposes no password hash', async () => {
    await createUser({ email: 'bootsafe@utopiabrands.com' });
    const agent = await loginAgent(app, 'bootsafe@utopiabrands.com');
    const res = await agent.get('/api/bootstrap');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });
});
