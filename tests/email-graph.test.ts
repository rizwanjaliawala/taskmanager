import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.resetModules()` re-imports the module graph, so the AppError class thrown inside
 * graph.js is a different class object from one imported here — `instanceof` would
 * always be false. Assert on the error's shape, which is what callers rely on anyway.
 */
function expectAppError(err: any, code = 'EMAIL_FAILED') {
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('AppError');
  expect(err.code).toBe(code);
  return err;
}

/*
 * These tests exercise the Microsoft Graph transport directly.
 *
 * `deliver()` short-circuits to the in-memory mailbox whenever NODE_ENV=test, which is
 * what keeps the rest of the suite from sending real mail — so to test Graph at all we
 * have to call `sendViaGraph`/`getAccessToken` themselves and stub `fetch`. Nothing here
 * touches the network: every assertion is against a stubbed global fetch.
 */

const CONFIG = {
  MICROSOFT_TENANT_ID: 'test-tenant-id',
  MICROSOFT_CLIENT_ID: 'test-client-id',
  MICROSOFT_CLIENT_SECRET: 'test-client-secret',
  MICROSOFT_SENDER_EMAIL: 'tasks@utopiabrands.com',
};

const saved: Record<string, string | undefined> = {};

function setConfig(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** env.ts snapshots process.env at import, so the module graph must be re-imported. */
async function loadGraph() {
  vi.resetModules();
  return import('../src/lib/email/graph.js');
}

const tokenResponse = (expiresIn = 3600) => ({
  ok: true, status: 200,
  json: async () => ({ access_token: 'stub-access-token', expires_in: expiresIn }),
});

beforeEach(() => setConfig(CONFIG));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
});

describe('configuration', () => {
  it('reports Graph as configured when every value is present', async () => {
    const { isGraphConfigured } = await loadGraph();
    expect(isGraphConfigured()).toBe(true);
  });

  it('reports Graph as not configured when a value is missing', async () => {
    setConfig({ MICROSOFT_CLIENT_SECRET: undefined });
    const { isGraphConfigured } = await loadGraph();
    expect(isGraphConfigured()).toBe(false);
  });

  it('names the missing variables instead of failing vaguely', async () => {
    setConfig({ MICROSOFT_CLIENT_SECRET: undefined, MICROSOFT_SENDER_EMAIL: undefined });
    const { sendViaGraph } = await loadGraph();

    await expect(sendViaGraph({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }))
      .rejects.toThrow(/MICROSOFT_CLIENT_SECRET, MICROSOFT_SENDER_EMAIL/);
  });

  it('fails rather than pretending the message was sent', async () => {
    setConfig({ MICROSOFT_TENANT_ID: undefined });
    const { sendViaGraph } = await loadGraph();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const err = await sendViaGraph({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);
    expectAppError(err);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('token acquisition', () => {
  it('requests a client-credentials token for the .default scope', async () => {
    const fetchMock = vi.fn(async (_url?: any, _init?: any) => tokenResponse() as any);
    vi.stubGlobal('fetch', fetchMock);

    const { getAccessToken } = await loadGraph();
    expect(await getAccessToken()).toBe('stub-access-token');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token');
    const body = String((init as any).body);
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
  });

  it('caches the token instead of re-authenticating per message', async () => {
    const fetchMock = vi.fn(async (_url?: any, _init?: any) => tokenResponse() as any);
    vi.stubGlobal('fetch', fetchMock);

    const { getAccessToken } = await loadGraph();
    await getAccessToken();
    await getAccessToken();
    await getAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    // The reminder job sends in a loop; without sharing, each send mints its own token.
    const fetchMock = vi.fn(async (_url?: any, _init?: any) => tokenResponse() as any);
    vi.stubGlobal('fetch', fetchMock);

    const { getAccessToken } = await loadGraph();
    await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-authenticates once the cached token is close to expiry', async () => {
    // 30s lifetime is inside the 60s skew, so it must never be reused.
    const fetchMock = vi.fn(async (_url?: any, _init?: any) => tokenResponse(30) as any);
    vi.stubGlobal('fetch', fetchMock);

    const { getAccessToken } = await loadGraph();
    await getAccessToken();
    await getAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces Entra ID errors without leaking the client secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401,
      json: async () => ({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }),
    })) as any);

    const { getAccessToken } = await loadGraph();
    const err = await getAccessToken().catch((e) => e);

    expectAppError(err);
    expect(err.message).toContain('AADSTS7000215');
    expect(err.message).not.toContain(CONFIG.MICROSOFT_CLIENT_SECRET);
  });
});

describe('sendMail', () => {
  function stubSuccess() {
    const fetchMock = vi.fn(async (url: any, _init?: any) =>
      String(url).includes('/oauth2/') ? tokenResponse() : { status: 202, ok: true, json: async () => ({}) },
    );
    vi.stubGlobal('fetch', fetchMock as any);
    return fetchMock;
  }

  it('posts to sendMail for the configured sender mailbox', async () => {
    const fetchMock = stubSuccess();
    const { sendViaGraph } = await loadGraph();

    await sendViaGraph({ to: 'john@utopiabrands.com', subject: 'Task assigned', html: '<b>hi</b>', text: 'hi' });

    const send = fetchMock.mock.calls.find((c) => String(c[0]).includes('/sendMail'))!;
    expect(String(send[0]))
      .toBe('https://graph.microsoft.com/v1.0/users/tasks%40utopiabrands.com/sendMail');
    expect((send[1] as any).headers.Authorization).toBe('Bearer stub-access-token');
  });

  it('preserves the subject and HTML body the templates produced', async () => {
    const fetchMock = stubSuccess();
    const { sendViaGraph } = await loadGraph();

    await sendViaGraph({
      to: 'john@utopiabrands.com',
      subject: '[Utopia Trucking Task Manager] New task assigned: UT-1042',
      html: '<h1>Verify container</h1>', text: 'Verify container',
    });

    const send = fetchMock.mock.calls.find((c) => String(c[0]).includes('/sendMail'))!;
    const body = JSON.parse(String((send[1] as any).body));
    expect(body.message.subject).toBe('[Utopia Trucking Task Manager] New task assigned: UT-1042');
    expect(body.message.body.contentType).toBe('HTML');
    expect(body.message.body.content).toBe('<h1>Verify container</h1>');
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'john@utopiabrands.com' } }]);
  });

  it('carries cc and bcc through when supplied', async () => {
    const fetchMock = stubSuccess();
    const { sendViaGraph } = await loadGraph();

    await sendViaGraph({
      to: 'a@utopiabrands.com', subject: 's', html: 'h', text: 't',
      cc: ['b@utopiabrands.com'], bcc: ['c@utopiabrands.com'],
    });

    const send = fetchMock.mock.calls.find((c) => String(c[0]).includes('/sendMail'))!;
    const body = JSON.parse(String((send[1] as any).body));
    expect(body.message.ccRecipients).toEqual([{ emailAddress: { address: 'b@utopiabrands.com' } }]);
    expect(body.message.bccRecipients).toEqual([{ emailAddress: { address: 'c@utopiabrands.com' } }]);
  });

  it('omits cc and bcc entirely when not supplied', async () => {
    const fetchMock = stubSuccess();
    const { sendViaGraph } = await loadGraph();

    await sendViaGraph({ to: 'a@utopiabrands.com', subject: 's', html: 'h', text: 't' });

    const send = fetchMock.mock.calls.find((c) => String(c[0]).includes('/sendMail'))!;
    const body = JSON.parse(String((send[1] as any).body));
    expect(body.message).not.toHaveProperty('ccRecipients');
    expect(body.message).not.toHaveProperty('bccRecipients');
  });

  it('treats 202 Accepted as success', async () => {
    stubSuccess();
    const { sendViaGraph } = await loadGraph();
    await expect(sendViaGraph({ to: 'a@b.com', subject: 's', html: 'h', text: 't' })).resolves.toBeUndefined();
  });

  it('reports a Graph rejection with its error code', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, _init?: any) =>
      String(url).includes('/oauth2/') ? tokenResponse() : ({
        ok: false, status: 403, statusText: 'Forbidden',
        json: async () => ({ error: { code: 'ErrorAccessDenied', message: 'Access to OData is disabled.' } }),
      }),
    ) as any);

    const { sendViaGraph } = await loadGraph();
    const err = await sendViaGraph({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expectAppError(err);
    expect(err.message).toContain('ErrorAccessDenied');
  });

  it('drops the cached token after a 401 so the next attempt re-authenticates', async () => {
    let sendCalls = 0;
    const fetchMock = vi.fn(async (url: any, _init?: any) => {
      if (String(url).includes('/oauth2/')) return tokenResponse() as any;
      sendCalls++;
      return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) } as any;
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const { sendViaGraph } = await loadGraph();
    await sendViaGraph({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch(() => {});
    await sendViaGraph({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch(() => {});

    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/oauth2/')).length;
    expect(sendCalls).toBe(2);
    expect(tokenCalls).toBe(2); // not reusing the token Graph just refused
  });
});
