import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests exercise the Resend transport directly.
 *
 * `deliver()` short-circuits to the in-memory mailbox whenever NODE_ENV=test — that is
 * what stops the rest of the suite sending real mail — so testing the send path means
 * calling into the transport module with NODE_ENV forced to something else and `fetch`
 * stubbed. Nothing here opens a socket.
 */

/**
 * `vi.resetModules()` re-imports the module graph, so the AppError thrown inside
 * transport.js is a different class object from one imported here — `instanceof` would
 * always be false. Assert on the error's shape, which is what callers rely on anyway.
 */
function expectAppError(err: any, code = 'EMAIL_FAILED') {
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('AppError');
  expect(err.code).toBe(code);
  return err;
}

const API_KEY = 're_test_key_value_not_real';

const CONFIG = {
  RESEND_API_KEY: API_KEY,
  EMAIL_FROM_EMAIL: 'taskmanager@utopiabrands.com',
  EMAIL_FROM_NAME: 'Utopia Trucking Task Manager',
};

const saved: Record<string, string | undefined> = {};

function setConfig(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/**
 * Captures what Resend was asked to do, without touching the network.
 *
 * The parameters are declared even though the body ignores them: without them
 * TypeScript infers the call tuple as `[]`, and every `mock.calls[0]![1]` below
 * becomes a compile error.
 */
function stubFetch(response?: { status?: number; body?: unknown }) {
  const status = response?.status ?? 200;
  const body = response?.body ?? { id: 'stub-message-id' };
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The JSON body the transport posted, parsed. */
function sentBody(fetchMock: ReturnType<typeof stubFetch>) {
  return JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
}

/** env.ts snapshots process.env at import, so the module graph must be re-imported. */
async function loadTransport() {
  vi.resetModules();
  return import('../src/lib/email/transport.js');
}

beforeEach(() => {
  setConfig(CONFIG);
  // Leave test mode so `deliver` takes the real send path rather than the mailbox.
  setConfig({ NODE_ENV: 'development' });
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
  it('reports email as configured when every value is present', async () => {
    const { isEmailConfigured } = await loadTransport();
    expect(isEmailConfigured()).toBe(true);
  });

  it('reports email as not configured when the key is missing', async () => {
    setConfig({ RESEND_API_KEY: undefined });
    const { isEmailConfigured } = await loadTransport();
    expect(isEmailConfigured()).toBe(false);
  });

  it('names the missing variables instead of failing vaguely', async () => {
    setConfig({ RESEND_API_KEY: undefined, EMAIL_FROM_EMAIL: undefined });
    stubFetch();
    const { deliver } = await loadTransport();

    await expect(deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }))
      .rejects.toThrow(/RESEND_API_KEY, EMAIL_FROM_EMAIL/);
  });

  it('fails rather than pretending the message was sent', async () => {
    setConfig({ RESEND_API_KEY: undefined });
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);
    expectAppError(err);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the transport as resend when configured', async () => {
    const { activeTransport } = await loadTransport();
    expect(activeTransport()).toBe('resend');
  });

  it('reports none when nothing is configured', async () => {
    setConfig({ RESEND_API_KEY: undefined, EMAIL_FROM_EMAIL: undefined });
    const { activeTransport } = await loadTransport();
    expect(activeTransport()).toBe('none');
  });
});

describe('request construction', () => {
  it('posts to the Resend messages endpoint', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
  });

  it('authenticates with the API key as a bearer token', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('bounds the request so a hung call cannot consume the function budget', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(fetchMock.mock.calls[0]![1]!.signal).toBeDefined();
  });

  it('opens no connection to reuse, so repeated sends each post once', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
    await deliver({ to: 'c@d.com', subject: 's', html: 'h', text: 't' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('sending', () => {
  it('sends from the configured sender with its display name', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ to: 'john@utopiabrands.com', subject: 's', html: 'h', text: 't' });

    const body = sentBody(fetchMock);
    expect(body.from).toBe('Utopia Trucking Task Manager <taskmanager@utopiabrands.com>');
    expect(body.to).toEqual(['john@utopiabrands.com']);
  });

  it('preserves the subject, HTML and text the templates produced', async () => {
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({
      to: 'john@utopiabrands.com',
      subject: '[Utopia Trucking Task Manager] New task assigned: UT-1042',
      html: '<h1>Verify container</h1>',
      text: 'Verify container',
    });

    expect(sentBody(fetchMock)).toMatchObject({
      subject: '[Utopia Trucking Task Manager] New task assigned: UT-1042',
      html: '<h1>Verify container</h1>',
      text: 'Verify container',
    });
  });

  it('explains an unverified sender domain instead of just reporting 403', async () => {
    // The one failure that looks like a code bug and is not: the key is valid and
    // the config is complete, yet every send fails until a DNS record exists.
    stubFetch({
      status: 403,
      body: { statusCode: 403, name: 'validation_error', message: 'The utopiabrands.com domain is not verified.' },
    });
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expectAppError(err);
    expect(err.message).toMatch(/resend\.com\/domains/);
    expect(err.message).toMatch(/onboarding@resend\.dev/);
  });

  it('names a rejected API key rather than a generic failure', async () => {
    stubFetch({ status: 401, body: { statusCode: 401, name: 'validation_error', message: 'API key is invalid' } });
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expectAppError(err);
    expect(err.message).toMatch(/RESEND_API_KEY/);
  });

  it('reports a rate limit as not sent', async () => {
    stubFetch({ status: 429, body: { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests' } });
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expectAppError(err);
    expect(err.message).toMatch(/not sent/);
  });

  it('never puts the API key in the error surfaced to callers', async () => {
    stubFetch({ status: 500, body: { statusCode: 500, message: 'Internal error' } });
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expect(err.message).not.toContain(API_KEY);
  });

  it('treats a network failure as not sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expectAppError(err);
    expect(err.message).toMatch(/Could not reach Resend/);
  });

  it('writes to the in-memory mailbox under NODE_ENV=test instead of sending', async () => {
    setConfig({ NODE_ENV: 'test' });
    const fetchMock = stubFetch();
    const { deliver, __sentMessages, __resetMailbox } = await loadTransport();

    __resetMailbox();
    await deliver({ to: 'a@b.com', subject: 'captured', html: 'h', text: 't' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]!.subject).toBe('captured');
  });
});

describe('no dependency on a previous provider remains', () => {
  it('sends with no MICROSOFT_* or BREVO_* variable present', async () => {
    setConfig({
      MICROSOFT_TENANT_ID: undefined, MICROSOFT_CLIENT_ID: undefined,
      MICROSOFT_CLIENT_SECRET: undefined, MICROSOFT_SENDER_EMAIL: undefined,
      BREVO_SMTP_HOST: undefined, BREVO_SMTP_PORT: undefined,
      BREVO_SMTP_USER: undefined, BREVO_SMTP_PASSWORD: undefined,
      BREVO_SMTP_FROM_EMAIL: undefined, BREVO_SMTP_FROM_NAME: undefined,
    });
    const fetchMock = stubFetch();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
