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

/** Extract the database name (URL pathname, leading slash stripped) without ever exposing the full connection string. */
function dbNameOf(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).pathname.replace(/^\//, '') || undefined;
  } catch {
    return undefined;
  }
}

if (testUrl === process.env.DATABASE_URL || testUrl === process.env.DATABASE_URL_UNPOOLED) {
  throw new Error(
    'TEST_DATABASE_URL is identical to a production connection string ' +
      '(DATABASE_URL or DATABASE_URL_UNPOOLED). Refusing to run: the suite would ' +
      'truncate the production database.',
  );
}

const testDbName = dbNameOf(testUrl);
const prodDbNames = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED]
  .filter((v): v is string => !!v)
  .map(dbNameOf);

if (testDbName && prodDbNames.includes(testDbName)) {
  throw new Error(
    `TEST_DATABASE_URL points at database "${testDbName}", which matches a production ` +
      'database name (via DATABASE_URL or DATABASE_URL_UNPOOLED), just through a different ' +
      'endpoint host. Refusing to run: the suite would truncate the production database.',
  );
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';

const sql = neon(testUrl);

export async function truncateAll(): Promise<void> {
  await sql`TRUNCATE TABLE
    notifications, task_comments, task_history, tasks,
    login_attempts, refresh_sessions, job_runs, users, teams
    RESTART IDENTITY CASCADE`;
}

beforeEach(async () => {
  await truncateAll();
});
