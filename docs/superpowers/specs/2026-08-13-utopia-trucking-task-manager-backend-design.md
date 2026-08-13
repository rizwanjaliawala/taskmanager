# Utopia Trucking Task Manager — Backend, Database & Notifications

**Date:** 2026-08-13
**Status:** Approved design, pending implementation plan

---

## 1. Purpose

Turn the existing static TaskFlow frontend into a working full-stack application:

```
existing frontend  →  Express REST API  →  Neon PostgreSQL
                          ↓
              SMTP email + scheduled jobs
```

The existing frontend is the starting point and is preserved. Only these changes are
made to it: charts are removed, real authentication replaces the demo login, the mock
data layer is replaced by API calls, a Manager-only user-management screen is added, a
change-password screen is added, and the product is rebranded to **Utopia Trucking
Task Manager**.

## 2. Existing frontend — inventory

Vanilla HTML/CSS/JS, no framework, no build step. Global `window.TF` namespace. Five
scripts load in order from `index.html`.

| File | Lines | Role |
| --- | --- | --- |
| `assets/js/data.js` | 374 | Synchronous mock arrays: 8 users, 30 tasks, notifications, `STATUS`/`PRIORITY` dictionaries, analytics series |
| `assets/js/ui.js` | 295 | DOM helpers, formatters, avatars, toasts, count-up, confetti |
| `assets/js/charts.js` | 270 | Hand-built SVG ring, donut, bars, line, sparkline |
| `assets/js/views.js` | 746 | Nine views as `V.name()` returning an HTML string, plus optional `V.name.after(root)` hook |
| `assets/js/app.js` | 1240 | State, localStorage persistence (`taskflow.v1`), routing, drawer, create-task modal, search, mutations, boot sequence, auth screen |

Views: `dashboard`, `mytasks`, `alltasks`, `team`, `calendar`, `notifications`,
`reports`, `activity`, `settings`.

Existing task shape: `{ id, title, desc, status, priority, progress, assignee,
reporter, project, start, due, created, completedAt, onTime, tags, attachments,
activity[], comments[] }`.

Existing user shape: `{ id, name, initials, role, dept, email, c1, c2 }` — note `role`
currently holds a **job title** string, not an organizational rank.

`TaskFlow.html` (254 KB) and `build-standalone.ps1` produce a single-file offline
bundle. A single-file bundle cannot reach a backend, so both are retained on disk but
dropped from the workflow.

The repository has **no commits**. An initial commit of the untouched frontend is made
first, so every backend change appears as a reviewable diff.

## 3. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Backend | Node + Express + TypeScript | Matches the vanilla frontend; no frontend build step introduced |
| Hosting | Vercel serverless | Express exported as one serverless handler from `api/index.ts` |
| Database driver | `@neondatabase/serverless` (HTTP) | A `pg.Pool` per serverless invocation exhausts Neon connection limits |
| ORM | Drizzle + drizzle-kit | Type-safe, fully parameterized, real migration files, low cold-start cost |
| Auth | JWT in httpOnly cookie | Same-origin deployment; XSS cannot read the token |
| Email | Nodemailer over SMTP | Matches the required `EMAIL_*` environment variables |
| Scheduler | Vercel Cron → protected HTTP endpoints | No long-lived process exists on serverless |
| Task statuses | Frontend keys kept verbatim, `cancelled` added | Zero churn in `views.js` |
| Permission model | Flat, single team | Per requirement: any user may view and assign any task |
| Charts | Removed everywhere | Per requirement; `charts.js` is deleted |
| Seed | One Manager account, no demo data | Clean start; real data entered through the UI |

## 4. Architecture

```
/                       existing frontend, served statically by Vercel
  index.html            app shell, icon sprite, boot + login screens
  assets/css/styles.css
  assets/js/            api.js (new), data.js (reduced), ui.js, views.js, app.js
/api/index.ts           Express app exported as the Vercel serverless handler
/src
  /routes               HTTP layer only: parse, validate, delegate, serialize
  /services             business rules and transactions
  /db                   Drizzle schema, migrations, query helpers
  /lib                  permissions, auth, email, errors, validation, logger
  /jobs                 reminder and expiry job bodies
/tests                  Vitest suites
```

**Layering rule:** a route handler never writes SQL and never calls Nodemailer. Routes
call services; services call `db/` and `lib/email`. Jobs call the same services the
routes do, so a reminder sent by cron and one sent by an API call travel identical code.

### 4.1 Request flow — assigning a task

1. `POST /api/tasks/:id/assign` → `requireAuth` → `requirePermission('task:assign')`
2. Zod validates the body (`assigneeId`, optional `dueAt`, optional `note`)
3. `taskService.assign()` reads and validates the task, then issues one `db.batch([...])`
   — Drizzle's `neon-http` driver has no interactive `db.transaction()`; `batch` is sent
   as a single request that Neon wraps in a real transaction. Every atomic operation is
   therefore shaped **read → validate → batch-write**:
   - update `tasks.assigned_to`, `assigned_at`, `status`
   - insert `task_history` row (`assigned` or `reassigned`)
   - insert `notifications` rows for assignee and assigner, `status = 'pending'`
4. After commit, `emailService.sendAssignment()` delivers and flips each notification
   row to `sent` or `failed` with `last_error`
5. Response returns the updated task in the shape `views.js` already renders

Email delivery happens **after** commit and never rolls back the task. A failed send
leaves a `failed` notification row that the reminder job retries.

## 5. Database schema

All tables use `uuid` primary keys (`gen_random_uuid()`), `timestamptz` timestamps, and
`created_at` / `updated_at` maintained by the application layer.

### teams
`id`, `name`, `description`, `is_active`, `created_at`, `updated_at`

One seeded row, `Operations`. The table exists so a second team is data rather than a
migration. Nothing in the permission layer reads it today.

### users
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `full_name` | text not null | |
| `email` | citext unique not null | login identity and notification address |
| `password_hash` | text not null | bcrypt cost 12 |
| `role` | enum | `director`, `sr_manager`, `manager`, `dm`, `sr_am`, `am`, `sr_executive`, `executive` |
| `job_title` | text null | free-text display string, e.g. "Warehouse Lead" |
| `department` | text null | |
| `team_id` | uuid FK → teams | nullable |
| `manager_id` | uuid FK → users | self-reference, informational only |
| `is_active` | boolean default true | inactive users cannot authenticate |
| `must_change_password` | boolean default false | forces the change-password screen |
| `token_version` | int default 0 | bumped to revoke all sessions |
| `created_at`, `updated_at`, `last_login_at` | timestamptz | |

Indexes: unique on `email`, index on `team_id`, `role`, `is_active`.

`password_hash` and `token_version` are excluded by a `publicUser()` projection applied
at the **query** level, so they cannot leak through a route added later.

### tasks
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `ref` | text unique not null | human identifier, `UT-1042`, from a sequence |
| `title` | text not null | |
| `description` | text | |
| `created_by` | uuid FK → users not null | |
| `assigned_to` | uuid FK → users null | |
| `priority` | enum | `low`, `medium`, `high`, `critical` |
| `status` | enum | `assigned`, `progress`, `hold`, `completed`, `overdue`, `cancelled` |
| `progress` | int 0–100 default 0 | check constraint |
| `project` | text | |
| `tags` | text[] default '{}' | |
| `notes` | text | |
| `created_at` | timestamptz not null | |
| `assigned_at` | timestamptz null | |
| `start_at` | timestamptz null | |
| `due_at` | timestamptz null | |
| `completed_at` | timestamptz null | |
| `updated_at` | timestamptz not null | |

Indexes: `assigned_to`, `status`, `due_at`, `created_by`, and a composite
`(status, due_at)` serving both scheduled jobs.

`assigned` is displayed in the UI as **Pending**. The DB key is unchanged so `views.js`
needs no edit.

### task_history
`id`, `task_id` FK cascade, `actor_id` FK → users, `event` enum, `from_value` text,
`to_value` text, `detail` jsonb, `created_at`

`event` ∈ `created`, `assigned`, `reassigned`, `status_changed`, `priority_changed`,
`due_changed`, `progress_changed`, `completed`, `reopened`, `cancelled`, `commented`.

Index on `(task_id, created_at desc)` — the drawer's activity timeline reads this.

### task_comments
`id`, `task_id` FK cascade, `author_id` FK → users, `body` text, `created_at`

### notifications
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK → users | recipient |
| `task_id` | uuid FK → tasks null | |
| `type` | enum | `assigned`, `reassigned`, `reminder`, `expired`, `completed`, `comment` |
| `channel` | enum | `email`, `in_app` |
| `title`, `body` | text | rendered for the in-app panel |
| `status` | enum | `pending`, `sent`, `failed`, `skipped` |
| `dedupe_key` | text **unique** null | idempotency guarantee, see §7 |
| `attempts` | int default 0 | |
| `last_error` | text null | |
| `sent_at` | timestamptz null | |
| `read_at` | timestamptz null | null means unread |
| `created_at` | timestamptz | |

Indexes: `(user_id, read_at)`, `(status, attempts)`, unique on `dedupe_key`.

### login_attempts
`id`, `email` citext, `ip` text, `succeeded` boolean, `created_at`

Index on `(email, created_at desc)`. Backs DB-level login rate limiting — an in-memory
limiter is useless when every serverless invocation is a fresh process.

### job_runs
`id`, `job` text, `started_at`, `finished_at`, `processed` int, `succeeded` int,
`failed` int, `error` text

One audit row per cron invocation.

### Derived `is_overdue`

Every task read also computes
`is_overdue = due_at < now() AND status NOT IN ('completed','cancelled')`.

This is stored **and** derived on purpose. The expiry job writes `status='overdue'` so
the state is queryable and fires exactly one email; the derived flag keeps the UI
correct in the window between a task passing its due time and the next cron tick.

## 6. Authentication

- **bcrypt**, cost 12. Plain-text passwords are never stored, logged, or returned.
- **Access token** — JWT, 15 minutes, httpOnly + Secure + SameSite=Lax cookie.
- **Refresh token** — JWT, 7 days, rotated on use, separate cookie, path-scoped to
  `/api/auth/refresh`.
- **Revocation** — both tokens embed `token_version`. Changing a password or
  deactivating a user bumps the column, invalidating every issued token immediately.
- **`must_change_password`** — the seeded Manager account starts with this true. All
  routes except `GET /api/auth/me` and `POST /api/auth/change-password` return
  `403 PASSWORD_CHANGE_REQUIRED` until it is cleared. The frontend routes to the
  change-password screen on that code.
- **Rate limiting** — `POST /api/auth/login` allows 10 failures per email per 15
  minutes and 30 per IP, counted from `login_attempts`.
- **Password policy** — minimum 8 characters, at least one letter and one digit, must
  differ from the current password. Current password is verified before any change.
- Inactive users (`is_active = false`) are rejected at login and at every token check.

## 7. Permissions

Flat, single-team model. One file, `src/lib/permissions.ts`, exporting
`can(user, action, resource?) → boolean` and a `requirePermission(action)` middleware.

| Action | Rule |
| --- | --- |
| `user:create` | **Manager only** |
| `user:update`, `user:deactivate`, `user:activate` | **Manager only** |
| `team:manage` | **Manager only** |
| `user:list` | Any active authenticated user |
| `task:list`, `task:view` | Any active authenticated user |
| `task:create`, `task:assign` | Any active authenticated user |
| `task:edit`, `task:delete`, `task:changeStatus`, `task:complete` | Creator, assignee, or Manager |
| `task:comment` | Any active authenticated user |
| `password:change` | Self only — no role can change another user's password |
| `notification:read` | Owner of the notification only |

Every mutating route carries a `requirePermission` middleware. Frontend button hiding
is cosmetic and additional; the API rejects unauthorized calls independently and
returns `403 FORBIDDEN`.

The 8 roles are stored, displayed and reportable, but only `manager` currently carries
authority. Granting authority to another role is a one-line change in this file.

## 8. Scheduled jobs

Two endpoints, each accepting `GET` and `POST`, both requiring
`Authorization: Bearer ${CRON_SECRET}`:

- `/api/jobs/reminders`
- `/api/jobs/expiry`

Wired through `vercel.json` `crons`. Each writes a `job_runs` audit row.

**Vercel Cron issues `GET` requests** and, when `CRON_SECRET` is set as a project
environment variable, automatically attaches `Authorization: Bearer $CRON_SECRET`.
A `POST`-only endpoint would never fire. Both verbs are accepted so the jobs can also
be triggered manually or by an external scheduler.

### Idempotency

`notifications.dedupe_key` carries a unique constraint and is the **entire**
duplicate-prevention mechanism:

| Job | dedupe_key |
| --- | --- |
| Assignment | `assign:{task_id}:{user_id}:{assigned_at_epoch}` |
| 24h reminder | `reminder:{task_id}:{user_id}:{YYYY-MM-DD}` |
| Expiry | `expiry:{task_id}:{user_id}` |

Postgres advisory locks are deliberately **not** used: they are session-scoped, and
over the Neon HTTP driver each statement is its own session, so a lock taken on one
statement is gone by the next. The unique constraint is correct under overlapping
schedules, retries, concurrent invocations, and jobs that die mid-flight — two
simultaneous runs both attempt the insert, exactly one wins, the loser swallows the
unique-violation and skips sending.

Both jobs are therefore **safe to call at any frequency**. They behave correctly on
Vercel Hobby's once-daily cron limit and become more responsive if pointed at a
higher-frequency scheduler.

### Reminder job

Selects tasks where `status IN ('assigned','progress','hold')` and `assigned_to IS NOT
NULL`, then for each recipient attempts a `reminder:{task}:{user}:{today}` insert.
Rows that insert successfully are emailed. Completed, cancelled and overdue tasks are
excluded by the status filter.

The same job re-attempts `notifications` rows with `status='failed'` and
`attempts < 5`, applying exponential backoff on `attempts`.

### Expiry job

Selects tasks where `due_at < now()` and `status NOT IN ('completed','cancelled',
'overdue')`. For each: transition `status → 'overdue'`, insert a `status_changed`
history row, insert `expiry:{task}:{user}` notifications, send. The unique key
guarantees exactly one expiry email per task per recipient, permanently.

## 9. Email service

`src/lib/email/` — a service, never inline `sendMail` calls in route handlers.

```
email/
  transport.ts    Nodemailer SMTP transport built from env vars
  render.ts       shared HTML layout + plain-text fallback
  templates/      assignment.ts, reminder.ts, expiry.ts
  index.ts        sendAssignment(), sendReminder(), sendExpiry()
```

Every template renders task title, description, assigned-by, priority, due date/time,
current status, and a button linking to `${APP_URL}/#task/${ref}`.

**Recipients** — all three email types go to **both the assignee and the assigner**
(the task's `created_by` for reminders and expiry), deduplicated when they are the same
person. Controlled by a single `NOTIFY_ASSIGNER` constant.

Templates receive a rendering context, never a database row, so no internal identifier
or hash can reach an outbound email.

## 10. API surface

All responses are `{ ok: true, data }` or `{ ok: false, error: { code, message,
details? } }`. Stack traces and database messages never reach the client.

### Auth
```
POST   /api/auth/login             email + password → sets cookies
POST   /api/auth/logout            clears cookies
POST   /api/auth/refresh           rotates the refresh token
GET    /api/auth/me                current user profile
POST   /api/auth/change-password   currentPassword, newPassword, confirmPassword
```

### Users — Manager-gated for writes
```
GET    /api/users                  list, filterable by role/active
POST   /api/users                  Manager only
GET    /api/users/:id
PATCH  /api/users/:id              Manager only
POST   /api/users/:id/activate     Manager only
POST   /api/users/:id/deactivate   Manager only
```

`POST /api/users` accepts `fullName`, `email`, `role`, `jobTitle`, `department`,
`teamId`, `managerId`. A temporary password is generated, `must_change_password` is
set, and the credentials are emailed to the new user.

### Tasks
```
GET    /api/tasks                  filters: status, priority, assignee, project, q, due
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/assign
POST   /api/tasks/:id/status
POST   /api/tasks/:id/complete
POST   /api/tasks/:id/reopen
POST   /api/tasks/:id/cancel
GET    /api/tasks/:id/history
GET    /api/tasks/:id/comments
POST   /api/tasks/:id/comments
```

### Notifications, dashboard, bootstrap
```
GET    /api/notifications
PATCH  /api/notifications/:id/read
POST   /api/notifications/read-all
GET    /api/dashboard
GET    /api/bootstrap              users + tasks + notifications in one call
```

### Jobs — CRON_SECRET-gated
```
POST   /api/jobs/reminders
POST   /api/jobs/expiry
```

### Error codes
`INVALID_CREDENTIALS`, `UNAUTHORIZED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`,
`ACCOUNT_INACTIVE`, `USER_EXISTS`, `USER_NOT_FOUND`, `TASK_NOT_FOUND`,
`INVALID_ASSIGNMENT`, `INVALID_STATUS_TRANSITION`, `VALIDATION_ERROR`, `RATE_LIMITED`,
`EMAIL_FAILED`, `DATABASE_ERROR`, `INTERNAL_ERROR`.

## 11. Task lifecycle

```
assigned ──► progress ──► completed
   │  ▲         │  ▲          │
   │  └── hold ─┘  │          │ reopen
   │               │          ▼
   └──────► overdue ◄─────────┘
   │
   └──────► cancelled  (terminal)
```

- `assigned` (displayed **Pending**), `progress`, `hold` are *active* — they receive
  reminders.
- `completed` and `cancelled` are terminal — no reminders, no expiry emails.
- `overdue` is set only by the expiry job; it is **not** treated as pending, so it
  stops receiving reminder emails and receives exactly one expiry email.
- Setting `progress = 100` transitions to `completed` and stamps `completed_at`.
- Reopening a completed task clears `completed_at` and returns it to `progress`.
- Every transition is validated server-side and written to `task_history`.

## 12. Frontend integration

### Hydrate-once store

The frontend builds HTML synchronously from `TF.tasks`. Making views async would mean
rewriting all nine screens. Instead:

1. New `assets/js/api.js` — `fetch` wrapper with `credentials: 'include'`, structured
   error parsing, and automatic refresh-then-retry on `401`.
2. `GET /api/bootstrap` fills `TF.users`, `TF.tasks`, `TF.notifications` in exactly the
   shapes `data.js` produces today, **before** the first `render()`.
3. `data.js` shrinks to the `STATUS`, `PRIORITY`, `ACT` and `NOTIF_STYLE` dictionaries.
   All mock arrays and analytics series are deleted.
4. Mutations become optimistic: mutate local state → `render()` → send the request →
   on failure roll back and raise the existing error toast.
5. localStorage task persistence is removed; the server is the source of truth. Theme
   and accent preferences stay local.

`views.js` view bodies remain otherwise unchanged.

### Charts removed

`assets/js/charts.js` is deleted, along with every call site.

**Dashboard** keeps its layout, header and card chrome, and shows: Total Tasks, Pending,
In Progress, Completed, Overdue, Assigned to Me, Due Today, Due Soon (next 7 days) as
count tiles; plus Recently Assigned, My Tasks, and Recent Activity lists. The
productivity ring, status donut, weekly-throughput bars and KPI sparklines are removed
and not replaced with other visualizations.

**Reports** is rebuilt as tables and counts over the same data: by status, by priority,
by assignee, by project, plus overdue and completion tallies.

### Screens added or changed

| Screen | Change |
| --- | --- |
| Login | Real email + password against `POST /api/auth/login`; demo copy removed |
| Change password | New view; forced when `must_change_password` is true |
| Team | Becomes user management — Manager sees create/edit/activate controls, others see a read-only roster |
| Settings | Change password entry point; "Reset workspace" removed |
| Task drawer | Comments and activity read from the API |
| Create task | Posts to `POST /api/tasks`, assignee list from `/api/users` |
| Branding | "TaskFlow" → "Utopia Trucking Task Manager" in `<title>`, meta, boot screen, login, sidebar, footer, email templates |
| Credit line | Footnote "Created by Rizwan Hanif for Utopia Brands Trucking Team" in the app footer, on the login screen, and in the email template footer |

## 13. Security

- bcrypt cost 12; hashes never returned by any endpoint
- Zod validation on every request body, query and path parameter
- Drizzle parameterizes all queries — no string-interpolated SQL anywhere
- httpOnly + Secure + SameSite=Lax cookies; CSRF mitigated by SameSite plus a
  same-origin `Origin` header check on mutations
- CORS restricted to `APP_URL`
- Helmet security headers
- DB-backed login rate limiting
- All secrets in environment variables; `.env` gitignored, `.env.example` committed
- `task_history` and `job_runs` provide the audit trail
- Errors are mapped to safe codes; internals are logged server-side only

## 14. Environment configuration

`.env.example`, committed with placeholders only:

```
DATABASE_URL=
DATABASE_URL_UNPOOLED=
JWT_SECRET=
JWT_REFRESH_SECRET=
EMAIL_HOST=
EMAIL_PORT=
EMAIL_SECURE=
EMAIL_USERNAME=
EMAIL_PASSWORD=
EMAIL_FROM=
APP_URL=
CRON_SECRET=
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
NODE_ENV=
```

`DATABASE_URL` is the Neon **pooled** endpoint, used at runtime by the HTTP driver.
`DATABASE_URL_UNPOOLED` is the direct endpoint, used by `drizzle-kit` for migrations —
DDL through a transaction-mode pooler is unreliable. When unset, migrations fall back
to `DATABASE_URL`.

## 15. Database setup

```
npm run db:generate   drizzle-kit generates SQL migrations from the schema
npm run db:migrate    applies pending migrations
npm run db:seed       idempotent bootstrap
```

`db:seed` creates exactly two things and is safe to re-run:

1. The `Operations` team
2. One **Manager** account from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
   (`shahzeb.ali@utopiabrands.com`), with `must_change_password = true`

No demo users and no demo tasks. Real data is entered through the UI.

## 16. Testing

Vitest against a dedicated Neon branch (`TEST_DATABASE_URL`) with an in-memory mock
SMTP transport that records sends. Each suite truncates tables in a `beforeEach`.

| # | Test |
| --- | --- |
| 1 | Manager can create a team member |
| 2 | Non-Manager receives 403 on `POST /api/users` |
| 3 | User can change their own password with a correct current password |
| 4 | User cannot change another user's password |
| 5 | Assigning a task writes task, history and notification rows |
| 6 | Assignment triggers email to assignee and assigner |
| 7 | Reminder is sent for a task pending past 24 hours |
| 8 | A second reminder in the same 24-hour window is not sent |
| 9 | Completed tasks receive no reminders |
| 10 | Cancelled tasks receive no reminders |
| 11 | An expired task receives an expiry notification and flips to `overdue` |
| 12 | The expiry notification is not sent twice for the same task |
| 13 | Protected routes reject unauthenticated requests with 401 |
| 14 | Role permissions are enforced server-side regardless of frontend state |
| 15 | Login rate limiting triggers after repeated failures |
| 16 | `must_change_password` blocks other routes until cleared |
| 17 | Inactive users cannot authenticate |
| 18 | No endpoint returns `password_hash` |

## 17. Out of scope

- Multiple teams, hierarchical permission inheritance
- File attachment upload and storage (the existing UI simulates attachments; the field
  is retained but no storage backend is added)
- Real-time push or WebSockets — the frontend polls
- Password reset by email link — a Manager resets a password by issuing a temporary one
- Mobile applications
- The `TaskFlow.html` single-file bundle and `build-standalone.ps1`, which cannot reach
  a backend; both files remain on disk but leave the workflow

## 18. Assumptions

1. Task **edit and delete** are limited to creator, assignee, or Manager. Viewing and
   assigning are open to every active user, as specified.
2. All three email types notify **both** the assignee and the assigner, deduplicated
   when identical. Governed by one `NOTIFY_ASSIGNER` constant.
3. Reminder windows are calendar days in UTC — one reminder per active task per
   recipient per day.
4. SMTP credentials for the sending mailbox are supplied by the operator; no domain or
   DNS configuration is performed as part of this work.
5. The organization operates on `utopiabrands.com`.
6. The Neon credential shared during design is rotated once the application runs.
