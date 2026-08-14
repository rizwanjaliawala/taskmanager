import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { notifications } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function notifyFor(userId: string, title = 'New task assigned') {
  const [n] = await db.insert(notifications).values({
    userId, type: 'assigned', channel: 'in_app', title, body: 'Something happened',
  }).returning();
  return n!;
}

describe('GET /api/notifications', () => {
  it('returns only the caller notifications', async () => {
    const me = await createUser({ email: 'n1@utopiabrands.com' });
    const other = await createUser({ email: 'n2@utopiabrands.com' });
    await notifyFor(me.id, 'Mine');
    await notifyFor(other.id, 'Theirs');

    const agent = await loginAgent(app, 'n1@utopiabrands.com');
    const res = await agent.get('/api/notifications');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mine');
  });

  it('reports read state as a boolean', async () => {
    const me = await createUser({ email: 'n3@utopiabrands.com' });
    await notifyFor(me.id);
    const agent = await loginAgent(app, 'n3@utopiabrands.com');
    const res = await agent.get('/api/notifications');
    expect(res.body.data[0].read).toBe(false);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  it('marks the caller notification read', async () => {
    const me = await createUser({ email: 'n4@utopiabrands.com' });
    const n = await notifyFor(me.id);
    const agent = await loginAgent(app, 'n4@utopiabrands.com');

    const res = await agent.patch(`/api/notifications/${n.id}/read`);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row!.readAt).not.toBeNull();
  });

  it("refuses to mark another user's notification read", async () => {
    const victim = await createUser({ email: 'n5@utopiabrands.com' });
    const n = await notifyFor(victim.id);
    await createUser({ email: 'n6@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'n6@utopiabrands.com');

    const res = await agent.patch(`/api/notifications/${n.id}/read`);
    expect(res.status).toBe(403);

    const [row] = await db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row!.readAt).toBeNull();
  });

  it('marks all as read', async () => {
    const me = await createUser({ email: 'n7@utopiabrands.com' });
    await notifyFor(me.id, 'A');
    await notifyFor(me.id, 'B');
    const agent = await loginAgent(app, 'n7@utopiabrands.com');

    await agent.post('/api/notifications/read-all');
    const res = await agent.get('/api/notifications');
    expect(res.body.data.every((n: any) => n.read)).toBe(true);
  });
});
