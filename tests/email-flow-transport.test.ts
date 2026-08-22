import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mail delivery through the Power Automate flow.
 *
 * The app holds no mail credentials: every email is a POST to the same webhook the
 * chat message uses. The load-bearing properties are that a failure THROWS — so
 * `fanOut` records a retryable `failed` notification row rather than losing the mail —
 * and that the message body never reaches the field the chat posts.
 */

const WEBHOOK = 'https://example.invalid/workflows/stub/triggers/manual/paths/invoke?sig=x';

const saved: Record<string, string | undefined> = {};

function setConfig(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function stubFetch(response?: { status?: number; body?: string }) {
  const status = response?.status ?? 202;
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => response?.body ?? '',
  }) as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentContent(fetchMock: ReturnType<typeof stubFetch>) {
  const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body as string);
  return body.attachments[0].content;
}

async function loadTransport() {
  vi.resetModules();
  return import('../src/lib/email/transport.js');
}

const MSG = {
  to: 'faris@example.test',
  subject: 'UT-1042 assigned to Faris Ahmed',
  html: '<p>Verify container CMAU9822570</p>',
  text: 'Verify container CMAU9822570',
};

beforeEach(() => {
  /* The transport short-circuits to an in-memory mailbox under NODE_ENV=test, so the
     real send path is only reachable by pretending not to be a test. */
  setConfig({ NODE_ENV: 'production', TEAMS_WEBHOOK_URL: WEBHOOK });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
});

describe('configuration', () => {
  it('is configured by the webhook URL alone — no mail credentials exist', async () => {
    const { isEmailConfigured, activeTransport } = await loadTransport();
    expect(isEmailConfigured()).toBe(true);
    expect(activeTransport()).toBe('flow');
  });

  it('reports not configured when the webhook is unset', async () => {
    setConfig({ TEAMS_WEBHOOK_URL: undefined });
    const { isEmailConfigured, activeTransport } = await loadTransport();
    expect(isEmailConfigured()).toBe(false);
    expect(activeTransport()).toBe('none');
  });

  /* A silent no-op would leave a Manager believing a new member was emailed their
     password when nothing was ever sent. */
  it('throws rather than silently dropping mail when unconfigured', async () => {
    setConfig({ TEAMS_WEBHOOK_URL: undefined });
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await expect(deliver(MSG)).rejects.toThrow(/TEAMS_WEBHOOK_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the payload', () => {
  it('carries the fields the flow email action addresses', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver(MSG);

    expect(sentContent(fetchMock)).toMatchObject({
      kind: 'email',
      emailTo: MSG.to,
      emailCc: '',
      emailSubject: MSG.subject,
      emailBody: MSG.html,
    });
  });

  /* The assignment mail puts the creator on the same message rather than sending them
     a separate copy, so the assignee can see who was looped in. */
  it('carries a Cc when one is given, and an empty one when not', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ ...MSG, cc: 'shahzeb@example.test' });

    expect(sentContent(fetchMock).emailCc).toBe('shahzeb@example.test');
  });

  /* Both actions hang off one trigger. If the flow's Condition on `kind` is missing,
     every email is also posted to the group chat — so the block the chat reads must
     never contain the message body. The account-created mail carries a temporary
     password, and this is what keeps it out of a ten-person chat. */
  it('keeps the message body out of the block the chat posts', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ ...MSG, html: '<p>Your temporary password is hunter2</p>' });

    const chatText = sentContent(fetchMock).body[0].text;
    expect(chatText).not.toContain('hunter2');
    expect(chatText).not.toContain('password');
  });
});

describe('failure is surfaced, never swallowed', () => {
  it('throws when the flow rejects, so the notification row is retryable', async () => {
    stubFetch({ status: 400, body: 'Flow run failed' });
    const { deliver } = await loadTransport();

    await expect(deliver(MSG)).rejects.toThrow(/rejected the message \(400\)/);
  });

  it('throws when the flow cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    const { deliver } = await loadTransport();

    await expect(deliver(MSG)).rejects.toThrow(/ETIMEDOUT/);
  });

  it('bounds the request so a hung flow cannot consume the function budget', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver(MSG);

    expect((fetchMock.mock.calls[0] as any)[1].signal).toBeDefined();
  });
});

describe('the test mailbox', () => {
  it('writes to the in-memory mailbox under NODE_ENV=test instead of sending', async () => {
    setConfig({ NODE_ENV: 'test' });
    const fetchMock = stubFetch();
    const { deliver, __sentMessages, __resetMailbox } = await loadTransport();
    __resetMailbox();

    await deliver(MSG);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]).toMatchObject({ to: MSG.to, subject: MSG.subject });
  });
});
