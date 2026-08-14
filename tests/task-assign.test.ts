import { describe, expect, it, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, taskHistory, notifications } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

const app = createApp();
beforeEach(() => __resetMailbox());

async function setup() {
  const assigner = await createUser({ email: 'assigner@utopiabrands.com', fullName: 'Shahzeb Ali' });
  const assignee = await createUser({ email: 'assignee@utopiabrands.com', fullName: 'John Smith' });
  const agent = await loginAgent(app, 'assigner@utopiabrands.com');
  const made = await agent.post('/api/tasks').send({
    title: 'Verify container CTNR-88213',
    description: 'Cross-check the manifest.',
    priority: 'high',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return { assigner, assignee, agent, taskId: made.body.data.id as string, ref: made.body.data.ref as string };
}

describe('POST /api/tasks/:id/assign', () => {
  it('saves the assignment on the task', async () => {
    const { assignee, agent, taskId } = await setup();
    const res = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedTo).toBe(assignee.id);
    expect(res.body.data.assignedAt).not.toBeNull();
  });

  it('records an assigned history event naming the actor', async () => {
    const { assigner, assignee, agent, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId));
    const ev = rows.find((r) => r.event === 'assigned');
    expect(ev).toBeDefined();
    expect(ev!.actorId).toBe(assigner.id);
    expect(ev!.toValue).toBe(assignee.id);
  });

  it('records reassigned, not assigned, on the second assignment', async () => {
    const { assignee, agent, taskId } = await setup();
    const third = await createUser({ email: 'third@utopiabrands.com' });

    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: third.id });

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId));
    const re = rows.find((r) => r.event === 'reassigned');
    expect(re).toBeDefined();
    expect(re!.fromValue).toBe(assignee.id);
    expect(re!.toValue).toBe(third.id);
  });

  it('creates notification records for assignee and assigner', async () => {
    const { assigner, assignee, agent, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, taskId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([assigner.id, assignee.id].sort());
    expect(rows.every((r) => r.type === 'assigned')).toBe(true);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
  });

  it('sends the assignment email to both the assignee and the assigner', async () => {
    const { agent, assignee, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    expect(__sentMessages).toHaveLength(2);
    expect(__sentMessages.map((m) => m.to).sort())
      .toEqual(['assignee@utopiabrands.com', 'assigner@utopiabrands.com']);
  });

  it('includes the task detail and a link in the email', async () => {
    const { agent, assignee, taskId, ref } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    const body = __sentMessages[0]!.html;
    expect(body).toContain(ref);
    expect(body).toContain('Verify container CTNR-88213');
    expect(body).toContain('High');
    expect(body).toContain('Shahzeb Ali');
    expect(body).toContain(`#task/${ref}`);
  });

  it('sends one email when the assigner assigns to themselves', async () => {
    const { assigner, agent, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assigner.id });
    expect(__sentMessages).toHaveLength(1);
  });

  it('lets any active user assign — flat permissions', async () => {
    const { assignee, taskId } = await setup();
    await createUser({ email: 'junior@utopiabrands.com', role: 'executive' });
    const junior = await loginAgent(app, 'junior@utopiabrands.com');

    const res = await junior.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    expect(res.status).toBe(200);
  });

  it('rejects assigning to an unknown user', async () => {
    const { agent, taskId } = await setup();
    const res = await agent.post(`/api/tasks/${taskId}/assign`)
      .send({ assigneeId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_ASSIGNMENT');
  });

  it('rejects assigning to an inactive user', async () => {
    const { agent, taskId } = await setup();
    const gone = await createUser({ email: 'gone@utopiabrands.com', isActive: false });
    const res = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: gone.id });
    expect(res.status).toBe(422);
  });

  it('rejects assigning a completed task', async () => {
    const { assignee, agent, taskId } = await setup();
    await db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, taskId));
    const res = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    expect(res.status).toBe(422);
  });

  it('rejects an unauthenticated assign', async () => {
    const { assignee, taskId } = await setup();
    const request = (await import('supertest')).default;
    const res = await request(app).post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    expect(res.status).toBe(401);
  });
});

describe('notification idempotency (the mechanism Tasks 13 and 14 depend on)', () => {
  it('createPending returns only the rows it actually inserted', async () => {
    const { createPending } = await import('../src/services/notification.service.js');
    const user = await createUser({ email: 'dedupe-svc@utopiabrands.com' });

    const row = {
      userId: user.id, type: 'reminder' as const, channel: 'email' as const,
      title: 'r', body: 'r', dedupeKey: `reminder:${user.id}:2026-08-14`,
    };

    // First caller owns it and must be told so.
    const first = await createPending([row]);
    expect(first).toHaveLength(1);

    // Second caller conflicts. It must get an empty array rather than throwing —
    // that empty result is precisely how a job learns another run already sent this.
    const second = await createPending([row]);
    expect(second).toHaveLength(0);
  });

  it('createPending returns only the new subset when some rows conflict', async () => {
    const { createPending } = await import('../src/services/notification.service.js');
    const a = await createUser({ email: 'dedupe-a@utopiabrands.com' });
    const b = await createUser({ email: 'dedupe-b@utopiabrands.com' });

    const mk = (u: string) => ({
      userId: u, type: 'reminder' as const, channel: 'email' as const,
      title: 'r', body: 'r', dedupeKey: `reminder:${u}:2026-08-14`,
    });

    await createPending([mk(a.id)]);
    const mixed = await createPending([mk(a.id), mk(b.id)]);

    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.userId).toBe(b.id);
  });

  it('reassigning back to the original assignee still notifies', async () => {
    // The dedupe key includes the assignment timestamp, so a genuine reassignment
    // is never mistaken for a duplicate of an earlier one to the same person.
    const { assignee, agent, taskId } = await setup();
    const third = await createUser({ email: 'round-trip@utopiabrands.com' });

    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: third.id });
    __resetMailbox();
    const back = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    expect(back.status).toBe(200);
    expect(__sentMessages.length).toBeGreaterThan(0);
  });
});
