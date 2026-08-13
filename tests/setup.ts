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
