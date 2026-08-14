import { randomBytes } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, type Role } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { publicUser, type PublicUser } from '../lib/serialize.js';

export type CreateUserInput = {
  fullName: string; email: string; role: Role;
  jobTitle?: string | null; department?: string | null;
  teamId?: string | null; managerId?: string | null;
};

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'email'>>;

/** 12 chars, always contains a letter and a digit so it satisfies the password policy. */
export function generateTempPassword(): string {
  const body = randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 9);
  return `Ut${body}7`.slice(0, 12);
}

export async function list(filters: { role?: Role; active?: boolean } = {}): Promise<PublicUser[]> {
  const conditions = [];
  if (filters.role) conditions.push(eq(users.role, filters.role));
  if (filters.active !== undefined) conditions.push(eq(users.isActive, filters.active));

  const rows = await db.select().from(users)
    .where(conditions.length ? sql.join(conditions, sql` AND `) : undefined)
    .orderBy(asc(users.fullName));

  return rows.map(publicUser);
}

export async function getById(id: string): Promise<PublicUser> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) throw new AppError('USER_NOT_FOUND', 'User not found');
  return publicUser(row);
}

export async function create(input: CreateUserInput): Promise<{ user: PublicUser; tempPassword: string }> {
  const email = input.email.trim().toLowerCase();

  const [existing] = await db.select({ id: users.id }).from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  if (existing) throw new AppError('USER_EXISTS', 'A user with that email address already exists');

  const tempPassword = generateTempPassword();

  const [row] = await db.insert(users).values({
    fullName: input.fullName.trim(),
    email,
    passwordHash: await hashPassword(tempPassword),
    role: input.role,
    jobTitle: input.jobTitle ?? null,
    department: input.department ?? null,
    teamId: input.teamId ?? null,
    managerId: input.managerId ?? null,
    isActive: true,
    mustChangePassword: true,
  }).returning();

  return { user: publicUser(row!), tempPassword };
}

/**
 * Only a Manager can manage users, so the last active Manager is a single point of
 * failure: demote or deactivate them and nobody left can create users, restore roles,
 * or reactivate anyone. There is no in-app recovery — `npm run db:seed` is idempotent
 * and will not resurrect an existing-but-deactivated account — so the only way back
 * would be direct database access. Cheaper to refuse the move.
 */
async function assertNotLastManager(target: { id: string; role: Role; isActive: boolean }): Promise<void> {
  if (target.role !== 'manager' || !target.isActive) return;

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'manager'), eq(users.isActive, true), ne(users.id, target.id)));

  if ((row?.n ?? 0) === 0) {
    throw new AppError(
      'LAST_MANAGER',
      'This is the only active Manager. Promote another user to Manager first, ' +
        'otherwise no one will be able to manage the team.',
    );
  }
}

export async function update(id: string, patch: UpdateUserInput): Promise<PublicUser> {
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) throw new AppError('USER_NOT_FOUND', 'User not found');

  if (patch.role !== undefined && patch.role !== 'manager') {
    await assertNotLastManager(existing);
  }

  const [row] = await db.update(users).set({
    ...(patch.fullName !== undefined ? { fullName: patch.fullName.trim() } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.jobTitle !== undefined ? { jobTitle: patch.jobTitle } : {}),
    ...(patch.department !== undefined ? { department: patch.department } : {}),
    ...(patch.teamId !== undefined ? { teamId: patch.teamId } : {}),
    ...(patch.managerId !== undefined ? { managerId: patch.managerId } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, id)).returning();

  return publicUser(row!);
}

export async function setActive(id: string, active: boolean, actorId: string): Promise<PublicUser> {
  if (!active && id === actorId) {
    throw new AppError('SELF_ACTION_FORBIDDEN', 'You cannot deactivate your own account');
  }

  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) throw new AppError('USER_NOT_FOUND', 'User not found');

  if (!active) await assertNotLastManager(existing);

  const [row] = await db.update(users).set({
    isActive: active,
    // Deactivation revokes every issued token immediately.
    tokenVersion: active ? existing.tokenVersion : existing.tokenVersion + 1,
    updatedAt: new Date(),
  }).where(eq(users.id, id)).returning();

  return publicUser(row!);
}
