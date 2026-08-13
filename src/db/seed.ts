import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from './client.js';
import { teams, users } from './schema.js';

const TEAM_NAME = 'Operations';

export async function runSeed(): Promise<{ teamId: string; userId: string; created: boolean }> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email) throw new Error('SEED_ADMIN_EMAIL is required to seed the initial Manager account');
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required to seed the initial Manager account');

  const [team] = await db.insert(teams)
    .values({ name: TEAM_NAME, description: 'Utopia Brands Trucking Team' })
    .onConflictDoUpdate({ target: teams.name, set: { updatedAt: new Date() } })
    .returning();

  const [existing] = await db.select({ id: users.id }).from(users)
    .where(sql`lower(${users.email}) = ${email}`);

  if (existing) {
    return { teamId: team!.id, userId: existing.id, created: false };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [admin] = await db.insert(users).values({
    fullName: 'Shahzeb Ali',
    email,
    passwordHash,
    role: 'manager',
    jobTitle: 'Manager',
    department: TEAM_NAME,
    teamId: team!.id,
    isActive: true,
    mustChangePassword: true,
  }).returning();

  return { teamId: team!.id, userId: admin!.id, created: true };
}

// Executed directly via `npm run db:seed`
// (compared via pathToFileURL, not a raw `file://${path}` template, so this also
// matches on Windows where argv[1] uses backslashes and needs URL-encoding)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runSeed();
  console.log(
    r.created
      ? `Seeded team "${TEAM_NAME}" and Manager account ${process.env.SEED_ADMIN_EMAIL}.\n` +
        'This account must change its password on first login.'
      : `Already seeded — Manager account ${process.env.SEED_ADMIN_EMAIL} exists. No changes made.`,
  );
}
