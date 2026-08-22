import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Teams notification behaviour.
 *
 * The load-bearing property is that this NEVER throws: it runs after the assignment
 * has already committed and after the emails have been recorded, so an exception here
 * would turn a Teams outage into a failed assignment.
 */

const WEBHOOK = 'https://prod-00.westus.logic.azure.com/workflows/stub/triggers/manual/paths/invoke';

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
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => response?.body ?? '',
  }) as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentCard(fetchMock: ReturnType<typeof stubFetch>) {
  return JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
}

async function loadNotify() {
  vi.resetModules();
  return import('../src/lib/teams/notify.js');
}

const CTX = {
  ref: 'UT-1042',
  title: 'Verify container CMAU9822570',
  description: null,
  priority: 'high' as const,
  status: 'pending' as const,
  dueAt: new Date('2026-08-20T17:00:00.000Z'),
  assignedByName: 'Rizwan Hanif',
  assignedToName: 'Faris Ahmed',
  assignedByEmail: 'rizwan@example.test',
  assignedToEmail: 'faris@example.test',
  taskUrl: 'https://example.test/#task/UT-1042',
};

beforeEach(() => {
  setConfig({ TEAMS_WEBHOOK_URL: WEBHOOK });
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
  it('reports configured when the webhook URL is set', async () => {
    const { isTeamsConfigured } = await loadNotify();
    expect(isTeamsConfigured()).toBe(true);
  });

  it('is simply off when no webhook is configured, and posts nothing', async () => {
    setConfig({ TEAMS_WEBHOOK_URL: undefined });
    const fetchMock = stubFetch();
    const { isTeamsConfigured, notifyAssignment } = await loadNotify();

    expect(isTeamsConfigured()).toBe(false);
    await expect(notifyAssignment(CTX as any)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the payload', () => {
  it('posts to the configured webhook', async () => {
    const fetchMock = stubFetch();
    const { notifyAssignment } = await loadNotify();

    await notifyAssignment(CTX as any);

    expect(fetchMock.mock.calls[0]![0]).toBe(WEBHOOK);
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
  });

  /* The flow reads exactly content.body[0].text and posts it verbatim. Anything the
     chat must show has to be inside that one string — a second TextBlock is invisible. */
  it('puts the whole chat message in the single block the flow reads', async () => {
    const fetchMock = stubFetch();
    const { notifyAssignment } = await loadNotify();

    await notifyAssignment(CTX as any);

    const card = sentCard(fetchMock).attachments[0].content;
    expect(card.body).toHaveLength(1);

    const text = card.body[0].text;
    expect(text).toContain('UT-1042');
    expect(text).toContain('Faris Ahmed');
    expect(text).toContain('Rizwan Hanif');
    expect(text).toContain(CTX.taskUrl);
  });

  /* The trigger discards root-level properties, so these ride inside `content`.
     Each one is addressed by a flow expression; renaming any is a breaking change. */
  it('carries the fields the flow email action addresses', async () => {
    const fetchMock = stubFetch();
    const { notifyAssignment } = await loadNotify();

    await notifyAssignment(CTX as any);

    expect(sentCard(fetchMock).attachments[0].content).toMatchObject({
      assigneeName: 'Faris Ahmed',
      assigneeEmail: 'faris@example.test',
      assignerName: 'Rizwan Hanif',
      assignerEmail: 'rizwan@example.test',
      emailSubject: expect.stringContaining('UT-1042'),
    });
  });

  it('omits the due line entirely when the task has no due date', async () => {
    const fetchMock = stubFetch();
    const { notifyAssignment } = await loadNotify();

    await notifyAssignment({ ...CTX, dueAt: null } as any);

    expect(sentCard(fetchMock).attachments[0].content.body[0].text).not.toContain('Due:');
  });

  it('sends an adaptive card in the envelope both webhook flavours accept', async () => {
    const fetchMock = stubFetch();
    const { notifyAssignment } = await loadNotify();

    await notifyAssignment(CTX as any);

    const payload = sentCard(fetchMock);
    expect(payload.type).toBe('message');
    expect(payload.attachments[0].contentType)
      .toBe('application/vnd.microsoft.card.adaptive');
  });
});

describe('failure is contained', () => {
  it('reports failure rather than throwing when the flow rejects', async () => {
    stubFetch({ status: 400, body: 'Flow run failed' });
    const { notifyAssignment } = await loadNotify();

    await expect(notifyAssignment(CTX as any)).resolves.toBe(false);
  });

  it('reports failure rather than throwing when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    const { notifyAssignment } = await loadNotify();

    // An exception here would turn a Teams outage into a failed assignment.
    await expect(notifyAssignment(CTX as any)).resolves.toBe(false);
  });

  it('bounds the request so a hung flow cannot consume the function budget', async () => {
    const fetchMock = stubFetch();
    const { notifyAssignment } = await loadNotify();

    await notifyAssignment(CTX as any);

    expect(fetchMock.mock.calls[0]![1]!.signal).toBeDefined();
  });
});
