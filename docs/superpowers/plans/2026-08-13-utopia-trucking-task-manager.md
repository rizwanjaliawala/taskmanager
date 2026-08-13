# Utopia Trucking Task Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing static TaskFlow frontend into a working full-stack application — Express REST API on Vercel, Neon PostgreSQL, JWT cookie auth, Manager-gated user creation, SMTP notifications, and cron-driven reminder/expiry jobs — rebranded to Utopia Trucking Task Manager.

**Architecture:** A single Express app is exported as one Vercel serverless function from `api/index.ts`; the existing frontend is served statically from the repo root on the same origin. Routes validate and delegate to services; services own business rules and talk to Drizzle; email and permissions are standalone modules that both routes and cron jobs import. The frontend keeps all nine views intact by hydrating `TF.tasks` / `TF.users` from one `/api/bootstrap` call before the first render.

**Tech Stack:** Node 20, TypeScript, Express 4, Drizzle ORM + drizzle-kit, `@neondatabase/serverless` (HTTP driver), Zod, bcryptjs, jsonwebtoken, Nodemailer, Helmet, Vitest, Supertest. Frontend stays vanilla ES5-style JS — no framework, no build step.

## Global Constraints

- **Product name is `Utopia Trucking Task Manager`** everywhere user-visible: `<title>`, meta description, boot screen, login screen, sidebar, footer, email subjects and bodies, README.
- **Credit footnote is exactly `Created by Rizwan Hanif for Utopia Brands Trucking Team`** — app footer, login screen, and email template footer.
- **Task status keys are stored verbatim as the frontend already uses them:** `assigned`, `progress`, `hold`, `completed`, `overdue`, plus new `cancelled`. `assigned` is *displayed* as "Pending" and never renamed in the database or API.
- **Priority keys:** `low`, `medium`, `high`, `critical`.
- **Organizational roles (exactly 8):** `director`, `sr_manager`, `manager`, `dm`, `sr_am`, `am`, `sr_executive`, `executive`.
- **Only `manager` may create, update, activate, or deactivate users.** Enforced server-side on every such route, independent of any frontend control.
- **Permissions are flat and single-team:** any active authenticated user may view and assign any task. Edit/delete/status/complete are limited to creator, assignee, or Manager.
- **No plain-text password is ever stored, logged, returned, or emailed to a third party.** `password_hash` must never appear in any API response.
- **All secrets come from environment variables.** No credential, connection string, or key appears in any committed file. `.env` is gitignored; `.env.example` holds placeholders only.
- **Node 20.x.** `"engines": { "node": ">=20 <21" }`.
- **Drizzle `neon-http` has no interactive `db.transaction()`.** Every atomic multi-write uses `db.batch([...])`, shaped read → validate → batch-write.
- **Vercel Cron issues `GET`** and attaches `Authorization: Bearer $CRON_SECRET`. Job endpoints accept both `GET` and `POST` and verify that header.
- **Tests must never run against the production database.** `tests/setup.ts` aborts if `TEST_DATABASE_URL` is unset or equals `DATABASE_URL`.
- **Commit after every task.** Conventional commit messages (`feat:`, `test:`, `chore:`, `refactor:`).
- **No charts anywhere.** `assets/js/charts.js` is deleted; no replacement visualization is added.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json`, `vercel.json`, `.env.example` | Project configuration |
| `api/index.ts` | Vercel serverless entry — exports the Express app |
| `src/app.ts` | Express app assembly: middleware, route mounting, error handler |
| `src/server.ts` | Local dev listener (`tsx watch`) |
| `src/lib/env.ts` | Zod-validated environment loader |
| `src/lib/errors.ts` | `AppError` + typed error codes |
| `src/lib/respond.ts` | `{ ok, data }` / `{ ok, error }` envelope helpers |
| `src/lib/validate.ts` | Zod request-validation middleware |
| `src/lib/password.ts` | bcrypt hash/verify + policy check |
| `src/lib/tokens.ts` | Access/refresh JWT sign + verify |
| `src/lib/auth.ts` | `requireAuth`, `requirePasswordChanged` middleware |
| `src/lib/permissions.ts` | `can()` + `requirePermission()` — the single source of authority |
| `src/lib/serialize.ts` | DB row → API shape (`publicUser`, `publicTask`) |
| `src/lib/logger.ts` | Structured server-side logging |
| `src/db/schema.ts` | Drizzle tables + enums |
| `src/db/client.ts` | Neon HTTP client + Drizzle instance |
| `src/db/migrate.ts`, `src/db/seed.ts` | Migration runner, idempotent seed |
| `src/services/auth.service.ts` | Login, refresh, password change, rate limiting |
| `src/services/user.service.ts` | User CRUD, activation |
| `src/services/task.service.ts` | Task CRUD, assignment, status transitions, history |
| `src/services/comment.service.ts` | Task comments |
| `src/services/notification.service.ts` | Notification create/read, dedupe, delivery bookkeeping |
| `src/services/dashboard.service.ts` | Counts + list widgets + bootstrap payload |
| `src/lib/email/transport.ts`, `render.ts`, `templates/*.ts`, `index.ts` | Email service |
| `src/jobs/reminders.ts`, `src/jobs/expiry.ts`, `src/jobs/runner.ts` | Scheduled job bodies + audit wrapper |
| `src/routes/*.routes.ts` | HTTP layer, one file per resource |
| `assets/js/api.js` | Frontend fetch client (new) |
| `assets/js/data.js` | Reduced to dictionaries only |
| `assets/js/views.js`, `app.js`, `index.html` | Wired to the API, charts removed, rebranded |
| `tests/*.test.ts` | Vitest suites |

---

## Task Index

| # | Task | Delivers |
| --- | --- | --- |
| 1 | Project scaffolding + error envelope | `/api/health` responding in the standard envelope |
| 2 | Database schema + migrations | All tables live on Neon; `batch` rollback verified |
| 3 | Seed script | Operations team + Manager account |
| 4 | Password + tokens + auth middleware | Verified hashing and JWT round-trip |
| 5 | Permissions module | `can()` matrix fully tested |
| 6 | Auth routes | Login, logout, refresh, me, change-password |
| 7 | Users routes | Manager-gated user management |
| 8 | Email service | Three templates + mock transport |
| 9 | Tasks CRUD | List, create, read, update, delete |
| 10 | Assignment + status transitions | History, notifications, assignment email |
| 11 | Comments + history routes | Drawer data |
| 12 | Notifications + dashboard + bootstrap | Frontend hydration payload |
| 13 | Reminder job | 24h reminders with dedupe + retry |
| 14 | Expiry job | Overdue transition + one-time expiry email |
| 15 | Frontend API client | `TF.api` with refresh-retry |
| 16 | Frontend auth wiring | Real login, forced password change, logout |
| 17 | Frontend hydration + mutations | Server as source of truth |
| 18 | Remove charts + rebuild dashboard | Count tiles + list widgets |
| 19 | Rebuild reports | Tables and counts |
| 20 | User management screen | Manager-only roster controls |
| 21 | Branding + footer credit + docs | Rename, credit line, README, deploy guide |

---

### Task 1: Project scaffolding, environment loader, error envelope

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vercel.json`, `.env.example`
- Create: `src/lib/env.ts`, `src/lib/errors.ts`, `src/lib/respond.ts`, `src/lib/logger.ts`
- Create: `src/app.ts`, `src/server.ts`, `api/index.ts`
- Test: `tests/health.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `env: { DATABASE_URL: string; DATABASE_URL_UNPOOLED?: string; JWT_SECRET: string; JWT_REFRESH_SECRET: string; EMAIL_HOST: string; EMAIL_PORT: number; EMAIL_SECURE: boolean; EMAIL_USERNAME: string; EMAIL_PASSWORD: string; EMAIL_FROM: string; APP_URL: string; CRON_SECRET: string; SEED_ADMIN_EMAIL: string; SEED_ADMIN_PASSWORD: string; NODE_ENV: 'development'|'production'|'test' }`
  - `class AppError extends Error { code: ErrorCode; status: number; details?: unknown; constructor(code: ErrorCode, message: string, details?: unknown) }`
  - `type ErrorCode = 'INVALID_CREDENTIALS'|'UNAUTHORIZED'|'FORBIDDEN'|'PASSWORD_CHANGE_REQUIRED'|'ACCOUNT_INACTIVE'|'USER_EXISTS'|'USER_NOT_FOUND'|'TASK_NOT_FOUND'|'INVALID_ASSIGNMENT'|'INVALID_STATUS_TRANSITION'|'VALIDATION_ERROR'|'RATE_LIMITED'|'EMAIL_FAILED'|'DATABASE_ERROR'|'NOT_FOUND'|'INTERNAL_ERROR'`
  - `ok<T>(res: Response, data: T, status?: number): void`
  - `fail(res: Response, err: AppError): void`
  - `createApp(): express.Express`
  - `logger: { info(msg: string, meta?: object): void; warn(...): void; error(...): void }`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "utopia-trucking-task-manager",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20 <21" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.4.7",
    "drizzle-orm": "^0.38.3",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "nodemailer": "^6.9.16",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^20.17.10",
    "@types/nodemailer": "^6.4.17",
    "@types/supertest": "^6.0.2",
    "drizzle-kit": "^0.30.1",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Run: `npm install`
Expected: `node_modules/` created, no peer-dependency errors.

- [ ] **Step 2: Create `tsconfig.json` and `vitest.config.ts`**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "api/**/*.ts", "tests/**/*.ts", "drizzle.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

`fileParallelism: false` matters — every suite truncates the same shared test database, so parallel files would clobber each other.

- [ ] **Step 3: Create `.env.example`**

Placeholders only. Never commit a real value here.

```
# --- database (Neon) ---
# Pooled endpoint, used at runtime by the HTTP driver
DATABASE_URL=postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
# Direct endpoint (same host without "-pooler"), used by drizzle-kit for DDL
DATABASE_URL_UNPOOLED=postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
# Separate Neon branch for tests. MUST differ from DATABASE_URL.
TEST_DATABASE_URL=

# --- auth ---
# Generate each with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=
JWT_REFRESH_SECRET=

# --- email (SMTP) ---
EMAIL_HOST=smtp.office365.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USERNAME=
EMAIL_PASSWORD=
EMAIL_FROM="Utopia Trucking Task Manager <tasks@utopiabrands.com>"

# --- app ---
APP_URL=http://localhost:3000
NODE_ENV=development

# --- cron ---
# Vercel sends this automatically as "Authorization: Bearer $CRON_SECRET"
CRON_SECRET=

# --- initial manager account (used only by npm run db:seed) ---
SEED_ADMIN_EMAIL=shahzeb.ali@utopiabrands.com
SEED_ADMIN_PASSWORD=
```

Also create a local `.env` (gitignored) with the real Neon URL, real secrets, and `SEED_ADMIN_PASSWORD=Utopia01`. Confirm it is ignored:

Run: `git check-ignore -v .env`
Expected: a line naming `.gitignore` — proving the file will not be committed.

- [ ] **Step 4: Write `src/lib/env.ts`**

```ts
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  EMAIL_HOST: z.string().default('localhost'),
  EMAIL_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_SECURE: z.coerce.boolean().default(false),
  EMAIL_USERNAME: z.string().default(''),
  EMAIL_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().default('Utopia Trucking Task Manager <no-reply@localhost>'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  CRON_SECRET: z.string().min(16).default('dev-cron-secret-change-me'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
```

- [ ] **Step 5: Write `src/lib/errors.ts`**

```ts
export type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'ACCOUNT_INACTIVE'
  | 'USER_EXISTS'
  | 'USER_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'INVALID_ASSIGNMENT'
  | 'INVALID_STATUS_TRANSITION'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'EMAIL_FAILED'
  | 'DATABASE_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  ACCOUNT_INACTIVE: 403,
  USER_EXISTS: 409,
  USER_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  INVALID_ASSIGNMENT: 422,
  INVALID_STATUS_TRANSITION: 422,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  EMAIL_FAILED: 502,
  DATABASE_ERROR: 500,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const unauthorized = (m = 'Authentication required') => new AppError('UNAUTHORIZED', m);
export const forbidden = (m = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', m);
export const notFound = (m = 'Resource not found') => new AppError('NOT_FOUND', m);
```

- [ ] **Step 6: Write `src/lib/logger.ts` and `src/lib/respond.ts`**

`src/lib/logger.ts`:

```ts
import { isTest } from './env.js';

function emit(level: 'info' | 'warn' | 'error', msg: string, meta?: object) {
  if (isTest && level !== 'error') return;
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: object) => emit('info', msg, meta),
  warn: (msg: string, meta?: object) => emit('warn', msg, meta),
  error: (msg: string, meta?: object) => emit('error', msg, meta),
};
```

`src/lib/respond.ts` — the envelope. Note `fail` never serializes `err.stack` or a raw database message:

```ts
import type { Response } from 'express';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export function fail(res: Response, err: AppError): void {
  res.status(err.status).json({
    ok: false,
    error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
  });
}

/** Express error handler. Unknown errors are logged in full and reported as INTERNAL_ERROR. */
export function errorHandler(err: unknown, _req: any, res: Response, _next: any): void {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(err.message, { code: err.code });
    fail(res, err);
    return;
  }
  logger.error('Unhandled error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  fail(res, new AppError('INTERNAL_ERROR', 'An unexpected error occurred'));
}
```

- [ ] **Step 7: Write the failing test — `tests/health.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('app skeleton', () => {
  it('GET /api/health returns the success envelope', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('unknown /api route returns the error envelope, not an HTML 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('never leaks a stack trace on an unexpected error', async () => {
    const res = await request(app).get('/api/health/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run tests/health.test.ts`
Expected: FAIL — `Cannot find module '../src/app.js'`.

- [ ] **Step 9: Write `src/app.ts`**

The `/api/health/boom` route exists solely to prove the error handler swallows internals; keep it.

```ts
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppError } from './lib/errors.js';
import { ok, errorHandler } from './lib/respond.js';
import { env } from './lib/env.js';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Same-origin deployment: only allow the configured app origin.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', env.APP_URL);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  app.get('/api/health', (_req, res) => {
    ok(res, { status: 'ok', service: 'Utopia Trucking Task Manager', ts: new Date().toISOString() });
  });

  app.get('/api/health/boom', () => {
    throw new Error('intentional failure: secret-value-must-not-leak');
  });

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Endpoint not found')));
  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 10: Write `src/server.ts` and `api/index.ts`**

`src/server.ts` — local development only. It also serves the existing frontend so `npm run dev` gives you the whole app on one origin, exactly as Vercel will:

```ts
import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';

const app = createApp();
const root = path.resolve(process.cwd());
app.use(express.static(root, { index: 'index.html', extensions: ['html'] }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => logger.info(`Listening on http://localhost:${port}`, { env: env.NODE_ENV }));
```

`api/index.ts` — the Vercel handler. An Express app *is* a `(req, res)` function, so it can be exported directly:

```ts
import { createApp } from '../src/app.js';

export default createApp();
```

- [ ] **Step 11: Create `vercel.json`**

`crons` below assume a Pro plan (hourly expiry). On Hobby, change the expiry schedule to `0 * * * *` → `30 9 * * *`; both jobs stay correct because they are idempotent.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }],
  "crons": [
    { "path": "/api/jobs/reminders", "schedule": "0 9 * * *" },
    { "path": "/api/jobs/expiry", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run tests/health.test.ts`
Expected: PASS — 3 tests.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 13: Verify the frontend still serves and nothing leaked**

Run: `npm run dev`, then open `http://localhost:3000`
Expected: the existing TaskFlow boot screen and login render exactly as before.

Run: `git status --short`
Expected: `.env` does **not** appear in the list.

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts vercel.json .env.example src/ api/ tests/
git commit -m "feat: scaffold Express API with env loader, error envelope and health check"
```

---

### Task 2: Database schema, migrations and Neon client

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `drizzle.config.ts`
- Create: `drizzle/0001_task_ref_sequence.sql` (hand-written, after generation)
- Test: `tests/setup.ts`, `tests/db.test.ts`

**Interfaces:**
- Consumes: `env` (Task 1)
- Produces:
  - `db` — Drizzle instance over the Neon HTTP driver, typed with the full schema
  - Tables: `teams`, `users`, `tasks`, `taskHistory`, `taskComments`, `notifications`, `loginAttempts`, `jobRuns`
  - Enums: `roleEnum`, `taskStatusEnum`, `taskPriorityEnum`, `historyEventEnum`, `notificationTypeEnum`, `notificationChannelEnum`, `notificationStatusEnum`
  - `ROLES: readonly ['director','sr_manager','manager','dm','sr_am','am','sr_executive','executive']`
  - `TASK_STATUSES: readonly ['assigned','progress','hold','completed','overdue','cancelled']`
  - `ACTIVE_STATUSES: readonly ['assigned','progress','hold']` — the statuses that receive reminders
  - `type Role`, `type TaskStatus`, `type TaskPriority`
  - `truncateAll(): Promise<void>` — test helper exported from `tests/setup.ts`

- [ ] **Step 1: Write the failing test — `tests/setup.ts`**

This file is a safety device before it is a convenience. It refuses to run if the test URL is missing or points at production.

```ts
import 'dotenv/config';
import { beforeEach } from 'vitest';
import { neon } from '@neondatabase/serverless';

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Create a separate Neon branch for tests — ' +
      'the suite truncates every table and must never touch production data.',
  );
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL equals DATABASE_URL. Refusing to run: the suite would ' +
      'truncate the production database.',
  );
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';

const sql = neon(testUrl);

export async function truncateAll(): Promise<void> {
  await sql`TRUNCATE TABLE
    notifications, task_comments, task_history, tasks,
    login_attempts, job_runs, users, teams
    RESTART IDENTITY CASCADE`;
}

beforeEach(async () => {
  await truncateAll();
});
```

`tests/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql as dsql, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { teams, users, tasks, notifications } from '../src/db/schema.js';

async function makeUser(email: string) {
  const [u] = await db.insert(users).values({
    fullName: 'Test User', email, passwordHash: 'x', role: 'manager',
  }).returning();
  return u!;
}

describe('database schema', () => {
  it('creates every expected table', async () => {
    const rows = await db.execute(dsql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    const names = (rows.rows as { table_name: string }[]).map((r) => r.table_name);
    for (const t of ['teams','users','tasks','task_history','task_comments','notifications','login_attempts','job_runs']) {
      expect(names).toContain(t);
    }
  });

  it('enforces a unique email', async () => {
    await makeUser('dup@utopiabrands.com');
    await expect(makeUser('dup@utopiabrands.com')).rejects.toThrow();
  });

  it('treats email as case-insensitive', async () => {
    await makeUser('Case@utopiabrands.com');
    await expect(makeUser('case@utopiabrands.com')).rejects.toThrow();
  });

  it('auto-generates a UT- prefixed task ref', async () => {
    const u = await makeUser('ref@utopiabrands.com');
    const [t] = await db.insert(tasks).values({
      title: 'Ref test', createdBy: u.id, priority: 'medium', status: 'assigned',
    }).returning();
    expect(t!.ref).toMatch(/^UT-\d{4,}$/);
  });

  it('rejects a progress value outside 0-100', async () => {
    const u = await makeUser('prog@utopiabrands.com');
    await expect(
      db.insert(tasks).values({
        title: 'Bad', createdBy: u.id, priority: 'low', status: 'assigned', progress: 150,
      }),
    ).rejects.toThrow();
  });

  it('enforces a unique dedupe_key on notifications', async () => {
    const u = await makeUser('dedupe@utopiabrands.com');
    const row = { userId: u.id, type: 'reminder' as const, channel: 'email' as const,
      title: 'r', body: 'r', dedupeKey: 'reminder:abc:2026-08-13' };
    await db.insert(notifications).values(row);
    await expect(db.insert(notifications).values(row)).rejects.toThrow();
  });

  it('allows many notifications with a null dedupe_key', async () => {
    const u = await makeUser('nulls@utopiabrands.com');
    const row = { userId: u.id, type: 'comment' as const, channel: 'in_app' as const,
      title: 'c', body: 'c', dedupeKey: null };
    await db.insert(notifications).values(row);
    await db.insert(notifications).values(row);
    const all = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(all).toHaveLength(2);
  });

  it('rolls back the whole batch when one statement fails', async () => {
    const u = await makeUser('batch@utopiabrands.com');
    await db.insert(teams).values({ name: 'Operations' });
    await expect(
      db.batch([
        db.insert(tasks).values({ title: 'Batch A', createdBy: u.id, priority: 'low', status: 'assigned' }),
        db.insert(tasks).values({ title: 'Batch B', createdBy: u.id, priority: 'low', status: 'assigned', progress: 999 }),
      ] as any),
    ).rejects.toThrow();
    const remaining = await db.select().from(tasks);
    expect(remaining).toHaveLength(0);
  });
});
```

The final test is load-bearing. The entire assignment flow assumes `db.batch` is atomic; this proves it before twenty tasks are built on the assumption.

- [ ] **Step 2: Run the test to verify it fails**

First create a Neon branch for tests in the Neon console (Branches → New branch from `main`, name it `test`), copy its pooled connection string into `.env` as `TEST_DATABASE_URL`.

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `Cannot find module '../src/db/client.js'`.

- [ ] **Step 3: Write `src/db/schema.ts`**

```ts
import {
  boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  managerId: uuid('manager_id').references((): any => users.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
}, (t) => [index('login_attempts_email_idx').on(t.email, t.createdAt)]);

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
```

A unique index on a nullable `dedupe_key` is exactly right: Postgres treats `NULL` as distinct, so ad-hoc notifications (comments, in-app-only) can be created freely while keyed ones are singular. That is why the "many nulls" test exists.

- [ ] **Step 4: Write `src/db/client.ts`**

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { env } from '../lib/env.js';

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema, casing: 'snake_case' });
export { schema };
```

- [ ] **Step 5: Create `drizzle.config.ts` and generate the migration**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // DDL through a transaction-mode pooler is unreliable; prefer the direct endpoint.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
```

Run: `npm run db:generate`
Expected: `drizzle/0000_*.sql` and `drizzle/meta/` created.

- [ ] **Step 6: Add the task-ref sequence migration**

`tasks.ref` defaults to `'UT-' || nextval('task_ref_seq')`, so the sequence must exist **before** the table. Open the generated `drizzle/0000_*.sql` and insert this as its first line:

```sql
CREATE SEQUENCE IF NOT EXISTS task_ref_seq START WITH 1001 INCREMENT BY 1;
```

Verify it precedes `CREATE TABLE "tasks"`:

Run: `grep -n "task_ref_seq\|CREATE TABLE \"tasks\"" drizzle/0000_*.sql`
Expected: the sequence line has a lower line number than the tasks table.

- [ ] **Step 7: Write `src/db/migrate.ts`**

```ts
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required to run migrations');

const target = new URL(url.replace(/^postgresql:/, 'https:')).host;
console.log(`Applying migrations to ${target}`);

await migrate(drizzle(neon(url)), { migrationsFolder: './drizzle' });
console.log('Migrations applied.');
```

Logging only the host keeps the password out of terminal scrollback and CI logs.

- [ ] **Step 8: Apply migrations to both databases**

Run: `npm run db:migrate`
Expected: `Migrations applied.`

Run: `DATABASE_URL_UNPOOLED= DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate`
Expected: `Migrations applied.` (PowerShell: `$env:DATABASE_URL=$env:TEST_DATABASE_URL; npm run db:migrate`)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS — 8 tests, including the batch-rollback test.

If the rollback test fails, stop and report it. Every atomic operation in Tasks 10, 13 and 14 depends on `db.batch` being transactional; the fallback is `drizzle-orm/neon-serverless` with a `Pool`, which is a design change, not a patch.

- [ ] **Step 10: Commit**

```bash
git add src/db/ drizzle/ drizzle.config.ts tests/setup.ts tests/db.test.ts
git commit -m "feat: add Drizzle schema, Neon client and migrations"
```

---

### Task 3: Seed script

**Files:**
- Create: `src/db/seed.ts`
- Test: `tests/seed.test.ts`

**Interfaces:**
- Consumes: `db`, `teams`, `users` (Task 2); `env` (Task 1)
- Produces: `runSeed(): Promise<{ teamId: string; userId: string; created: boolean }>`

The seed creates exactly two things and is safe to re-run: the `Operations` team and one Manager account from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. No demo users, no demo tasks — real data is entered through the UI.

- [ ] **Step 1: Write the failing test — `tests/seed.test.ts`**

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, teams } from '../src/db/schema.js';
import { runSeed } from '../src/db/seed.js';

beforeAll(() => {
  process.env.SEED_ADMIN_EMAIL = 'shahzeb.ali@utopiabrands.com';
  process.env.SEED_ADMIN_PASSWORD = 'Utopia01';
});

describe('seed', () => {
  it('creates the Operations team and one Manager account', async () => {
    const result = await runSeed();
    expect(result.created).toBe(true);

    const [team] = await db.select().from(teams).where(eq(teams.name, 'Operations'));
    expect(team).toBeDefined();

    const [admin] = await db.select().from(users)
      .where(eq(users.email, 'shahzeb.ali@utopiabrands.com'));
    expect(admin!.role).toBe('manager');
    expect(admin!.isActive).toBe(true);
    expect(admin!.teamId).toBe(team!.id);
  });

  it('forces a password change on first login', async () => {
    await runSeed();
    const [admin] = await db.select().from(users)
      .where(eq(users.email, 'shahzeb.ali@utopiabrands.com'));
    expect(admin!.mustChangePassword).toBe(true);
  });

  it('stores a bcrypt hash, never the plain password', async () => {
    await runSeed();
    const [admin] = await db.select().from(users)
      .where(eq(users.email, 'shahzeb.ali@utopiabrands.com'));
    expect(admin!.passwordHash).not.toBe('Utopia01');
    expect(admin!.passwordHash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('Utopia01', admin!.passwordHash)).toBe(true);
  });

  it('is idempotent — a second run creates no duplicates', async () => {
    await runSeed();
    const second = await runSeed();
    expect(second.created).toBe(false);

    const allUsers = await db.select().from(users);
    const allTeams = await db.select().from(teams);
    expect(allUsers).toHaveLength(1);
    expect(allTeams).toHaveLength(1);
  });

  it('creates no demo tasks', async () => {
    await runSeed();
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
  });

  it('refuses to run without SEED_ADMIN_PASSWORD', async () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    await expect(runSeed()).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    process.env.SEED_ADMIN_PASSWORD = 'Utopia01';
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/seed.test.ts`
Expected: FAIL — `Cannot find module '../src/db/seed.js'`.

- [ ] **Step 3: Write `src/db/seed.ts`**

```ts
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
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
  }).returning();

  return { teamId: team!.id, userId: admin!.id, created: true };
}

// Executed directly via `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runSeed();
  console.log(
    r.created
      ? `Seeded team "${TEAM_NAME}" and Manager account ${process.env.SEED_ADMIN_EMAIL}.\n` +
        'This account must change its password on first login.'
      : `Already seeded — Manager account ${process.env.SEED_ADMIN_EMAIL} exists. No changes made.`,
  );
}
```

Note `runSeed` reads `process.env` directly rather than the cached `env` object, so the test can vary values between cases.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/seed.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Seed the real database**

Run: `npm run db:seed`
Expected: `Seeded team "Operations" and Manager account shahzeb.ali@utopiabrands.com.`

Run: `npm run db:seed`
Expected: `Already seeded … No changes made.` — proves idempotency against the live database.

- [ ] **Step 6: Commit**

```bash
git add src/db/seed.ts tests/seed.test.ts
git commit -m "feat: add idempotent seed creating the Operations team and initial Manager"
```

---

### Task 4: Password hashing, JWT tokens and auth middleware

**Files:**
- Create: `src/lib/password.ts`, `src/lib/tokens.ts`, `src/lib/auth.ts`, `src/lib/serialize.ts`
- Test: `tests/auth-lib.test.ts`

**Interfaces:**
- Consumes: `env` (Task 1); `users`, `db`, `Role` (Task 2); `AppError` (Task 1)
- Produces:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `assertPasswordPolicy(plain: string): void` — throws `AppError('VALIDATION_ERROR')`
  - `signAccessToken(p: TokenPayload): string`, `signRefreshToken(p: TokenPayload): string`
  - `verifyAccessToken(t: string): TokenPayload`, `verifyRefreshToken(t: string): TokenPayload`
  - `type TokenPayload = { sub: string; role: Role; tokenVersion: number }`
  - `setAuthCookies(res, access, refresh): void`, `clearAuthCookies(res): void`
  - `ACCESS_COOKIE = 'utm_access'`, `REFRESH_COOKIE = 'utm_refresh'`
  - `requireAuth: RequestHandler` — populates `req.user: AuthUser`
  - `requirePasswordChanged: RequestHandler`
  - `type AuthUser = { id: string; email: string; fullName: string; role: Role; isActive: boolean; mustChangePassword: boolean; teamId: string | null }`
  - `publicUser(row): PublicUser` — the projection that strips `passwordHash` and `tokenVersion`

- [ ] **Step 1: Write the failing test — `tests/auth-lib.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  hashPassword, verifyPassword, assertPasswordPolicy,
} from '../src/lib/password.js';
import {
  signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken,
} from '../src/lib/tokens.js';
import { publicUser } from '../src/lib/serialize.js';
import { AppError } from '../src/lib/errors.js';

const payload = { sub: '11111111-1111-1111-1111-111111111111', role: 'manager' as const, tokenVersion: 0 };

describe('password', () => {
  it('produces a bcrypt hash that is not the plain text', async () => {
    const h = await hashPassword('Utopia01');
    expect(h).not.toBe('Utopia01');
    expect(h.startsWith('$2')).toBe(true);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('Utopia01');
    expect(await verifyPassword('Utopia01', h)).toBe(true);
    expect(await verifyPassword('utopia01', h)).toBe(false);
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(() => assertPasswordPolicy('Ab1')).toThrow(AppError);
  });

  it('requires at least one letter and one digit', () => {
    expect(() => assertPasswordPolicy('abcdefgh')).toThrow(AppError);
    expect(() => assertPasswordPolicy('12345678')).toThrow(AppError);
    expect(() => assertPasswordPolicy('abcdefg1')).not.toThrow();
  });
});

describe('tokens', () => {
  it('round-trips an access token', () => {
    const decoded = verifyAccessToken(signAccessToken(payload));
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.role).toBe('manager');
    expect(decoded.tokenVersion).toBe(0);
  });

  it('rejects a tampered token', () => {
    const t = signAccessToken(payload);
    expect(() => verifyAccessToken(t.slice(0, -3) + 'aaa')).toThrow();
  });

  it('will not verify a refresh token as an access token', () => {
    expect(() => verifyAccessToken(signRefreshToken(payload))).toThrow();
  });

  it('will not verify an access token as a refresh token', () => {
    expect(() => verifyRefreshToken(signAccessToken(payload))).toThrow();
  });
});

describe('publicUser', () => {
  it('strips passwordHash and tokenVersion', () => {
    const row = {
      id: 'u1', fullName: 'Shahzeb Ali', email: 'shahzeb.ali@utopiabrands.com',
      passwordHash: '$2a$12$secret', role: 'manager', jobTitle: 'Manager',
      department: 'Operations', teamId: 't1', managerId: null, isActive: true,
      mustChangePassword: false, tokenVersion: 3,
      createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null,
    };
    const out = publicUser(row as any) as Record<string, unknown>;
    expect(out.passwordHash).toBeUndefined();
    expect(out.tokenVersion).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('$2a$12$secret');
    expect(out.email).toBe('shahzeb.ali@utopiabrands.com');
    expect(out.role).toBe('manager');
  });
});
```

Separate secrets for access and refresh tokens are what make the two cross-verification tests pass. With one shared secret, a refresh token would be a valid access token — a 7-day bearer credential where a 15-minute one was intended.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth-lib.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/password.js'`.

- [ ] **Step 3: Write `src/lib/password.ts`**

```ts
import bcrypt from 'bcryptjs';
import { AppError } from './errors.js';

const COST = 12;
const MIN_LENGTH = 8;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function assertPasswordPolicy(plain: string): void {
  if (typeof plain !== 'string' || plain.length < MIN_LENGTH) {
    throw new AppError('VALIDATION_ERROR', `Password must be at least ${MIN_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) {
    throw new AppError('VALIDATION_ERROR', 'Password must contain at least one letter and one digit');
  }
}
```

- [ ] **Step 4: Write `src/lib/tokens.ts`**

```ts
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isProd } from './env.js';
import type { Role } from '../db/schema.js';

export type TokenPayload = { sub: string; role: Role; tokenVersion: number };

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const ISSUER = 'utopia-trucking-task-manager';

export const ACCESS_COOKIE = 'utm_access';
export const REFRESH_COOKIE = 'utm_refresh';

export function signAccessToken(p: TokenPayload): string {
  return jwt.sign(p, env.JWT_SECRET, { expiresIn: ACCESS_TTL, issuer: ISSUER, audience: 'access' });
}

export function signRefreshToken(p: TokenPayload): string {
  return jwt.sign(p, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL, issuer: ISSUER, audience: 'refresh' });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER, audience: 'access' }) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER, audience: 'refresh' }) as TokenPayload;
}

export function setAuthCookies(res: Response, access: string, refresh: string): void {
  const base = { httpOnly: true, secure: isProd, sameSite: 'lax' as const };
  res.cookie(ACCESS_COOKIE, access, { ...base, path: '/', maxAge: 15 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...base, path: '/api/auth', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
```

Scoping the refresh cookie to `path: '/api/auth'` means the browser never attaches the long-lived credential to ordinary API calls — it travels only to the endpoint that consumes it.

- [ ] **Step 5: Write `src/lib/serialize.ts`**

```ts
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
```

- [ ] **Step 6: Write `src/lib/auth.ts`**

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, type Role } from '../db/schema.js';
import { AppError } from './errors.js';
import { ACCESS_COOKIE, verifyAccessToken } from './tokens.js';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  teamId: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

function readToken(req: Request): string | null {
  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof cookie === 'string' && cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = readToken(req);
    if (!token) throw new AppError('UNAUTHORIZED', 'Authentication required');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    }

    const [row] = await db.select().from(users).where(sql`${users.id} = ${payload.sub}`);
    if (!row) throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    if (!row.isActive) throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated');
    if (row.tokenVersion !== payload.tokenVersion) {
      throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
    }

    req.user = {
      id: row.id, email: row.email, fullName: row.fullName, role: row.role,
      isActive: row.isActive, mustChangePassword: row.mustChangePassword, teamId: row.teamId,
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Blocks every route except /auth/me and /auth/change-password until the password is changed. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    next(new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing'));
    return;
  }
  next();
};

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError('UNAUTHORIZED', 'Authentication required');
  return req.user;
}
```

Re-reading the user row on every request — rather than trusting the JWT claims alone — is what makes deactivation and `token_version` revocation take effect immediately instead of up to 15 minutes later.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/auth-lib.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 8: Commit**

```bash
git add src/lib/password.ts src/lib/tokens.ts src/lib/auth.ts src/lib/serialize.ts tests/auth-lib.test.ts
git commit -m "feat: add password hashing, JWT tokens and auth middleware"
```

---

### Task 5: Centralized permissions

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Consumes: `AuthUser` (Task 4); `Role` (Task 2); `AppError` (Task 1)
- Produces:
  - `type Action = 'user:create'|'user:update'|'user:activate'|'user:deactivate'|'user:list'|'team:manage'|'task:list'|'task:view'|'task:create'|'task:assign'|'task:edit'|'task:delete'|'task:changeStatus'|'task:complete'|'task:comment'|'password:change'|'notification:read'`
  - `type TaskLike = { createdBy: string; assignedTo: string | null }`
  - `can(user: AuthUser, action: Action, resource?: TaskLike | { userId: string }): boolean`
  - `requirePermission(action: Action): RequestHandler`
  - `assertCan(user: AuthUser, action: Action, resource?): void`

This is the single source of authority in the system. No route handler may inline a role check.

- [ ] **Step 1: Write the failing test — `tests/permissions.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { can } from '../src/lib/permissions.js';
import type { AuthUser } from '../src/lib/auth.js';
import { ROLES } from '../src/db/schema.js';

const mk = (role: AuthUser['role'], id = 'u-self'): AuthUser => ({
  id, email: `${id}@utopiabrands.com`, fullName: 'Test', role,
  isActive: true, mustChangePassword: false, teamId: 't1',
});

const manager = mk('manager', 'u-manager');
const director = mk('director', 'u-director');
const executive = mk('executive', 'u-exec');

const task = { createdBy: 'u-creator', assignedTo: 'u-assignee' };

describe('user management — Manager only', () => {
  for (const action of ['user:create', 'user:update', 'user:activate', 'user:deactivate', 'team:manage'] as const) {
    it(`allows a Manager to ${action}`, () => {
      expect(can(manager, action)).toBe(true);
    });

    it(`denies every non-Manager role ${action}`, () => {
      for (const role of ROLES.filter((r) => r !== 'manager')) {
        expect(can(mk(role), action)).toBe(false);
      }
    });
  }

  it('denies a Director user:create — rank does not grant user management', () => {
    expect(can(director, 'user:create')).toBe(false);
  });

  it('denies an inactive Manager everything', () => {
    const inactive = { ...manager, isActive: false };
    expect(can(inactive, 'user:create')).toBe(false);
    expect(can(inactive, 'task:view')).toBe(false);
  });
});

describe('flat task access — single team', () => {
  for (const action of ['task:list', 'task:view', 'task:create', 'task:assign', 'task:comment', 'user:list'] as const) {
    it(`allows every role to ${action}`, () => {
      for (const role of ROLES) expect(can(mk(role), action, task)).toBe(true);
    });
  }
});

describe('task mutation — creator, assignee or Manager', () => {
  for (const action of ['task:edit', 'task:delete', 'task:changeStatus', 'task:complete'] as const) {
    it(`allows the creator to ${action}`, () => {
      expect(can(mk('executive', 'u-creator'), action, task)).toBe(true);
    });

    it(`allows the assignee to ${action}`, () => {
      expect(can(mk('executive', 'u-assignee'), action, task)).toBe(true);
    });

    it(`allows a Manager who is neither to ${action}`, () => {
      expect(can(manager, action, task)).toBe(true);
    });

    it(`denies an unrelated non-Manager ${action}`, () => {
      expect(can(mk('director', 'u-bystander'), action, task)).toBe(false);
      expect(can(executive, action, task)).toBe(false);
    });

    it(`denies ${action} when no resource is supplied`, () => {
      expect(can(executive, action)).toBe(false);
    });
  }
});

describe('password change — self only', () => {
  it('allows a user to change their own password', () => {
    expect(can(executive, 'password:change', { userId: 'u-exec' })).toBe(true);
  });

  it("denies a Manager changing another user's password", () => {
    expect(can(manager, 'password:change', { userId: 'u-exec' })).toBe(false);
  });

  it('denies a Director changing another password', () => {
    expect(can(director, 'password:change', { userId: 'u-exec' })).toBe(false);
  });
});

describe('notifications — owner only', () => {
  it('allows the owner to read their notification', () => {
    expect(can(executive, 'notification:read', { userId: 'u-exec' })).toBe(true);
  });

  it('denies a Manager reading another user notification', () => {
    expect(can(manager, 'notification:read', { userId: 'u-exec' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/permissions.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/permissions.js'`.

- [ ] **Step 3: Write `src/lib/permissions.ts`**

```ts
import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
import type { AuthUser } from './auth.js';

export type Action =
  | 'user:create' | 'user:update' | 'user:activate' | 'user:deactivate' | 'user:list'
  | 'team:manage'
  | 'task:list' | 'task:view' | 'task:create' | 'task:assign' | 'task:comment'
  | 'task:edit' | 'task:delete' | 'task:changeStatus' | 'task:complete'
  | 'password:change'
  | 'notification:read';

export type TaskLike = { createdBy: string; assignedTo: string | null };
export type OwnedLike = { userId: string };
export type Resource = TaskLike | OwnedLike | undefined;

/** Only this role may manage users. Widening authority is a one-line change here. */
const USER_MANAGEMENT_ROLES = new Set<AuthUser['role']>(['manager']);

/** Open to every active user — the organisation operates as one flat team. */
const OPEN_ACTIONS = new Set<Action>([
  'user:list', 'task:list', 'task:view', 'task:create', 'task:assign', 'task:comment',
]);

/** Restricted to the task's creator, its assignee, or a Manager. */
const TASK_MUTATION_ACTIONS = new Set<Action>([
  'task:edit', 'task:delete', 'task:changeStatus', 'task:complete',
]);

const USER_MANAGEMENT_ACTIONS = new Set<Action>([
  'user:create', 'user:update', 'user:activate', 'user:deactivate', 'team:manage',
]);

const isTaskLike = (r: Resource): r is TaskLike =>
  !!r && 'createdBy' in r;
const isOwned = (r: Resource): r is OwnedLike =>
  !!r && 'userId' in r;

export function can(user: AuthUser, action: Action, resource?: Resource): boolean {
  if (!user?.isActive) return false;

  if (USER_MANAGEMENT_ACTIONS.has(action)) return USER_MANAGEMENT_ROLES.has(user.role);

  if (OPEN_ACTIONS.has(action)) return true;

  if (TASK_MUTATION_ACTIONS.has(action)) {
    if (!isTaskLike(resource)) return false;
    if (USER_MANAGEMENT_ROLES.has(user.role)) return true;
    return resource.createdBy === user.id || resource.assignedTo === user.id;
  }

  // Strictly self-scoped: no role, including Manager, may act on another user here.
  if (action === 'password:change' || action === 'notification:read') {
    return isOwned(resource) && resource.userId === user.id;
  }

  return false;
}

export function assertCan(user: AuthUser, action: Action, resource?: Resource): void {
  if (!can(user, action, resource)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to perform this action');
  }
}

/**
 * Route guard for actions that need no resource (e.g. user:create).
 * Resource-scoped actions are checked inside the service, after the row is loaded.
 */
export function requirePermission(action: Action): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Authentication required');
      assertCan(req.user, action);
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/permissions.test.ts`
Expected: PASS — 40+ assertions across the matrix.

- [ ] **Step 5: Verify no role check exists outside this file**

Run: `grep -rn "role ===\|role !==\|'manager'" src/ --include=*.ts | grep -v "src/lib/permissions.ts" | grep -v "src/db/"`
Expected: no output. Any hit is a scattered authority check that belongs in `permissions.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions.ts tests/permissions.test.ts
git commit -m "feat: add centralized flat permission model with Manager-only user management"
```

---

### Task 6: Auth routes

**Files:**
- Create: `src/services/auth.service.ts`, `src/routes/auth.routes.ts`, `src/lib/validate.ts`
- Modify: `src/app.ts` — mount `/api/auth`
- Test: `tests/auth-routes.test.ts`, `tests/helpers.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces:
  - `validate({ body?, query?, params? })` — Zod middleware, throws `AppError('VALIDATION_ERROR', msg, details)`
  - `authService.login(email, password, ip): Promise<{ user: PublicUser; access: string; refresh: string }>`
  - `authService.refresh(token: string): Promise<{ access: string; refresh: string }>`
  - `authService.changePassword(userId, current, next): Promise<void>`
  - Test helpers: `createUser(over?): Promise<UserRow>`, `loginAgent(app, email, password): Promise<SuperAgentTest>`

- [ ] **Step 1: Write `src/lib/validate.ts`**

```ts
import type { RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from './errors.js';

type Schemas = { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema };

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new AppError('VALIDATION_ERROR', 'Request validation failed',
          err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))));
        return;
      }
      next(err);
    }
  };
}
```

- [ ] **Step 2: Write `tests/helpers.ts`**

```ts
import request from 'supertest';
import type { Express } from 'express';
import { db } from '../src/db/client.js';
import { teams, users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';

type UserRow = typeof users.$inferSelect;

export const DEFAULT_PASSWORD = 'Utopia01';

export async function createTeam(name = 'Operations') {
  const [t] = await db.insert(teams).values({ name }).returning();
  return t!;
}

export async function createUser(over: Partial<UserRow> & { password?: string } = {}): Promise<UserRow> {
  const { password, ...rest } = over;
  const [u] = await db.insert(users).values({
    fullName: rest.fullName ?? 'Test User',
    email: rest.email ?? `user-${crypto.randomUUID()}@utopiabrands.com`,
    passwordHash: await hashPassword(password ?? DEFAULT_PASSWORD),
    role: rest.role ?? 'executive',
    isActive: rest.isActive ?? true,
    mustChangePassword: rest.mustChangePassword ?? false,
    jobTitle: rest.jobTitle ?? null,
    department: rest.department ?? null,
    teamId: rest.teamId ?? null,
    managerId: rest.managerId ?? null,
  }).returning();
  return u!;
}

/** A supertest agent that retains auth cookies across requests. */
export async function loginAgent(app: Express, email: string, password = DEFAULT_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
```

- [ ] **Step 3: Write the failing test — `tests/auth-routes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { createUser, loginAgent, DEFAULT_PASSWORD } from './helpers.js';

const app = createApp();

describe('POST /api/auth/login', () => {
  it('signs in with a correct email and password', async () => {
    const u = await createUser({ email: 'login@utopiabrands.com', role: 'manager' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'login@utopiabrands.com', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(u.id);
    expect(res.headers['set-cookie'].join(';')).toContain('utm_access');
  });

  it('is case-insensitive on email', async () => {
    await createUser({ email: 'case@utopiabrands.com' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'CASE@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('never returns a password hash', async () => {
    await createUser({ email: 'nohash@utopiabrands.com' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nohash@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(JSON.stringify(res.body)).not.toContain('$2');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    await createUser({ email: 'wrong@utopiabrands.com' });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'wrong@utopiabrands.com', password: 'nope12345' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same error for an unknown email — no account enumeration', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'ghost@utopiabrands.com', password: 'whatever12' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an inactive account', async () => {
    await createUser({ email: 'inactive@utopiabrands.com', isActive: false });
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'inactive@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rate limits after 10 failed attempts for one email', async () => {
    await createUser({ email: 'brute@utopiabrands.com' });
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/auth/login')
        .send({ email: 'brute@utopiabrands.com', password: 'bad-password-1' });
    }
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'brute@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('stamps last_login_at on success', async () => {
    const u = await createUser({ email: 'stamp@utopiabrands.com' });
    expect(u.lastLoginAt).toBeNull();
    await request(app).post('/api/auth/login')
      .send({ email: 'stamp@utopiabrands.com', password: DEFAULT_PASSWORD });
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.lastLoginAt).not.toBeNull();
  });
});

describe('protected routes', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts an authenticated request', async () => {
    await createUser({ email: 'me@utopiabrands.com', fullName: 'Me Myself' });
    const agent = await loginAgent(app, 'me@utopiabrands.com');
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Me Myself');
  });

  it('rejects a request after the account is deactivated mid-session', async () => {
    const u = await createUser({ email: 'kill@utopiabrands.com' });
    const agent = await loginAgent(app, 'kill@utopiabrands.com');
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password with a correct current password', async () => {
    await createUser({ email: 'chg@utopiabrands.com' });
    const agent = await loginAgent(app, 'chg@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(res.status).toBe(200);

    const fresh = await request(app).post('/api/auth/login')
      .send({ email: 'chg@utopiabrands.com', password: 'NewPass123' });
    expect(fresh.status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    await createUser({ email: 'badcur@utopiabrands.com' });
    const agent = await loginAgent(app, 'badcur@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: 'not-it-1234', newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a mismatched confirmation', async () => {
    await createUser({ email: 'mism@utopiabrands.com' });
    const agent = await loginAgent(app, 'mism@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'Different123',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a password that violates the policy', async () => {
    await createUser({ email: 'weak@utopiabrands.com' });
    const agent = await loginAgent(app, 'weak@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'short', confirmPassword: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('rejects reusing the current password', async () => {
    await createUser({ email: 'same@utopiabrands.com' });
    const agent = await loginAgent(app, 'same@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('revokes the old session by bumping token_version', async () => {
    await createUser({ email: 'revoke@utopiabrands.com' });
    const agent = await loginAgent(app, 'revoke@utopiabrands.com');
    await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it("cannot change another user's password — no userId is accepted", async () => {
    const victim = await createUser({ email: 'victim@utopiabrands.com' });
    await createUser({ email: 'attacker@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'attacker@utopiabrands.com');

    await agent.post('/api/auth/change-password').send({
      userId: victim.id, currentPassword: DEFAULT_PASSWORD,
      newPassword: 'Hacked12345', confirmPassword: 'Hacked12345',
    });

    // The victim's password is untouched regardless of the response.
    const still = await request(app).post('/api/auth/login')
      .send({ email: 'victim@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(still.status).toBe(200);
  });
});

describe('must_change_password gate', () => {
  it('blocks other routes until the password is changed', async () => {
    await createUser({ email: 'forced@utopiabrands.com', mustChangePassword: true });
    const agent = await loginAgent(app, 'forced@utopiabrands.com');

    const blocked = await agent.get('/api/tasks');
    expect(blocked.status).toBe(403);
    expect(blocked.error && blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);
  });

  it('clears the flag once the password is changed', async () => {
    await createUser({ email: 'clears@utopiabrands.com', mustChangePassword: true });
    const agent = await loginAgent(app, 'clears@utopiabrands.com');
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPass123', confirmPassword: 'NewPass123',
    });
    expect(res.status).toBe(200);

    const after = await loginAgent(app, 'clears@utopiabrands.com', 'NewPass123');
    const me = await after.get('/api/auth/me');
    expect(me.body.data.mustChangePassword).toBe(false);
  });
});

describe('logout', () => {
  it('clears the auth cookies', async () => {
    await createUser({ email: 'out@utopiabrands.com' });
    const agent = await loginAgent(app, 'out@utopiabrands.com');
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });
});
```

The `victim.id` test is the important one. The endpoint takes **no** user identifier at all — the subject is always `req.user.id` — so an attacker-supplied `userId` is inert. That is a stronger guarantee than checking a supplied id against the session.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/auth-routes.test.ts`
Expected: FAIL — 404 on `/api/auth/login`.

- [ ] **Step 5: Write `src/services/auth.service.ts`**

```ts
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginAttempts, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { publicUser, type PublicUser } from '../lib/serialize.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, type TokenPayload,
} from '../lib/tokens.js';

const MAX_FAILURES = 10;
const WINDOW_MINUTES = 15;

function tokensFor(row: { id: string; role: any; tokenVersion: number }) {
  const payload: TokenPayload = { sub: row.id, role: row.role, tokenVersion: row.tokenVersion };
  return { access: signAccessToken(payload), refresh: signRefreshToken(payload) };
}

async function recentFailures(email: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(
      sql`lower(${loginAttempts.email}) = ${email}`,
      eq(loginAttempts.succeeded, false),
      gte(loginAttempts.createdAt, since),
    ));
  return row?.n ?? 0;
}

export async function login(rawEmail: string, password: string, ip?: string): Promise<{
  user: PublicUser; access: string; refresh: string;
}> {
  const email = rawEmail.trim().toLowerCase();

  if (await recentFailures(email) >= MAX_FAILURES) {
    throw new AppError('RATE_LIMITED',
      `Too many failed sign-in attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  }

  const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);

  // Identical error for unknown email and wrong password — no account enumeration.
  const okPassword = row ? await verifyPassword(password, row.passwordHash) : false;

  if (!row || !okPassword) {
    await db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: false });
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (!row.isActive) {
    await db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: false });
    throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated. Contact your Manager.');
  }

  const now = new Date();
  await db.batch([
    db.insert(loginAttempts).values({ email, ip: ip ?? null, succeeded: true }),
    db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, row.id)),
  ] as any);

  return { user: publicUser({ ...row, lastLoginAt: now }), ...tokensFor(row) };
}

export async function refresh(token: string): Promise<{ access: string; refresh: string }> {
  let payload: TokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  const [row] = await db.select().from(users).where(eq(users.id, payload.sub));
  if (!row) throw new AppError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  if (!row.isActive) throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated');
  if (row.tokenVersion !== payload.tokenVersion) {
    throw new AppError('UNAUTHORIZED', 'Session has been revoked. Please sign in again.');
  }

  return tokensFor(row);
}

export async function changePassword(
  userId: string, currentPassword: string, newPassword: string,
): Promise<void> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new AppError('USER_NOT_FOUND', 'User not found');

  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect');
  }

  assertPasswordPolicy(newPassword);

  if (await verifyPassword(newPassword, row.passwordHash)) {
    throw new AppError('VALIDATION_ERROR', 'Your new password must differ from your current password');
  }

  await db.update(users).set({
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    tokenVersion: row.tokenVersion + 1, // revokes every existing session
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}
```

- [ ] **Step 6: Write `src/routes/auth.routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import { currentUser, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';
import { publicUser } from '../lib/serialize.js';
import { clearAuthCookies, setAuthCookies, REFRESH_COOKIE } from '../lib/tokens.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const authRoutes = Router();

const loginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Your current password is required'),
  newPassword: z.string().min(1, 'A new password is required'),
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'New password and confirmation do not match',
  path: ['confirmPassword'],
});

authRoutes.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { user, access, refresh } = await authService.login(email, password, req.ip);
    setAuthCookies(res, access, refresh);
    ok(res, { user });
  } catch (err) { next(err); }
});

authRoutes.post('/logout', (_req, res) => {
  clearAuthCookies(res);
  ok(res, { loggedOut: true });
});

authRoutes.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError('UNAUTHORIZED', 'No active session');
    const { access, refresh } = await authService.refresh(token);
    setAuthCookies(res, access, refresh);
    ok(res, { refreshed: true });
  } catch (err) {
    clearAuthCookies(res);
    next(err);
  }
});

// Reachable while mustChangePassword is true — the frontend needs it to route correctly.
authRoutes.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [row] = await db.select().from(users).where(eq(users.id, currentUser(req).id));
    if (!row) throw new AppError('USER_NOT_FOUND', 'User not found');
    ok(res, publicUser(row));
  } catch (err) { next(err); }
});

// The subject is always the session user. No userId is read from the body.
authRoutes.post('/change-password', requireAuth, validate({ body: changePasswordSchema }),
  async (req, res, next) => {
    try {
      const me = currentUser(req);
      await authService.changePassword(me.id, req.body.currentPassword, req.body.newPassword);
      clearAuthCookies(res);
      ok(res, { changed: true, reauthenticate: true });
    } catch (err) { next(err); }
  });
```

- [ ] **Step 7: Mount the routes in `src/app.ts`**

Replace the `/api/health/boom` block's following lines — insert before the 404 catch-all:

```ts
import { authRoutes } from './routes/auth.routes.js';
// …inside createApp(), after the health routes:
app.use('/api/auth', authRoutes);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/auth-routes.test.ts`
Expected: PASS on every case **except** the two that touch `/api/tasks` (the `must_change_password` gate) — those stay red until Task 9 adds the route. Mark them `it.skip` with the comment `// unskip in Task 9`, and unskip them there.

Run: `npx vitest run`
Expected: all prior suites still pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validate.ts src/services/auth.service.ts src/routes/auth.routes.ts src/app.ts tests/helpers.ts tests/auth-routes.test.ts
git commit -m "feat: add login, logout, refresh, me and change-password endpoints"
```

---

### Task 7: Users routes — Manager-gated

**Files:**
- Create: `src/services/user.service.ts`, `src/routes/user.routes.ts`
- Modify: `src/app.ts` — mount `/api/users`
- Test: `tests/user-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6
- Produces:
  - `userService.list(filters): Promise<PublicUser[]>`
  - `userService.create(actor, input): Promise<{ user: PublicUser; tempPassword: string }>`
  - `userService.getById(id): Promise<PublicUser>`
  - `userService.update(id, patch): Promise<PublicUser>`
  - `userService.setActive(id, active): Promise<PublicUser>`
  - `generateTempPassword(): string`

- [ ] **Step 1: Write the failing test — `tests/user-routes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users, ROLES } from '../src/db/schema.js';
import { createTeam, createUser, loginAgent, DEFAULT_PASSWORD } from './helpers.js';

const app = createApp();

async function managerAgent() {
  await createUser({ email: 'mgr@utopiabrands.com', role: 'manager' });
  return loginAgent(app, 'mgr@utopiabrands.com');
}

describe('POST /api/users — Manager only', () => {
  it('lets a Manager create a team member', async () => {
    const team = await createTeam();
    const agent = await managerAgent();

    const res = await agent.post('/api/users').send({
      fullName: 'New Hire', email: 'new.hire@utopiabrands.com',
      role: 'am', jobTitle: 'Account Manager', department: 'Operations', teamId: team.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('new.hire@utopiabrands.com');
    expect(res.body.data.user.role).toBe('am');
    expect(res.body.data.user.teamId).toBe(team.id);

    const [row] = await db.select().from(users)
      .where(eq(users.email, 'new.hire@utopiabrands.com'));
    expect(row!.mustChangePassword).toBe(true);
    expect(row!.isActive).toBe(true);
  });

  it('never returns the password hash', async () => {
    const agent = await managerAgent();
    const res = await agent.post('/api/users').send({
      fullName: 'No Hash', email: 'nohash2@utopiabrands.com', role: 'executive',
    });
    expect(JSON.stringify(res.body)).not.toContain('$2');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects every non-Manager role with 403', async () => {
    for (const role of ROLES.filter((r) => r !== 'manager')) {
      const email = `${role}@utopiabrands.com`;
      await createUser({ email, role });
      const agent = await loginAgent(app, email);

      const res = await agent.post('/api/users').send({
        fullName: 'Blocked', email: `blocked-${role}@utopiabrands.com`, role: 'executive',
      });

      expect(res.status, `role ${role} must not create users`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const [created] = await db.select().from(users)
        .where(eq(users.email, `blocked-${role}@utopiabrands.com`));
      expect(created, `role ${role} must not have created a row`).toBeUndefined();
    }
  });

  it('rejects an unauthenticated create with 401', async () => {
    const res = await request(app).post('/api/users').send({
      fullName: 'Anon', email: 'anon@utopiabrands.com', role: 'executive',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a duplicate email with USER_EXISTS', async () => {
    await createUser({ email: 'dupe@utopiabrands.com' });
    const agent = await managerAgent();
    const res = await agent.post('/api/users').send({
      fullName: 'Dupe', email: 'dupe@utopiabrands.com', role: 'executive',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EXISTS');
  });

  it('rejects a role outside the eight organizational roles', async () => {
    const agent = await managerAgent();
    const res = await agent.post('/api/users').send({
      fullName: 'Bad Role', email: 'badrole@utopiabrands.com', role: 'ceo',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts all eight organizational roles', async () => {
    const agent = await managerAgent();
    for (const role of ROLES) {
      const res = await agent.post('/api/users').send({
        fullName: `Role ${role}`, email: `ok-${role}@utopiabrands.com`, role,
      });
      expect(res.status, `role ${role} should be accepted`).toBe(201);
    }
  });
});

describe('GET /api/users', () => {
  it('is readable by any active authenticated user', async () => {
    await createUser({ email: 'reader@utopiabrands.com', role: 'executive' });
    const agent = await loginAgent(app, 'reader@utopiabrands.com');
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('exposes no password hash in the list', async () => {
    await createUser({ email: 'listread@utopiabrands.com' });
    const agent = await loginAgent(app, 'listread@utopiabrands.com');
    const res = await agent.get('/api/users');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });
});

describe('PATCH /api/users/:id and activation — Manager only', () => {
  it('lets a Manager update a user', async () => {
    const target = await createUser({ email: 'target@utopiabrands.com', role: 'executive' });
    const agent = await managerAgent();
    const res = await agent.patch(`/api/users/${target.id}`)
      .send({ role: 'sr_am', jobTitle: 'Senior Account Manager' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('sr_am');
  });

  it('rejects a non-Manager update with 403', async () => {
    const target = await createUser({ email: 'target2@utopiabrands.com' });
    await createUser({ email: 'nonmgr@utopiabrands.com', role: 'director' });
    const agent = await loginAgent(app, 'nonmgr@utopiabrands.com');
    const res = await agent.patch(`/api/users/${target.id}`).send({ role: 'sr_am' });
    expect(res.status).toBe(403);
  });

  it('lets a Manager deactivate and reactivate a user', async () => {
    const target = await createUser({ email: 'toggle@utopiabrands.com' });
    const agent = await managerAgent();

    const off = await agent.post(`/api/users/${target.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const blocked = await request(app).post('/api/auth/login')
      .send({ email: 'toggle@utopiabrands.com', password: DEFAULT_PASSWORD });
    expect(blocked.status).toBe(403);

    const on = await agent.post(`/api/users/${target.id}/activate`);
    expect(on.body.data.isActive).toBe(true);
  });

  it('rejects a non-Manager deactivation with 403', async () => {
    const target = await createUser({ email: 'safe@utopiabrands.com' });
    await createUser({ email: 'sneaky@utopiabrands.com', role: 'sr_manager' });
    const agent = await loginAgent(app, 'sneaky@utopiabrands.com');
    const res = await agent.post(`/api/users/${target.id}/deactivate`);
    expect(res.status).toBe(403);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row!.isActive).toBe(true);
  });

  it('prevents a Manager deactivating themselves', async () => {
    await createUser({ email: 'selfoff@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'selfoff@utopiabrands.com');
    const [me] = await db.select().from(users).where(eq(users.email, 'selfoff@utopiabrands.com'));
    const res = await agent.post(`/api/users/${me!.id}/deactivate`);
    expect(res.status).toBe(422);
  });

  it('returns USER_NOT_FOUND for an unknown id', async () => {
    const agent = await managerAgent();
    const res = await agent.get('/api/users/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});
```

The non-Manager loop asserts twice: the response is 403 **and** no row was written. A 403 that still created the user would pass a status-only assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/user-routes.test.ts`
Expected: FAIL — 404 on `/api/users`.

- [ ] **Step 3: Write `src/services/user.service.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
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

export async function update(id: string, patch: UpdateUserInput): Promise<PublicUser> {
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) throw new AppError('USER_NOT_FOUND', 'User not found');

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
    throw new AppError('VALIDATION_ERROR', 'You cannot deactivate your own account');
  }

  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) throw new AppError('USER_NOT_FOUND', 'User not found');

  const [row] = await db.update(users).set({
    isActive: active,
    // Deactivation revokes every issued token immediately.
    tokenVersion: active ? existing.tokenVersion : existing.tokenVersion + 1,
    updatedAt: new Date(),
  }).where(eq(users.id, id)).returning();

  return publicUser(row!);
}
```

- [ ] **Step 4: Write `src/routes/user.routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import * as userService from '../services/user.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { requirePermission } from '../lib/permissions.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';
import { ROLES } from '../db/schema.js';
import { sendAccountCreated } from '../lib/email/index.js';
import { logger } from '../lib/logger.js';

export const userRoutes = Router();

const roleSchema = z.enum(ROLES);
const idParam = z.object({ id: z.string().uuid('A valid user id is required') });

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  role: roleSchema,
  jobTitle: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  role: roleSchema.optional(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
});

const listQuery = z.object({
  role: roleSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
});

userRoutes.use(requireAuth, requirePasswordChanged);

userRoutes.get('/', requirePermission('user:list'), validate({ query: listQuery }),
  async (req, res, next) => {
    try {
      const active = req.query.active === undefined ? undefined : req.query.active === 'true';
      ok(res, await userService.list({ role: req.query.role as any, active }));
    } catch (err) { next(err); }
  });

userRoutes.post('/', requirePermission('user:create'), validate({ body: createSchema }),
  async (req, res, next) => {
    try {
      const { user, tempPassword } = await userService.create(req.body);
      // Email failure must not roll back a created account.
      try {
        await sendAccountCreated({ user, tempPassword, createdBy: currentUser(req).fullName });
      } catch (e) {
        logger.error('Account-created email failed', {
          userId: user.id, message: e instanceof Error ? e.message : String(e),
        });
      }
      ok(res, { user }, 201);
    } catch (err) { next(err); }
  });

userRoutes.get('/:id', requirePermission('user:list'), validate({ params: idParam }),
  async (req, res, next) => {
    try { ok(res, await userService.getById(req.params.id!)); } catch (err) { next(err); }
  });

userRoutes.patch('/:id', requirePermission('user:update'),
  validate({ params: idParam, body: updateSchema }), async (req, res, next) => {
    try { ok(res, await userService.update(req.params.id!, req.body)); } catch (err) { next(err); }
  });

userRoutes.post('/:id/activate', requirePermission('user:activate'), validate({ params: idParam }),
  async (req, res, next) => {
    try {
      ok(res, await userService.setActive(req.params.id!, true, currentUser(req).id));
    } catch (err) { next(err); }
  });

userRoutes.post('/:id/deactivate', requirePermission('user:deactivate'), validate({ params: idParam }),
  async (req, res, next) => {
    try {
      ok(res, await userService.setActive(req.params.id!, false, currentUser(req).id));
    } catch (err) { next(err); }
  });
```

`sendAccountCreated` arrives in Task 8. Build Task 8 first if you prefer a green suite at every step; otherwise stub it as `export async function sendAccountCreated() {}` and complete it in Task 8.

- [ ] **Step 5: Mount in `src/app.ts`**

```ts
import { userRoutes } from './routes/user.routes.js';
app.use('/api/users', userRoutes);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/user-routes.test.ts`
Expected: PASS — including all 7 non-Manager role rejections.

- [ ] **Step 7: Commit**

```bash
git add src/services/user.service.ts src/routes/user.routes.ts src/app.ts tests/user-routes.test.ts
git commit -m "feat: add Manager-gated user management endpoints"
```

---

### Task 8: Email service and templates

**Files:**
- Create: `src/lib/email/transport.ts`, `render.ts`, `index.ts`
- Create: `src/lib/email/templates/assignment.ts`, `reminder.ts`, `expiry.ts`, `account-created.ts`
- Test: `tests/email.test.ts`

**Interfaces:**
- Consumes: `env` (Task 1); `PublicUser` (Task 4)
- Produces:
  - `type TaskEmailContext = { ref: string; title: string; description: string | null; priority: TaskPriority; status: TaskStatus; dueAt: Date | null; assignedByName: string; assignedToName: string; taskUrl: string }`
  - `sendAssignment(to: string[], ctx: TaskEmailContext): Promise<void>`
  - `sendReminder(to: string[], ctx: TaskEmailContext & { hoursPending: number }): Promise<void>`
  - `sendExpiry(to: string[], ctx: TaskEmailContext): Promise<void>`
  - `sendAccountCreated(input: { user: PublicUser; tempPassword: string; createdBy: string }): Promise<void>`
  - `__setTransportForTests(t: MockTransport | null): void`
  - `__sentMessages: SentMessage[]` — test inspection array
  - `type SentMessage = { to: string; subject: string; html: string; text: string }`

- [ ] **Step 1: Write the failing test — `tests/email.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  sendAssignment, sendReminder, sendExpiry, sendAccountCreated,
  __sentMessages, __resetMailbox,
} from '../src/lib/email/index.js';

const ctx = {
  ref: 'UT-1042',
  title: 'Verify Amazon Container CTNR-88213',
  description: 'Cross-check the 40ft inbound container manifest against the ASN.',
  priority: 'high' as const,
  status: 'assigned' as const,
  dueAt: new Date('2026-08-14T16:30:00Z'),
  assignedByName: 'Shahzeb Ali',
  assignedToName: 'John Smith',
  taskUrl: 'http://localhost:3000/#task/UT-1042',
};

beforeEach(() => __resetMailbox());

describe('assignment email', () => {
  it('sends one message per recipient', async () => {
    await sendAssignment(['john@utopiabrands.com', 'shahzeb.ali@utopiabrands.com'], ctx);
    expect(__sentMessages).toHaveLength(2);
    expect(__sentMessages.map((m) => m.to).sort())
      .toEqual(['john@utopiabrands.com', 'shahzeb.ali@utopiabrands.com']);
  });

  it('includes every required task detail', async () => {
    await sendAssignment(['john@utopiabrands.com'], ctx);
    const body = __sentMessages[0]!.html;
    expect(body).toContain('UT-1042');
    expect(body).toContain('Verify Amazon Container CTNR-88213');
    expect(body).toContain('Cross-check the 40ft inbound container manifest');
    expect(body).toContain('High');
    expect(body).toContain('Shahzeb Ali');
    expect(body).toContain('http://localhost:3000/#task/UT-1042');
  });

  it('carries the product name and credit footnote', async () => {
    await sendAssignment(['john@utopiabrands.com'], ctx);
    const m = __sentMessages[0]!;
    expect(m.subject).toContain('Utopia Trucking Task Manager');
    expect(m.html).toContain('Created by Rizwan Hanif for Utopia Brands Trucking Team');
  });

  it('always ships a plain-text alternative', async () => {
    await sendAssignment(['john@utopiabrands.com'], ctx);
    expect(__sentMessages[0]!.text.length).toBeGreaterThan(50);
    expect(__sentMessages[0]!.text).toContain('UT-1042');
  });

  it('escapes HTML in a task title', async () => {
    await sendAssignment(['x@utopiabrands.com'], { ...ctx, title: '<img src=x onerror=alert(1)>' });
    expect(__sentMessages[0]!.html).not.toContain('<img src=x');
    expect(__sentMessages[0]!.html).toContain('&lt;img');
  });

  it('deduplicates a repeated recipient', async () => {
    await sendAssignment(['same@utopiabrands.com', 'same@utopiabrands.com'], ctx);
    expect(__sentMessages).toHaveLength(1);
  });
});

describe('reminder email', () => {
  it('states the task is still pending', async () => {
    await sendReminder(['john@utopiabrands.com'], { ...ctx, hoursPending: 26 });
    const m = __sentMessages[0]!;
    expect(m.subject.toLowerCase()).toContain('reminder');
    expect(m.html).toContain('UT-1042');
    expect(m.html.toLowerCase()).toContain('still');
  });
});

describe('expiry email', () => {
  it('states the assigned time has finished and shows the due date', async () => {
    await sendExpiry(['john@utopiabrands.com'], { ...ctx, status: 'overdue' });
    const m = __sentMessages[0]!;
    expect(m.subject.toLowerCase()).toContain('overdue');
    expect(m.html).toContain('UT-1042');
    expect(m.html.toLowerCase()).toContain('finished');
  });
});

describe('account created email', () => {
  it('sends the temporary password only to the new user', async () => {
    await sendAccountCreated({
      user: { id: 'u1', email: 'new@utopiabrands.com', fullName: 'New Hire', role: 'am' } as any,
      tempPassword: 'UtAbc12345',
      createdBy: 'Shahzeb Ali',
    });
    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]!.to).toBe('new@utopiabrands.com');
    expect(__sentMessages[0]!.html).toContain('UtAbc12345');
    expect(__sentMessages[0]!.html.toLowerCase()).toContain('change');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/email.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/email/index.js'`.

- [ ] **Step 3: Write `src/lib/email/transport.ts`**

```ts
import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../env.js';

export type SentMessage = { to: string; subject: string; html: string; text: string };

/** Every message sent while NODE_ENV=test, for assertion in the suite. */
export const __sentMessages: SentMessage[] = [];
export function __resetMailbox(): void { __sentMessages.length = 0; }

let cached: Transporter | null = null;

function realTransport(): Transporter {
  if (!cached) {
    cached = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE,
      auth: env.EMAIL_USERNAME ? { user: env.EMAIL_USERNAME, pass: env.EMAIL_PASSWORD } : undefined,
    });
  }
  return cached;
}

export async function deliver(msg: SentMessage): Promise<void> {
  if (isTest) {
    __sentMessages.push(msg);
    return;
  }
  await realTransport().sendMail({
    from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
  });
}
```

- [ ] **Step 4: Write `src/lib/email/render.ts`**

```ts
import { env } from '../env.js';

export const PRODUCT_NAME = 'Utopia Trucking Task Manager';
export const CREDIT_LINE = 'Created by Rizwan Hanif for Utopia Brands Trucking Team';

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmtDateTime(d: Date | null): string {
  if (!d) return 'No due date';
  return d.toLocaleString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  });
}

const LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
  assigned: 'Pending', progress: 'In Progress', hold: 'On Hold',
  completed: 'Completed', overdue: 'Overdue', cancelled: 'Cancelled',
};
export const label = (k: string): string => LABELS[k] ?? k;

const ACCENT: Record<string, string> = {
  low: '#64748b', medium: '#3b82f6', high: '#f59e0b', critical: '#ef4444',
};

export function detailRows(rows: [string, string][]): string {
  return rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 0;color:#64748b;font-size:13px;width:130px">${esc(k)}</td>
      <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600">${v}</td>
    </tr>`).join('');
}

/** Table-based layout with inline styles — the only thing mail clients render reliably. */
export function layout(opts: {
  heading: string; intro: string; priority?: string; body: string;
  ctaUrl: string; ctaLabel: string;
}): string {
  const accent = ACCENT[opts.priority ?? 'medium'] ?? '#3b82f6';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="height:4px;background:${accent}"></td></tr>
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700">
            ${esc(PRODUCT_NAME)}
          </div>
          <h1 style="margin:12px 0 8px;font-size:21px;line-height:1.3;color:#0f172a">${esc(opts.heading)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569">${esc(opts.intro)}</p>
        </td></tr>
        <tr><td style="padding:0 32px">${opts.body}</td></tr>
        <tr><td style="padding:24px 32px 32px">
          <a href="${esc(opts.ctaUrl)}"
             style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;
                    padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">
            ${esc(opts.ctaLabel)}
          </a>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
            ${esc(PRODUCT_NAME)} &middot; <a href="${esc(env.APP_URL)}" style="color:#64748b">${esc(env.APP_URL)}</a><br/>
            ${esc(CREDIT_LINE)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function toText(lines: (string | null)[]): string {
  return [...lines.filter(Boolean), '', PRODUCT_NAME, CREDIT_LINE].join('\n');
}
```

- [ ] **Step 5: Write the four templates**

`src/lib/email/templates/assignment.ts`:

```ts
import { CREDIT_LINE, PRODUCT_NAME, detailRows, esc, fmtDateTime, label, layout, toText } from '../render.js';
import type { TaskEmailContext } from '../index.js';

export function assignmentSubject(c: TaskEmailContext): string {
  return `[${PRODUCT_NAME}] New task assigned: ${c.ref} — ${c.title}`;
}

export function assignmentHtml(c: TaskEmailContext): string {
  return layout({
    heading: `You have been assigned ${c.ref}`,
    intro: `${c.assignedByName} assigned this task to ${c.assignedToName}.`,
    priority: c.priority,
    ctaUrl: c.taskUrl,
    ctaLabel: 'Open the task',
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${detailRows([
          ['Task', esc(c.title)],
          ['Reference', esc(c.ref)],
          ['Priority', esc(label(c.priority))],
          ['Status', esc(label(c.status))],
          ['Due', esc(fmtDateTime(c.dueAt))],
          ['Assigned by', esc(c.assignedByName)],
        ])}
      </table>
      ${c.description ? `<p style="margin:18px 0 0;padding:14px 16px;background:#f8fafc;
        border-left:3px solid #cbd5e1;border-radius:6px;font-size:14px;line-height:1.6;color:#334155">
        ${esc(c.description)}</p>` : ''}`,
  });
}

export function assignmentText(c: TaskEmailContext): string {
  return toText([
    `You have been assigned ${c.ref}`,
    `${c.assignedByName} assigned this task to ${c.assignedToName}.`,
    '',
    `Task:        ${c.title}`,
    `Reference:   ${c.ref}`,
    `Priority:    ${label(c.priority)}`,
    `Status:      ${label(c.status)}`,
    `Due:         ${fmtDateTime(c.dueAt)}`,
    `Assigned by: ${c.assignedByName}`,
    c.description ? `\n${c.description}` : null,
    '',
    `Open the task: ${c.taskUrl}`,
  ]);
}
```

`src/lib/email/templates/reminder.ts` — same shape, with:

```ts
export function reminderSubject(c: TaskEmailContext & { hoursPending: number }): string {
  return `[${PRODUCT_NAME}] Reminder: ${c.ref} is still pending`;
}
// heading: `${c.ref} is still pending`
// intro:  `This task is still open and has been pending for ${Math.round(c.hoursPending)} hours. It is due ${fmtDateTime(c.dueAt)}.`
// ctaLabel: 'Update the task'
// detailRows: Task / Reference / Priority / Status / Due / Assigned by
```

`src/lib/email/templates/expiry.ts`:

```ts
export function expirySubject(c: TaskEmailContext): string {
  return `[${PRODUCT_NAME}] Overdue: the assigned time for ${c.ref} has finished`;
}
// heading: `The assigned time for ${c.ref} has finished`
// intro:  `This task reached its due date and time and has not been completed. It is now marked Overdue.`
// ctaLabel: 'Open the overdue task'
// detailRows: Task / Reference / Priority / Status ("Overdue") / Due (the elapsed due date) / Assigned by
```

`src/lib/email/templates/account-created.ts`:

```ts
export function accountCreatedSubject(): string {
  return `[${PRODUCT_NAME}] Your account is ready`;
}
// heading: `Welcome to ${PRODUCT_NAME}`
// intro:  `${createdBy} created an account for you. Sign in with the temporary password below — you will be asked to change it immediately.`
// body:   detailRows([['Email', esc(user.email)], ['Temporary password', `<code>${esc(tempPassword)}</code>`], ['Role', esc(roleLabel(user.role))]])
// ctaUrl: env.APP_URL, ctaLabel: 'Sign in'
```

- [ ] **Step 6: Write `src/lib/email/index.ts`**

```ts
import { env } from '../env.js';
import { logger } from '../logger.js';
import { AppError } from '../errors.js';
import type { PublicUser } from '../serialize.js';
import type { TaskPriority, TaskStatus } from '../../db/schema.js';
import { deliver, __sentMessages, __resetMailbox } from './transport.js';
import { assignmentHtml, assignmentSubject, assignmentText } from './templates/assignment.js';
import { reminderHtml, reminderSubject, reminderText } from './templates/reminder.js';
import { expiryHtml, expirySubject, expiryText } from './templates/expiry.js';
import { accountCreatedHtml, accountCreatedSubject, accountCreatedText } from './templates/account-created.js';

export { __sentMessages, __resetMailbox };

export type TaskEmailContext = {
  ref: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: Date | null;
  assignedByName: string;
  assignedToName: string;
  taskUrl: string;
};

export function taskUrlFor(ref: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/#task/${encodeURIComponent(ref)}`;
}

/** Templates receive a context object, never a database row — no internal id can leak. */
async function fanOut(
  recipients: string[], subject: string, html: string, text: string, kind: string,
): Promise<void> {
  const unique = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  const failures: string[] = [];

  for (const to of unique) {
    try {
      await deliver({ to, subject, html, text });
    } catch (err) {
      failures.push(to);
      logger.error(`${kind} email failed`, {
        to, message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failures.length === unique.length && unique.length > 0) {
    throw new AppError('EMAIL_FAILED', `Could not deliver the ${kind} email`);
  }
}

export function sendAssignment(to: string[], c: TaskEmailContext): Promise<void> {
  return fanOut(to, assignmentSubject(c), assignmentHtml(c), assignmentText(c), 'assignment');
}

export function sendReminder(to: string[], c: TaskEmailContext & { hoursPending: number }): Promise<void> {
  return fanOut(to, reminderSubject(c), reminderHtml(c), reminderText(c), 'reminder');
}

export function sendExpiry(to: string[], c: TaskEmailContext): Promise<void> {
  return fanOut(to, expirySubject(c), expiryHtml(c), expiryText(c), 'expiry');
}

export function sendAccountCreated(input: {
  user: PublicUser; tempPassword: string; createdBy: string;
}): Promise<void> {
  return fanOut([input.user.email], accountCreatedSubject(),
    accountCreatedHtml(input), accountCreatedText(input), 'account-created');
}
```

`fanOut` throws only when **every** recipient failed. A task assigned to a valid address should not report failure because the assigner's mailbox bounced.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/email.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 8: Verify no inline mail sending exists elsewhere**

Run: `grep -rn "createTransport\|sendMail" src/ --include=*.ts | grep -v "src/lib/email/"`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/lib/email/ tests/email.test.ts
git commit -m "feat: add reusable SMTP email service with assignment, reminder and expiry templates"
```

---

### Task 9: Tasks CRUD

**Files:**
- Create: `src/services/task.service.ts`, `src/routes/task.routes.ts`
- Modify: `src/app.ts` — mount `/api/tasks`; `tests/auth-routes.test.ts` — unskip the two gate tests
- Test: `tests/task-crud.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8
- Produces:
  - `type PublicTask = Omit<TaskRow, never> & { isOverdue: boolean }`
  - `taskService.list(filters): Promise<PublicTask[]>`
  - `taskService.getById(id): Promise<TaskRow>` — throws `TASK_NOT_FOUND`
  - `taskService.create(actor, input): Promise<PublicTask>`
  - `taskService.update(actor, id, patch): Promise<PublicTask>`
  - `taskService.remove(actor, id): Promise<void>`
  - `publicTask(row: TaskRow): PublicTask`
  - `type TaskFilters = { status?: TaskStatus; priority?: TaskPriority; assignedTo?: string; createdBy?: string; project?: string; q?: string }`

- [ ] **Step 1: Write the failing test — `tests/task-crud.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, taskHistory } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function agentFor(email: string, role: any = 'executive') {
  await createUser({ email, role, fullName: email.split('@')[0]! });
  return loginAgent(app, email);
}

describe('POST /api/tasks', () => {
  it('creates a task and returns a UT- reference', async () => {
    const agent = await agentFor('creator@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({
      title: 'Verify container CTNR-88213',
      description: 'Cross-check the manifest against the ASN.',
      priority: 'high',
      project: 'Inbound Operations',
      tags: ['Amazon', 'Inbound'],
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.ref).toMatch(/^UT-\d+$/);
    expect(res.body.data.title).toBe('Verify container CTNR-88213');
    expect(res.body.data.status).toBe('assigned');
    expect(res.body.data.progress).toBe(0);
    expect(res.body.data.tags).toEqual(['Amazon', 'Inbound']);
  });

  it('records a created history event', async () => {
    const agent = await agentFor('hist@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: 'History check', priority: 'low' });
    const rows = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, res.body.data.id));
    expect(rows.map((r) => r.event)).toContain('created');
  });

  it('stamps created_by as the session user', async () => {
    const u = await createUser({ email: 'stampme@utopiabrands.com' });
    const agent = await loginAgent(app, 'stampme@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: 'Stamped', priority: 'medium' });
    expect(res.body.data.createdBy).toBe(u.id);
  });

  it('ignores a client-supplied createdBy', async () => {
    const other = await createUser({ email: 'other@utopiabrands.com' });
    const me = await createUser({ email: 'me2@utopiabrands.com' });
    const agent = await loginAgent(app, 'me2@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({
      title: 'Spoof', priority: 'low', createdBy: other.id,
    });
    expect(res.body.data.createdBy).toBe(me.id);
  });

  it('rejects an empty title', async () => {
    const agent = await agentFor('empty@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: '', priority: 'low' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid priority', async () => {
    const agent = await agentFor('badprio@utopiabrands.com');
    const res = await agent.post('/api/tasks').send({ title: 'X', priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated create', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Anon', priority: 'low' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tasks', () => {
  it('is readable by any active user — flat visibility', async () => {
    const owner = await createUser({ email: 'owner@utopiabrands.com' });
    await db.insert(tasks).values({ title: 'Someone else task', createdBy: owner.id, priority: 'low' });

    const agent = await agentFor('nosy@utopiabrands.com');
    const res = await agent.get('/api/tasks');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by status', async () => {
    const u = await createUser({ email: 'filt@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'A', createdBy: u.id, priority: 'low', status: 'assigned' },
      { title: 'B', createdBy: u.id, priority: 'low', status: 'completed' },
    ]);
    const agent = await agentFor('filtread@utopiabrands.com');
    const res = await agent.get('/api/tasks?status=completed');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('B');
  });

  it('searches title and description with q', async () => {
    const u = await createUser({ email: 'srch@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Container manifest', createdBy: u.id, priority: 'low' },
      { title: 'Payroll run', createdBy: u.id, priority: 'low', description: 'container of files' },
      { title: 'Unrelated', createdBy: u.id, priority: 'low' },
    ]);
    const agent = await agentFor('srchread@utopiabrands.com');
    const res = await agent.get('/api/tasks?q=container');
    expect(res.body.data).toHaveLength(2);
  });

  it('marks a past-due task isOverdue even before the cron job runs', async () => {
    const u = await createUser({ email: 'due@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Past due', createdBy: u.id, priority: 'high',
      status: 'assigned', dueAt: new Date(Date.now() - 3_600_000),
    });
    const agent = await agentFor('dueread@utopiabrands.com');
    const res = await agent.get('/api/tasks');
    expect(res.body.data[0].isOverdue).toBe(true);
    expect(res.body.data[0].status).toBe('assigned');
  });

  it('does not mark a completed past-due task as overdue', async () => {
    const u = await createUser({ email: 'donedue@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Done late', createdBy: u.id, priority: 'low',
      status: 'completed', dueAt: new Date(Date.now() - 3_600_000),
    });
    const agent = await agentFor('donedueread@utopiabrands.com');
    const res = await agent.get('/api/tasks');
    expect(res.body.data[0].isOverdue).toBe(false);
  });
});

describe('PATCH /api/tasks/:id — creator, assignee or Manager', () => {
  it('lets the creator edit', async () => {
    const agent = await agentFor('edcreator@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'Mine', priority: 'low' });
    const res = await agent.patch(`/api/tasks/${made.body.data.id}`).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed');
  });

  it('lets the assignee edit', async () => {
    const creator = await createUser({ email: 'c1@utopiabrands.com' });
    const assignee = await createUser({ email: 'a1@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Assigned to me', createdBy: creator.id, assignedTo: assignee.id, priority: 'low',
    }).returning();

    const agent = await loginAgent(app, 'a1@utopiabrands.com');
    const res = await agent.patch(`/api/tasks/${t!.id}`).send({ notes: 'Working on it' });
    expect(res.status).toBe(200);
  });

  it('lets a Manager edit any task', async () => {
    const creator = await createUser({ email: 'c2@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Not mine', createdBy: creator.id, priority: 'low',
    }).returning();

    const agent = await agentFor('mgredit@utopiabrands.com', 'manager');
    const res = await agent.patch(`/api/tasks/${t!.id}`).send({ title: 'Manager edit' });
    expect(res.status).toBe(200);
  });

  it('denies an unrelated non-Manager with 403 and changes nothing', async () => {
    const creator = await createUser({ email: 'c3@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Protected', createdBy: creator.id, priority: 'low',
    }).returning();

    const agent = await agentFor('bystander@utopiabrands.com', 'director');
    const res = await agent.patch(`/api/tasks/${t!.id}`).send({ title: 'Hijacked' });
    expect(res.status).toBe(403);

    const [after] = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(after!.title).toBe('Protected');
  });

  it('records a priority_changed history event', async () => {
    const agent = await agentFor('prio@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'P', priority: 'low' });
    await agent.patch(`/api/tasks/${made.body.data.id}`).send({ priority: 'critical' });

    const rows = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, made.body.data.id));
    const ev = rows.find((r) => r.event === 'priority_changed');
    expect(ev).toBeDefined();
    expect(ev!.fromValue).toBe('low');
    expect(ev!.toValue).toBe('critical');
  });

  it('records a due_changed history event', async () => {
    const agent = await agentFor('duechg@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'D', priority: 'low' });
    await agent.patch(`/api/tasks/${made.body.data.id}`)
      .send({ dueAt: new Date(Date.now() + 172_800_000).toISOString() });

    const rows = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, made.body.data.id));
    expect(rows.map((r) => r.event)).toContain('due_changed');
  });

  it('returns TASK_NOT_FOUND for an unknown id', async () => {
    const agent = await agentFor('nf@utopiabrands.com');
    const res = await agent.get('/api/tasks/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TASK_NOT_FOUND');
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('lets the creator delete and cascades history', async () => {
    const agent = await agentFor('del@utopiabrands.com');
    const made = await agent.post('/api/tasks').send({ title: 'Delete me', priority: 'low' });
    const res = await agent.delete(`/api/tasks/${made.body.data.id}`);
    expect(res.status).toBe(200);

    const rows = await db.select().from(tasks).where(eq(tasks.id, made.body.data.id));
    expect(rows).toHaveLength(0);
    const hist = await db.select().from(taskHistory)
      .where(eq(taskHistory.taskId, made.body.data.id));
    expect(hist).toHaveLength(0);
  });

  it('denies an unrelated non-Manager delete', async () => {
    const creator = await createUser({ email: 'c4@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Keep me', createdBy: creator.id, priority: 'low',
    }).returning();

    const agent = await agentFor('deleter@utopiabrands.com', 'sr_manager');
    const res = await agent.delete(`/api/tasks/${t!.id}`);
    expect(res.status).toBe(403);

    const rows = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/task-crud.test.ts`
Expected: FAIL — 404 on `/api/tasks`.

- [ ] **Step 3: Write `src/services/task.service.ts`**

```ts
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskHistory, tasks, type TaskPriority, type TaskStatus } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertCan } from '../lib/permissions.js';
import { isOverdue } from '../lib/serialize.js';
import type { AuthUser } from '../lib/auth.js';

export type TaskRow = typeof tasks.$inferSelect;
export type PublicTask = TaskRow & { isOverdue: boolean };

export type TaskFilters = {
  status?: TaskStatus; priority?: TaskPriority;
  assignedTo?: string; createdBy?: string; project?: string; q?: string;
};

export type CreateTaskInput = {
  title: string; description?: string | null; priority?: TaskPriority;
  assignedTo?: string | null; project?: string | null; tags?: string[];
  startAt?: Date | null; dueAt?: Date | null; notes?: string | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput> & { progress?: number };

export function publicTask(row: TaskRow): PublicTask {
  return { ...row, isOverdue: isOverdue(row) };
}

export async function getById(id: string): Promise<TaskRow> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!row) throw new AppError('TASK_NOT_FOUND', 'Task not found');
  return row;
}

export async function list(f: TaskFilters = {}): Promise<PublicTask[]> {
  const where: SQL[] = [];
  if (f.status) where.push(eq(tasks.status, f.status));
  if (f.priority) where.push(eq(tasks.priority, f.priority));
  if (f.assignedTo) where.push(eq(tasks.assignedTo, f.assignedTo));
  if (f.createdBy) where.push(eq(tasks.createdBy, f.createdBy));
  if (f.project) where.push(eq(tasks.project, f.project));
  if (f.q) {
    const needle = `%${f.q}%`;
    where.push(or(
      ilike(tasks.title, needle), ilike(tasks.description, needle), ilike(tasks.ref, needle),
    )!);
  }

  const rows = await db.select().from(tasks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(tasks.createdAt));

  return rows.map(publicTask);
}

export async function create(actor: AuthUser, input: CreateTaskInput): Promise<PublicTask> {
  assertCan(actor, 'task:create');

  const now = new Date();
  const [row] = await db.insert(tasks).values({
    title: input.title.trim(),
    description: input.description ?? null,
    createdBy: actor.id,                 // always the session user; never client-supplied
    assignedTo: input.assignedTo ?? null,
    priority: input.priority ?? 'medium',
    status: 'assigned',
    progress: 0,
    project: input.project ?? null,
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    startAt: input.startAt ?? null,
    dueAt: input.dueAt ?? null,
    assignedAt: input.assignedTo ? now : null,
  }).returning();

  await db.insert(taskHistory).values({
    taskId: row!.id, actorId: actor.id, event: 'created', toValue: row!.title,
  });

  return publicTask(row!);
}

export async function update(actor: AuthUser, id: string, patch: UpdateTaskInput): Promise<PublicTask> {
  const existing = await getById(id);
  assertCan(actor, 'task:edit', existing);

  const events: (typeof taskHistory.$inferInsert)[] = [];
  const push = (event: any, fromValue: string | null, toValue: string | null) =>
    events.push({ taskId: id, actorId: actor.id, event, fromValue, toValue });

  if (patch.priority !== undefined && patch.priority !== existing.priority) {
    push('priority_changed', existing.priority, patch.priority);
  }
  if (patch.dueAt !== undefined &&
      (patch.dueAt?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null)) {
    push('due_changed', existing.dueAt?.toISOString() ?? null, patch.dueAt?.toISOString() ?? null);
  }
  if (patch.progress !== undefined && patch.progress !== existing.progress) {
    push('progress_changed', String(existing.progress), String(patch.progress));
  }

  const [row] = await db.update(tasks).set({
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.project !== undefined ? { project: patch.project } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  if (events.length) await db.insert(taskHistory).values(events);

  return publicTask(row!);
}

export async function remove(actor: AuthUser, id: string): Promise<void> {
  const existing = await getById(id);
  assertCan(actor, 'task:delete', existing);
  await db.delete(tasks).where(eq(tasks.id, id)); // history and comments cascade
}
```

- [ ] **Step 4: Write `src/routes/task.routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import * as taskService from '../services/task.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { requirePermission } from '../lib/permissions.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';
import { TASK_PRIORITIES, TASK_STATUSES } from '../db/schema.js';

export const taskRoutes = Router();

const idParam = z.object({ id: z.string().uuid('A valid task id is required') });
const isoDate = z.string().datetime().transform((s) => new Date(s));

const createSchema = z.object({
  title: z.string().trim().min(1, 'A task title is required').max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  project: z.string().trim().max(120).optional().nullable(),
  tags: z.array(z.string().trim().max(40)).max(12).optional(),
  startAt: isoDate.optional().nullable(),
  dueAt: isoDate.optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
}).strip(); // drops createdBy, status, ref and anything else a client tries to set

const updateSchema = createSchema.partial().extend({
  progress: z.number().int().min(0).max(100).optional(),
});

const listQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignedTo: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  project: z.string().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

taskRoutes.use(requireAuth, requirePasswordChanged);

taskRoutes.get('/', requirePermission('task:list'), validate({ query: listQuery }),
  async (req, res, next) => {
    try { ok(res, await taskService.list(req.query as any)); } catch (err) { next(err); }
  });

taskRoutes.post('/', requirePermission('task:create'), validate({ body: createSchema }),
  async (req, res, next) => {
    try { ok(res, await taskService.create(currentUser(req), req.body), 201); }
    catch (err) { next(err); }
  });

taskRoutes.get('/:id', requirePermission('task:view'), validate({ params: idParam }),
  async (req, res, next) => {
    try {
      ok(res, taskService.publicTask(await taskService.getById(req.params.id!)));
    } catch (err) { next(err); }
  });

// task:edit is resource-scoped, so the check happens in the service after the row loads.
taskRoutes.patch('/:id', validate({ params: idParam, body: updateSchema }),
  async (req, res, next) => {
    try { ok(res, await taskService.update(currentUser(req), req.params.id!, req.body)); }
    catch (err) { next(err); }
  });

taskRoutes.delete('/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    await taskService.remove(currentUser(req), req.params.id!);
    ok(res, { deleted: true });
  } catch (err) { next(err); }
});
```

`.strip()` on the create schema is what makes the "ignores a client-supplied createdBy" test pass — unknown keys never reach the service.

- [ ] **Step 5: Mount and unskip**

In `src/app.ts`:

```ts
import { taskRoutes } from './routes/task.routes.js';
app.use('/api/tasks', taskRoutes);
```

In `tests/auth-routes.test.ts`, change the two `it.skip` cases in the `must_change_password gate` block back to `it`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/task-crud.test.ts tests/auth-routes.test.ts`
Expected: PASS — including the previously skipped gate tests.

- [ ] **Step 7: Commit**

```bash
git add src/services/task.service.ts src/routes/task.routes.ts src/app.ts tests/task-crud.test.ts tests/auth-routes.test.ts
git commit -m "feat: add task CRUD with history events and resource-scoped authorization"
```

---

### Task 10: Assignment, status transitions and the assignment email

**Files:**
- Modify: `src/services/task.service.ts` — add `assign`, `changeStatus`, `complete`, `reopen`, `cancel`
- Create: `src/services/notification.service.ts`
- Modify: `src/routes/task.routes.ts` — add the five action endpoints
- Test: `tests/task-assign.test.ts`, `tests/task-status.test.ts`

**Interfaces:**
- Consumes: Tasks 1–9
- Produces:
  - `taskService.assign(actor, taskId, assigneeId): Promise<PublicTask>`
  - `taskService.changeStatus(actor, taskId, status): Promise<PublicTask>`
  - `taskService.complete(actor, taskId): Promise<PublicTask>`
  - `taskService.reopen(actor, taskId): Promise<PublicTask>`
  - `taskService.cancel(actor, taskId): Promise<PublicTask>`
  - `notificationService.recipientsFor(task): Promise<{ id: string; email: string; fullName: string }[]>`
  - `notificationService.createPending(rows): Promise<Notification[]>` — swallows unique-violations on `dedupeKey`
  - `notificationService.markSent(id)`, `notificationService.markFailed(id, error)`
  - `notificationService.emailContextFor(task): Promise<TaskEmailContext>`
  - `NOTIFY_ASSIGNER = true`
  - `ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]>`

- [ ] **Step 1: Write the failing test — `tests/task-assign.test.ts`**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, taskHistory, notifications } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

const app = createApp();
beforeEach(() => __resetMailbox());

async function setup() {
  const assigner = await createUser({ email: 'assigner@utopiabrands.com', fullName: 'Shahzeb Ali' });
  const assignee = await createUser({ email: 'assignee@utopiabrands.com', fullName: 'John Smith' });
  const agent = await loginAgent(app, 'assigner@utopiabrands.com');
  const made = await agent.post('/api/tasks').send({
    title: 'Verify container CTNR-88213',
    description: 'Cross-check the manifest.',
    priority: 'high',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return { assigner, assignee, agent, taskId: made.body.data.id as string, ref: made.body.data.ref as string };
}

describe('POST /api/tasks/:id/assign', () => {
  it('saves the assignment on the task', async () => {
    const { assignee, agent, taskId } = await setup();
    const res = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedTo).toBe(assignee.id);
    expect(res.body.data.assignedAt).not.toBeNull();
  });

  it('records an assigned history event naming the actor', async () => {
    const { assigner, assignee, agent, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId));
    const ev = rows.find((r) => r.event === 'assigned');
    expect(ev).toBeDefined();
    expect(ev!.actorId).toBe(assigner.id);
    expect(ev!.toValue).toBe(assignee.id);
  });

  it('records reassigned, not assigned, on the second assignment', async () => {
    const { assignee, agent, taskId } = await setup();
    const third = await createUser({ email: 'third@utopiabrands.com' });

    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: third.id });

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, taskId));
    const re = rows.find((r) => r.event === 'reassigned');
    expect(re).toBeDefined();
    expect(re!.fromValue).toBe(assignee.id);
    expect(re!.toValue).toBe(third.id);
  });

  it('creates notification records for assignee and assigner', async () => {
    const { assigner, assignee, agent, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, taskId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([assigner.id, assignee.id].sort());
    expect(rows.every((r) => r.type === 'assigned')).toBe(true);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
  });

  it('sends the assignment email to both the assignee and the assigner', async () => {
    const { agent, assignee, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    expect(__sentMessages).toHaveLength(2);
    expect(__sentMessages.map((m) => m.to).sort())
      .toEqual(['assignee@utopiabrands.com', 'assigner@utopiabrands.com']);
  });

  it('includes the task detail and a link in the email', async () => {
    const { agent, assignee, taskId, ref } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });

    const body = __sentMessages[0]!.html;
    expect(body).toContain(ref);
    expect(body).toContain('Verify container CTNR-88213');
    expect(body).toContain('High');
    expect(body).toContain('Shahzeb Ali');
    expect(body).toContain(`#task/${ref}`);
  });

  it('sends one email when the assigner assigns to themselves', async () => {
    const { assigner, agent, taskId } = await setup();
    await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assigner.id });
    expect(__sentMessages).toHaveLength(1);
  });

  it('lets any active user assign — flat permissions', async () => {
    const { assignee, taskId } = await setup();
    await createUser({ email: 'junior@utopiabrands.com', role: 'executive' });
    const junior = await loginAgent(app, 'junior@utopiabrands.com');

    const res = await junior.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    expect(res.status).toBe(200);
  });

  it('rejects assigning to an unknown user', async () => {
    const { agent, taskId } = await setup();
    const res = await agent.post(`/api/tasks/${taskId}/assign`)
      .send({ assigneeId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_ASSIGNMENT');
  });

  it('rejects assigning to an inactive user', async () => {
    const { agent, taskId } = await setup();
    const gone = await createUser({ email: 'gone@utopiabrands.com', isActive: false });
    const res = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: gone.id });
    expect(res.status).toBe(422);
  });

  it('rejects assigning a completed task', async () => {
    const { assignee, agent, taskId } = await setup();
    await db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, taskId));
    const res = await agent.post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    expect(res.status).toBe(422);
  });

  it('rejects an unauthenticated assign', async () => {
    const { assignee, taskId } = await setup();
    const request = (await import('supertest')).default;
    const res = await request(app).post(`/api/tasks/${taskId}/assign`).send({ assigneeId: assignee.id });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Write the failing test — `tests/task-status.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, taskHistory } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function ownTask(email = 'st@utopiabrands.com') {
  await createUser({ email });
  const agent = await loginAgent(app, email);
  const made = await agent.post('/api/tasks').send({ title: 'Lifecycle', priority: 'medium' });
  return { agent, id: made.body.data.id as string };
}

describe('status transitions', () => {
  it('moves assigned to progress', async () => {
    const { agent, id } = await ownTask();
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('progress');
  });

  it('records a status_changed history event', async () => {
    const { agent, id } = await ownTask('st2@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    const ev = rows.find((r) => r.event === 'status_changed');
    expect(ev!.fromValue).toBe('assigned');
    expect(ev!.toValue).toBe('progress');
  });

  it('rejects an illegal transition from completed to progress', async () => {
    const { agent, id } = await ownTask('st3@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/complete`);
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'progress' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('rejects any transition out of cancelled — it is terminal', async () => {
    const { agent, id } = await ownTask('st4@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/cancel`);
    for (const status of ['progress', 'assigned', 'completed', 'hold']) {
      const res = await agent.post(`/api/tasks/${id}/status`).send({ status });
      expect(res.status, `cancelled -> ${status} must be rejected`).toBe(422);
    }
  });

  it('rejects a status value outside the six known statuses', async () => {
    const { agent, id } = await ownTask('st5@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/status`).send({ status: 'pending' });
    expect(res.status).toBe(400);
  });
});

describe('complete', () => {
  it('sets status, progress 100 and completed_at', async () => {
    const { agent, id } = await ownTask('cp1@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/complete`);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.progress).toBe(100);
    expect(res.body.data.completedAt).not.toBeNull();
  });

  it('completes an overdue task', async () => {
    const { agent, id } = await ownTask('cp2@utopiabrands.com');
    await db.update(tasks).set({
      status: 'overdue', dueAt: new Date(Date.now() - 3_600_000),
    }).where(eq(tasks.id, id));
    const res = await agent.post(`/api/tasks/${id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  it('sets progress to 100 when patched, flipping status to completed', async () => {
    const { agent, id } = await ownTask('cp3@utopiabrands.com');
    const res = await agent.patch(`/api/tasks/${id}`).send({ progress: 100 });
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.completedAt).not.toBeNull();
  });

  it('denies an unrelated non-Manager completing a task', async () => {
    const creator = await createUser({ email: 'cpown@utopiabrands.com' });
    const [t] = await db.insert(tasks).values({
      title: 'Not yours', createdBy: creator.id, priority: 'low',
    }).returning();

    await createUser({ email: 'cpother@utopiabrands.com', role: 'director' });
    const agent = await loginAgent(app, 'cpother@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${t!.id}/complete`);
    expect(res.status).toBe(403);
  });
});

describe('reopen and cancel', () => {
  it('reopens a completed task back to progress and clears completed_at', async () => {
    const { agent, id } = await ownTask('ro1@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/complete`);
    const res = await agent.post(`/api/tasks/${id}/reopen`);

    expect(res.body.data.status).toBe('progress');
    expect(res.body.data.completedAt).toBeNull();

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    expect(rows.map((r) => r.event)).toContain('reopened');
  });

  it('cancels a task and records the event', async () => {
    const { agent, id } = await ownTask('cx1@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/cancel`);
    expect(res.body.data.status).toBe('cancelled');

    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, id));
    expect(rows.map((r) => r.event)).toContain('cancelled');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/task-assign.test.ts tests/task-status.test.ts`
Expected: FAIL — 404 on `/api/tasks/:id/assign`.

- [ ] **Step 4: Write `src/services/notification.service.ts`**

```ts
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications, tasks, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { taskUrlFor, type TaskEmailContext } from '../lib/email/index.js';
import type { TaskRow } from './task.service.js';

/** Notify the person who assigned the task as well as the assignee. */
export const NOTIFY_ASSIGNER = true;

export type Recipient = { id: string; email: string; fullName: string };
type NewNotification = typeof notifications.$inferInsert;

export async function recipientsFor(task: TaskRow): Promise<Recipient[]> {
  const ids = [task.assignedTo, NOTIFY_ASSIGNER ? task.createdBy : null]
    .filter((v): v is string => !!v);
  if (!ids.length) return [];

  const rows = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, isActive: users.isActive })
    .from(users).where(inArray(users.id, [...new Set(ids)]));

  return rows.filter((r) => r.isActive).map(({ isActive: _a, ...r }) => r);
}

/**
 * Inserts pending notifications, skipping any whose dedupe_key already exists.
 * The unique constraint — not application timing — is what makes this idempotent
 * under concurrent job runs, retries and overlapping schedules.
 */
export async function createPending(rows: NewNotification[]): Promise<(typeof notifications.$inferSelect)[]> {
  if (!rows.length) return [];
  return db.insert(notifications).values(rows)
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
}

export async function markSent(id: string): Promise<void> {
  await db.update(notifications)
    .set({ status: 'sent', sentAt: new Date(), lastError: null })
    .where(eq(notifications.id, id));
}

export async function markFailed(id: string, error: unknown, attempts: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.update(notifications)
    .set({ status: 'failed', attempts: attempts + 1, lastError: message.slice(0, 500) })
    .where(eq(notifications.id, id));
  logger.warn('Notification delivery failed', { id, message });
}

export async function emailContextFor(task: TaskRow): Promise<TaskEmailContext> {
  const ids = [task.createdBy, task.assignedTo].filter((v): v is string => !!v);
  const people = await db.select({ id: users.id, fullName: users.fullName })
    .from(users).where(inArray(users.id, [...new Set(ids)]));
  const nameOf = (id: string | null) =>
    people.find((p) => p.id === id)?.fullName ?? 'Someone';

  return {
    ref: task.ref,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt,
    assignedByName: nameOf(task.createdBy),
    assignedToName: nameOf(task.assignedTo),
    taskUrl: taskUrlFor(task.ref),
  };
}

/** Delivers each pending notification and records the outcome. Never throws. */
export async function deliverAll(
  rows: (typeof notifications.$inferSelect)[],
  send: (emails: string[]) => Promise<void>,
  emailOf: Map<string, string>,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0, failed = 0;
  for (const row of rows) {
    const email = emailOf.get(row.userId);
    if (!email) { failed++; continue; }
    try {
      await send([email]);
      await markSent(row.id);
      succeeded++;
    } catch (err) {
      await markFailed(row.id, err, row.attempts);
      failed++;
    }
  }
  return { succeeded, failed };
}
```

- [ ] **Step 5: Add the transition table and actions to `src/services/task.service.ts`**

Append to the file:

```ts
import { inArray } from 'drizzle-orm';
import { users, notifications } from '../db/schema.js';
import * as notificationService from './notification.service.js';
import { sendAssignment } from '../lib/email/index.js';

/**
 * assigned ──► progress ──► completed ──reopen──► progress
 *    │  ▲         │  ▲          │
 *    │  └── hold ─┘  │
 *    └──────► overdue ──► completed
 * cancelled is terminal from anywhere.
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  assigned:  ['progress', 'hold', 'completed', 'overdue', 'cancelled'],
  progress:  ['assigned', 'hold', 'completed', 'overdue', 'cancelled'],
  hold:      ['assigned', 'progress', 'completed', 'overdue', 'cancelled'],
  overdue:   ['progress', 'hold', 'completed', 'cancelled'],
  completed: ['progress'],            // reopen only
  cancelled: [],                      // terminal
};

function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new AppError('INVALID_STATUS_TRANSITION',
      `A task cannot move from ${from} to ${to}`);
  }
}

export async function assign(actor: AuthUser, taskId: string, assigneeId: string): Promise<PublicTask> {
  assertCan(actor, 'task:assign');

  const existing = await getById(taskId);
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw new AppError('INVALID_ASSIGNMENT',
      `A ${existing.status} task cannot be assigned`);
  }

  const [assignee] = await db.select().from(users).where(eq(users.id, assigneeId));
  if (!assignee) throw new AppError('INVALID_ASSIGNMENT', 'The selected user does not exist');
  if (!assignee.isActive) {
    throw new AppError('INVALID_ASSIGNMENT', 'The selected user is deactivated');
  }
  if (existing.assignedTo === assigneeId) {
    return publicTask(existing);
  }

  const now = new Date();
  const reassigning = existing.assignedTo !== null;

  // read → validate → batch-write: neon-http has no interactive transaction
  await db.batch([
    db.update(tasks).set({ assignedTo: assigneeId, assignedAt: now, updatedAt: now })
      .where(eq(tasks.id, taskId)),
    db.insert(taskHistory).values({
      taskId, actorId: actor.id,
      event: reassigning ? 'reassigned' : 'assigned',
      fromValue: existing.assignedTo, toValue: assigneeId,
    }),
  ] as any);

  const updated = await getById(taskId);
  await notifyAssignment(updated);
  return publicTask(updated);
}

async function notifyAssignment(task: TaskRow): Promise<void> {
  const recipients = await notificationService.recipientsFor(task);
  if (!recipients.length) return;

  const ctx = await notificationService.emailContextFor(task);

  const rows = await notificationService.createPending(recipients.map((r) => ({
    userId: r.id,
    taskId: task.id,
    type: 'assigned' as const,
    channel: 'email' as const,
    title: 'New task assigned',
    body: `${ctx.assignedByName} assigned "${task.title}" to ${ctx.assignedToName}`,
    dedupeKey: `assign:${task.id}:${r.id}:${task.assignedAt?.getTime() ?? Date.now()}`,
  })));

  const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
  await notificationService.deliverAll(rows, (to) => sendAssignment(to, ctx), emailOf);
}

export async function changeStatus(actor: AuthUser, taskId: string, status: TaskStatus): Promise<PublicTask> {
  const existing = await getById(taskId);
  assertCan(actor, 'task:changeStatus', existing);
  assertTransition(existing.status, status);

  const now = new Date();
  const [row] = await db.update(tasks).set({
    status,
    ...(status === 'completed' ? { completedAt: now, progress: 100 } : {}),
    ...(existing.status === 'completed' && status !== 'completed' ? { completedAt: null } : {}),
    updatedAt: now,
  }).where(eq(tasks.id, taskId)).returning();

  await db.insert(taskHistory).values({
    taskId, actorId: actor.id,
    event: status === 'completed' ? 'completed'
         : status === 'cancelled' ? 'cancelled'
         : existing.status === 'completed' ? 'reopened'
         : 'status_changed',
    fromValue: existing.status, toValue: status,
  });

  return publicTask(row!);
}

export const complete = (actor: AuthUser, id: string) => changeStatus(actor, id, 'completed');
export const cancel   = (actor: AuthUser, id: string) => changeStatus(actor, id, 'cancelled');
export const reopen   = (actor: AuthUser, id: string) => changeStatus(actor, id, 'progress');
```

Also modify `update()` so `progress: 100` implies completion. Inside `update`, before the `db.update` call:

```ts
  const reaching100 = patch.progress === 100 && existing.status !== 'completed';
  const now = new Date();
  if (reaching100) push('completed', existing.status, 'completed');
```

and add to the `.set({ … })` object:

```ts
    ...(reaching100 ? { status: 'completed' as const, completedAt: now } : {}),
```

- [ ] **Step 6: Add the action endpoints to `src/routes/task.routes.ts`**

```ts
const assignSchema = z.object({ assigneeId: z.string().uuid('Select a team member to assign') });
const statusSchema = z.object({ status: z.enum(TASK_STATUSES) });

taskRoutes.post('/:id/assign', requirePermission('task:assign'),
  validate({ params: idParam, body: assignSchema }), async (req, res, next) => {
    try {
      ok(res, await taskService.assign(currentUser(req), req.params.id!, req.body.assigneeId));
    } catch (err) { next(err); }
  });

taskRoutes.post('/:id/status', validate({ params: idParam, body: statusSchema }),
  async (req, res, next) => {
    try {
      ok(res, await taskService.changeStatus(currentUser(req), req.params.id!, req.body.status));
    } catch (err) { next(err); }
  });

taskRoutes.post('/:id/complete', validate({ params: idParam }), async (req, res, next) => {
  try { ok(res, await taskService.complete(currentUser(req), req.params.id!)); }
  catch (err) { next(err); }
});

taskRoutes.post('/:id/reopen', validate({ params: idParam }), async (req, res, next) => {
  try { ok(res, await taskService.reopen(currentUser(req), req.params.id!)); }
  catch (err) { next(err); }
});

taskRoutes.post('/:id/cancel', validate({ params: idParam }), async (req, res, next) => {
  try { ok(res, await taskService.cancel(currentUser(req), req.params.id!)); }
  catch (err) { next(err); }
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/task-assign.test.ts tests/task-status.test.ts`
Expected: PASS — 12 assignment tests, 11 status tests.

Run: `npx vitest run`
Expected: every suite green.

- [ ] **Step 8: Commit**

```bash
git add src/services/task.service.ts src/services/notification.service.ts src/routes/task.routes.ts tests/task-assign.test.ts tests/task-status.test.ts
git commit -m "feat: add task assignment, status transitions and assignment email"
```

---

### Task 11: Comments and history routes

**Files:**
- Create: `src/services/comment.service.ts`
- Modify: `src/routes/task.routes.ts` — add history and comment endpoints
- Test: `tests/task-comments.test.ts`

**Interfaces:**
- Consumes: Tasks 1–10
- Produces:
  - `commentService.list(taskId): Promise<CommentWithAuthor[]>`
  - `commentService.create(actor, taskId, body): Promise<CommentWithAuthor>`
  - `taskService.history(taskId): Promise<HistoryWithActor[]>`
  - `type CommentWithAuthor = { id: string; taskId: string; body: string; createdAt: Date; author: { id: string; fullName: string; initials: string } }`
  - `type HistoryWithActor = { id: string; event: string; fromValue: string|null; toValue: string|null; createdAt: Date; actor: { id: string; fullName: string } | null }`

- [ ] **Step 1: Write the failing test — `tests/task-comments.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function taskWithAgent(email: string) {
  await createUser({ email, fullName: 'Comment Author' });
  const agent = await loginAgent(app, email);
  const made = await agent.post('/api/tasks').send({ title: 'Commentable', priority: 'low' });
  return { agent, id: made.body.data.id as string };
}

describe('GET/POST /api/tasks/:id/comments', () => {
  it('adds a comment and returns it with its author', async () => {
    const { agent, id } = await taskWithAgent('cmt1@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/comments`)
      .send({ body: 'Counted 18 of 24 pallets so far.' });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe('Counted 18 of 24 pallets so far.');
    expect(res.body.data.author.fullName).toBe('Comment Author');
    expect(res.body.data.author.initials).toBe('CA');
  });

  it('lists comments oldest first', async () => {
    const { agent, id } = await taskWithAgent('cmt2@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/comments`).send({ body: 'First' });
    await agent.post(`/api/tasks/${id}/comments`).send({ body: 'Second' });

    const res = await agent.get(`/api/tasks/${id}/comments`);
    expect(res.body.data.map((c: any) => c.body)).toEqual(['First', 'Second']);
  });

  it('records a commented history event', async () => {
    const { agent, id } = await taskWithAgent('cmt3@utopiabrands.com');
    await agent.post(`/api/tasks/${id}/comments`).send({ body: 'Noted' });

    const res = await agent.get(`/api/tasks/${id}/history`);
    expect(res.body.data.map((h: any) => h.event)).toContain('commented');
  });

  it('lets any active user comment — flat permissions', async () => {
    const { id } = await taskWithAgent('cmt4@utopiabrands.com');
    await createUser({ email: 'anyone@utopiabrands.com', role: 'executive' });
    const other = await loginAgent(app, 'anyone@utopiabrands.com');

    const res = await other.post(`/api/tasks/${id}/comments`).send({ body: 'Passing through' });
    expect(res.status).toBe(201);
  });

  it('rejects an empty comment', async () => {
    const { agent, id } = await taskWithAgent('cmt5@utopiabrands.com');
    const res = await agent.post(`/api/tasks/${id}/comments`).send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a comment on an unknown task', async () => {
    const { agent } = await taskWithAgent('cmt6@utopiabrands.com');
    const res = await agent.post('/api/tasks/11111111-1111-1111-1111-111111111111/comments')
      .send({ body: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/tasks/:id/history', () => {
  it('returns events newest first with actor names', async () => {
    const { agent, id } = await taskWithAgent('hist2@utopiabrands.com');
    await agent.patch(`/api/tasks/${id}`).send({ priority: 'critical' });

    const res = await agent.get(`/api/tasks/${id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].event).toBe('priority_changed');
    expect(res.body.data[0].actor.fullName).toBe('Comment Author');
    expect(res.body.data.at(-1).event).toBe('created');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/task-comments.test.ts`
Expected: FAIL — 404 on the comments endpoint.

- [ ] **Step 3: Write `src/services/comment.service.ts`**

```ts
import { asc, desc, eq } from 'drizzle-orm';
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
```

- [ ] **Step 4: Add `history()` to `src/services/task.service.ts`**

```ts
export type HistoryWithActor = {
  id: string; event: string; fromValue: string | null; toValue: string | null;
  createdAt: Date; actor: { id: string; fullName: string } | null;
};

export async function history(taskId: string): Promise<HistoryWithActor[]> {
  await getById(taskId);

  const rows = await db.select({
    id: taskHistory.id, event: taskHistory.event,
    fromValue: taskHistory.fromValue, toValue: taskHistory.toValue,
    createdAt: taskHistory.createdAt,
    actorId: users.id, actorName: users.fullName,
  }).from(taskHistory)
    .leftJoin(users, eq(users.id, taskHistory.actorId))
    .where(eq(taskHistory.taskId, taskId))
    .orderBy(desc(taskHistory.createdAt));

  return rows.map((r) => ({
    id: r.id, event: r.event, fromValue: r.fromValue, toValue: r.toValue, createdAt: r.createdAt,
    actor: r.actorId ? { id: r.actorId, fullName: r.actorName! } : null,
  }));
}
```

Add `desc` to the existing `drizzle-orm` import in that file.

- [ ] **Step 5: Add the routes to `src/routes/task.routes.ts`**

```ts
import * as commentService from '../services/comment.service.js';

const commentSchema = z.object({ body: z.string().trim().min(1, 'A comment cannot be empty').max(4000) });

taskRoutes.get('/:id/history', requirePermission('task:view'), validate({ params: idParam }),
  async (req, res, next) => {
    try { ok(res, await taskService.history(req.params.id!)); } catch (err) { next(err); }
  });

taskRoutes.get('/:id/comments', requirePermission('task:view'), validate({ params: idParam }),
  async (req, res, next) => {
    try { ok(res, await commentService.list(req.params.id!)); } catch (err) { next(err); }
  });

taskRoutes.post('/:id/comments', requirePermission('task:comment'),
  validate({ params: idParam, body: commentSchema }), async (req, res, next) => {
    try {
      ok(res, await commentService.create(currentUser(req), req.params.id!, req.body.body), 201);
    } catch (err) { next(err); }
  });
```

Register these **before** the `/:id` routes if any ordering conflict appears — Express matches in declaration order, and `/:id` would otherwise swallow `/:id/comments` only if declared as a wildcard. With exact paths there is no conflict.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/task-comments.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 7: Commit**

```bash
git add src/services/comment.service.ts src/services/task.service.ts src/routes/task.routes.ts tests/task-comments.test.ts
git commit -m "feat: add task comments and history endpoints"
```

---

### Task 12: Notifications, dashboard and bootstrap

**Files:**
- Create: `src/services/dashboard.service.ts`, `src/routes/notification.routes.ts`, `src/routes/dashboard.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/dashboard.test.ts`, `tests/notifications.test.ts`

**Interfaces:**
- Consumes: Tasks 1–11
- Produces:
  - `dashboardService.summary(userId): Promise<DashboardSummary>`
  - `dashboardService.bootstrap(userId): Promise<{ me: PublicUser; users: PublicUser[]; tasks: PublicTask[]; notifications: NotificationView[] }>`
  - `notificationService.listFor(userId): Promise<NotificationView[]>`
  - `notificationService.markRead(actor, id)`, `notificationService.markAllRead(userId)`
  - `type DashboardSummary = { counts: { total: number; pending: number; progress: number; hold: number; completed: number; overdue: number; cancelled: number; assignedToMe: number; dueToday: number; dueSoon: number }; dueToday: PublicTask[]; dueSoon: PublicTask[]; recentlyAssigned: PublicTask[]; myTasks: PublicTask[]; recentActivity: HistoryWithActor[] }`

- [ ] **Step 1: Write the failing test — `tests/dashboard.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

describe('GET /api/dashboard', () => {
  it('counts every status bucket', async () => {
    const me = await createUser({ email: 'dash@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'P1', createdBy: me.id, priority: 'low', status: 'assigned' },
      { title: 'P2', createdBy: me.id, priority: 'low', status: 'assigned' },
      { title: 'IP', createdBy: me.id, priority: 'low', status: 'progress' },
      { title: 'H',  createdBy: me.id, priority: 'low', status: 'hold' },
      { title: 'C',  createdBy: me.id, priority: 'low', status: 'completed' },
      { title: 'O',  createdBy: me.id, priority: 'low', status: 'overdue' },
      { title: 'X',  createdBy: me.id, priority: 'low', status: 'cancelled' },
    ]);

    const agent = await loginAgent(app, 'dash@utopiabrands.com');
    const res = await agent.get('/api/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.data.counts).toMatchObject({
      total: 7, pending: 2, progress: 1, hold: 1, completed: 1, overdue: 1, cancelled: 1,
    });
  });

  it('counts tasks assigned to me', async () => {
    const me = await createUser({ email: 'mine@utopiabrands.com' });
    const other = await createUser({ email: 'notmine@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Mine 1', createdBy: other.id, assignedTo: me.id, priority: 'low' },
      { title: 'Mine 2', createdBy: other.id, assignedTo: me.id, priority: 'low' },
      { title: 'Theirs', createdBy: other.id, assignedTo: other.id, priority: 'low' },
    ]);

    const agent = await loginAgent(app, 'mine@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.counts.assignedToMe).toBe(2);
    expect(res.body.data.myTasks).toHaveLength(2);
  });

  it('separates due today from due soon', async () => {
    const me = await createUser({ email: 'duebuckets@utopiabrands.com' });
    const endOfToday = new Date(); endOfToday.setHours(23, 0, 0, 0);
    await db.insert(tasks).values([
      { title: 'Today',   createdBy: me.id, priority: 'low', dueAt: endOfToday },
      { title: 'In 3d',   createdBy: me.id, priority: 'low', dueAt: hours(72) },
      { title: 'In 30d',  createdBy: me.id, priority: 'low', dueAt: hours(720) },
    ]);

    const agent = await loginAgent(app, 'duebuckets@utopiabrands.com');
    const res = await agent.get('/api/dashboard');

    expect(res.body.data.counts.dueToday).toBe(1);
    expect(res.body.data.dueToday[0].title).toBe('Today');
    expect(res.body.data.dueSoon.map((t: any) => t.title)).toEqual(['In 3d']);
  });

  it('excludes completed and cancelled tasks from the due buckets', async () => {
    const me = await createUser({ email: 'duedone@utopiabrands.com' });
    const endOfToday = new Date(); endOfToday.setHours(23, 0, 0, 0);
    await db.insert(tasks).values([
      { title: 'Done today', createdBy: me.id, priority: 'low', dueAt: endOfToday, status: 'completed' },
      { title: 'Cancelled',  createdBy: me.id, priority: 'low', dueAt: endOfToday, status: 'cancelled' },
    ]);

    const agent = await loginAgent(app, 'duedone@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.counts.dueToday).toBe(0);
  });

  it('lists recently assigned tasks newest first', async () => {
    const me = await createUser({ email: 'recent@utopiabrands.com' });
    await db.insert(tasks).values([
      { title: 'Older', createdBy: me.id, assignedTo: me.id, priority: 'low', assignedAt: hours(-5) },
      { title: 'Newer', createdBy: me.id, assignedTo: me.id, priority: 'low', assignedAt: hours(-1) },
    ]);

    const agent = await loginAgent(app, 'recent@utopiabrands.com');
    const res = await agent.get('/api/dashboard');
    expect(res.body.data.recentlyAssigned[0].title).toBe('Newer');
  });

  it('rejects an unauthenticated request', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/bootstrap', () => {
  it('returns me, users, tasks and notifications in one call', async () => {
    await createUser({ email: 'boot@utopiabrands.com', fullName: 'Boot User' });
    await createUser({ email: 'boot2@utopiabrands.com' });

    const agent = await loginAgent(app, 'boot@utopiabrands.com');
    const res = await agent.get('/api/bootstrap');

    expect(res.status).toBe(200);
    expect(res.body.data.me.fullName).toBe('Boot User');
    expect(res.body.data.users).toHaveLength(2);
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
  });

  it('exposes no password hash', async () => {
    await createUser({ email: 'bootsafe@utopiabrands.com' });
    const agent = await loginAgent(app, 'bootsafe@utopiabrands.com');
    const res = await agent.get('/api/bootstrap');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });
});
```

- [ ] **Step 2: Write the failing test — `tests/notifications.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { notifications } from '../src/db/schema.js';
import { createUser, loginAgent } from './helpers.js';

const app = createApp();

async function notifyFor(userId: string, title = 'New task assigned') {
  const [n] = await db.insert(notifications).values({
    userId, type: 'assigned', channel: 'in_app', title, body: 'Something happened',
  }).returning();
  return n!;
}

describe('GET /api/notifications', () => {
  it('returns only the caller notifications', async () => {
    const me = await createUser({ email: 'n1@utopiabrands.com' });
    const other = await createUser({ email: 'n2@utopiabrands.com' });
    await notifyFor(me.id, 'Mine');
    await notifyFor(other.id, 'Theirs');

    const agent = await loginAgent(app, 'n1@utopiabrands.com');
    const res = await agent.get('/api/notifications');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mine');
  });

  it('reports read state as a boolean', async () => {
    const me = await createUser({ email: 'n3@utopiabrands.com' });
    await notifyFor(me.id);
    const agent = await loginAgent(app, 'n3@utopiabrands.com');
    const res = await agent.get('/api/notifications');
    expect(res.body.data[0].read).toBe(false);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  it('marks the caller notification read', async () => {
    const me = await createUser({ email: 'n4@utopiabrands.com' });
    const n = await notifyFor(me.id);
    const agent = await loginAgent(app, 'n4@utopiabrands.com');

    const res = await agent.patch(`/api/notifications/${n.id}/read`);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row!.readAt).not.toBeNull();
  });

  it("refuses to mark another user's notification read", async () => {
    const victim = await createUser({ email: 'n5@utopiabrands.com' });
    const n = await notifyFor(victim.id);
    await createUser({ email: 'n6@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'n6@utopiabrands.com');

    const res = await agent.patch(`/api/notifications/${n.id}/read`);
    expect(res.status).toBe(403);

    const [row] = await db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row!.readAt).toBeNull();
  });

  it('marks all as read', async () => {
    const me = await createUser({ email: 'n7@utopiabrands.com' });
    await notifyFor(me.id, 'A');
    await notifyFor(me.id, 'B');
    const agent = await loginAgent(app, 'n7@utopiabrands.com');

    await agent.post('/api/notifications/read-all');
    const res = await agent.get('/api/notifications');
    expect(res.body.data.every((n: any) => n.read)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/dashboard.test.ts tests/notifications.test.ts`
Expected: FAIL — 404 on `/api/dashboard`.

- [ ] **Step 4: Write `src/services/dashboard.service.ts`**

```ts
import { and, desc, eq, gte, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks, taskHistory, users } from '../db/schema.js';
import { publicTask, type PublicTask } from './task.service.js';
import { publicUser, type PublicUser } from '../lib/serialize.js';
import { listFor, type NotificationView } from './notification.service.js';
import { AppError } from '../lib/errors.js';

const TERMINAL = ['completed', 'cancelled'] as const;

function dayBounds(now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const endOfDay = new Date(start.getTime() + 86_400_000);
  const soon = new Date(start.getTime() + 8 * 86_400_000); // through the next 7 days
  return { start, endOfDay, soon };
}

export type DashboardSummary = {
  counts: {
    total: number; pending: number; progress: number; hold: number;
    completed: number; overdue: number; cancelled: number;
    assignedToMe: number; dueToday: number; dueSoon: number;
  };
  dueToday: PublicTask[];
  dueSoon: PublicTask[];
  recentlyAssigned: PublicTask[];
  myTasks: PublicTask[];
  recentActivity: {
    id: string; event: string; taskId: string; taskTitle: string;
    createdAt: Date; actor: { id: string; fullName: string } | null;
  }[];
};

export async function summary(userId: string): Promise<DashboardSummary> {
  const { endOfDay, soon } = dayBounds();
  const all = (await db.select().from(tasks)).map(publicTask);

  const openWithDue = (t: PublicTask) =>
    !!t.dueAt && !TERMINAL.includes(t.status as any);

  const dueToday = all
    .filter((t) => openWithDue(t) && t.dueAt!.getTime() < endOfDay.getTime())
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());

  const dueSoon = all
    .filter((t) => openWithDue(t)
      && t.dueAt!.getTime() >= endOfDay.getTime()
      && t.dueAt!.getTime() < soon.getTime())
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());

  const myTasks = all
    .filter((t) => t.assignedTo === userId && !TERMINAL.includes(t.status as any))
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

  const recentlyAssigned = all
    .filter((t) => t.assignedAt !== null)
    .sort((a, b) => b.assignedAt!.getTime() - a.assignedAt!.getTime())
    .slice(0, 8);

  const countOf = (s: string) => all.filter((t) => t.status === s).length;

  const activity = await db.select({
    id: taskHistory.id, event: taskHistory.event, createdAt: taskHistory.createdAt,
    taskId: tasks.id, taskTitle: tasks.title,
    actorId: users.id, actorName: users.fullName,
  }).from(taskHistory)
    .innerJoin(tasks, eq(tasks.id, taskHistory.taskId))
    .leftJoin(users, eq(users.id, taskHistory.actorId))
    .orderBy(desc(taskHistory.createdAt))
    .limit(12);

  return {
    counts: {
      total: all.length,
      pending: countOf('assigned'),
      progress: countOf('progress'),
      hold: countOf('hold'),
      completed: countOf('completed'),
      overdue: countOf('overdue'),
      cancelled: countOf('cancelled'),
      assignedToMe: all.filter((t) => t.assignedTo === userId).length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
    },
    dueToday: dueToday.slice(0, 8),
    dueSoon: dueSoon.slice(0, 8),
    recentlyAssigned,
    myTasks: myTasks.slice(0, 8),
    recentActivity: activity.map((a) => ({
      id: a.id, event: a.event, taskId: a.taskId, taskTitle: a.taskTitle, createdAt: a.createdAt,
      actor: a.actorId ? { id: a.actorId, fullName: a.actorName! } : null,
    })),
  };
}

export async function bootstrap(userId: string): Promise<{
  me: PublicUser; users: PublicUser[]; tasks: PublicTask[]; notifications: NotificationView[];
}> {
  const [meRow] = await db.select().from(users).where(eq(users.id, userId));
  if (!meRow) throw new AppError('USER_NOT_FOUND', 'User not found');

  const [allUsers, allTasks, notifs] = await Promise.all([
    db.select().from(users),
    db.select().from(tasks).orderBy(desc(tasks.createdAt)),
    listFor(userId),
  ]);

  return {
    me: publicUser(meRow),
    users: allUsers.map(publicUser),
    tasks: allTasks.map(publicTask),
    notifications: notifs,
  };
}
```

Counting in memory is deliberate at this scale: one query feeds every tile and list, which is cheaper over the Neon HTTP driver than ten round-trips. If the workspace grows past a few thousand tasks, replace `summary` with a single grouped `count(*)` query — the interface stays the same.

- [ ] **Step 5: Add notification reads to `src/services/notification.service.ts`**

```ts
import { and, desc, isNull } from 'drizzle-orm';
import { assertCan } from '../lib/permissions.js';
import type { AuthUser } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

export type NotificationView = {
  id: string; type: string; taskId: string | null; title: string; body: string;
  read: boolean; createdAt: Date; sentAt: Date | null;
};

export async function listFor(userId: string): Promise<NotificationView[]> {
  const rows = await db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id, type: r.type, taskId: r.taskId, title: r.title, body: r.body,
    read: r.readAt !== null, createdAt: r.createdAt, sentAt: r.sentAt,
  }));
}

export async function markRead(actor: AuthUser, id: string): Promise<void> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!row) throw new AppError('NOT_FOUND', 'Notification not found');
  assertCan(actor, 'notification:read', { userId: row.userId });

  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
}

export async function markAllRead(userId: string): Promise<void> {
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
```

- [ ] **Step 6: Write the two route files**

`src/routes/notification.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import * as notificationService from '../services/notification.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { ok } from '../lib/respond.js';
import { validate } from '../lib/validate.js';

export const notificationRoutes = Router();
const idParam = z.object({ id: z.string().uuid() });

notificationRoutes.use(requireAuth, requirePasswordChanged);

notificationRoutes.get('/', async (req, res, next) => {
  try { ok(res, await notificationService.listFor(currentUser(req).id)); } catch (e) { next(e); }
});

notificationRoutes.patch('/:id/read', validate({ params: idParam }), async (req, res, next) => {
  try {
    await notificationService.markRead(currentUser(req), req.params.id!);
    ok(res, { read: true });
  } catch (e) { next(e); }
});

notificationRoutes.post('/read-all', async (req, res, next) => {
  try {
    await notificationService.markAllRead(currentUser(req).id);
    ok(res, { read: true });
  } catch (e) { next(e); }
});
```

`src/routes/dashboard.routes.ts`:

```ts
import { Router } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import { currentUser, requireAuth, requirePasswordChanged } from '../lib/auth.js';
import { ok } from '../lib/respond.js';

export const dashboardRoutes = Router();
dashboardRoutes.use(requireAuth, requirePasswordChanged);

dashboardRoutes.get('/dashboard', async (req, res, next) => {
  try { ok(res, await dashboardService.summary(currentUser(req).id)); } catch (e) { next(e); }
});

dashboardRoutes.get('/bootstrap', async (req, res, next) => {
  try { ok(res, await dashboardService.bootstrap(currentUser(req).id)); } catch (e) { next(e); }
});
```

- [ ] **Step 7: Mount in `src/app.ts`**

```ts
import { notificationRoutes } from './routes/notification.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
app.use('/api/notifications', notificationRoutes);
app.use('/api', dashboardRoutes);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard.test.ts tests/notifications.test.ts`
Expected: PASS — 8 dashboard tests, 5 notification tests.

- [ ] **Step 9: Commit**

```bash
git add src/services/dashboard.service.ts src/services/notification.service.ts src/routes/notification.routes.ts src/routes/dashboard.routes.ts src/app.ts tests/dashboard.test.ts tests/notifications.test.ts
git commit -m "feat: add notifications, dashboard summary and bootstrap endpoints"
```

---

### Task 13: 24-hour pending reminder job

**Files:**
- Create: `src/jobs/runner.ts`, `src/jobs/reminders.ts`, `src/routes/job.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/job-reminders.test.ts`

**Interfaces:**
- Consumes: Tasks 1–12
- Produces:
  - `runJob(name, fn): Promise<JobResult>` — writes a `job_runs` audit row, never throws
  - `type JobResult = { job: string; processed: number; succeeded: number; failed: number; skipped: number }`
  - `runReminders(now?: Date): Promise<JobResult>`
  - `reminderDedupeKey(taskId, userId, now): string`
  - `requireCronSecret: RequestHandler`

- [ ] **Step 1: Write the failing test — `tests/job-reminders.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { tasks, notifications, jobRuns, TASK_STATUSES } from '../src/db/schema.js';
import { createUser } from './helpers.js';
import { runReminders } from '../src/jobs/reminders.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

const app = createApp();
beforeEach(() => __resetMailbox());

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function pendingTask(status: any = 'assigned') {
  const creator = await createUser({ email: `c-${crypto.randomUUID()}@utopiabrands.com`, fullName: 'Shahzeb Ali' });
  const assignee = await createUser({ email: `a-${crypto.randomUUID()}@utopiabrands.com`, fullName: 'John Smith' });
  const [t] = await db.insert(tasks).values({
    title: 'Pending work', description: 'Still open.', createdBy: creator.id,
    assignedTo: assignee.id, priority: 'high', status,
    assignedAt: hoursAgo(30), dueAt: new Date(Date.now() + 86_400_000),
  }).returning();
  return { task: t!, creator, assignee };
}

describe('reminder job', () => {
  it('sends a reminder for a task pending past 24 hours', async () => {
    const { task, assignee, creator } = await pendingTask();
    const result = await runReminders();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(2); // assignee + assigner

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === 'reminder' && r.status === 'sent')).toBe(true);
    expect(__sentMessages.map((m) => m.to).sort())
      .toEqual([assignee.email, creator.email].sort());
  });

  it('does not send a second reminder in the same 24-hour window', async () => {
    const { task } = await pendingTask();

    const first = await runReminders();
    expect(first.succeeded).toBe(2);

    __resetMailbox();
    const second = await runReminders();

    expect(second.succeeded).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect(__sentMessages).toHaveLength(0);

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('sends again on the following day', async () => {
    const { task } = await pendingTask();
    await runReminders();
    __resetMailbox();

    const tomorrow = new Date(Date.now() + 86_400_000);
    const result = await runReminders(tomorrow);

    expect(result.succeeded).toBe(2);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(4);
  });

  it('sends nothing for a completed task', async () => {
    await pendingTask('completed');
    const result = await runReminders();
    expect(result.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('sends nothing for a cancelled task', async () => {
    await pendingTask('cancelled');
    const result = await runReminders();
    expect(result.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('sends nothing for an overdue task — expiry owns that state', async () => {
    await pendingTask('overdue');
    const result = await runReminders();
    expect(result.processed).toBe(0);
  });

  it('reminds for progress and hold, the other active statuses', async () => {
    await pendingTask('progress');
    await pendingTask('hold');
    const result = await runReminders();
    expect(result.processed).toBe(2);
  });

  it('skips a task with no assignee', async () => {
    const creator = await createUser({ email: 'noassignee@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Unassigned', createdBy: creator.id, priority: 'low', status: 'assigned',
    });
    const result = await runReminders();
    expect(result.processed).toBe(0);
  });

  it('is safe under concurrent invocations — no duplicate email', async () => {
    await pendingTask();
    const [a, b] = await Promise.all([runReminders(), runReminders()]);
    expect(a.succeeded + b.succeeded).toBe(2);
    expect(__sentMessages).toHaveLength(2);
  });

  it('writes a job_runs audit row', async () => {
    await pendingTask();
    await runReminders();
    const rows = await db.select().from(jobRuns).where(eq(jobRuns.job, 'reminders'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.finishedAt).not.toBeNull();
  });

  it('retries a previously failed notification', async () => {
    const { task, assignee } = await pendingTask();
    await db.insert(notifications).values({
      userId: assignee.id, taskId: task.id, type: 'reminder', channel: 'email',
      title: 'Reminder', body: 'x', status: 'failed', attempts: 1,
      dedupeKey: `reminder:${task.id}:${assignee.id}:1970-01-01`,
    });

    const result = await runReminders();
    expect(result.succeeded).toBeGreaterThan(0);
  });
});

describe('job endpoint authorization', () => {
  it('rejects a request with no CRON_SECRET', async () => {
    const res = await request(app).get('/api/jobs/reminders');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong CRON_SECRET', async () => {
    const res = await request(app).get('/api/jobs/reminders')
      .set('Authorization', 'Bearer wrong-secret-value');
    expect(res.status).toBe(401);
  });

  it('accepts a GET with the correct secret — Vercel Cron uses GET', async () => {
    const res = await request(app).get('/api/jobs/reminders')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.data.job).toBe('reminders');
  });

  it('accepts a POST with the correct secret', async () => {
    const res = await request(app).post('/api/jobs/reminders')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
  });

  it('is not reachable with an ordinary user session', async () => {
    const { loginAgent } = await import('./helpers.js');
    await createUser({ email: 'nocron@utopiabrands.com', role: 'manager' });
    const agent = await loginAgent(app, 'nocron@utopiabrands.com');
    const res = await agent.get('/api/jobs/reminders');
    expect(res.status).toBe(401);
  });
});
```

The concurrency test is the one that proves the design. Two overlapping runs must produce exactly two emails, not four — and that guarantee comes from the unique index, not from timing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/job-reminders.test.ts`
Expected: FAIL — `Cannot find module '../src/jobs/reminders.js'`.

- [ ] **Step 3: Write `src/jobs/runner.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export type JobResult = {
  job: string; processed: number; succeeded: number; failed: number; skipped: number;
};

export type JobBody = () => Promise<Omit<JobResult, 'job'>>;

/** Wraps a job body in a job_runs audit row. Never throws — a cron caller gets a result. */
export async function runJob(job: string, body: JobBody): Promise<JobResult> {
  const [run] = await db.insert(jobRuns).values({ job }).returning();
  const started = Date.now();

  try {
    const r = await body();
    await db.update(jobRuns).set({
      finishedAt: new Date(), processed: r.processed, succeeded: r.succeeded, failed: r.failed,
    }).where(eq(jobRuns.id, run!.id));

    logger.info(`job ${job} finished`, { ...r, ms: Date.now() - started });
    return { job, ...r };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(jobRuns).set({ finishedAt: new Date(), error: message.slice(0, 500) })
      .where(eq(jobRuns.id, run!.id));
    logger.error(`job ${job} failed`, { message });
    return { job, processed: 0, succeeded: 0, failed: 1, skipped: 0 };
  }
}
```

- [ ] **Step 4: Write `src/jobs/reminders.ts`**

```ts
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ACTIVE_STATUSES, notifications, tasks } from '../db/schema.js';
import { sendReminder } from '../lib/email/index.js';
import * as notificationService from '../services/notification.service.js';
import { runJob, type JobResult } from './runner.js';

const MAX_ATTEMPTS = 5;

/** One reminder per task, per recipient, per UTC calendar day. */
export function reminderDedupeKey(taskId: string, userId: string, now: Date): string {
  return `reminder:${taskId}:${userId}:${now.toISOString().slice(0, 10)}`;
}

export function runReminders(now = new Date()): Promise<JobResult> {
  return runJob('reminders', async () => {
    let processed = 0, succeeded = 0, failed = 0, skipped = 0;

    // Completed, cancelled and overdue are excluded by this status filter.
    const due = await db.select().from(tasks).where(and(
      inArray(tasks.status, [...ACTIVE_STATUSES]),
      isNotNull(tasks.assignedTo),
    ));

    for (const task of due) {
      processed++;
      const recipients = await notificationService.recipientsFor(task);
      if (!recipients.length) { skipped++; continue; }

      const ctx = await notificationService.emailContextFor(task);
      const hoursPending = task.assignedAt
        ? (now.getTime() - task.assignedAt.getTime()) / 3_600_000
        : (now.getTime() - task.createdAt.getTime()) / 3_600_000;

      // The unique index on dedupe_key decides who sends. A row that comes back
      // was inserted by THIS run; a conflict means another run already owns it.
      const rows = await notificationService.createPending(recipients.map((r) => ({
        userId: r.id,
        taskId: task.id,
        type: 'reminder' as const,
        channel: 'email' as const,
        title: 'Task still pending',
        body: `"${task.title}" is still open and awaiting completion.`,
        dedupeKey: reminderDedupeKey(task.id, r.id, now),
      })));

      skipped += recipients.length - rows.length;

      const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
      const outcome = await notificationService.deliverAll(
        rows, (to) => sendReminder(to, { ...ctx, hoursPending }), emailOf,
      );
      succeeded += outcome.succeeded;
      failed += outcome.failed;
    }

    const retried = await retryFailed(now);
    succeeded += retried.succeeded;
    failed += retried.failed;

    return { processed, succeeded, failed, skipped };
  });
}

/** Re-attempts notifications that failed delivery, with a simple attempt ceiling. */
async function retryFailed(now: Date): Promise<{ succeeded: number; failed: number }> {
  const stuck = await db.select().from(notifications).where(and(
    eq(notifications.status, 'failed'),
    lt(notifications.attempts, MAX_ATTEMPTS),
  )).limit(50);

  let succeeded = 0, failed = 0;

  for (const n of stuck) {
    if (!n.taskId) { failed++; continue; }
    const [task] = await db.select().from(tasks).where(eq(tasks.id, n.taskId));
    if (!task) { failed++; continue; }

    const recipients = await notificationService.recipientsFor(task);
    const recipient = recipients.find((r) => r.id === n.userId);
    if (!recipient) { failed++; continue; }

    const ctx = await notificationService.emailContextFor(task);
    const hoursPending = (now.getTime() - (task.assignedAt ?? task.createdAt).getTime()) / 3_600_000;

    try {
      await sendReminder([recipient.email], { ...ctx, hoursPending });
      await notificationService.markSent(n.id);
      succeeded++;
    } catch (err) {
      await notificationService.markFailed(n.id, err, n.attempts);
      failed++;
    }
  }

  return { succeeded, failed };
}
```

- [ ] **Step 5: Write `src/routes/job.routes.ts`**

```ts
import { Router, type RequestHandler } from 'express';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/respond.js';
import { runReminders } from '../jobs/reminders.js';

export const jobRoutes = Router();

/**
 * Vercel Cron issues GET and attaches "Authorization: Bearer $CRON_SECRET"
 * automatically when CRON_SECRET is set as a project environment variable.
 */
export const requireCronSecret: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || supplied !== env.CRON_SECRET) {
    next(new AppError('UNAUTHORIZED', 'Invalid or missing cron credentials'));
    return;
  }
  next();
};

jobRoutes.use(requireCronSecret);

jobRoutes.all('/reminders', async (_req, res, next) => {
  try { ok(res, await runReminders()); } catch (e) { next(e); }
});
```

- [ ] **Step 6: Mount in `src/app.ts`**

```ts
import { jobRoutes } from './routes/job.routes.js';
app.use('/api/jobs', jobRoutes);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/job-reminders.test.ts`
Expected: PASS — 11 job tests, 5 authorization tests.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/ src/routes/job.routes.ts src/app.ts tests/job-reminders.test.ts
git commit -m "feat: add 24-hour pending reminder job with dedupe-key idempotency and retry"
```

---

### Task 14: Task expiry job

**Files:**
- Create: `src/jobs/expiry.ts`
- Modify: `src/routes/job.routes.ts`, `vercel.json`
- Test: `tests/job-expiry.test.ts`

**Interfaces:**
- Consumes: Tasks 1–13
- Produces:
  - `runExpiry(now?: Date): Promise<JobResult>`
  - `expiryDedupeKey(taskId, userId): string` — no date component; expiry fires exactly once, ever

- [ ] **Step 1: Write the failing test — `tests/job-expiry.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { tasks, notifications, taskHistory } from '../src/db/schema.js';
import { createUser } from './helpers.js';
import { runExpiry } from '../src/jobs/expiry.js';
import { runReminders } from '../src/jobs/reminders.js';
import { __sentMessages, __resetMailbox } from '../src/lib/email/index.js';

beforeEach(() => __resetMailbox());
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function overdueTask(status: any = 'assigned', dueAt = hoursAgo(2)) {
  const creator = await createUser({ email: `ec-${crypto.randomUUID()}@utopiabrands.com` });
  const assignee = await createUser({ email: `ea-${crypto.randomUUID()}@utopiabrands.com` });
  const [t] = await db.insert(tasks).values({
    title: 'Past its time', description: 'Not finished.', createdBy: creator.id,
    assignedTo: assignee.id, priority: 'critical', status, assignedAt: hoursAgo(48), dueAt,
  }).returning();
  return { task: t!, creator, assignee };
}

describe('expiry job', () => {
  it('flips a past-due task to overdue', async () => {
    const { task } = await overdueTask();
    const result = await runExpiry();

    expect(result.processed).toBe(1);
    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after!.status).toBe('overdue');
  });

  it('emails both the assignee and the assigner', async () => {
    const { assignee, creator } = await overdueTask();
    await runExpiry();
    expect(__sentMessages.map((m) => m.to).sort()).toEqual([assignee.email, creator.email].sort());
  });

  it('says the assigned time has finished and names the task', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    const body = __sentMessages[0]!.html;
    expect(body).toContain(task.ref);
    expect(body).toContain('Past its time');
    expect(body.toLowerCase()).toContain('finished');
  });

  it('records the notification rows', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === 'expired' && r.status === 'sent')).toBe(true);
  });

  it('writes a status_changed history event', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    const rows = await db.select().from(taskHistory).where(eq(taskHistory.taskId, task.id));
    const ev = rows.find((r) => r.event === 'status_changed');
    expect(ev!.fromValue).toBe('assigned');
    expect(ev!.toValue).toBe('overdue');
  });

  it('does not send a second expiry email on a later run', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    __resetMailbox();

    const second = await runExpiry();
    expect(second.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);

    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('does not resend even if the task is manually reset to pending', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    __resetMailbox();

    // A user reopens it, then it lapses again — the expiry event already fired.
    await db.update(tasks).set({ status: 'assigned' }).where(eq(tasks.id, task.id));
    await runExpiry();

    expect(__sentMessages).toHaveLength(0);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
  });

  it('ignores a completed task past its due date', async () => {
    await overdueTask('completed');
    const result = await runExpiry();
    expect(result.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);
  });

  it('ignores a cancelled task past its due date', async () => {
    await overdueTask('cancelled');
    const result = await runExpiry();
    expect(result.processed).toBe(0);
  });

  it('ignores a task that is not yet due', async () => {
    await overdueTask('assigned', new Date(Date.now() + 86_400_000));
    const result = await runExpiry();
    expect(result.processed).toBe(0);
  });

  it('ignores a task with no due date', async () => {
    const creator = await createUser({ email: 'nodue@utopiabrands.com' });
    const assignee = await createUser({ email: 'nodue2@utopiabrands.com' });
    await db.insert(tasks).values({
      title: 'Open ended', createdBy: creator.id, assignedTo: assignee.id,
      priority: 'low', status: 'assigned', dueAt: null,
    });
    const result = await runExpiry();
    expect(result.processed).toBe(0);
  });

  it('is safe under concurrent invocations', async () => {
    await overdueTask();
    await Promise.all([runExpiry(), runExpiry()]);
    expect(__sentMessages).toHaveLength(2);
  });

  it('stops sending reminders once a task expires', async () => {
    const { task } = await overdueTask();
    await runExpiry();
    __resetMailbox();

    const reminders = await runReminders();
    expect(reminders.processed).toBe(0);
    expect(__sentMessages).toHaveLength(0);

    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after!.status).toBe('overdue');
  });
});
```

The "manually reset to pending" test encodes the requirement literally: *do not repeatedly send expiry emails for the same expiry event.* A date-bucketed key would resend; a bare `expiry:{task}:{user}` key cannot.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/job-expiry.test.ts`
Expected: FAIL — `Cannot find module '../src/jobs/expiry.js'`.

- [ ] **Step 3: Write `src/jobs/expiry.ts`**

```ts
import { and, isNotNull, lt, notInArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskHistory, tasks } from '../db/schema.js';
import { sendExpiry } from '../lib/email/index.js';
import * as notificationService from '../services/notification.service.js';
import { runJob, type JobResult } from './runner.js';

/** No date component: an expiry event fires exactly once per task, permanently. */
export function expiryDedupeKey(taskId: string, userId: string): string {
  return `expiry:${taskId}:${userId}`;
}

export function runExpiry(now = new Date()): Promise<JobResult> {
  return runJob('expiry', async () => {
    let processed = 0, succeeded = 0, failed = 0, skipped = 0;

    const lapsed = await db.select().from(tasks).where(and(
      isNotNull(tasks.dueAt),
      lt(tasks.dueAt, now),
      notInArray(tasks.status, ['completed', 'cancelled', 'overdue']),
    ));

    for (const task of lapsed) {
      const recipients = await notificationService.recipientsFor(task);

      const rows = recipients.length
        ? await notificationService.createPending(recipients.map((r) => ({
            userId: r.id,
            taskId: task.id,
            type: 'expired' as const,
            channel: 'email' as const,
            title: 'Task time finished',
            body: `The assigned time for "${task.title}" has finished and it is not complete.`,
            dedupeKey: expiryDedupeKey(task.id, r.id),
          })))
        : [];

      // A conflict on every row means the expiry event already fired for this task.
      if (recipients.length && rows.length === 0) {
        await markOverdue(task, now);
        skipped++;
        continue;
      }

      processed++;
      await markOverdue(task, now);

      if (!rows.length) { skipped++; continue; }

      const ctx = await notificationService.emailContextFor({ ...task, status: 'overdue' });
      const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
      const outcome = await notificationService.deliverAll(
        rows, (to) => sendExpiry(to, ctx), emailOf,
      );
      succeeded += outcome.succeeded;
      failed += outcome.failed;
    }

    return { processed, succeeded, failed, skipped };
  });
}

async function markOverdue(task: typeof tasks.$inferSelect, now: Date): Promise<void> {
  await db.batch([
    db.update(tasks).set({ status: 'overdue', updatedAt: now })
      .where(and(eq(tasks.id, task.id))),
    db.insert(taskHistory).values({
      taskId: task.id, actorId: null, event: 'status_changed',
      fromValue: task.status, toValue: 'overdue',
      detail: 'Marked overdue automatically — the assigned time finished',
    }),
  ] as any);
}
```

Add `eq` to the `drizzle-orm` import in this file.

- [ ] **Step 4: Add the endpoint and the cron entry**

In `src/routes/job.routes.ts`:

```ts
import { runExpiry } from '../jobs/expiry.js';

jobRoutes.all('/expiry', async (_req, res, next) => {
  try { ok(res, await runExpiry()); } catch (e) { next(e); }
});
```

`vercel.json` already declares both cron paths from Task 1. Confirm:

Run: `grep -A1 "jobs/expiry" vercel.json`
Expected: the `/api/jobs/expiry` cron entry is present.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/job-expiry.test.ts`
Expected: PASS — 13 tests.

Run: `npx vitest run`
Expected: the whole backend suite green.

- [ ] **Step 6: Verify the full backend against the real database once**

Run: `npm run dev`, then in a second terminal:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"shahzeb.ali@utopiabrands.com","password":"Utopia01"}'
```

Expected: `{"ok":true,"data":{"user":{…,"mustChangePassword":true}}}` with no `passwordHash` anywhere in the response.

- [ ] **Step 7: Commit**

```bash
git add src/jobs/expiry.ts src/routes/job.routes.ts tests/job-expiry.test.ts
git commit -m "feat: add task expiry job marking overdue and sending a one-time expiry email"
```

---

**Task bodies continue below.**
