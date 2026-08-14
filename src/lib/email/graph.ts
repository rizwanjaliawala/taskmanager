import { env } from '../env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

/*
 * Microsoft Graph mail transport.
 *
 * Authenticates as the *application* (OAuth 2.0 client credentials), not as a signed-in
 * person, because this backend sends unattended mail from cron jobs and API requests
 * where no user is present to consent. That requires the `Mail.Send` **application**
 * permission with tenant admin consent, and it grants send-as rights over every mailbox
 * in the tenant — which is why the sender is pinned to one configured mailbox below
 * rather than taken from anything a caller supplies.
 *
 * Tokens live in memory only, never in the database and never in a response.
 */

const GRAPH_HOST = 'https://graph.microsoft.com';
const LOGIN_HOST = 'https://login.microsoftonline.com';
const SCOPE = `${GRAPH_HOST}/.default`;

/** Refresh a little before the real expiry so an in-flight send cannot use a dead token. */
const EXPIRY_SKEW_MS = 60_000;

type CachedToken = { value: string; expiresAt: number };
let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

export type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
};

/** True when every Graph setting is present, so callers can pick a transport. */
export function isGraphConfigured(): boolean {
  return Boolean(
    env.MICROSOFT_TENANT_ID &&
    env.MICROSOFT_CLIENT_ID &&
    env.MICROSOFT_CLIENT_SECRET &&
    env.MICROSOFT_SENDER_EMAIL,
  );
}

/**
 * Fails loudly rather than pretending a message was sent. A half-configured Graph
 * setup is a deployment mistake, and silently dropping notifications would hide it.
 */
function requireConfig(): GraphConfig {
  const missing = [
    ['MICROSOFT_TENANT_ID', env.MICROSOFT_TENANT_ID],
    ['MICROSOFT_CLIENT_ID', env.MICROSOFT_CLIENT_ID],
    ['MICROSOFT_CLIENT_SECRET', env.MICROSOFT_CLIENT_SECRET],
    ['MICROSOFT_SENDER_EMAIL', env.MICROSOFT_SENDER_EMAIL],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new AppError(
      'EMAIL_FAILED',
      `Microsoft Graph email is not configured. Missing: ${missing.join(', ')}. ` +
        'See docs/EMAIL_SETUP.md.',
    );
  }

  return {
    tenantId: env.MICROSOFT_TENANT_ID!,
    clientId: env.MICROSOFT_CLIENT_ID!,
    clientSecret: env.MICROSOFT_CLIENT_SECRET!,
    senderEmail: env.MICROSOFT_SENDER_EMAIL!,
  };
}

/** Drops the cached token. Used by tests; also useful after a credential rotation. */
export function __resetGraphToken(): void {
  cached = null;
  inFlight = null;
}

/**
 * Client-credentials token, cached until shortly before it expires.
 *
 * Concurrent callers share one request: the reminder job sends to many recipients in a
 * loop, and without this each one would mint its own token against the login endpoint.
 */
export async function getAccessToken(): Promise<string> {
  const cfg = requireConfig();

  if (cached && cached.expiresAt > Date.now() + EXPIRY_SKEW_MS) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: SCOPE,
      grant_type: 'client_credentials',
    });

    let res: Response;
    try {
      res = await fetch(`${LOGIN_HOST}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      throw new AppError('EMAIL_FAILED',
        `Could not reach Microsoft Entra ID: ${err instanceof Error ? err.message : String(err)}`);
    }

    const payload = (await res.json().catch(() => ({}))) as {
      access_token?: string; expires_in?: number; error?: string; error_description?: string;
    };

    if (!res.ok || !payload.access_token) {
      /* Entra's error_description names the misconfiguration (wrong tenant, bad secret,
         missing consent) and contains no secret material, so it is safe to surface. */
      const detail = payload.error_description?.split('\n')[0] ?? payload.error ?? `HTTP ${res.status}`;
      throw new AppError('EMAIL_FAILED', `Microsoft Graph authentication failed: ${detail}`);
    }

    cached = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return cached.value;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export type GraphMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  cc?: string[];
  bcc?: string[];
};

const recipients = (addresses: string[]) =>
  addresses.filter(Boolean).map((address) => ({ emailAddress: { address } }));

/**
 * Sends one message via `POST /users/{sender}/sendMail`.
 *
 * `saveToSentItems: true` keeps a copy in the shared mailbox, so there is an auditable
 * record of what the system sent to whom — worth having for a tool whose whole job is
 * chasing people about deadlines.
 */
export async function sendViaGraph(msg: GraphMessage): Promise<void> {
  const cfg = requireConfig();
  const token = await getAccessToken();

  const body = {
    message: {
      subject: msg.subject,
      body: { contentType: 'HTML', content: msg.html },
      toRecipients: recipients([msg.to]),
      ...(msg.cc?.length ? { ccRecipients: recipients(msg.cc) } : {}),
      ...(msg.bcc?.length ? { bccRecipients: recipients(msg.bcc) } : {}),
    },
    saveToSentItems: true,
  };

  const url = `${GRAPH_HOST}/v1.0/users/${encodeURIComponent(cfg.senderEmail)}/sendMail`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AppError('EMAIL_FAILED',
      `Could not reach Microsoft Graph: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 202 Accepted is the success case; sendMail returns no content.
  if (res.status === 202) return;

  /* A token can be revoked or the app's consent withdrawn mid-life. Drop the cache so
     the next attempt re-authenticates instead of replaying a token Graph just refused. */
  if (res.status === 401) cached = null;

  const detail = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  const code = detail?.error?.code ?? `HTTP ${res.status}`;
  const message = detail?.error?.message ?? res.statusText;

  logger.error('Graph sendMail failed', { status: res.status, code, to: msg.to });

  throw new AppError('EMAIL_FAILED', `Microsoft Graph rejected the message (${code}): ${message}`);
}
