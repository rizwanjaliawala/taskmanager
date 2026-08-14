# Utopia Trucking Task Manager

Task management for the Utopia Brands Trucking Team.

Vanilla HTML/CSS/JS frontend → Express REST API → Neon PostgreSQL, with Microsoft Graph
email notifications and scheduled reminder and expiry jobs.

## Requirements

- Node 20+
- A Neon PostgreSQL database
- A Microsoft Entra ID app registration for sending mail (see
  [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md))

## Setup

```bash
npm install
cp .env.example .env      # then fill it in
npm run db:migrate        # create the schema
npm run db:seed           # create the Operations team and the first Manager
npm run dev               # http://localhost:3000
```

The seeded Manager signs in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` and must
change that password on first sign-in. Everyone else is added from **Team → Add team
member**, which only a Manager can do.

## Roles

Director · Sr. Manager · Manager · DM · Sr. AM · AM · Sr Executive · Executive

The team is flat: any active user can see every task and assign work to anyone. **Only a
Manager can add, edit, activate or deactivate users** — enforced by the API, not merely
by hiding buttons. The last active Manager cannot be deactivated or demoted, because
nobody would be left able to manage the team.

## Task lifecycle

```
Pending ──► In Progress ──► Completed ──reopen──► In Progress
   │  ▲          │  ▲            │
   │  └─ On Hold ┘  │
   └────────► Overdue ──► Completed

Cancelled is terminal from anywhere.
```

Completed and cancelled tasks stop receiving reminders. Overdue is set automatically when
a due time passes, and triggers exactly one expiry email, ever.

## Emails

| Email | When |
| --- | --- |
| Task assigned | Immediately, to both the assignee and the assigner |
| Still pending | Every 24 hours while a task stays open |
| Time finished | Once, when a due time passes without completion |
| Account created | When a Manager adds a team member |

Delivery goes through Microsoft Graph. A failed send is recorded against the notification
row and retried by the reminder job — nothing is silently dropped. Setup is in
[docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md).

## Scheduled jobs

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/jobs/reminders` | daily 09:00 | 24-hour reminders, plus retrying failed sends |
| `/api/jobs/expiry` | hourly | Mark overdue, send the one-time expiry email |

Both are idempotent — a unique `dedupe_key` on the notification row, not timing, is what
prevents duplicates — so they are safe to run at any frequency, or twice at once.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local server, frontend and API together |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Create the Operations team and first Manager (idempotent) |
| `npm test` | Vitest suite against `TEST_DATABASE_URL` |
| `npm run typecheck` | TypeScript check |

Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Layout

```
index.html                 app shell, icon sprite, boot and login screens
assets/css/styles.css      design system
assets/js/api.js           API client — fetch wrapper, refresh coordination
assets/js/data.js          status / priority / role dictionaries
assets/js/ui.js            DOM helpers, formatters, toasts
assets/js/views.js         the screens
assets/js/app.js           state, routing, drawer, modals, mutations
api/index.ts               Vercel serverless entry
src/routes                 HTTP layer
src/services               business rules
src/jobs                   scheduled jobs
src/lib                    auth, permissions, email, errors
src/db                     Drizzle schema, migrations, seed
```

`TaskFlow.html` and `build-standalone.ps1` are the pre-backend single-file demo. They are
kept for reference and are no longer part of the build — a single-file offline page
cannot reach the API.

---

Created by Rizwan Hanif for Utopia Brands Trucking Team
