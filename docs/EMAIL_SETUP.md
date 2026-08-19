# Email setup — Brevo SMTP

The Utopia Trucking Task Manager sends five kinds of mail: a task-assignment
notification, a 24-hour pending reminder, a task-expired notice, an account-created
message carrying a new member's temporary password, and the Monday digest.

All of it goes out over **Brevo SMTP** using `nodemailer`.

```
Task Manager  →  email service  →  Brevo SMTP relay  →  recipient
```

---

## 1. Get the SMTP credentials

In Brevo: **SMTP & API → SMTP**.

| Brevo field | Environment variable |
| --- | --- |
| SMTP server | `BREVO_SMTP_HOST` — `smtp-relay.brevo.com` |
| Port | `BREVO_SMTP_PORT` — `587` |
| Login | `BREVO_SMTP_USER` — looks like `b6xxxxx@smtp-brevo.com` |
| SMTP key | `BREVO_SMTP_PASSWORD` |

> The **SMTP key is the password**. It is not your Brevo account password, and it is not
> the same string as a Brevo *API* key (those start `xkeysib-`; SMTP keys start
> `xsmtpsib-`). Generate SMTP keys on the same page.

## 2. Verify the sender

`BREVO_SMTP_FROM_EMAIL` must be a sender Brevo has verified, under **Senders, Domains &
Dedicated IPs → Senders**. An unverified sender is rejected at send time even when
authentication succeeds.

For better deliverability, authenticate the whole domain (SPF + DKIM) rather than a
single address. Mail from an unauthenticated domain frequently lands in spam.

```
BREVO_SMTP_FROM_EMAIL=taskmanager@utopiabrands.com
BREVO_SMTP_FROM_NAME=Utopia Trucking Task Manager
```

## 3. Authorize sending IPs — read this before deploying

Brevo can restrict SMTP to an allow-list of IP addresses. When it is on and the caller's
address is not listed, authentication fails with:

```
525 5.7.1 Unauthorized IP address
```

That is an **IP** rejection, not a credential one — a wrong key gives `535 Authentication
failed` instead. The two are easy to confuse and lead you to re-copy a key that was
always correct.

Find it in Brevo under **SMTP & API → SMTP**, in the authorized-IPs / security panel.

**This matters more than it looks on a serverless deployment.** Vercel functions do not
have a stable outbound IP — it changes between invocations and regions, so there is no
address you could add to an allow-list that stays correct. If IP restriction is enabled,
production mail will fail unpredictably.

| Where you run | What to do |
| --- | --- |
| Local development | Add your current public IP, or disable the restriction |
| Vercel / any serverless host | **Disable the IP restriction** — dynamic egress IPs cannot be allow-listed |
| A fixed server or NAT gateway | Add that IP and keep the restriction on |

---

## 4. Environment variables

Local development — add to `.env` (gitignored, never committed):

```
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=
BREVO_SMTP_PASSWORD=
BREVO_SMTP_FROM_EMAIL=taskmanager@utopiabrands.com
BREVO_SMTP_FROM_NAME=Utopia Trucking Task Manager
```

Production — set the same six in **Project → Settings → Environment Variables**, scoped
to Production, then **redeploy**. Environment variables are read at process start, so
setting them without redeploying changes nothing.

`APP_URL` must also be correct, because every notification email links back to the task:

```
APP_URL=https://your-deployed-app.example.com
```

### Port and TLS

`secure` is derived from the port rather than configured separately: Brevo's relay uses
STARTTLS on **587** (connect plain, upgrade immediately) and implicit TLS only on **465**.
Setting `secure: true` against 587 makes the connection hang until it times out, which is
a slow and confusing way to find a one-character mistake.

---

## 5. Verify

With the six variables set, start the app and create a team member from
**Team → Add team member**. Watch the server log:

- Success — the new member receives the account email, and the dialog reports the
  password was emailed.
- Failure — the dialog says the email could not be sent and shows the temporary password
  so you can pass it on by hand. The SMTP reply appears in the log and on the
  `notifications` row's `last_error`.

### Common failures

| SMTP reply | Cause |
| --- | --- |
| `525 5.7.1 Unauthorized IP address` | IP restriction is on and this address is not authorized — see step 3 |
| `535 Authentication failed` | Wrong login or SMTP key. Check you copied the SMTP key, not an API key |
| Sender rejected / not allowed | `BREVO_SMTP_FROM_EMAIL` is not a verified sender in Brevo |
| Connection hangs, then times out | `secure: true` against port 587, or the port is blocked outbound |
| Daily limit reached | Brevo's free tier caps sends per day |

### Flushing mail that failed while email was down

Nothing queued is lost. Failed notifications are retried by the reminder job, which also
sweeps rows stuck in `pending`. Trigger it manually:

```bash
curl -X POST https://your-app.example.com/api/jobs/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Security notes

- No Brevo credential is ever sent to the frontend, returned from an API endpoint, or
  written to the database.
- The SMTP key is never logged. Failures log the recipient, the SMTP reply code and the
  command — enough to diagnose, and none of it secret.
- `.env` is gitignored. `.env.example` carries placeholders only.
- Rotate the SMTP key from **SMTP & API → SMTP** if it is ever exposed; old keys can be
  deleted there without affecting the account.

---

Created by Rizwan Hanif for Utopia Brands Trucking Team
