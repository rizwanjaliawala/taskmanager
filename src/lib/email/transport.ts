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
