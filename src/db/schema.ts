import {
  AnyPgColumn, boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const ROLES = ['director','sr_manager','manager','dm','sr_am','am','sr_executive','executive'] as const;
export const TASK_STATUSES = ['assigned','progress','hold','completed','overdue','cancelled'] as const;
export const TASK_PRIORITIES = ['low','medium','high','critical'] as const;
/** Statuses that still receive 24-hour reminder emails. */
export const ACTIVE_STATUSES = ['assigned','progress','hold'] as const;
/** Statuses that never receive reminders or expiry emails. */
export const TERMINAL_STATUSES = ['completed','cancelled'] as const;

export type Role = (typeof ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const roleEnum = pgEnum('role', ROLES);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES);
export const historyEventEnum = pgEnum('history_event', [
  'created','assigned','reassigned','status_changed','priority_changed',
  'due_changed','progress_changed','completed','reopened','cancelled','commented',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'assigned','reassigned','reminder','expired','completed','comment','account_created','password_reset',
]);
export const notificationChannelEnum = pgEnum('notification_channel', ['email','in_app']);
export const notificationStatusEnum = pgEnum('notification_status', ['pending','sent','failed','skipped']);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  jobTitle: text('job_title'),
  department: text('department'),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  managerId: uuid('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
  index('users_team_idx').on(t.teamId),
  index('users_role_idx').on(t.role),
  index('users_active_idx').on(t.isActive),
]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: text('ref').notNull().unique().default(sql`'UT-' || nextval('task_ref_seq')`),
  title: text('title').notNull(),
  description: text('description'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  priority: taskPriorityEnum('priority').notNull().default('medium'),
  status: taskStatusEnum('status').notNull().default('assigned'),
  progress: integer('progress').notNull().default(0),
  project: text('project'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  startAt: timestamp('start_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  check('tasks_progress_range', sql`${t.progress} >= 0 AND ${t.progress} <= 100`),
  index('tasks_assigned_to_idx').on(t.assignedTo),
  index('tasks_status_idx').on(t.status),
  index('tasks_due_at_idx').on(t.dueAt),
  index('tasks_created_by_idx').on(t.createdBy),
  index('tasks_status_due_idx').on(t.status, t.dueAt),
]);

export const taskHistory = pgTable('task_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  event: historyEventEnum('event').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('task_history_task_idx').on(t.taskId, t.createdAt)]);

export const taskComments = pgTable('task_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('task_comments_task_idx').on(t.taskId, t.createdAt)]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  channel: notificationChannelEnum('channel').notNull().default('email'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  dedupeKey: text('dedupe_key'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('notifications_dedupe_key_idx').on(t.dedupeKey),
  index('notifications_user_read_idx').on(t.userId, t.readAt),
  index('notifications_retry_idx').on(t.status, t.attempts),
]);

export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  ip: text('ip'),
  succeeded: boolean('succeeded').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('login_attempts_email_idx').on(t.email, t.createdAt),
  index('login_attempts_ip_idx').on(t.ip, t.createdAt),
]);

/**
 * One row per issued refresh token (the JWT's `jti` claim IS this row's id).
 * Rotation-with-reuse-detection: a refresh consumes its row (revokedAt set,
 * replacedById points at the successor) and issues a fresh row. If a
 * revoked row is presented again, it's a replay — the whole family for that
 * user is revoked (see auth.service.ts `refresh`).
 */
export const refreshSessions = pgTable('refresh_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // Self-reference by value only — no FK constraint, this points at a sibling row's id.
  replacedById: uuid('replaced_by_id'),
}, (t) => [
  index('refresh_sessions_user_idx').on(t.userId),
  index('refresh_sessions_expires_idx').on(t.expiresAt),
]);

export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  job: text('job').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  processed: integer('processed').notNull().default(0),
  succeeded: integer('succeeded').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  error: text('error'),
}, (t) => [index('job_runs_job_idx').on(t.job, t.startedAt)]);
