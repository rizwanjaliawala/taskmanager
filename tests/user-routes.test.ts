import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users, ROLES } from '../src/db/schema.js';
import { createTeam, createUser, loginAgent, DEFAULT_PASSWORD } from './helpers.js';

const app = createApp();

async function managerAgent() {
  await createUser({ email: 'mgr@utopiabrands.com', role: 'manager' });
  return loginAgent(app, 'mgr@utopiabrands.com');
}

describe('POST /api/users — Manager only', () => {
  it('lets a Manager create a team member', async () => {
    const team = await createTeam();
    const agent = await managerAgent();

    const res = await agent.post('/api/users').send({
      fullName: 'New Hire', email: 'new.hire@utopiabrands.com',
      role: 'am', jobTitle: 'Account Manager', department: 'Operations', teamId: team.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('new.hire@utopiabrands.com');
    expect(res.body.data.user.role).toBe('am');
    expect(res.body.data.user.teamId).toBe(team.id);

    const [row] = await db.select().from(users)
      .where(eq(users.email, 'new.hire@utopiabrands.com'));
    expect(row!.mustChangePassword).toBe(true);
    expect(row!.isActive).toBe(true);
  });

  it('never returns the password hash', async () => {
    const agent = await managerAgent();
    const res = await agent.post('/api/users').send({
      fullName: 'No Hash', email: 'nohash2@utopiabrands.com', role: 'executive',
    });
    expect(JSON.stringify(res.body)).not.toContain('$2');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects every non-Manager role with 403', async () => {
    for (const role of ROLES.filter((r) => r !== 'manager')) {
      const email = `${role}@utopiabrands.com`;
      await createUser({ email, role });
      const agent = await loginAgent(app, email);

      const res = await agent.post('/api/users').send({
        fullName: 'Blocked', email: `blocked-${role}@utopiabrands.com`, role: 'executive',
      });

      expect(res.status, `role ${role} must not create users`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const [created] = await db.select().from(users)
        .where(eq(users.email, `blocked-${role}@utopiabrands.com`));
      expect(created, `role ${role} must not have created a row`).toBeUndefined();
    }
  });

  it('rejects an unauthenticated create with 401', async () => {
    const res = await request(app).post('/api/users').send({
      fullName: 'Anon', email: 'anon@utopiabrands.com', role: 'executive',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a duplicate email with USER_EXISTS', async () => {
    await createUser({ email: 'dupe@utopiabrands.com' });
    const agent = await managerAgent();
    const res = await agent.post('/api/users').send({
      fullName: 'Dupe', email: 'dupe@utopiabrands.com', role: 'executive',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EXISTS');
  });

  it('rejects a role outside the eight organizational roles', async () => {
    const agent = await managerAgent();
    const res = await agent.post('/api/users').send({
      fullName: 'Bad Role', email: 'badrole@utopiabrands.com', role: 'ceo',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts all eight organizational roles', async () => {
    const agent = await managerAgent();
    for (const role of ROLES) {
      const res = await agent.post('/api/users').send({
        fullName: `Role ${role}`, email: `ok-${role}@utopiabrands.com`, role,
      });
      expect(res.status, `role ${role} should be accepted`).toBe(201);
    }
  });
});

describe('GET /api/users', () => {
  it('is readable by any active authenticated user', async () => {
    await createUser({ email: 'reader@utopiabrands.com', role: 'executive' });
    const agent = await loginAgent(app, 'reader@utopiabrands.com');
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('exposes no password hash in the list', async () => {
    await createUser({ email: 'listread@utopiabrands.com' });
    const agent = await loginAgent(app, 'listread@utopiabrands.com');
    const res = await agent.get('/api/users');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });
});

describe('PATCH /api/users/:id and activation — Manager only', () => {
  it('lets a Manager update a user', async () => {
    const target = await createUser({ email: 'target@utopiabrands.com', role: 'executive' });
    const agent = await managerAgent();
    const res = await agent.patch(`/api/users/${target.id}`)
      .send({ role: 'sr_am', jobTitle: 'Senior Account Manager' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('sr_am');
  });

  it('rejects a non-Manager update with 403', async () => {
    const target = await createUser({ email: 'target2@utopiabrands.com' });
    await createUser({ email: 'nonmgr@utopiabrands.com', role: 'director' });
    const agent = await loginAgent(app, 'nonmgr@utopiabrands.com');
    const res = await agent.patch(`/api/users/${target.id}`).send({ role: 'sr_am' });
    expect(res.status).toBe(403);
  });

  it('lets a Manager deactivate and reactivate a user', async () => {
    const target = await createUser({ email: 'toggle@utopiabrands.com' });
    const agent = await managerAgent();

    const off = await agent.post(`/api/users/${target.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const blocked = await request(app).post('/api/auth/login')
      .send({ email: 'toggle@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(blocked.status).toBe(403);

    const on = await agent.post(`/api/users/${target.id}/activate`);
    expect(on.body.data.isActive).toBe(true);
  });

  it('rejects a non-Manager deactivation with 403', async () => {
    const target = await createUser({ email: 'safe@utopiabrands.com' });
    await createUser({ email: 'sneaky@utopiabrands.com', role: 'sr_manager' });
    const agent = await loginAgent(app, 'sneaky@utopiabrands.com');
    const res = await agent.post(`/api/users/${target.id}/deactivate`);
    expect(res.status).toBe(403);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row!.isActive).toBe(true);
  });

  it('prevents a Manager deactivating themselves', async () => {
    await createUser({ email: 'selfoff@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'selfoff@utopiabrands.com');
    const [me] = await db.select().from(users).where(eq(users.email, 'selfoff@utopiabrands.com'));
    const res = await agent.post(`/api/users/${me!.id}/deactivate`);
    expect(res.status).toBe(422);
  });

  it('returns USER_NOT_FOUND for an unknown id', async () => {
    const agent = await managerAgent();
    const res = await agent.get('/api/users/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});
