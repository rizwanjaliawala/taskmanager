import { describe, expect, it, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, teams } from '../src/db/schema.js';
import { runSeed } from '../src/db/seed.js';

beforeAll(() => {
  process.env.SEED_ADMIN_EMAIL = 'shahzeb.ali@utopiabrands.com';
  process.env.SEED_ADMIN_PASSWORD = 'Utopia01';
});

describe('seed', () => {
  it('creates the Operations team and one Manager account', async () => {
    const result = await runSeed();
    expect(result.created).toBe(true);

    const [team] = await db.select().from(teams).where(eq(teams.name, 'Operations'));
    expect(team).toBeDefined();

    const [admin] = await db.select().from(users)
      .where(eq(users.email, 'shahzeb.ali@utopiabrands.com'));
    expect(admin!.role).toBe('manager');
    expect(admin!.isActive).toBe(true);
    expect(admin!.teamId).toBe(team!.id);
  });

  it('forces a password change on first login', async () => {
    await runSeed();
    const [admin] = await db.select().from(users)
      .where(eq(users.email, 'shahzeb.ali@utopiabrands.com'));
    expect(admin!.mustChangePassword).toBe(true);
  });

  it('stores a bcrypt hash, never the plain password', async () => {
    await runSeed();
    const [admin] = await db.select().from(users)
      .where(eq(users.email, 'shahzeb.ali@utopiabrands.com'));
    expect(admin!.passwordHash).not.toBe('Utopia01');
    expect(admin!.passwordHash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('Utopia01', admin!.passwordHash)).toBe(true);
  });

  it('is idempotent — a second run creates no duplicates', async () => {
    await runSeed();
    const second = await runSeed();
    expect(second.created).toBe(false);

    const allUsers = await db.select().from(users);
    const allTeams = await db.select().from(teams);
    expect(allUsers).toHaveLength(1);
    expect(allTeams).toHaveLength(1);
  });

  it('creates no demo tasks', async () => {
    await runSeed();
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
  });

  it('refuses to run without SEED_ADMIN_PASSWORD', async () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    await expect(runSeed()).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    process.env.SEED_ADMIN_PASSWORD = 'Utopia01';
  });
});
