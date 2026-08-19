# Utopia Trucking Task Manager

Task management for the Utopia Brands Trucking Team.

**Live:** https://utopia-trucking-task-manager.vercel.app

A full-stack application: a vanilla HTML/CSS/JS frontend talking to an Express REST API
backed by Neon PostgreSQL, with Brevo SMTP email notifications and three scheduled
jobs. No frontend framework, no build step for the UI.

---

## Contents

- [Architecture](#architecture)
- [Features](#features)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Email](#email)
- [Roles and permissions](#roles-and-permissions)
- [Task lifecycle](#task-lifecycle)
- [Scheduled jobs](#scheduled-jobs)
- [API reference](#api-reference)
- [Database](#database)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Project layout](#project-layout)
- [Current status](#current-status)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
Browser (vanilla JS)
      │  fetch, httpOnly cookies, same origin
      ▼
Express REST API  ──────►  Neon PostgreSQL   (Drizzle ORM, HTTP driver)
      │
      ├──►  Brevo SMTP  ──►  recipient mailbox
      │
      └──►  Vercel Cron  ──►  /api/jobs/*  (reminders, expiry, digest)
```

The whole API is one Vercel serverless function exported from `api/index.ts`. The
frontend is served as static files from the same origin, so the auth cookie is
first-party and there is no CORS to configure.

**Layering.** Routes parse and validate, then delegate. Services own business rules and
talk to the database. Permissions and email are standalone modules that both routes and
jobs import. A route handler never writes SQL and never sends mail directly.

### Notable design decisions

**Neon's HTTP driver, not a connection pool.** A `pg.Pool` assumes one long-lived
process; on serverless every concurrent invocation is its own process, so fifty requests
means fifty pools and an exhausted connection limit. The HTTP driver is stateless. The
trade-off is no interactive transactions — `db.batch([...])` is the atomic primitive, so
every multi-write is shaped *read → validate → batch-write*.

**A unique `dedupe_key` is the entire duplicate-email mechanism.** Advisory locks are the
usual answer, but they are session-scoped and the HTTP driver gives every statement its
own session — a lock taken on one line is gone by the next. Instead the notification row
carries a unique key: two overlapping job runs both attempt the insert, Postgres lets
exactly one win, and the loser swallows the conflict and skips sending. Correct under
retries, overlapping schedules, and a job that dies mid-flight.

**The frontend hydrates once.** Views build HTML synchronously from `TF.tasks`. Rather
than rewrite all nine screens to be async, a single `GET /api/bootstrap` fills the same
in-memory shapes before the first render, and mutations are optimistic with rollback.

---

## Features

- Email + password authentication with forced password change on first sign-in
- Role-based access control, enforced server-side on every route
- Manager-only team management: create, edit, activate, deactivate
- Tasks with priority, status, progress, due dates, projects, tags and notes
- Assignment with an immediate email to both assignee and assigner
- Full audit trail of every change, and per-task comments
- Dashboard with live counts and task lists — no charts
- Reports as breakdown tables by status, priority, project and assignee
- Automatic 24-hour reminders, expiry detection, and a Monday digest
- In-app notifications with read state
- Light/dark themes, five accent colours, keyboard shortcuts

---

## Getting started

**Requirements:** Node 20+, a Neon PostgreSQL database, and (for email) a Brevo account.

```bash
npm install
cp .env.example .env          # then fill it in — see below
npm run db:migrate            # create the schema
npm run db:seed               # create the Operations team and first Manager
npm run dev                   # http://localhost:3000
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. You are sent straight to the
change-password screen — the seeded account is created with `must_change_password` set.

Everyone else is added from **Team → Add team member**, which only a Manager can do.

### A separate database for tests

The suite truncates every table before each test, so it must never point at real data.
`tests/setup.ts` refuses to run unless `TEST_DATABASE_URL` is set and differs from
`DATABASE_URL` — it also compares the parsed database names, so pointing at the same
database through Neon's pooled and direct endpoints is caught too.

Create a second database on the same Neon instance, then migrate it:

```sql
CREATE DATABASE neondb_test;
```

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon **pooled** endpoint, used at runtime |
| `DATABASE_URL_UNPOOLED` | for migrations | Neon **direct** endpoint — DDL through a transaction-mode pooler is unreliable |
| `TEST_DATABASE_URL` | for tests | Separate database. Must differ from `DATABASE_URL` |
| `JWT_SECRET` | yes | Access-token signing key, ≥32 chars |
| `JWT_REFRESH_SECRET` | yes | Refresh-token key. **Must differ** from `JWT_SECRET` |
| `APP_URL` | yes | Deployed origin. Used for CORS **and** every link inside notification emails |
| `CRON_SECRET` | yes | Guards the job endpoints. Vercel attaches it automatically |
| `BREVO_SMTP_HOST` | for email | `smtp-relay.brevo.com` |
| `BREVO_SMTP_PORT` | for email | `587` (STARTTLS) or `465` (implicit TLS) |
| `BREVO_SMTP_USER` | for email | Brevo SMTP login, e.g. `b6xxxxx@smtp-brevo.com` |
| `BREVO_SMTP_PASSWORD` | for email | The Brevo **SMTP key** — not an API key, not your account password |
| `BREVO_SMTP_FROM_EMAIL` | for email | Must be a verified sender in Brevo |
| `BREVO_SMTP_FROM_NAME` | no | Display name on outgoing mail |
| `SEED_ADMIN_EMAIL` | seeding | The first Manager's address |
| `SEED_ADMIN_PASSWORD` | seeding | Their temporary password |
| `NODE_ENV` | no | `development`, `production` or `test` |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env` is gitignored. `.env.example` holds placeholders only. In production these live in
Vercel's environment settings — **and are read at process start, so redeploy after
changing them.**

---

## Email

Five emails go out, all through Brevo SMTP:

| Email | When | Recipients |
| --- | --- | --- |
| Task assigned | Immediately on assignment | Assignee **and** assigner, deduplicated if the same person |
| Still pending | Every 24 hours while a task stays open | Assignee and assigner |
| Time finished | Once, ever, when a due time passes | Assignee and assigner |
| Account created | When a Manager adds a member | The new member |
| Monday digest | Monday 08:00 | Each person, their own board |

Transport is plain SMTP via `nodemailer`. The Brevo **SMTP key** is the password — not
your account password, and not a Brevo API key (those start `xkeysib-`; SMTP keys start
`xsmtpsib-`). Full setup: **[docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md)**.

**Before deploying, check Brevo's IP restriction.** If it is enabled, SMTP auth fails with
`525 5.7.1 Unauthorized IP address` — an IP rejection, not a credential one. Serverless
hosts have no stable outbound IP, so the restriction must be off for production.

**Failures are never silent.** A send that fails leaves the notification row marked
`failed` with the error text and an attempt count. The reminder job's sweep retries both
`failed` rows and any stuck in `pending` for over an hour, dispatching each through the
template matching its type. If no transport is configured at all, delivery raises a
configuration error rather than pretending — a Manager must never believe a temporary
password was emailed when nothing was sent.

---

## Roles and permissions

Eight organizational roles: **Director · Sr. Manager · Manager · DM · Sr. AM · AM ·
Sr Executive · Executive**

The team operates flat. Any active user can view every task and assign work to anyone —
rank does not grant privilege. Exactly one rule carries authority:

> **Only a Manager can create, edit, activate or deactivate users.**
> Not Director, not Sr. Manager.

| Action | Who |
| --- | --- |
| `user:create` `user:update` `user:activate` `user:deactivate` `team:manage` | **Manager only** |
| `user:list` `task:list` `task:view` `task:create` `task:assign` `task:comment` | Any active user |
| `task:edit` `task:delete` `task:changeStatus` `task:complete` | Creator, assignee, or Manager |
| `password:change` `notification:read` | **Self only** — no role, including Manager, can act on another user |

All authority lives in `src/lib/permissions.ts`. No role comparison exists anywhere else
in the codebase. Hiding a button in the UI is presentation; the API rejects the request
regardless.

**The last active Manager cannot be deactivated or demoted.** Nobody would be left able
to manage the team, and there is no in-app recovery — `db:seed` is idempotent and will
not resurrect a deactivated account.

---

## Task lifecycle

```
Pending ──► In Progress ──► Completed ──reopen──► In Progress
   │  ▲          │  ▲            │
   │  └─ On Hold ┘  │
   └────────► Overdue ──► Completed

Cancelled is terminal from every path.
```

- `Pending` is stored as `assigned` — the key is never renamed, only displayed differently
- Completed and cancelled tasks stop receiving reminders
- Overdue is set by the expiry job and triggers exactly one email, permanently
- Setting progress to 100% completes the task and stamps `completed_at`
- Every transition is validated server-side and written to the audit trail

**Overdue is both stored and derived.** The job writes the status so it is queryable and
emails fire once; every read *also* computes `is_overdue` from the due date, so a task
that lapses at 09:05 shows as overdue immediately rather than waiting for the next run.

---

## Scheduled jobs

| Endpoint | Schedule | Purpose |
| --- | --- | --- |
| `/api/jobs/reminders` | daily 09:00 | 24-hour reminders, plus retrying failed and orphaned sends |
| `/api/jobs/expiry` | daily 09:30 | Mark overdue, send the one-time expiry email |
| `/api/jobs/digest` | Monday 08:00 | The weekly roll-up |

All three are guarded by `CRON_SECRET` and accept **GET and POST** — Vercel Cron issues
GET and attaches `Authorization: Bearer $CRON_SECRET` automatically. Each writes a
`job_runs` audit row and never throws out to the caller.

They are safe to run at any frequency, including twice at once. Dedupe keys:

| Job | Key | Effect |
| --- | --- | --- |
| Assignment | `assign:{task}:{user}:{timestamp}` | One per assignment event |
| Reminder | `reminder:{task}:{user}:{YYYY-MM-DD}` | One per task, per person, per day |
| Expiry | `expiry:{task}:{user}` | **No date** — exactly once, ever |
| Digest | `digest:{user}:{ISO week}` | One per person, per week |

The expiry key deliberately has no date component: that is what makes "do not repeatedly
send expiry emails" true even if a task is manually reset and lapses again. The digest
keys on the ISO week so a Tuesday retry after a Monday failure sends nothing.

Trigger one by hand:

```bash
curl -X POST https://utopia-trucking-task-manager.vercel.app/api/jobs/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## API reference

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message, details? } }`.
Stack traces and database messages never reach the client.

### Auth
```
POST   /api/auth/login             email + password, sets httpOnly cookies
POST   /api/auth/logout
POST   /api/auth/refresh           rotates the refresh token
GET    /api/auth/me                current user
PATCH  /api/auth/me                self-service profile: name, job title, department
POST   /api/auth/change-password   current + new + confirm
```

### Users — writes are Manager-only
```
GET    /api/users                  filterable by role and active
POST   /api/users                  returns the temporary password to the Manager
GET    /api/users/:id
PATCH  /api/users/:id
POST   /api/users/:id/activate
POST   /api/users/:id/deactivate
```

### Tasks
```
GET    /api/tasks                  filters: status, priority, assignedTo, createdBy, project, q
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/assign       { assigneeId }
POST   /api/tasks/:id/status       { status }
POST   /api/tasks/:id/complete
POST   /api/tasks/:id/reopen
POST   /api/tasks/:id/cancel
GET    /api/tasks/:id/history
GET    /api/tasks/:id/comments
POST   /api/tasks/:id/comments     { body }
```

### Notifications, dashboard, jobs
```
GET    /api/notifications
PATCH  /api/notifications/:id/read
POST   /api/notifications/read-all
GET    /api/dashboard              counts and list widgets
GET    /api/bootstrap              me + users + tasks + notifications, one call
GET|POST /api/jobs/reminders       CRON_SECRET required
GET|POST /api/jobs/expiry
GET|POST /api/jobs/digest
```

### Error codes

`INVALID_CREDENTIALS` · `UNAUTHORIZED` · `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` ·
`ACCOUNT_INACTIVE` · `USER_EXISTS` · `USER_NOT_FOUND` · `TASK_NOT_FOUND` ·
`INVALID_ASSIGNMENT` · `INVALID_STATUS_TRANSITION` · `SELF_ACTION_FORBIDDEN` ·
`LAST_MANAGER` · `VALIDATION_ERROR` · `RATE_LIMITED` · `EMAIL_FAILED` ·
`DATABASE_ERROR` · `NOT_FOUND` · `INTERNAL_ERROR`

---

## Database

Nine tables, all `uuid` primary keys and `timestamptz` timestamps.

| Table | Purpose |
| --- | --- |
| `teams` | Currently one row, `Operations`. Exists so a second team is data, not a migration |
| `users` | Identity, role, job title, manager link, active flag, `token_version` |
| `tasks` | The work. `ref` is a human id (`UT-1042`) from a Postgres sequence |
| `task_history` | Audit trail — who changed what, when |
| `task_comments` | Per-task discussion |
| `notifications` | Every email owed, its delivery state, and the unique `dedupe_key` |
| `login_attempts` | Backs DB-level rate limiting |
| `refresh_sessions` | One row per issued refresh token, for rotation and reuse detection |
| `job_runs` | One audit row per scheduled-job invocation |

```bash
npm run db:generate   # generate a migration from schema changes
npm run db:migrate    # apply pending migrations
npm run db:seed       # Operations team + first Manager (idempotent)
```

Migrations run against `DATABASE_URL_UNPOOLED`. Remember to migrate the test database
too.

---

## Testing

**268 tests across 20 files**, all against a real Neon database — no mocked database
anywhere.

```bash
npm test              # full suite
npm run typecheck     # tsc --noEmit
npx vitest run tests/task-assign.test.ts    # one file
```

Coverage includes the business rules that matter most:

- A Manager can create a team member; **all seven** other roles get 403 *and* no row is written
- A user can change their own password; nobody can change another's
- Assignment writes task, history and notification rows atomically
- A reminder is sent after 24 hours, and **not** a second time the same day
- Completed, cancelled and overdue tasks receive no reminders
- An expired task gets exactly one expiry email, even if reset and re-lapsed
- Concurrent job runs produce one set of emails, not two
- The login timing gap between an unknown email and a wrong password stays within bounds
- Refresh-token replay revokes the whole session family
- No endpoint returns a password hash

### The suite is slow, and why

Roughly 12 minutes. Every test hits a real Neon database in `us-east-2` over HTTP —
measured on a dev machine: a round-trip is ~460ms, a truncate ~290ms, and bcryptjs at
cost 12 is ~540ms per hash. `fileParallelism` is off because every suite truncates the
same shared database.

**Only one test process may run at a time.** Two concurrent `vitest` runs will truncate
each other's fixtures mid-test and produce false failures that look alarming and mean
nothing.

---

## Deployment

Deployed on Vercel. Full guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

```bash
vercel deploy --prod
```

Two things that are easy to get wrong:

**`vercel.json` sets `framework: null` deliberately.** Left to auto-detect, Vercel sees
Express and routes every non-`/api` request to `src/server.ts` — which calls
`app.listen()` and exports no handler, so the entire frontend returns 500 *"Invalid
export"* while `/api/*` works perfectly. That split symptom is the giveaway.

**Hobby rejects any cron more frequent than daily**, failing the deploy outright, which
is why expiry runs daily rather than hourly. The dashboard still shows a task as overdue
the instant its due time passes; only the expiry *email* can lag.

---

## Security

- **bcrypt** at cost 12. No plain-text password is stored, logged or returned
- **`publicUser()` is an explicit allow-list**, not an exclude-list. A column added to
  `users` later is absent by default rather than silently shipped to every client
- **JWT in httpOnly, SameSite=Lax cookies.** Access 15 min, refresh 7 days, separate
  secrets and distinct audience claims so one can never be replayed as the other
- **Refresh-token rotation with reuse detection.** Each refresh consumes its token via a
  conditional update; replaying a consumed token revokes every session for that user
- **`token_version`** invalidates all sessions instantly on password change or deactivation
- **Constant-cost login.** bcrypt runs on both branches — against a dummy hash when no
  user exists — so response timing cannot distinguish an unknown email from a wrong password
- **Rate limiting** counted from database rows, since an in-memory limiter is useless
  across serverless invocations. 10 failures per email and 30 per IP, per 15 minutes
- **Zod validation** on every body, query and path parameter; unknown keys are stripped,
  so a client cannot mass-assign `role`, `isActive` or `createdBy`
- **Drizzle parameterizes everything.** No string-interpolated SQL anywhere
- Secrets only in environment variables; `.env` gitignored

**One assumption worth knowing:** the per-IP rate limit keys on `req.ip`, derived from
`X-Forwarded-For` under `trust proxy`. It is only sound behind a proxy that overwrites
that header. Vercel does; a direct-to-internet deployment would not. The per-email limit
carries no such assumption and is the primary control.

---

## Project layout

```
index.html                  app shell, icon sprite, boot and login screens
assets/css/styles.css       design system — tokens, components, motion
assets/js/api.js            API client: fetch wrapper, cross-tab refresh coordination
assets/js/data.js           status / priority / role dictionaries
assets/js/ui.js             DOM helpers, formatters, toasts, animations
assets/js/views.js          the screens
assets/js/app.js            state, routing, drawer, modals, mutations

api/index.ts                Vercel serverless entry — exports the Express app
src/app.ts                  middleware, route mounting, error handler
src/server.ts               local dev listener (also serves the frontend)
src/routes/                 HTTP layer, one file per resource
src/services/               business rules and transactions
src/jobs/                   reminders, expiry, digest, and the audit wrapper
src/lib/                    auth, tokens, permissions, email, errors, validation
src/lib/email/              transport, renderer, five templates
src/db/                     Drizzle schema, migrations, seed
tests/                      20 Vitest suites
docs/                       EMAIL_SETUP.md, DEPLOYMENT.md
```

`TaskFlow.html` and `build-standalone.ps1` are the pre-backend single-file demo, kept for
reference. A single-file offline page cannot reach an API, so they are no longer part of
the build.

---

## Current status

**Working and deployed:** authentication, permissions, team management, tasks,
assignment, comments, history, dashboard, reports, notifications, all three scheduled
jobs, and the frontend.

**Not yet working: email delivery.** The Brevo SMTP transport is built and tested, and
credentials are configured, but Brevo is rejecting the connection with `525 5.7.1
Unauthorized IP address` — its IP allow-list is enabled. Until that is turned off,
notifications are recorded and marked `failed` rather than sent; nothing is lost, and the
retry sweep flushes the backlog once sending works. See
[docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md).

Because email is down, a Manager adding a team member is shown the generated temporary
password with a copy button, so onboarding still works by hand.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Every page 500s but `/api/*` works | Vercel framework auto-detection. Set `framework: null` |
| Every path returns Vercel-branded HTML | Deployment protection on the per-deployment URL. Use the canonical domain |
| Deploy fails: *"limited to daily cron jobs"* | A cron schedule more frequent than daily on Hobby |
| `525 5.7.1 Unauthorized IP address` | Brevo's IP allow-list is on. Disable it for serverless |
| `535 Authentication failed` | Wrong SMTP login or key — check it is an SMTP key, not an API key |
| Sender rejected | `BREVO_SMTP_FROM_EMAIL` is not verified in Brevo |
| Tests fail in strange, shifting ways | Two test processes against the same database |
| "It logged me out of everything" | Refresh-token reuse detection. Usually two browser tabs refreshing at once, not an attack |
| A new member never got their password | Email is not configured. Delete and re-add them, and copy the password from the dialog |

---

Created by Rizwan Hanif for Utopia Brands Trucking Team
