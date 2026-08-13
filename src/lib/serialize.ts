import type { users, tasks } from '../db/schema.js';

type UserRow = typeof users.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

export type PublicUser = {
  id: UserRow['id'];
  fullName: UserRow['fullName'];
  email: UserRow['email'];
  role: UserRow['role'];
  jobTitle: UserRow['jobTitle'];
  department: UserRow['department'];
  teamId: UserRow['teamId'];
  managerId: UserRow['managerId'];
  isActive: UserRow['isActive'];
  mustChangePassword: UserRow['mustChangePassword'];
  createdAt: UserRow['createdAt'];
  updatedAt: UserRow['updatedAt'];
  lastLoginAt: UserRow['lastLoginAt'];
  initials: string;
};

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/**
 * The only sanctioned way to put a user row into an API response.
 *
 * Deliberately an allow-list, not `Omit<UserRow, 'passwordHash' | 'tokenVersion'>`:
 * a destructure-and-spread approach fails OPEN when a column is added to `users`
 * (it ships to clients automatically), while this fails SAFE (the new column is
 * just absent until someone deliberately adds it below).
 */
export function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    jobTitle: row.jobTitle,
    department: row.department,
    teamId: row.teamId,
    managerId: row.managerId,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
    initials: initialsOf(row.fullName),
  };
}

export function isOverdue(t: Pick<TaskRow, 'dueAt' | 'status'>, now = new Date()): boolean {
  if (!t.dueAt) return false;
  if (t.status === 'completed' || t.status === 'cancelled') return false;
  return t.dueAt.getTime() < now.getTime();
}
