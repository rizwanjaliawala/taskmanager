import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users, refreshSessions } from '../src/db/schema.js';
import { verifyRefreshToken } from '../src/lib/tokens.js';
import { createUser, loginAgent, DEFAULT_PASSWORD } from './helpers.js';

const app = createApp();

/** Extracts the raw "name=value" pair for one cookie out of a response's Set-Cookie headers. */
function cookieValue(res: request.Response, name: string): string {
  const raw = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const line = raw.find((c) => c.startsWith(`${name}=`));
  if (!line) throw new Error(`Set-Cookie ${name} not found in response`);
  return line.split(';')[0]!;
}

async function loginRaw(email: string, password = DEFAULT_PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

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

  it('succeeds even when no refresh cookie is present — logging out twice is not an error', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.data.loggedOut).toBe(true);
  });

  it('revokes only the presented session, leaving another device working', async () => {
    await createUser({ email: 'logout-multi@utopiabrands.com' });
    const deviceA = await loginRaw('logout-multi@utopiabrands.com');
    const deviceB = await loginRaw('logout-multi@utopiabrands.com');
    const accessA = cookieValue(deviceA, 'utm_access');
    const refreshA = cookieValue(deviceA, 'utm_refresh');
    const refreshB = cookieValue(deviceB, 'utm_refresh');

    // A real browser never attaches the path-scoped refresh cookie to /logout;
    // this simulates a client that forwards it explicitly, which logout accepts
    // without requiring it (see the "logout succeeds with no cookie" test above).
    const logoutRes = await request(app).post('/api/auth/logout')
      .set('Cookie', [accessA, refreshA].join('; '));
    expect(logoutRes.status).toBe(200);

    // Confirm session A is revoked directly against the DB — deliberately NOT
    // by replaying refreshA against /refresh, since presenting an
    // already-revoked token there is exactly the reuse-detection trigger
    // (covered by the FIX 3 replay tests) and would itself kill every
    // session for this user, including device B, defeating the point of
    // this test.
    const jtiA = verifyRefreshToken(refreshA.slice(refreshA.indexOf('=') + 1)).jti;
    const [sessionA] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, jtiA));
    expect(sessionA?.revokedAt).not.toBeNull();

    const stillB = await request(app).post('/api/auth/refresh').set('Cookie', refreshB);
    expect(stillB.status).toBe(200);
  });
});

describe('timing safety: unknown email vs wrong password (FIX 1)', () => {
  it('unknown-email and wrong-password logins take comparable wall-clock time', async () => {
    await createUser({ email: 'timing@utopiabrands.com' });
    const SAMPLES = 5;

    async function medianMs(fn: () => Promise<unknown>): Promise<number> {
      const durations: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const start = performance.now();
        await fn();
        durations.push(performance.now() - start);
      }
      durations.sort((a, b) => a - b);
      return durations[Math.floor(durations.length / 2)]!;
    }

    const unknownEmailMedian = await medianMs(() => request(app).post('/api/auth/login')
      .send({ email: `ghost-${crypto.randomUUID()}@utopiabrands.com`, password: 'whatever-12' }));

    const wrongPasswordMedian = await medianMs(() => request(app).post('/api/auth/login')
      .send({ email: 'timing@utopiabrands.com', password: 'definitely-wrong-1' }));

    // Deliberately loose bound: this only needs to catch the "bcrypt entirely
    // skipped for unknown emails" class of regression (~30x difference between
    // a no-op and a real cost-12 bcrypt compare), not assert near-equality.
    // Ordinary network/DB latency jitter on a shared Neon HTTP connection can
    // easily swing either median by 2x on its own.
    const slower = Math.max(unknownEmailMedian, wrongPasswordMedian);
    const faster = Math.min(unknownEmailMedian, wrongPasswordMedian);
    expect(slower).toBeLessThan(faster * 3);
  });
});

describe('per-IP rate limiting (FIX 2)', () => {
  it('rate limits after 30 failures from one IP across many different emails, without affecting another IP', async () => {
    // 31 sequential real requests against Neon over HTTP, each paying a full
    // bcrypt-12 compare — comfortably over vitest's default 30s test timeout.
    const attackerIp = '10.0.0.9';
    // 31 failed attempts across 31 different (nonexistent) emails from the same
    // IP — each email stays under its own 10-failure limit, but the IP crosses 30.
    for (let i = 0; i < 31; i++) {
      await request(app).post('/api/auth/login')
        .set('X-Forwarded-For', attackerIp)
        .send({ email: `nobody-${i}@utopiabrands.com`, password: 'whatever-12' });
    }
    const blocked = await request(app).post('/api/auth/login')
      .set('X-Forwarded-For', attackerIp)
      .send({ email: 'yet-another@utopiabrands.com', password: 'whatever-12' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // A different IP hitting a real account is unaffected by the attacker's IP limit.
    await createUser({ email: 'other-ip@utopiabrands.com' });
    const stillOk = await request(app).post('/api/auth/login')
      .set('X-Forwarded-For', '10.0.0.10')
      .send({ email: 'other-ip@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(stillOk.status).toBe(200);
  }, 90_000);
});

describe('refresh token rotation and reuse detection (FIX 3)', () => {
  it('rotates the refresh token on every /refresh call', async () => {
    await createUser({ email: 'rotate1@utopiabrands.com' });
    const login = await loginRaw('rotate1@utopiabrands.com');
    const cookie0 = cookieValue(login, 'utm_refresh');

    const res1 = await request(app).post('/api/auth/refresh').set('Cookie', cookie0);
    expect(res1.status).toBe(200);
    const cookie1 = cookieValue(res1, 'utm_refresh');
    expect(cookie1).not.toBe(cookie0);

    // the newly issued refresh token itself works
    const res2 = await request(app).post('/api/auth/refresh').set('Cookie', cookie1);
    expect(res2.status).toBe(200);
  });

  it('rejects a replayed (already-rotated) refresh token and revokes the whole family', async () => {
    await createUser({ email: 'reuse@utopiabrands.com' });
    const login = await loginRaw('reuse@utopiabrands.com');
    const original = cookieValue(login, 'utm_refresh');

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(rotated.status).toBe(200);
    const current = cookieValue(rotated, 'utm_refresh');

    // Replay the already-consumed original token.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHORIZED');

    // Reuse detection must also invalidate the token that superseded it (family revocation).
    const afterReplay = await request(app).post('/api/auth/refresh').set('Cookie', current);
    expect(afterReplay.status).toBe(401);
  });

  it('lets only one of two concurrent refreshes with the same token win', async () => {
    await createUser({ email: 'race@utopiabrands.com' });
    const login = await loginRaw('race@utopiabrands.com');
    const original = cookieValue(login, 'utm_refresh');

    // Fire both without awaiting between them — this is the real race. Before the
    // conditional claim, both requests read revokedAt as null and both succeeded,
    // minting two live sibling sessions and silently defeating reuse detection.
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', original),
      request(app).post('/api/auth/refresh').set('Cookie', original),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);

    // The loser is treated as a replay, so the family is revoked and the winner's
    // freshly issued token must not work either.
    const winner = a.status === 200 ? a : b;
    const issued = cookieValue(winner, 'utm_refresh');
    const after = await request(app).post('/api/auth/refresh').set('Cookie', issued);
    expect(after.status).toBe(401);
  });

  it('supports two independent devices refreshing without disturbing each other', async () => {
    await createUser({ email: 'multi@utopiabrands.com' });
    const deviceA = await loginRaw('multi@utopiabrands.com');
    const deviceB = await loginRaw('multi@utopiabrands.com');
    const refreshA = cookieValue(deviceA, 'utm_refresh');
    const refreshB = cookieValue(deviceB, 'utm_refresh');
    expect(refreshA).not.toBe(refreshB);

    const resA = await request(app).post('/api/auth/refresh').set('Cookie', refreshA);
    expect(resA.status).toBe(200);

    // Device B's session is untouched by device A's rotation.
    const resB = await request(app).post('/api/auth/refresh').set('Cookie', refreshB);
    expect(resB.status).toBe(200);
  });
});

describe('refresh cookie path scoping (FIX 4)', () => {
  it('scopes the refresh cookie to /api/auth/refresh, leaving the access cookie at /', async () => {
    await createUser({ email: 'cookiepath@utopiabrands.com' });
    const res = await loginRaw('cookiepath@utopiabrands.com');
    const raw = (res.headers['set-cookie'] ?? []) as unknown as string[];
    const refreshLine = raw.find((c) => c.startsWith('utm_refresh='))!;
    const accessLine = raw.find((c) => c.startsWith('utm_access='))!;

    expect(refreshLine).toMatch(/Path=\/api\/auth\/refresh/i);
    expect(accessLine).toMatch(/Path=\//i);
    expect(accessLine).not.toMatch(/Path=\/api\/auth\/refresh/i);
  });

  it('does not send the refresh cookie to /api/auth/me (agent respects cookie Path)', async () => {
    await createUser({ email: 'pathcheck@utopiabrands.com' });
    const agent = await loginAgent(app, 'pathcheck@utopiabrands.com');
    const res = await agent.get('/api/auth/me');
    // Only readable proxy for "was the refresh cookie sent": the request still
    // succeeds on the access cookie alone, and no new Set-Cookie is emitted here.
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
