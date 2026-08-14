# Email setup — Microsoft Graph

The Utopia Trucking Task Manager sends four kinds of mail: a task-assignment
notification, a 24-hour pending reminder, a task-expired notice, and an account-created
message carrying a new member's temporary password.

All of it goes out through **Microsoft Graph**, authenticating as the application with
OAuth 2.0 client credentials.

```
Task Manager  →  email service  →  Microsoft Graph  →  Microsoft 365  →  recipient
```

---

## Important: an AI assistant's Microsoft 365 connection is not this

If you have connected a Microsoft 365 account to an AI assistant such as Claude, **that
connection is not available to this application**. It is a separate credential, held by
a different system, scoped to that assistant's own session.

The deployed backend authenticates to Microsoft Graph on its own, using an app
registration you create in your tenant. That is what the rest of this document sets up.

---

## 1. Register the application in Microsoft Entra ID

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as an
   account that can create app registrations and grant admin consent.
2. **Identity → Applications → App registrations → New registration**.
3. Name it something recognisable, e.g. `Utopia Trucking Task Manager`.
4. **Supported account types:** *Accounts in this organizational directory only*
   (single tenant).
5. Leave the redirect URI blank — this is a daemon application with no interactive
   sign-in.
6. Register.

From the **Overview** page, copy:

| Portal field | Environment variable |
| --- | --- |
| Directory (tenant) ID | `MICROSOFT_TENANT_ID` |
| Application (client) ID | `MICROSOFT_CLIENT_ID` |

## 2. Create a client secret

1. **Certificates & secrets → Client secrets → New client secret**.
2. Give it a description and an expiry. Note the expiry date — **mail silently stops
   working when a secret expires**, so put a calendar reminder a week before.
3. Copy the secret **Value** (not the Secret ID) immediately; the portal never shows it
   again.

Set it as `MICROSOFT_CLIENT_SECRET`.

> Certificate credentials are more robust than secrets for long-lived production use
> because they can be rotated without downtime. The current implementation uses a client
> secret; moving to a certificate would only change `src/lib/email/graph.ts`.

## 3. Grant the Mail.Send application permission

1. **API permissions → Add a permission → Microsoft Graph**.
2. Choose **Application permissions** — *not* Delegated. Delegated permissions require a
   signed-in user, and this backend sends unattended mail from cron jobs.
3. Select **`Mail.Send`**.
4. Add the permission, then click **Grant admin consent for &lt;tenant&gt;**. The status
   column must read *Granted*. Without consent every send fails with
   `ErrorAccessDenied`.

That is the only Graph permission required. Do not add `Mail.ReadWrite` or
`User.Read.All` — the application neither reads mail nor enumerates directory users.

## 4. Choose the sender mailbox

Set `MICROSOFT_SENDER_EMAIL` to the mailbox all notifications should come from, for
example `tasks@utopiabrands.com`. It must be a real, licensed mailbox (or a shared
mailbox) in the same tenant.

### Restrict which mailboxes the app can send as — recommended

`Mail.Send` as an *application* permission grants send-as rights over **every mailbox in
the tenant**. Scope it down to the one mailbox with an application access policy. In
Exchange Online PowerShell:

```powershell
New-ApplicationAccessPolicy `
  -AppId <MICROSOFT_CLIENT_ID> `
  -PolicyScopeGroupId tasks@utopiabrands.com `
  -AccessRight RestrictAccess `
  -Description "Utopia Trucking Task Manager may send only as the tasks mailbox"
```

Verify it with `Test-ApplicationAccessPolicy -Identity tasks@utopiabrands.com -AppId <client id>`.
Policy changes can take up to 30 minutes to take effect.

---

## 5. Environment variables

Local development — add to `.env` (gitignored, never committed):

```
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_SENDER_EMAIL=tasks@utopiabrands.com
```

Production — set the same four in your hosting provider's environment settings. On
Vercel: **Project → Settings → Environment Variables**, scoped to Production. Redeploy
after changing them; environment variables are read at process start.

`APP_URL` must also be correct, because every notification email links back to the task:

```
APP_URL=https://your-deployed-app.example.com
```

### The legacy SMTP variables

`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USERNAME`, `EMAIL_PASSWORD` and
`EMAIL_FROM` remain in the configuration as a fallback. They are used **only** when the
`MICROSOFT_*` values are absent. Leave `EMAIL_USERNAME` and `EMAIL_PASSWORD` blank to
require Graph.

If neither transport is configured, the application does **not** pretend to send. It
raises a configuration error, the notification row is recorded as `failed`, and the
retry sweep picks it up once credentials are in place.

---

## 6. Verify

With the four variables set, start the app and create a team member from
**Team → Add team member**. Watch the server log:

- Success — the new member receives the account email, and the dialog reports the
  password was emailed.
- Failure — the dialog says the email could not be sent and shows the temporary password
  so you can pass it on by hand. The reason appears in the log and on the
  `notifications` row's `last_error`.

### Common failures

| Symptom | Cause |
| --- | --- |
| `AADSTS7000215: Invalid client secret provided` | Wrong secret, or the Secret **ID** was copied instead of the **Value** |
| `AADSTS700016: Application not found in the directory` | Wrong `MICROSOFT_CLIENT_ID`, or the app lives in a different tenant |
| `ErrorAccessDenied` | Admin consent was never granted, or the permission was added as Delegated rather than Application |
| `ErrorInvalidUser` / mailbox not found | `MICROSOFT_SENDER_EMAIL` is not a real mailbox in this tenant |
| `ErrorAccessDenied` only for some mailboxes | An application access policy is scoping the app more narrowly than the sender you configured |
| Worked, then stopped | The client secret expired |

### Flushing mail that failed while email was down

Nothing queued is lost. Failed notifications are retried by the reminder job, which also
sweeps rows stuck in `pending`. Trigger it manually:

```bash
curl -X POST https://your-app.example.com/api/jobs/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Security notes

- No Microsoft credential is ever sent to the frontend, returned from an API endpoint,
  or written to the database.
- Access tokens are held in memory only, cached until shortly before expiry, and dropped
  if Graph rejects them. They are never persisted.
- The client secret is never logged. Entra's `error_description` is surfaced because it
  names the misconfiguration and contains no secret material.
- `.env` is gitignored. `.env.example` carries placeholders only.

---

Created by Rizwan Hanif for Utopia Brands Trucking Team
