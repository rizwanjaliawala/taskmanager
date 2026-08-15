# Deployment — Vercel

**Live:** https://utopia-trucking-task-manager.vercel.app

The Express API runs as a single serverless function from `api/index.ts`; the frontend is
served statically from the repository root by the CDN. Same origin, so the auth cookie is
first-party and there is no CORS to configure.

## Why `vercel.json` sets `framework: null`

Left to auto-detect, Vercel sees Express and routes every non-`/api` request to
`src/server.ts` — which calls `app.listen()` and exports no handler, so the whole
frontend returns **500 "Invalid export"** while `/api/*` works perfectly. That split
symptom (API fine, pages broken) is the giveaway.

With detection off and `outputDirectory: "."`, the repo root is served as static files
and only `/api/*` reaches the function. The rewrite is still required: `api/index.ts`
answers `/api` and `/api/index` on its own, so sub-paths like `/api/auth/login` need
mapping onto it.

## Deployment protection

The per-deployment URL (`…-<hash>.vercel.app`) sits behind Vercel's SSO and returns a
login page to anything unauthenticated — including health checks. The **canonical**
production domain is public. If every path suddenly returns Vercel-branded HTML with a
deployment id that is not the one you just shipped, you are looking at the protection
page, not your app.

## 1. Environment variables

Set every variable from `.env.example` in **Project → Settings → Environment Variables**,
scoped to Production. They are read at process start, so **redeploy after changing them**.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** endpoint — used at runtime by the HTTP driver |
| `DATABASE_URL_UNPOOLED` | Neon **direct** endpoint — used by drizzle-kit for DDL |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Distinct values, ≥32 chars each. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_SENDER_EMAIL` | Microsoft Graph — see [EMAIL_SETUP.md](EMAIL_SETUP.md) |
| `APP_URL` | The deployed origin. Used for CORS **and** for the links inside every notification email — get it wrong and every email links to localhost |
| `CRON_SECRET` | Vercel attaches this automatically to cron requests. **Must not** be left at the development default — the app refuses to boot in production if it is |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Only read by `npm run db:seed` |

## 2. Database

Run migrations from a machine that has `DATABASE_URL_UNPOOLED` set:

```bash
npm run db:migrate
npm run db:seed
```

Migrations use the direct endpoint because DDL through a transaction-mode pooler is
unreliable. The application itself uses the pooled endpoint, via Neon's HTTP driver — a
conventional `pg.Pool` would open a new pool per serverless invocation and exhaust the
connection limit.

## 3. Cron

`vercel.json` declares both jobs:

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/jobs/reminders` | `0 9 * * *` | 24-hour reminders, retry of failed sends |
| `/api/jobs/expiry` | `30 9 * * *` | Mark overdue, send the one-time expiry email |
| `/api/jobs/digest` | `0 8 * * 1` | Monday roll-up, one email per person |

Expiry would ideally run hourly, but Hobby rejects any schedule more frequent than daily
— the deploy fails outright with *"Hobby accounts are limited to daily cron jobs"*. Daily
is what ships. The practical cost is smaller than it sounds: **the dashboard still shows
a task as overdue the moment its due time passes**, because `isOverdue` is derived on
read rather than waiting for the job. Only the expiry *email* can lag by up to a day. On
Pro, set it back to `0 * * * *`.

**Vercel Hobby allows one cron invocation per day and caps how many cron jobs you can
declare** — three are declared here, so Hobby will likely need the Pro plan or one job
dropped. On Hobby, also change the expiry schedule to something like `30 9 * * *`.

All three jobs are idempotent — the unique `dedupe_key` constraint, not the schedule,
prevents duplicates — so they stay correct at any frequency, including running twice at
once. A more frequent expiry schedule only makes the overdue state fresher; a digest run
more than once in a week sends nothing extra, because its key is the ISO week.

Vercel Cron issues **GET** requests and attaches `Authorization: Bearer $CRON_SECRET`.
The endpoints accept GET and POST. To trigger one by hand:

```bash
curl -X POST https://your-app.vercel.app/api/jobs/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

Route order matters: `jobRoutes` is mounted before the dashboard router, which applies
`requireAuth` to everything reaching it. Mounted the other way round, every cron request
would be rejected as unauthenticated before the cron-secret check ran, and the jobs would
silently never fire.

## 4. Login rate limiting depends on your proxy

Login is throttled two ways: **10 failures per email** per 15 minutes, and **30 per IP**.

The per-IP limit keys on `req.ip`, which Express derives from `X-Forwarded-For` because
the app sets `trust proxy`. That header is client-settable, so the IP limit is only sound
behind a proxy that **overwrites** it with the real peer address. **Vercel does.** If you
ever run this exposed directly to the internet, an attacker can rotate the header and
evade the IP limit entirely.

The per-email limit carries no such assumption and is the primary control — spraying one
account is throttled wherever the request claims to come from. The IP limit is the
secondary net for spraying many accounts from one source.

## 5. Verify after deploying

1. `GET /api/health` returns `{"ok":true,...}`.
2. Sign in as the seeded Manager — you should be routed to Change password.
3. Add a team member; confirm the account email arrives. If it does not, the dialog shows
   the temporary password so you can hand it over, and the reason is on the
   `notifications` row's `last_error`.
4. Create and assign a task; confirm both the assignee and the assigner receive it.
5. After the first scheduled run, check the `job_runs` table for a row with `finished_at`
   set.

## 6. Rotate the seed credentials

Change `SEED_ADMIN_PASSWORD` in Vercel after the first sign-in, and rotate the Neon
database password from the Neon console. Neither is needed at runtime after seeding.

---

Created by Rizwan Hanif for Utopia Brands Trucking Team
