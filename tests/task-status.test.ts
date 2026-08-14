import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, taskHistory } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function ownTask(email = 'st@utopiabrands.com') {
  await createUser({ email });
  const agent = await loginAgent(app, email);
  const made = await agent.post('/api/tasks').send({ title: 'Lifecycle', priority: 'medium' });
  return { agent, id: made.body.data.id as string };
}

describe('status transitions', () => {
  it('moves assigned to progress', async () => {
    const { agent, id } = await ownTask();
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('progress');
  });

  it('records a status_changed history event', async () => {
    const { agent, id } = await ownTask('st2@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    const ev = rows.find((r) => r.event === 'status_changed');
    expect(ev!.fromValue).toBe('assigned');
    expect(ev!.toValue).toBe('progress');
  });

  it('rejects an illegal transition from completed to progress', async () => {
    const { agent, id } = await ownTask('st3@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/complete`);
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('rejects any transition out of cancelled — it is terminal', async () => {
    const { agent, id } = await ownTask('st4@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/cancel`);
    for (const status of ['progress', 'assigned', 'completed', 'hold']) {
      const res = await agent.post(`/api/tasks/${id}/status`).send({ status });
      expect(res.status, `cancelled -> ${status} must be rejected`).toBe(422);
    }
  });

  it('rejects a status value outside the six known statuses', async () => {
    const { agent, id } = await ownTask('st5@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'pending' });
    expect(res.status).toBe(400);
  });
});

describe('complete', () => {
  it('sets status, progress 100 and completed_at', async () => {
    const { agent, id } = await ownTask('cp1@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/complete`);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.progress).toBe(100);
    expect(res.body.data.completedAt).not.toBeNull();
  });

  it('completes an overdue task', async () => {
    const { agent, id } = await ownTask('cp2@utopiabrands.com');
    await db.update(tasks).set({
      status: 'overdue', dueAt: new Date(Date.now() - 3_600_000),
    }).where(eq(tasks.id, id));
    const res = await agent.post(`/api/tasks/${id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  it('sets progress to 100 when patched, flipping status to completed', async () => {
    const { agent, id } = await ownTask('cp3@utopiabrands.com');
    const res = await agent.patch(`/api/tasks/${id}`).send({ progress: 100 });
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.completedAt).not.toBeNull();
  });

  it('denies an unrelated non-Manager completing a task', async () => {
    const creator = await createUser({ email: 'cpown@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Not yours', createdBy: creator.id, priority: 'low',
    }).returning();

    await createUser({ email: 'cpother@utopiabrands.com', role: 'director' });
    const agent = await loginAgent(app, 'cpother@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${t!.id}/complete`);
    expect(res.status).toBe(403);
  });
});

describe('reopen and cancel', () => {
  it('reopens a completed task back to progress and clears completed_at', async () => {
    const { agent, id } = await ownTask('ro1@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/complete`);
    const res = await agent.post(`/api/tasks/${id}/reopen`);

    expect(res.body.data.status).toBe('progress');
    expect(res.body.data.completedAt).toBeNull();

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    expect(rows.map((r) => r.event)).toContain('reopened');
  });

  it('cancels a task and records the event', async () => {
    const { agent, id } = await ownTask('cx1@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/cancel`);
    expect(res.body.data.status).toBe('cancelled');

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    expect(rows.map((r) => r.event)).toContain('cancelled');
  });
});

describe('cancelled is terminal through every door', () => {
  it('cannot be resurrected by PATCHing progress to 100', async () => {
    // PATCH flips status at 100%. It must consult the same transition table the
    // /status route uses, or it becomes a second way out of a terminal state.
    const { agent, id } = await ownTask('cx-patch@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/cancel`);

    const res = await agent.patch(`/api/tasks/${id}`).send({ progress: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    expect(row!.status).toBe('cancelled');
    expect(row!.completedAt).toBeNull();
  });

  it('cannot be reopened', async () => {
    const { agent, id } = await ownTask('cx-reopen@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/cancel`);

    const res = await agent.post(`/api/tasks/${id}/reopen`);
    expect(res.status).toBe(422);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    expect(row!.status).toBe('cancelled');
  });

  it('cannot be assigned', async () => {
    const { agent, id } = await ownTask('cx-assign@utopiabrands.com');
    const someone = await createUser({ email: 'cx-target@utopiabrands.com' });
    await agent.post(`/api/tasks/${id}/cancel`);

    const res = await agent.post(`/api/tasks/${id}/assign`).send({ assigneeId: someone.id });
    expect(res.status).toBe(422);
  });

  it('cannot be completed', async () => {
    const { agent, id } = await ownTask('cx-complete@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/cancel`);

    const res = await agent.post(`/api/tasks/${id}/complete`);
    expect(res.status).toBe(422);
  });
});

describe('setting a status to itself', () => {
  it('is a no-op and writes no history row', async () => {
    const { agent, id } = await ownTask('noop@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });

    const before = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    expect(res.status).toBe(200);

    const after = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    expect(after).toHaveLength(before.length);
  });
});
