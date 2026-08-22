import { env } from '../env.js';
import { logger } from '../logger.js';
import type { TaskEmailContext } from '../email/index.js';

/**
 * Teams notifications for task assignment.
 *
 * Posts an Adaptive Card to a webhook URL — a Power Automate flow with an HTTP
 * trigger, or a channel Incoming Webhook. Both accept the same payload.
 *
 * Why a webhook and not Microsoft Graph: sending a chat message *as an application*
 * is heavily restricted in Graph — it really wants a signed-in user — and the
 * alternative needs an Azure app registration plus admin consent. A Power Automate
 * flow runs as whoever created it, which is what makes posting to a group chat
 * possible at all, and needs no app registration.
 *
 * ── Deliberately different from email ──────────────────────────────────────
 * Email is per-recipient and reliable: every address gets its own notification row,
 * recorded as sent or failed, and the reminder sweep retries the failures.
 *
 * Teams here is ONE broadcast into a shared chat, naming both people. It is not
 * tracked per person and is not retried, so this function never throws — a Teams
 * outage must not mark somebody's assignment email as failed, and must not undo an
 * assignment that already committed.
 *
 * If Teams ever needs to be as reliable as email, it needs its own notification
 * rows keyed per recipient. Do not bolt retries onto this without that.
 */

const TIMEOUT_MS = 10_000;

/**
 * Teams needs addresses that `TaskEmailContext` deliberately does not carry — the
 * flow resolves people by email, both to @mention them and to address the email it
 * sends. Kept as a separate type so the email templates, which must never see an
 * address, are unaffected.
 */
export type TeamsAssignmentContext = TaskEmailContext & {
  assignedToEmail: string;
  assignedByEmail: string;
};

export function isTeamsConfigured(): boolean {
  return Boolean(env.TEAMS_WEBHOOK_URL);
}

/** The chat message, as plain text. The flow posts this string verbatim. */
function assignmentText(c: TeamsAssignmentContext): string {
  const lines = [
    `${c.ref} — assigned to ${c.assignedToName}`,
    c.title,
    `Assigned by: ${c.assignedByName}`,
    `Priority: ${c.priority}`,
    `Status: ${c.status}`,
  ];
  if (c.dueAt) lines.push(`Due: ${c.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  lines.push(`Open: ${c.taskUrl}`);
  return lines.join('\n');
}

/**
 * The envelope the "When a Teams webhook request is received" trigger accepts.
 *
 * That trigger validates against the Teams message envelope and DISCARDS anything
 * outside it — a root-level `text` property does not survive. Only what sits inside
 * `attachments[0].content` is forwarded to the flow's actions, which is why the
 * application fields below ride inside the card object rather than beside it.
 *
 * The flow reads:
 *   chat message   content.body[0].text
 *   email to/cc    content.assigneeEmail / content.assignerEmail
 *   email subject  content.emailSubject
 *   email body     content.emailBody
 *
 * Changing any of those paths means editing the flow to match.
 */
function assignmentPayload(c: TeamsAssignmentContext) {
  const text = assignmentText(c);

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',

        // Application fields, read by the flow's expressions. Not card properties.
        /* Both actions hang off one trigger; the flow's Condition branches on `kind`
           to decide whether this is a chat post, an email, or both. */
        kind: 'assignment',
        assigneeName: c.assignedToName,
        assigneeEmail: c.assignedToEmail,
        assignerName: c.assignedByName,
        assignerEmail: c.assignedByEmail,
        emailSubject: `${c.ref} assigned to ${c.assignedToName}`,
        emailBody: text.replace(/\n/g, '<br>'),

        body: [{ type: 'TextBlock', wrap: true, text }],
      },
    }],
  };
}

/**
 * Announces an assignment in Teams. Never throws.
 *
 * Returns whether the post succeeded, so a caller that wants to record the outcome
 * can, without being forced to handle an exception it must swallow anyway.
 */
export async function notifyAssignment(c: TeamsAssignmentContext): Promise<boolean> {
  if (!isTeamsConfigured()) return false;

  try {
    const response = await fetch(env.TEAMS_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignmentPayload(c)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      /* The body is the flow's own error text and carries no secret — the webhook
         URL is only ever in the request line, never echoed back. */
      const detail = await response.text().catch(() => '');
      logger.error('Teams notification rejected', {
        ref: c.ref, status: response.status, detail: detail.slice(0, 200),
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Teams notification failed', {
      ref: c.ref, reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
