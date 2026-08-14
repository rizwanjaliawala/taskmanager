import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../env.js';
import { logger } from '../logger.js';
import { isGraphConfigured, sendViaGraph } from './graph.js';

export type SentMessage = { to: string; subject: string; html: string; text: string };

/** Every message sent while NODE_ENV=test, for assertion in the suite. */
export const __sentMessages: SentMessage[] = [];
export function __resetMailbox(): void { __sentMessages.length = 0; }

let cached: Transporter | null = null;

function smtpTransport(): Transporter {
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

function smtpConfigured(): boolean {
  return Boolean(env.EMAIL_USERNAME && env.EMAIL_PASSWORD);
}

export type TransportName = 'test' | 'graph' | 'smtp' | 'none';

/**
 * Which transport a real send would use right now.
 *
 * Graph wins when configured. SMTP is kept as a fallback so an existing deployment
 * that already had working credentials does not go dark the moment this ships; it is
 * not the intended path. `none` means neither is configured, and `deliver` will throw
 * rather than quietly discard the message.
 */
export function activeTransport(): TransportName {
  if (isTest) return 'test';
  if (isGraphConfigured()) return 'graph';
  if (smtpConfigured()) return 'smtp';
  return 'none';
}

/**
 * Delivers one message. Signature unchanged — every caller goes through `fanOut()` in
 * ./index.ts, which records per-recipient success or failure against the notification
 * row, so a throw here becomes a retryable `failed` row rather than a lost email.
 */
export async function deliver(msg: SentMessage): Promise<void> {
  switch (activeTransport()) {
    case 'test':
      __sentMessages.push(msg);
      return;

    case 'graph':
      await sendViaGraph({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
      return;

    case 'smtp':
      logger.warn('Sending via SMTP; configure Microsoft Graph to use the intended transport');
      await smtpTransport().sendMail({
        from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
      });
      return;

    default:
      /* Never swallow this. A silent no-op would leave a Manager believing a new
         member was emailed their password when nothing was ever sent. */
      throw new Error(
        'No email transport is configured. Set the MICROSOFT_* Microsoft Graph variables ' +
          '(see docs/EMAIL_SETUP.md).',
      );
  }
}
