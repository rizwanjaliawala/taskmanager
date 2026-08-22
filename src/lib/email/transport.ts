import { env, isTest } from '../env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export type SentMessage = { to: string; subject: string; html: string; text: string };

/** Every message sent while NODE_ENV=test, for assertion in the suite. */
export const __sentMessages: SentMessage[] = [];
export function __resetMailbox(): void { __sentMessages.length = 0; }

/**
 * Resend's HTTPS API, not its SMTP relay.
 *
 * Resend offers both. HTTPS wins here because this app runs as Vercel functions,
 * including three cron jobs that exist only to send mail: a short-lived function
 * would pay a fresh SMTP connect + TLS + AUTH handshake on every invocation, and
 * outbound SMTP is widely throttled on serverless platforms. A `fetch` has none of
 * those problems, and a JSON error naming the cause beats decoding an SMTP reply code.
 */
const ENDPOINT = 'https://api.resend.com/emails';

/**
 * Serverless functions bill for wall-clock time and the cron jobs fan out over many
 * recipients, so a hung request must not consume the whole budget.
 */
const TIMEOUT_MS = 15_000;

/** Kept for API compatibility with the SMTP transport; nothing is cached now. */
export function __resetTransport(): void { /* no connection to reset */ }

/** True when every setting needed to send is present. */
export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM_EMAIL);
}

/**
 * Fails loudly and names what is missing. A half-configured mailer is a deployment
 * mistake, and silently dropping notifications would hide it.
 */
function requireConfig(): void {
  const missing = [
    ['RESEND_API_KEY', env.RESEND_API_KEY],
    ['EMAIL_FROM_EMAIL', env.EMAIL_FROM_EMAIL],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new AppError(
      'EMAIL_FAILED',
      `Resend is not configured. Missing: ${missing.join(', ')}. See docs/EMAIL_SETUP.md.`,
    );
  }
}

/**
 * The `From` header.
 *
 * Resend will only accept a domain verified in the account. An address on an
 * unverified domain is rejected at send time with 403, not at configuration time —
 * see the error mapping in `deliver`.
 */
export function fromAddress(): string {
  return `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_EMAIL}>`;
}

export type TransportName = 'test' | 'resend' | 'none';

/** Which transport a real send would use right now. */
export function activeTransport(): TransportName {
  if (isTest) return 'test';
  if (isEmailConfigured()) return 'resend';
  return 'none';
}

/** Resend's error body. `name` is a stable machine-readable code; `message` is prose. */
type ResendError = { name?: string; message?: string; statusCode?: number };

/**
 * Turns a Resend failure into something an operator can act on.
 *
 * The unverified-domain case is singled out because it is the one failure that looks
 * like a code bug and is not: everything is configured correctly, the key is valid,
 * and every send still fails until a DNS record is published.
 */
function describeFailure(status: number, body: ResendError, from: string): string {
  if (status === 403 || body.name === 'validation_error') {
    const domain = from.split('@').pop()?.replace(/>$/, '') ?? 'the sender domain';
    if (/domain/i.test(body.message ?? '')) {
      return `Resend rejected the sender: ${body.message} ` +
        `Verify ${domain} at https://resend.com/domains and publish the DNS records it lists, ` +
        `or set EMAIL_FROM_EMAIL to onboarding@resend.dev for testing.`;
    }
  }
  if (status === 401) {
    return 'Resend rejected the API key (401). Check RESEND_API_KEY.';
  }
  if (status === 429) {
    return 'Resend rate-limited the request (429). The message was not sent.';
  }
  return `Resend rejected the message (${status}): ${body.message ?? body.name ?? 'unknown error'}`;
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

  const from = fromAddress();
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    /* Network failure or timeout — never reached Resend, so nothing was sent. */
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('Resend request failed', { to: msg.to, reason });
    throw new AppError('EMAIL_FAILED', `Could not reach Resend: ${reason}`);
  }

  if (response.ok) return;

  /* The body names the real problem (unverified domain, bad key, rate limit) and
     contains no secret. The API key is only ever in the request header, never in a
     response, so it cannot reach a log or an error message from here. */
  const body = (await response.json().catch(() => ({}))) as ResendError;
  logger.error('Resend send failed', {
    to: msg.to, status: response.status, name: body.name,
  });
  throw new AppError('EMAIL_FAILED', describeFailure(response.status, body, from));
}
