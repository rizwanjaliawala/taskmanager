import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { notifications, tasks } from '../src/db/schema.js';
import { createUser } from './helpers.js';
import { runWeeklyDigest, isoWeek, digestDedupeKey } from '../src/jobs/digest.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

const app = createApp();
beforeEach(() => __resetMailbox());

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

async function personWithTasks(email: string, rows: Array<Partial<typeof tasks.$inferInsert>>) {
  const u = await createUser({ email, fullName: 'Digest Person' });
  if (rows.length) {
    await db.insert(tasks).values(rows.map((r) => ({
      title: 'Task', createdBy: u.id, assignedTo: u.id, priority: 'medium' as const,
      status: 'assigned' as const, ...r,
    })) as any);
  }
  return u;
}

describe('ISO week key', () => {
  it('is stable across every day of the same week', () => {
    // Mon 10 Aug 2026 through Sun 16 Aug 2026 must all produce one key.
    const days = [10, 11, 12, 13, 14, 15, 16].map((d) => new Date(Date.UTC(2026, 7, d, 8, 0, 0)));
    const keys = new Set(days.map(isoWeek));
    expect(keys.size).toBe(1);
  });

  it('changes on the following Monday', () => {
    const thisWeek = isoWeek(new Date(Date.UTC(2026, 7, 16)));  // Sunday
    const nextWeek = isoWeek(new Date(Date.UTC(2026, 7, 17)));  // Monday
    expect(nextWeek).not.toBe(thisWeek);
  });

  it('produces a distinct dedupe key per user', () => {
    const now = new Date();
    expect(digestDedupeKey('user-a', now)).not.toBe(digestDedupeKey('user-b', now));
  });
});

describe('weekly digest', () => {
  it('sends one digest to a person with open tasks', async () => {
    await personWithTasks('d1@utopiabrands.com', [{ title: 'Open work', dueAt: hours(48) }]);

    const result = await runWeeklyDigest();

    expect(result.succeeded).toBe(1);
    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]!.to).toBe('d1@utopiabrands.com');
    expect(__sentMessages[0]!.html).toContain('Open work');
  });

  it('does not email someone with an empty board and nothing closed', async () => {
    await personWithTasks('d2@utopiabrands.com', []);

    const result = await runWeeklyDigest();

    expect(result.succeeded).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('separates overdue from due-this-week in the email', async () => {
    await personWithTasks('d3@utopiabrands.com', [
      { title: 'Slipped already', dueAt: hours(-72) },
      { title: 'Due in two days', dueAt: hours(48) },
    ]);

    await runWeeklyDigest();
    const html = __sentMessages[0]!.html;

    expect(html).toContain('Overdue');
    expect(html).toContain('Slipped already');
    expect(html).toContain('Due in two days');
  });

  it('names the overdue count in the subject when something has slipped', async () => {
    await personWithTasks('d4@utopiabrands.com', [{ title: 'Late', dueAt: hours(-96) }]);
    await runWeeklyDigest();
    expect(__sentMessages[0]!.subject.toLowerCase()).toContain('overdue');
  });

  it('excludes completed and cancelled tasks from the open list', async () => {
    await personWithTasks('d5@utopiabrands.com', [
      { title: 'Finished', status: 'completed', completedAt: hours(-24) },
      { title: 'Dropped', status: 'cancelled' },
      { title: 'Still going', dueAt: hours(24) },
    ]);

    await runWeeklyDigest();
    const html = __sentMessages[0]!.html;

    expect(html).toContain('Still going');
    expect(html).not.toContain('Dropped');
  });

  it('counts last week\'s completions even when the board is now empty', async () => {
    await personWithTasks('d6@utopiabrands.com', [
      { title: 'Closed recently', status: 'completed', completedAt: hours(-48) },
    ]);

    const result = await runWeeklyDigest();

    expect(result.succeeded).toBe(1);
    // With nothing open the intro takes its other branch, so assert on the shared tail.
    expect(__sentMessages[0]!.html).toContain('closed last week');
    expect(__sentMessages[0]!.html).toContain('Nothing is open on your board');
  });

  it('does not send a second digest in the same week', async () => {
    await personWithTasks('d7@utopiabrands.com', [{ title: 'Work', dueAt: hours(48) }]);

    const first = await runWeeklyDigest();
    expect(first.succeeded).toBe(1);

    __resetMailbox();
    const second = await runWeeklyDigest();

    expect(second.succeeded).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('sends again the following week', async () => {
    const u = await personWithTasks('d8@utopiabrands.com', [{ title: 'Work', dueAt: hours(48) }]);
    await runWeeklyDigest();
    __resetMailbox();

    const nextWeek = new Date(Date.now() + 8 * 86_400_000);
    const result = await runWeeklyDigest(nextWeek);

    expect(result.succeeded).toBe(1);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(rows).toHaveLength(2);
  });

  it('is safe under concurrent invocations', async () => {
    await personWithTasks('d9@utopiabrands.com', [{ title: 'Work', dueAt: hours(48) }]);

    const [a, b] = await Promise.all([runWeeklyDigest(), runWeeklyDigest()]);

    expect(a.succeeded + b.succeeded).toBe(1);
    expect(__sentMessages).toHaveLength(1);
  });

  it('skips deactivated people', async () => {
    const u = await createUser({ email: 'd10@utopiabrands.com', isActive: false });
    await db.insert(tasks).values({
      title: 'Work', createdBy: u.id, assignedTo: u.id, priority: 'low',
      status: 'assigned', dueAt: hours(48),
    });

    const result = await runWeeklyDigest();

    expect(result.succeeded).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('records a notification row per digest sent', async () => {
    const u = await personWithTasks('d11@utopiabrands.com', [{ title: 'Work', dueAt: hours(48) }]);
    await runWeeklyDigest();

    const rows = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('digest');
    expect(rows[0]!.status).toBe('sent');
  });
});

describe('digest endpoint authorization', () => {
  it('rejects a request with no cron secret', async () => {
    const res = await request(app).get('/api/jobs/digest');
    expect(res.status).toBe(401);
  });

  it('accepts GET with the correct secret — Vercel Cron uses GET', async () => {
    const res = await request(app).get('/api/jobs/digest')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.data.job).toBe('weekly-digest');
  });
});
