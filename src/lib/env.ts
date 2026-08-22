import 'dotenv/config';
import { z } from 'zod';

/**
 * Ships as the default so `CRON_SECRET` is never *unset* in dev. A production deploy
 * that forgets to configure a real value must fail loudly instead of silently accepting
 * this publicly-known string — see the superRefine below.
 */
export const DEFAULT_CRON_SECRET = 'dev-cron-secret-change-me';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  /* The Power Automate flow behind BOTH the chat message and every email. The app
     holds no mail credentials of its own — the flow's Send an email action does the
     sending. One URL, one trigger, two actions.

     Optional at the schema level so the app still boots (and the suite still runs)
     without it; unset means no chat posts and no mail, which the email transport
     reports as a configuration error rather than silently dropping messages.

     This URL carries its own SAS signature and IS the credential. It belongs in .env
     and Vercel's environment settings, never in the repository. */
  TEAMS_WEBHOOK_URL: z.string().url().optional(),

  APP_URL: z.string().url().default('http://localhost:3000'),
  CRON_SECRET: z.string().min(16).default(DEFAULT_CRON_SECRET),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((val, ctx) => {
  // A production deploy that never set CRON_SECRET would otherwise silently accept
  // this well-known default, letting anyone trigger the job endpoints and spam email.
  if (val.NODE_ENV === 'production' && val.CRON_SECRET === DEFAULT_CRON_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CRON_SECRET'],
      message: 'CRON_SECRET must be set to a real value in production — the default is publicly known.',
    });
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
