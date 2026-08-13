import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { env } from '../lib/env.js';

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema, casing: 'snake_case' });
export { schema };
