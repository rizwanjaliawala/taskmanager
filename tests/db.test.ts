import { describe, expect, it } from 'vitest';
import { sql as dsql, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import {
  users, tasks, notifications, ROLES, TASK_STATUSES, TASK_PRIORITIES,
} from '../src/db/schema.js';

async function makeUser(email: string) {
  const [u] = await db.insert(users).values({
    fullName: 'Test User', email, passwordHash: 'x', role: 'manager',
  }).returning();
  return u!;
}

describe('database schema', () => {
  it('creates every expected table', async () => {
    const rows = await db.execute(dsql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    const names = (rows.rows as { table_name: string }[]).map((r) => r.table_name);
    for (const t of ['teams','users','tasks','task_history','task_comments','notifications','login_attempts','job_runs']) {
      expect(names).toContain(t);
    }
  });

  it('enforces a unique email', async () => {
    await makeUser('dup@utopiabrands.com');
    await expect(makeUser('dup@utopiabrands.com')).rejects.toThrow();
  });

  it('treats email as case-insensitive', async () => {
    await makeUser('Case@utopiabrands.com');
    await expect(makeUser('case@utopiabrands.com')).rejects.toThrow();
  });

  it('auto-generates a UT- prefixed task ref', async () => {
    const u = await makeUser('ref@utopiabrands.com');
    const [t] = await db.insert(tasks).values({
      title: 'Ref test', createdBy: u.id, priority: 'medium', status: 'assigned',
    }).returning();
    expect(t!.ref).toMatch(/^UT-\d{4,}$/);
  });

  it('rejects a progress value above 100', async () => {
    const u = await makeUser('prog@utopiabrands.com');
    await expect(
      db.insert(tasks).values({
        title: 'Bad', createdBy: u.id, priority: 'low', status: 'assigned', progress: 150,
      }),
    ).rejects.toThrow();
  });

  it('rejects a progress value below 0', async () => {
    const u = await makeUser('prog-neg@utopiabrands.com');
    await expect(
      db.insert(tasks).values({
        title: 'Bad', createdBy: u.id, priority: 'low', status: 'assigned', progress: -1,
      }),
    ).rejects.toThrow();
  });

  it('round-trips every role, task status and task priority enum member', async () => {
    for (const role of ROLES) {
      const [u] = await db.insert(users).values({
        fullName: 'Enum User', email: `role-${role}@utopiabrands.com`, passwordHash: 'x', role,
      }).returning();
      expect(u!.role).toBe(role);
    }

    const creator = await makeUser('enum-creator@utopiabrands.com');

    for (const status of TASK_STATUSES) {
      const [t] = await db.insert(tasks).values({
        title: `Status ${status}`, createdBy: creator.id, priority: 'medium', status,
      }).returning();
      expect(t!.status).toBe(status);
    }

    for (const priority of TASK_PRIORITIES) {
      const [t] = await db.insert(tasks).values({
        title: `Priority ${priority}`, createdBy: creator.id, priority, status: 'assigned',
      }).returning();
      expect(t!.priority).toBe(priority);
    }
  });

  it('enforces a unique dedupe_key on notifications', async () => {
    const u = await makeUser('dedupe@utopiabrands.com');
    const row = { userId: u.id, type: 'reminder' as const, channel: 'email' as const,
      title: 'r', body: 'r', dedupeKey: 'reminder:abc:2026-08-13' };
    await db.insert(notifications).values(row);
    await expect(db.insert(notifications).values(row)).rejects.toThrow();
  });

  it('allows many notifications with a null dedupe_key', async () => {
    const u = await makeUser('nulls@utopiabrands.com');
    const row = { userId: u.id, type: 'comment' as const, channel: 'in_app' as const,
      title: 'c', body: 'c', dedupeKey: null };
    await db.insert(notifications).values(row);
    await db.insert(notifications).values(row);
    const all = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(all).toHaveLength(2);
  });

  it('rolls back the whole batch when one statement fails', async () => {
    const u = await makeUser('batch@utopiabrands.com');
    await expect(
      db.batch([
        db.insert(tasks).values({ title: 'Batch A', createdBy: u.id, priority: 'low', status: 'assigned' }),
        db.insert(tasks).values({ title: 'Batch B', createdBy: u.id, priority: 'low', status: 'assigned', progress: 999 }),
      ] as any),
    ).rejects.toThrow();
    const remaining = await db.select().from(tasks);
    expect(remaining).toHaveLength(0);
  });
});
