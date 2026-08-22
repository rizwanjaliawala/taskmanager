import {
  notifyAssignment, isTeamsConfigured, type TeamsAssignmentContext,
} from '../lib/teams/notify.js';
import { env } from '../lib/env.js';
import { taskUrlFor } from '../lib/email/index.js';

/**
 * Posts one sample assignment card to the configured Teams flow.
 *
 * Exists because the only way to know a Power Automate flow is wired correctly is
 * to POST to it — the URL carries its own signature, the Teams action can be
 * misconfigured in ways that only fail at run time, and none of it is visible from
 * the application side until something is sent.
 *
 * Sends real content into a real chat. It is a manual script, never wired into a
 * job or a route.
 *
 *   npm run teams:test
 */

/** Distinctly a test, so nobody in the chat mistakes it for a live assignment. */
const SAMPLE: TeamsAssignmentContext = {
  ref: 'TEST-0000',
  title: 'Test notification from Task Manager (ignore)',
  description: null,
  priority: 'normal' as TeamsAssignmentContext['priority'],
  status: 'pending' as TeamsAssignmentContext['status'],
  dueAt: null,
  assignedByName: 'Task Manager setup check',
  assignedToName: 'Nobody — this is a connectivity test',
  /* Deliberately undeliverable. The flow's email action must not mail a real person
     during a connectivity check, and `.invalid` is reserved by RFC 2606 for this. */
  assignedByEmail: 'connectivity-test@example.invalid',
  assignedToEmail: 'connectivity-test@example.invalid',
  taskUrl: taskUrlFor('TEST-0000'),
};

async function main(): Promise<void> {
  if (!isTeamsConfigured()) {
    console.error(
      'TEAMS_WEBHOOK_URL is not set.\n\n' +
      'Open the flow in Power Automate, click the "When an HTTP request is received"\n' +
      'trigger, and copy the "HTTP POST URL". It looks like:\n' +
      '  https://prod-NN.<region>.logic.azure.com:443/workflows/.../triggers/manual/paths/invoke?...&sig=...\n\n' +
      'A ms-powerautomate:/ link is a desktop deep link, not the endpoint.',
    );
    process.exit(1);
  }

  // Print the host only. The query string carries the signature that authorises
  // posting to that chat, and this output tends to end up in tickets.
  const host = (() => {
    try { return new URL(env.TEAMS_WEBHOOK_URL!).host; } catch { return '(unparseable URL)'; }
  })();
  console.log(`Posting a test card via ${host} ...`);

  const ok = await notifyAssignment(SAMPLE);

  if (ok) {
    console.log(
      '\nFlow accepted the request.\n\n' +
      'Now check the "Trucking USA + Canada" chat and confirm:\n' +
      '  1. the card arrived, and\n' +
      '  2. the sender reads "Flow bot", not a person.\n\n' +
      'If it reads as a person, the flow\'s Teams action is set to Post as: User.',
    );
    process.exit(0);
  }

  console.error(
    '\nThe flow rejected the request or could not be reached.\n' +
    'The reason was logged above. Common causes:\n' +
    '  - the URL was truncated when copied (it must keep ?api-version=...&sig=...)\n' +
    '  - the flow is turned off\n' +
    '  - the Teams action names a chat the flow owner is not a member of',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
