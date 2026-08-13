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
