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
  /* Resend — the mail transport, over its HTTPS API rather than SMTP (see
     lib/email/transport.ts for why). Optional at the schema level so the app still
     boots (and the test suite still runs) before credentials are supplied; a partially
     filled set is reported by the email service as a configuration error rather than
     being mistaken for "no email configured".

     The FROM_* names are provider-neutral on purpose: the sender identity outlives
     whichever service delivers it, and this is the second provider already. */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_EMAIL: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('Utopia Trucking Task Manager'),

  /* Teams — a Power Automate HTTP-trigger flow, or a channel Incoming Webhook.
     Optional: unset simply means no Teams post. Email is unaffected either way,
     and remains the reliable per-person channel (see lib/teams/notify.ts). */
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
