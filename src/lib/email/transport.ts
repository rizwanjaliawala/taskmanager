import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export type SentMessage = { to: string; subject: string; html: string; text: string };

/** Every message sent while NODE_ENV=test, for assertion in the suite. */
export const __sentMessages: SentMessage[] = [];
export function __resetMailbox(): void { __sentMessages.length = 0; }

let cached: Transporter | null = null;

/** Drops the cached transporter. Used by tests and after a credential rotation. */
export function __resetTransport(): void { cached = null; }

/** True when every Brevo setting needed to send is present. */
export function isBrevoConfigured(): boolean {
  return Boolean(
    env.BREVO_SMTP_HOST &&
    env.BREVO_SMTP_PORT &&
    env.BREVO_SMTP_USER &&
    env.BREVO_SMTP_PASSWORD &&
    env.BREVO_SMTP_FROM_EMAIL,
  );
}

/**
 * Fails loudly and names what is missing. A half-configured mailer is a deployment
 * mistake, and silently dropping notifications would hide it.
 */
function requireConfig(): void {
  const missing = [
    ['BREVO_SMTP_HOST', env.BREVO_SMTP_HOST],
    ['BREVO_SMTP_PORT', env.BREVO_SMTP_PORT],
    ['BREVO_SMTP_USER', env.BREVO_SMTP_USER],
    ['BREVO_SMTP_PASSWORD', env.BREVO_SMTP_PASSWORD],
    ['BREVO_SMTP_FROM_EMAIL', env.BREVO_SMTP_FROM_EMAIL],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new AppError(
      'EMAIL_FAILED',
      `Brevo SMTP is not configured. Missing: ${missing.join(', ')}. See docs/EMAIL_SETUP.md.`,
    );
  }
}

/**
 * Cached SMTP transporter.
 *
 * `secure` is derived from the port rather than configured separately: Brevo's relay
 * uses STARTTLS on 587 (so `secure: false`, upgraded after connect) and implicit TLS
 * only on 465. Setting `secure: true` on 587 makes the connection hang until timeout,
 * which is a confusing way to discover a one-character config mistake.
 */
function transport(): Transporter {
  if (!cached) {
    cached = nodemailer.createTransport({
      host: env.BREVO_SMTP_HOST,
      port: env.BREVO_SMTP_PORT,
      secure: env.BREVO_SMTP_PORT === 465,
      auth: { user: env.BREVO_SMTP_USER!, pass: env.BREVO_SMTP_PASSWORD! },
    });
  }
  return cached;
}

/** The `From` header. Brevo requires this to be a sender verified in the account. */
export function fromAddress(): string {
  return `"${env.BREVO_SMTP_FROM_NAME}" <${env.BREVO_SMTP_FROM_EMAIL}>`;
}

export type TransportName = 'test' | 'brevo' | 'none';

/** Which transport a real send would use right now. */
export function activeTransport(): TransportName {
  if (isTest) return 'test';
  if (isBrevoConfigured()) return 'brevo';
  return 'none';
}

/**
 * Delivers one message. Signature unchanged — every caller goes through `fanOut()` in
 * ./index.ts, which records per-recipient success or failure against the notification
 * row, so a throw here becomes a retryable `failed` row rather than a lost email.
 */
export async function deliver(msg: SentMessage): Promise<void> {
  if (isTest) {
    __sentMessages.push(msg);
    return;
  }

  /* Never swallow this. A silent no-op would leave a Manager believing a new member
     was emailed their password when nothing was ever sent. */
  requireConfig();

  try {
    await transport().sendMail({
      from: fromAddress(),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  } catch (err) {
    /* Nodemailer's error carries the SMTP reply, which names the real problem
       (bad credentials, unverified sender, quota) and contains no secret. The
       password is never part of it and is never logged. */
    const e = err as { message?: string; responseCode?: number; command?: string };
    logger.error('Brevo SMTP send failed', {
      to: msg.to, responseCode: e.responseCode, command: e.command,
    });
    throw new AppError(
      'EMAIL_FAILED',
      `Brevo rejected the message${e.responseCode ? ` (${e.responseCode})` : ''}: ${e.message ?? 'unknown error'}`,
    );
  }
}
