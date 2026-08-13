import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { createUser, loginAgent, DEFAULT_PASSWORD } from './helpers.js';

const app = createApp();

describe('POST /api/auth/login', () => {
  it('signs in with a correct email and password', async () => {
    const u = await createUser({ email: 'login@utopiabrands.com', role: 'manager' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'login@utopiabrands.com', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(u.id);
    expect(res.get('Set-Cookie')?.join(';')).toContain('utm_access');
  });

  it('is case-insensitive on email', async () => {
    await createUser({ email: 'case@utopiabrands.com' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'CASE@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('never returns a password hash', async () => {
    await createUser({ email: 'nohash@utopiabrands.com' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nohash@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(JSON.stringify(res.body)).not.toContain('$2');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    await createUser({ email: 'wrong@utopiabrands.com' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'wrong@utopiabrands.com', password: 'nope12345' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same error for an unknown email — no account enumeration', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'ghost@utopiabrands.com', password: 'whatever12' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an inactive account', async () => {
    await createUser({ email: 'inactive@utopiabrands.com', isActive: false });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'inactive@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rate limits after 10 failed attempts for one email', async () => {
    await createUser({ email: 'brute@utopiabrands.com' });
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/auth/login')
        .send({ email: 'brute@utopiabrands.com', password: 'bad-password-1' });
    }
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'brute@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('stamps last_login_at on success', async () => {
    const u = await createUser({ email: 'stamp@utopiabrands.com' });
    expect(u.lastLoginAt).toBeNull();
    await request(app).post('/api/auth/login')
      .send({ email: 'stamp@utopiabrands.com', password: DEFAULT_PASSWORD });
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.lastLoginAt).not.toBeNull();
  });
});

describe('protected routes', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts an authenticated request', async () => {
    await createUser({ email: 'me@utopiabrands.com', fullName: 'Me Myself' });
    const agent = await loginAgent(app, 'me@utopiabrands.com');
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Me Myself');
  });

  it('rejects a request after the account is deactivated mid-session', async () => {
    const u = await createUser({ email: 'kill@utopiabrands.com' });
    const agent = await loginAgent(app, 'kill@utopiabrands.com');
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password with a correct current password', async () => {
    await createUser({ email: 'chg@utopiabrands.com' });
    const agent = await loginAgent(app, 'chg@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(res.status).toBe(200);

    const fresh = await request(app).post('/api/auth/login')
      .send({ email: 'chg@utopiabrands.com', password: 'NewPass123' });
    expect(fresh.status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    await createUser({ email: 'badcur@utopiabrands.com' });
    const agent = await loginAgent(app, 'badcur@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: 'not-it-1234', newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a mismatched confirmation', async () => {
    await createUser({ email: 'mism@utopiabrands.com' });
    const agent = await loginAgent(app, 'mism@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'Different123',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a password that violates the policy', async () => {
    await createUser({ email: 'weak@utopiabrands.com' });
    const agent = await loginAgent(app, 'weak@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'short', confirmPassword: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('rejects reusing the current password', async () => {
    await createUser({ email: 'same@utopiabrands.com' });
    const agent = await loginAgent(app, 'same@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('revokes the old session by bumping token_version', async () => {
    await createUser({ email: 'revoke@utopiabrands.com' });
    const agent = await loginAgent(app, 'revoke@utopiabrands.com');
    await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it("cannot change another user's password — no userId is accepted", async () => {
    const victim = await createUser({ email: 'victim@utopiabrands.com' });
    await createUser({ email: 'attacker@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'attacker@utopiabrands.com');

    await agent.post('/api/auth/change-password').send({
      userId: victim.id, currentPassword: DEFAULT_PASSWORD,
      newPassword: 'Hacked12345', confirmPassword: 'Hacked12345',
    });

    // The victim's password is untouched regardless of the response.
    const still = await request(app).post('/api/auth/login')
      .send({ email: 'victim@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(still.status).toBe(200);
  });
});

describe('must_change_password gate', () => {
  // The 'blocks other routes until the password is changed' case (asserting on
  // GET /api/tasks) is intentionally omitted here — that route doesn't exist
  // until Task 9, which adds it there instead of skipping it here.

  it('clears the flag once the password is changed', async () => {
    await createUser({ email: 'clears@utopiabrands.com', mustChangePassword: true });
    const agent = await loginAgent(app, 'clears@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(res.status).toBe(200);

    const after = await loginAgent(app, 'clears@utopiabrands.com', 'NewPass123');
    const me = await after.get('/api/auth/me');
    expect(me.body.data.mustChangePassword).toBe(false);
  });
});

describe('logout', () => {
  it('clears the auth cookies', async () => {
    await createUser({ email: 'out@utopiabrands.com' });
    const agent = await loginAgent(app, 'out@utopiabrands.com');
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });
});
