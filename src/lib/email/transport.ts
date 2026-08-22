import { env, isTest } from '../env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export type SentMessage = {
  to: string;
  /** Optional second recipient on the same message, not a separate send. */
  cc?: string;
  subject: string;
  html: string;
  text: string;
};

/** Every message sent while NODE_ENV=test, for assertion in the suite. */
export const __sentMessages: SentMessage[] = [];
export function __resetMailbox(): void { __sentMessages.length = 0; }

/**
 * Mail goes out through the Power Automate flow, not a mail provider.
 *
 * The app holds no mail credentials at all: it POSTs to the flow's webhook and the
 * flow's "Send an email (V2)" action does the sending, as whoever owns the flow. That
 * is the same webhook the chat message uses — one URL, one trigger, two actions.
 *
 * ── What this costs ────────────────────────────────────────────────────────
 * Power Automate retains each run's action INPUTS for 28 days, so the body of every
 * email is readable by anyone with access to the flow. That includes the temporary
 * password in the account-created mail. A mail provider's API does not retain message
 * bodies this way. This was chosen deliberately; if it ever needs undoing, the
 * account-created path is the one to move back first.
 *
 * The trigger validates against the Teams message envelope and discards anything
 * outside it, so — exactly as with the chat message — every field rides inside
 * `attachments[0].content`. See docs/TEAMS_SETUP.md.
 */
const TIMEOUT_MS = 15_000;

/** Kept for API compatibility with the previous transports; nothing is cached. */
export function __resetTransport(): void { /* no connection to reset */ }

/** True when every setting needed to send is present. */
export function isEmailConfigured(): boolean {
  return Boolean(env.TEAMS_WEBHOOK_URL);
}

/**
 * Fails loudly and names what is missing. A silent no-op would leave a Manager
 * believing a new member was emailed their password when nothing was ever sent.
 */
function requireConfig(): void {
  if (!env.TEAMS_WEBHOOK_URL) {
    throw new AppError(
      'EMAIL_FAILED',
      'TEAMS_WEBHOOK_URL is not set, so no mail can be sent. See docs/TEAMS_SETUP.md.',
    );
  }
}

export type TransportName = 'test' | 'flow' | 'none';

/** Which transport a real send would use right now. */
export function activeTransport(): TransportName {
  if (isTest) return 'test';
  if (isEmailConfigured()) return 'flow';
  return 'none';
}

/**
 * The envelope the "When a Teams webhook request is received" trigger accepts.
 *
 * `kind` is what the flow branches on. Both actions hang off one trigger, so without
 * a Condition on this field every email would also be posted into the group chat —
 * which for the account-created mail would put a temporary password in front of ten
 * people. `body[0].text` therefore never carries the message body: if the Condition
 * is missing or misconfigured, the chat shows a harmless one-liner instead.
 */
function emailPayload(msg: SentMessage) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',

        kind: 'email',
        emailTo: msg.to,
        /* Always present, empty when there is no Cc. The flow's Cc field reads this
           unconditionally, and an absent property and an empty one behave the same
           there — but a stable shape is easier to reason about in run history. */
        emailCc: msg.cc ?? '',
        emailSubject: msg.subject,
        emailBody: msg.html,

        /* Deliberately not the message body — see above. */
        body: [{ type: 'TextBlock', wrap: true, text: `Email sent: ${msg.subject}` }],
      },
    }],
  };
}

/**
 * Delivers one message. Signature unchanged — every caller goes through `fanOut()` in
 * ./index.ts, which records per-recipient success or failure against the notification
 * row, so a throw here becomes a retryable `failed` row rather than a lost email.
 *
 * A 202 means the flow ACCEPTED the request, not that the mail was sent: the trigger
 * is asynchronous and any failure inside the flow is invisible from here. Delivery
 * problems must be diagnosed in the flow's run history.
 */
export async function deliver(msg: SentMessage): Promise<void> {
  if (isTest) {
    __sentMessages.push(msg);
    return;
  }

  requireConfig();

  let response: Response;

  try {
    response = await fetch(env.TEAMS_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload(msg)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    /* Never reached the flow, so nothing was sent. */
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('Flow request failed', { to: msg.to, reason });
    throw new AppError('EMAIL_FAILED', `Could not reach the flow: ${reason}`);
  }

  if (response.ok) return;

  /* The body is the flow's own error text and carries no secret — the webhook URL,
     which is the credential, is only ever in the request line and is never echoed. */
  const detail = await response.text().catch(() => '');
  logger.error('Flow rejected the message', {
    to: msg.to, status: response.status, detail: detail.slice(0, 200),
  });
  throw new AppError(
    'EMAIL_FAILED',
    `The flow rejected the message (${response.status}). See docs/TEAMS_SETUP.md.`,
  );
}
