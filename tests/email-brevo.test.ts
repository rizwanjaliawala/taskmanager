import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests exercise the Brevo SMTP transport directly.
 *
 * `deliver()` short-circuits to the in-memory mailbox whenever NODE_ENV=test — that is
 * what stops the rest of the suite sending real mail — so testing the SMTP path means
 * calling into the transport module with NODE_ENV forced to something else and
 * nodemailer stubbed. Nothing here opens a socket.
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

const CONFIG = {
  BREVO_SMTP_HOST: 'smtp-relay.brevo.com',
  BREVO_SMTP_PORT: '587',
  BREVO_SMTP_USER: 'test-login@smtp-brevo.com',
  BREVO_SMTP_PASSWORD: 'test-smtp-key-value',
  BREVO_SMTP_FROM_EMAIL: 'taskmanager@utopiabrands.com',
  BREVO_SMTP_FROM_NAME: 'Utopia Trucking Task Manager',
};

const saved: Record<string, string | undefined> = {};

function setConfig(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Captures what nodemailer was asked to do, without touching the network. */
function stubNodemailer(sendImpl?: (opts: any) => Promise<any>) {
  const sendMail = vi.fn(sendImpl ?? (async (_opts?: any) => ({ messageId: '<stub@brevo>' })));
  // The parameter is declared so mock.calls entries are typed as the options object.
  const createTransport = vi.fn((_opts?: any) => ({ sendMail }));
  vi.doMock('nodemailer', () => ({ default: { createTransport }, createTransport }));
  return { createTransport, sendMail };
}

/** env.ts snapshots process.env at import, so the module graph must be re-imported. */
async function loadTransport() {
  vi.resetModules();
  return import('../src/lib/email/transport.js');
}

beforeEach(() => {
  setConfig(CONFIG);
  // Leave test mode so `deliver` takes the real SMTP path rather than the mailbox.
  setConfig({ NODE_ENV: 'development' });
});

afterEach(() => {
  vi.doUnmock('nodemailer');
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
});

describe('configuration', () => {
  it('reports Brevo as configured when every value is present', async () => {
    const { isBrevoConfigured } = await loadTransport();
    expect(isBrevoConfigured()).toBe(true);
  });

  it('reports Brevo as not configured when a value is missing', async () => {
    setConfig({ BREVO_SMTP_PASSWORD: undefined });
    const { isBrevoConfigured } = await loadTransport();
    expect(isBrevoConfigured()).toBe(false);
  });

  it('names the missing variables instead of failing vaguely', async () => {
    setConfig({ BREVO_SMTP_USER: undefined, BREVO_SMTP_FROM_EMAIL: undefined });
    stubNodemailer();
    const { deliver } = await loadTransport();

    await expect(deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }))
      .rejects.toThrow(/BREVO_SMTP_USER, BREVO_SMTP_FROM_EMAIL/);
  });

  it('fails rather than pretending the message was sent', async () => {
    setConfig({ BREVO_SMTP_PASSWORD: undefined });
    const { sendMail } = stubNodemailer();
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);
    expectAppError(err);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('reports the transport as brevo when configured', async () => {
    const { activeTransport } = await loadTransport();
    expect(activeTransport()).toBe('brevo');
  });

  it('reports none when nothing is configured', async () => {
    setConfig({ BREVO_SMTP_USER: undefined, BREVO_SMTP_PASSWORD: undefined });
    const { activeTransport } = await loadTransport();
    expect(activeTransport()).toBe('none');
  });
});

describe('transport construction', () => {
  it('connects to the configured Brevo relay with the SMTP key as the password', async () => {
    const { createTransport } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp-relay.brevo.com',
      port: 587,
      auth: { user: CONFIG.BREVO_SMTP_USER, pass: CONFIG.BREVO_SMTP_PASSWORD },
    }));
  });

  it('uses STARTTLS on 587, not implicit TLS', async () => {
    // secure:true on 587 makes the connection hang until timeout — a confusing way
    // to discover a one-character config mistake.
    const { createTransport } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(createTransport.mock.calls[0]![0]).toMatchObject({ secure: false });
  });

  it('uses implicit TLS on 465', async () => {
    setConfig({ BREVO_SMTP_PORT: '465' });
    const { createTransport } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(createTransport.mock.calls[0]![0]).toMatchObject({ port: 465, secure: true });
  });

  it('builds the transporter once and reuses it across sends', async () => {
    const { createTransport } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
    await deliver({ to: 'c@d.com', subject: 's', html: 'h', text: 't' });
    await deliver({ to: 'e@f.com', subject: 's', html: 'h', text: 't' });

    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});

describe('sending', () => {
  it('sends from the configured Brevo sender with its display name', async () => {
    const { sendMail } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({ to: 'john@utopiabrands.com', subject: 's', html: 'h', text: 't' });

    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      from: '"Utopia Trucking Task Manager" <taskmanager@utopiabrands.com>',
      to: 'john@utopiabrands.com',
    });
  });

  it('preserves the subject, HTML and text the templates produced', async () => {
    const { sendMail } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({
      to: 'john@utopiabrands.com',
      subject: '[Utopia Trucking Task Manager] New task assigned: UT-1042',
      html: '<h1>Verify container</h1>',
      text: 'Verify container',
    });

    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      subject: '[Utopia Trucking Task Manager] New task assigned: UT-1042',
      html: '<h1>Verify container</h1>',
      text: 'Verify container',
    });
  });

  it('surfaces an SMTP rejection with its reply code', async () => {
    stubNodemailer(async () => {
      const e: any = new Error('Invalid login: 535 Authentication failed');
      e.responseCode = 535;
      e.command = 'AUTH PLAIN';
      throw e;
    });
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expectAppError(err);
    expect(err.message).toContain('535');
  });

  it('never puts the SMTP password in the error surfaced to callers', async () => {
    stubNodemailer(async () => {
      const e: any = new Error('Invalid login: 535 Authentication failed');
      e.responseCode = 535;
      throw e;
    });
    const { deliver } = await loadTransport();

    const err = await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);

    expect(err.message).not.toContain(CONFIG.BREVO_SMTP_PASSWORD);
  });

  it('writes to the in-memory mailbox under NODE_ENV=test instead of sending', async () => {
    setConfig({ NODE_ENV: 'test' });
    const { sendMail } = stubNodemailer();
    const { deliver, __sentMessages, __resetMailbox } = await loadTransport();

    __resetMailbox();
    await deliver({ to: 'a@b.com', subject: 'captured', html: 'h', text: 't' });

    expect(sendMail).not.toHaveBeenCalled();
    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]!.subject).toBe('captured');
  });
});

describe('no Microsoft dependency remains', () => {
  it('sends without any MICROSOFT_* variable present', async () => {
    setConfig({
      MICROSOFT_TENANT_ID: undefined, MICROSOFT_CLIENT_ID: undefined,
      MICROSOFT_CLIENT_SECRET: undefined, MICROSOFT_SENDER_EMAIL: undefined,
    });
    const { sendMail } = stubNodemailer();
    const { deliver } = await loadTransport();

    await deliver({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
