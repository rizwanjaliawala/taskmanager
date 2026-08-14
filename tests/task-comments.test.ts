import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function taskWithAgent(email: string) {
  await createUser({ email, fullName: 'Comment Author' });
  const agent = await loginAgent(app, email);
  const made = await agent.post('/api/tasks').send({ title: 'Commentable', priority: 'low' });
  return { agent, id: made.body.data.id as string };
}

describe('GET/POST /api/tasks/:id/comments', () => {
  it('adds a comment and returns it with its author', async () => {
    const { agent, id } = await taskWithAgent('cmt1@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/comments`)
      .send({ body: 'Counted 18 of 24 pallets so far.' });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe('Counted 18 of 24 pallets so far.');
    expect(res.body.data.author.fullName).toBe('Comment Author');
    expect(res.body.data.author.initials).toBe('CA');
  });

  it('lists comments oldest first', async () => {
    const { agent, id } = await taskWithAgent('cmt2@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/comments`).send({ body: 'First' });
    await agent.post(`/api/tasks/${id}/comments`).send({ body: 'Second' });

    const res = await agent.get(`/api/tasks/${id}/comments`);
    expect(res.body.data.map((c: any) => c.body)).toEqual(['First', 'Second']);
  });

  it('records a commented history event', async () => {
    const { agent, id } = await taskWithAgent('cmt3@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/comments`).send({ body: 'Noted' });

    const res = await agent.get(`/api/tasks/${id}/history`);
    expect(res.body.data.map((h: any) => h.event)).toContain('commented');
  });

  it('lets any active user comment — flat permissions', async () => {
    const { id } = await taskWithAgent('cmt4@utopiabrands.com');
    await createUser({ email: 'anyone@utopiabrands.com', role: 'executive' });
    const other = await loginAgent(app, 'anyone@utopiabrands.com');

    const res = await other.post(`/api/tasks/${id}/comments`).send({ body: 'Passing through' });
    expect(res.status).toBe(201);
  });

  it('rejects an empty comment', async () => {
    const { agent, id } = await taskWithAgent('cmt5@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/comments`).send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a comment on an unknown task', async () => {
    const { agent } = await taskWithAgent('cmt6@utopiabrands.com');
    const res = await agent.post('/api/tasks/11111111-1111-1111-1111-111111111111/comments')
      .send({ body: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/tasks/:id/history', () => {
  it('returns events newest first with actor names', async () => {
    const { agent, id } = await taskWithAgent('hist2@utopiabrands.com');
    await agent.patch(`/api/tasks/${id}`).send({ priority: 'critical' });

    const res = await agent.get(`/api/tasks/${id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].event).toBe('priority_changed');
    expect(res.body.data[0].actor.fullName).toBe('Comment Author');
    expect(res.body.data.at(-1).event).toBe('created');
  });
});
