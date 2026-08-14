import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, taskHistory } from '../src/db/schema.js';
import { createUser, loginAgent, DEFAULT_PASSWORD } from './helpers.js';

const app = createApp();

async function agentFor(email: string, role: any = 'executive') {
  await createUser({ email, role, fullName: email.split('@')[0]! });
  return loginAgent(app, email);
}

describe('POST /api/tasks', () => {
  it('creates a task and returns a UT- reference', async () => {
    const agent = await agentFor('creator@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({
      title: 'Verify container CTNR-88213',
      description: 'Cross-check the manifest against the ASN.',
      priority: 'high',
      project: 'Inbound Operations',
      tags: ['Amazon', 'Inbound'],
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.ref).toMatch(/^UT-\d+$/);
    expect(res.body.data.title).toBe('Verify container CTNR-88213');
    expect(res.body.data.status).toBe('assigned');
    expect(res.body.data.progress).toBe(0);
    expect(res.body.data.tags).toEqual(['Amazon', 'Inbound']);
  });

  it('records a created history event', async () => {
    const agent = await agentFor('hist@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: 'History check', priority: 'low' });
    const rows = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, res.body.data.id));
    expect(rows.map((r) => r.event)).toContain('created');
  });

  it('stamps created_by as the session user', async () => {
    const u = await createUser({ email: 'stampme@utopiabrands.com' });
    const agent = await loginAgent(app, 'stampme@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: 'Stamped', priority: 'medium' });
    expect(res.body.data.createdBy).toBe(u.id);
  });

  it('ignores a client-supplied createdBy', async () => {
    const other = await createUser({ email: 'other@utopiabrands.com' });
    const me = await createUser({ email: 'me2@utopiabrands.com' });
    const agent = await loginAgent(app, 'me2@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({
      title: 'Spoof', priority: 'low', createdBy: other.id,
    });
    expect(res.body.data.createdBy).toBe(me.id);
  });

  it('rejects an empty title', async () => {
    const agent = await agentFor('empty@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: '', priority: 'low' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid priority', async () => {
    const agent = await agentFor('badprio@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: 'X', priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated create', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Anon', priority: 'low' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tasks', () => {
  it('is readable by any active user — flat visibility', async () => {
    const owner = await createUser({ email: 'owner@utopiabrands.com' });
    await db.insert(tasks).values({ title: 'Someone else task', createdBy: owner.id, priority: 'low' });

    const agent = await agentFor('nosy@utopiabrands.com');
    const res = await agent.get('/api/tasks');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by status', async () => {
    const u = await createUser({ email: 'filt@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'A', createdBy: u.id, priority: 'low', status: 'assigned' },
      { title: 'B', createdBy: u.id, priority: 'low', status: 'completed' },
    ]);
    const agent = await agentFor('filtread@utopiabrands.com');
    const res = await agent.get('/api/tasks?status=completed');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('B');
  });

  it('searches title and description with q', async () => {
    const u = await createUser({ email: 'srch@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Container manifest', createdBy: u.id, priority: 'low' },
      { title: 'Payroll run', createdBy: u.id, priority: 'low', description: 'container of files' },
      { title: 'Unrelated', createdBy: u.id, priority: 'low' },
    ]);
    const agent = await agentFor('srchread@utopiabrands.com');
    const res = await agent.get('/api/tasks?q=container');
    expect(res.body.data).toHaveLength(2);
  });

  it('marks a past-due task isOverdue even before the cron job runs', async () => {
    const u = await createUser({ email: 'due@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Past due', createdBy: u.id, priority: 'high',
      status: 'assigned', dueAt: new Date(Date.now() - 3_600_000),
    });
    const agent = await agentFor('dueread@utopiabrands.com');
    const res = await agent.get('/api/tasks');
    expect(res.body.data[0].isOverdue).toBe(true);
    expect(res.body.data[0].status).toBe('assigned');
  });

  it('does not mark a completed past-due task as overdue', async () => {
    const u = await createUser({ email: 'donedue@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Done late', createdBy: u.id, priority: 'low',
      status: 'completed', dueAt: new Date(Date.now() - 3_600_000),
    });
    const agent = await agentFor('donedueread@utopiabrands.com');
    const res = await agent.get('/api/tasks');
    expect(res.body.data[0].isOverdue).toBe(false);
  });
});

describe('PATCH /api/tasks/:id — creator, assignee or Manager', () => {
  it('lets the creator edit', async () => {
    const agent = await agentFor('edcreator@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'Mine', priority: 'low' });
    const res = await agent.patch(`/api/tasks/${made.body.data.id}`).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed');
  });

  it('lets the assignee edit', async () => {
    const creator = await createUser({ email: 'c1@utopiabrands.com' });
    const assignee = await createUser({ email: 'a1@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Assigned to me', createdBy: creator.id, assignedTo: assignee.id, priority: 'low',
    }).returning();

    const agent = await loginAgent(app, 'a1@utopiabrands.com');
    const res = await agent.patch(`/api/tasks/${t!.id}`).send({ notes: 'Working on it' });
    expect(res.status).toBe(200);
  });

  it('lets a Manager edit any task', async () => {
    const creator = await createUser({ email: 'c2@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Not mine', createdBy: creator.id, priority: 'low',
    }).returning();

    const agent = await agentFor('mgredit@utopiabrands.com', 'manager');
    const res = await agent.patch(`/api/tasks/${t!.id}`).send({ title: 'Manager edit' });
    expect(res.status).toBe(200);
  });

  it('denies an unrelated non-Manager with 403 and changes nothing', async () => {
    const creator = await createUser({ email: 'c3@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Protected', createdBy: creator.id, priority: 'low',
    }).returning();

    const agent = await agentFor('bystander@utopiabrands.com', 'director');
    const res = await agent.patch(`/api/tasks/${t!.id}`).send({ title: 'Hijacked' });
    expect(res.status).toBe(403);

    const [after] = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(after!.title).toBe('Protected');
  });

  it('records a priority_changed history event', async () => {
    const agent = await agentFor('prio@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'P', priority: 'low' });
    await agent.patch(`/api/tasks/${made.body.data.id}`).send({ priority: 'critical' });

    const rows = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, made.body.data.id));
    const ev = rows.find((r) => r.event === 'priority_changed');
    expect(ev).toBeDefined();
    expect(ev!.fromValue).toBe('low');
    expect(ev!.toValue).toBe('critical');
  });

  it('records a due_changed history event', async () => {
    const agent = await agentFor('duechg@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'D', priority: 'low' });
    await agent.patch(`/api/tasks/${made.body.data.id}`)
      .send({ dueAt: new Date(Date.now() + 172_800_000).toISOString() });

    const rows = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, made.body.data.id));
    expect(rows.map((r) => r.event)).toContain('due_changed');
  });

  it('returns TASK_NOT_FOUND for an unknown id', async () => {
    const agent = await agentFor('nf@utopiabrands.com');
    const res = await agent.get('/api/tasks/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TASK_NOT_FOUND');
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('lets the creator delete and cascades history', async () => {
    const agent = await agentFor('del@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'Delete me', priority: 'low' });
    const res = await agent.delete(`/api/tasks/${made.body.data.id}`);
    expect(res.status).toBe(200);

    const rows = await db.select().from(tasks).where(eq(tasks.id, made.body.data.id));
    expect(rows).toHaveLength(0);
    const hist = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, made.body.data.id));
    expect(hist).toHaveLength(0);
  });

  it('denies an unrelated non-Manager delete', async () => {
    const creator = await createUser({ email: 'c4@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Keep me', createdBy: creator.id, priority: 'low',
    }).returning();

    const agent = await agentFor('deleter@utopiabrands.com', 'sr_manager');
    const res = await agent.delete(`/api/tasks/${t!.id}`);
    expect(res.status).toBe(403);

    const rows = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(rows).toHaveLength(1);
  });
});

describe('must_change_password gate blocks task routes', () => {
  it('blocks /api/tasks until the password is changed', async () => {
    await createUser({ email: 'forced-tasks@utopiabrands.com', mustChangePassword: true });
    const agent = await loginAgent(app, 'forced-tasks@utopiabrands.com');

    const blocked = await agent.get('/api/tasks');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // /api/auth/me stays reachable so the frontend can route to the change screen
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);
  });

  it('allows /api/tasks once the password has been changed', async () => {
    await createUser({ email: 'cleared-tasks@utopiabrands.com', mustChangePassword: true });
    const first = await loginAgent(app, 'cleared-tasks@utopiabrands.com');
    const changed = await first.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(changed.status).toBe(200);

    const agent = await loginAgent(app, 'cleared-tasks@utopiabrands.com', 'NewPass123');
    const res = await agent.get('/api/tasks');
    expect(res.status).toBe(200);
  });
});
