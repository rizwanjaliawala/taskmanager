# Email setup — Resend

Task assignments, reminders, expiry notices, weekly digests and new-account passwords
are all delivered by email.

All of it goes out over the **Resend HTTPS API**.

```
Task Manager  →  email service  →  https://api.resend.com/emails  →  recipient
```

## Why the API and not SMTP

Resend offers both. This app uses the HTTPS API because it runs as Vercel serverless
functions, including three cron jobs whose only purpose is sending mail:

- A short-lived function pays a fresh SMTP connect, TLS negotiation and AUTH on
  **every invocation**. There is no long-lived process to keep a connection warm.
- Outbound SMTP is widely throttled or blocked on serverless platforms.
- An HTTPS failure returns JSON naming the cause. An SMTP failure returns a reply
  code you have to look up.

If you ever need SMTP anyway, Resend's relay is `smtp.resend.com`, port `465`
(implicit TLS) or `587`/`2587` (STARTTLS), user `resend`, password = the API key.
That would mean reinstating `nodemailer`; nothing else about the app would change.

## 1. Get the API key

In Resend: **API Keys → Create API Key**. It starts with `re_`.

| Resend field | Environment variable |
|---|---|
| API key | `RESEND_API_KEY` |

The key is shown once. Store it in the password manager, not in a file that gets
committed.

## 2. Verify the sending domain — this is the step that catches people

`EMAIL_FROM_EMAIL` must be on a domain verified at **https://resend.com/domains**.

Add `utopiabrands.com`, publish the DKIM and SPF records Resend gives you with your DNS
provider, and wait for the status to read **verified**.

> **An unverified domain fails at send time, not at startup.** The app will report
> email as configured, the key will be valid, and every single message will be
> rejected with `403`. That failure looks like a bug in the application and is not
> one — nothing in the code can detect it in advance. `deliver()` maps that 403 to a
> message naming the domain and linking the dashboard, so the log tells you the truth.

### Testing before DNS is ready

Resend provides `onboarding@resend.dev` as a shared sender. It works with no domain
setup, but **it only delivers to the email address that owns the Resend account** —
anything else returns `403` with an empty body. It is enough to prove the key and the
transport work; it is not enough to email your team.

## 3. Configure

```dotenv
RESEND_API_KEY=re_...
EMAIL_FROM_EMAIL=taskmanager@utopiabrands.com
EMAIL_FROM_NAME=Utopia Trucking Task Manager
```

The `EMAIL_FROM_*` names are deliberately provider-neutral. The sender identity
outlives whichever service delivers it, and this is already the second provider.

On Vercel these go in **Project → Settings → Environment Variables**, for Production.
Redeploy after adding them: a running deployment does not pick up new variables.

## 4. Confirm it works

`activeTransport()` reports which path a real send would take:

| Value | Meaning |
|---|---|
| `test` | `NODE_ENV=test` — messages go to an in-memory mailbox, nothing is sent |
| `resend` | `RESEND_API_KEY` and `EMAIL_FROM_EMAIL` are both set |
| `none` | Not configured; `deliver()` throws rather than silently dropping mail |

## Failure modes

`deliver()` never returns quietly on failure. `fanOut()` in `src/lib/email/index.ts`
records the outcome per recipient, so a failure becomes a retryable row rather than a
lost email — which is why the dashboard can show notification events for messages that
never arrived.

| Status | Cause |
|---|---|
| `403` with a domain message | `EMAIL_FROM_EMAIL` is on a domain not verified in Resend |
| `403` with an empty body | Sending from `onboarding@resend.dev` to anyone but the account owner |
| `401` | `RESEND_API_KEY` is wrong, revoked, or from a different account |
| `429` | Rate limited. The message was not sent |
| `Could not reach Resend` | Network failure or the 15s timeout elapsed; nothing was sent |

## What the API key can do

A Resend API key can send mail as any verified domain on the account and read the
account's domain list. Treat it as a production credential: rotate it if it is ever
pasted into a chat, a ticket or a screenshot, from **API Keys → the key → Delete**,
then create a replacement and update `RESEND_API_KEY` everywhere.
