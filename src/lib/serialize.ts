import type { users, tasks } from '../db/schema.js';

type UserRow = typeof users.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

export type PublicUser = Omit<UserRow, 'passwordHash' | 'tokenVersion'> & { initials: string };

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/** The only sanctioned way to put a user row into an API response. */
export function publicUser(row: UserRow): PublicUser {
  const { passwordHash: _p, tokenVersion: _t, ...rest } = row;
  return { ...rest, initials: initialsOf(row.fullName) };
}

export function isOverdue(t: Pick<TaskRow, 'dueAt' | 'status'>, now = new Date()): boolean {
  if (!t.dueAt) return false;
  if (t.status === 'completed' || t.status === 'cancelled') return false;
  return t.dueAt.getTime() < now.getTime();
}
