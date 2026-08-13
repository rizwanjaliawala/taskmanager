import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
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

  // No `target`: the table's unique constraint is an EXPRESSION index on
  // lower(email) (see `users_email_lower_idx` in schema.ts), not a plain
  // column unique index. Drizzle's onConflictDoNothing({ target: users.email })
  // would emit `ON CONFLICT (email)`, which Postgres rejects outright because
  // no constraint matches that exact column list. Omitting `target` emits a
  // bare `ON CONFLICT DO NOTHING`, which matches ANY unique violation on the
  // table — including the expression index — so two concurrent seed runs
  // that both pass the select above can still only ever insert one row.
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
  }).onConflictDoNothing().returning();

  if (admin) {
    return { teamId: team!.id, userId: admin.id, created: true };
  }

  // Lost the race: a concurrent run inserted the user first between our
  // select and our insert. Re-select to report the winner's id rather than
  // treating this as a failure.
  const [winner] = await db.select({ id: users.id }).from(users)
    .where(sql`lower(${users.email}) = ${email}`);

  if (!winner) {
    throw new Error('Seed conflict handling failed: insert conflicted but no matching user was found');
  }

  return { teamId: team!.id, userId: winner.id, created: false };
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
