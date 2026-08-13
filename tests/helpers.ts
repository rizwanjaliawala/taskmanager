import request from 'supertest';
import type { Express } from 'express';
import { db } from '../src/db/client.js';
import { teams, users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';

type UserRow = typeof users.$inferSelect;

export const DEFAULT_PASSWORD = 'Utopia01';

export async function createTeam(name = 'Operations') {
  const [t] = await db.insert(teams).values({ name }).returning();
  return t!;
}

export async function createUser(over: Partial<UserRow> & { password?: string } = {}): Promise<UserRow> {
  const { password, ...rest } = over;
  const [u] = await db.insert(users).values({
    fullName: rest.fullName ?? 'Test User',
    email: rest.email ?? `user-${crypto.randomUUID()}@utopiabrands.com`,
    passwordHash: await hashPassword(password ?? DEFAULT_PASSWORD),
    role: rest.role ?? 'executive',
    isActive: rest.isActive ?? true,
    mustChangePassword: rest.mustChangePassword ?? false,
    jobTitle: rest.jobTitle ?? null,
    department: rest.department ?? null,
    teamId: rest.teamId ?? null,
    managerId: rest.managerId ?? null,
  }).returning();
  return u!;
}

/** A supertest agent that retains auth cookies across requests. */
export async function loginAgent(app: Express, email: string, password = DEFAULT_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
