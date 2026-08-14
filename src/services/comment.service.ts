import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskComments, taskHistory, users } from '../db/schema.js';
import { assertCan } from '../lib/permissions.js';
import { AppError } from '../lib/errors.js';
import type { AuthUser } from '../lib/auth.js';
import { getById } from './task.service.js';

export type CommentWithAuthor = {
  id: string; taskId: string; body: string; createdAt: Date;
  author: { id: string; fullName: string; initials: string };
};

function initialsOf(fullName: string): string {
  const p = fullName.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? p[p.length - 1]![0]! : '')).toUpperCase();
}

export async function list(taskId: string): Promise<CommentWithAuthor[]> {
  await getById(taskId); // 404s on an unknown task

  const rows = await db.select({
    id: taskComments.id, taskId: taskComments.taskId, body: taskComments.body,
    createdAt: taskComments.createdAt,
    authorId: users.id, authorName: users.fullName,
  }).from(taskComments)
    .innerJoin(users, eq(users.id, taskComments.authorId))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));

  return rows.map((r) => ({
    id: r.id, taskId: r.taskId, body: r.body, createdAt: r.createdAt,
    author: { id: r.authorId, fullName: r.authorName, initials: initialsOf(r.authorName) },
  }));
}

export async function create(actor: AuthUser, taskId: string, body: string): Promise<CommentWithAuthor> {
  const task = await getById(taskId);
  assertCan(actor, 'task:comment', task);

  const trimmed = body.trim();
  if (!trimmed) throw new AppError('VALIDATION_ERROR', 'A comment cannot be empty');

  const [row] = await db.insert(taskComments)
    .values({ taskId, authorId: actor.id, body: trimmed }).returning();

  await db.insert(taskHistory).values({
    taskId, actorId: actor.id, event: 'commented', toValue: trimmed.slice(0, 120),
  });

  return {
    id: row!.id, taskId, body: row!.body, createdAt: row!.createdAt,
    author: { id: actor.id, fullName: actor.fullName, initials: initialsOf(actor.fullName) },
  };
}
