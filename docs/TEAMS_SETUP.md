# Teams notifications

When a task is assigned, the app posts an Adaptive Card into a Teams group chat
naming the assignee and the assigner, with a link to the task.

```
Task assigned  ──►  emails to assignee + assigner   (per person, tracked, retried)
               └─►  one card into a Teams chat      (broadcast, best effort)
```

## Teams is not a replacement for email

They are deliberately different, and the difference is load-bearing:

| | Email | Teams |
|---|---|---|
| Granularity | One message per person | One card into a shared chat |
| Tracked | A notification row per recipient | Not tracked |
| Retried | Yes, by the reminder sweep | No |
| On failure | Row marked `failed` | Logged, ignored |

`notifyAssignment()` **never throws.** It runs after the assignment has already
committed and after the emails have been recorded, so an exception there would turn a
Teams outage into a failed assignment. If Teams ever needs email's reliability, it
needs its own notification rows keyed per recipient — do not bolt retries onto the
current function.

## Why a webhook and not Microsoft Graph

Sending a chat message **as an application** is heavily restricted in Graph; it wants
a signed-in user. Going that route would mean an Azure app registration and admin
consent.

A Power Automate flow runs as **whoever created it**, which is what makes posting into
a group chat possible at all, and needs no app registration.

The flow still posts as **Flow bot**, so the message carries the bot's identity rather
than the creator's. The creator's account is only what authorises the flow to reach
that chat — it is not the visible sender.

## Target chat

Notifications go to **Trucking USA + Canada** (10 members).

```
Chat ID: 19:d17bac3b60bc4f4c8e38c50167294081@thread.v2
```

The chat is chosen **in the flow, not in this app** — the app only POSTs to a URL.
Changing the destination means editing the flow, not redeploying.

## Setting up the flow

1. Go to <https://make.powerautomate.com> → **Create → Instant cloud flow**.
2. Trigger: **When an HTTP request is received**.
3. Set **Who can trigger the flow?** to **Anyone**.

   This one is load-bearing. The default is *Any user in my tenant*, which makes the
   trigger demand an Entra ID bearer token on every call. The app is a server with no
   signed-in user and no token, so every POST comes back **401**. Obtaining such a
   token would need an Azure app registration — the exact thing using a flow avoids.

   *Anyone* is less permissive than it reads: the generated URL carries a SAS
   signature (`&sig=...`), so holding the URL **is** the credential. That is why it
   belongs in `TEAMS_WEBHOOK_URL` and never in the repository.

4. Leave the request schema empty.

   **A flow does not forward the request body.** Unlike a legacy Incoming Webhook, it
   does nothing with the payload until an action explicitly references it — a flow with
   `hello` typed into its message box posts `hello` forever, whatever you send.

   Worse, the **When a Teams webhook request is received** trigger validates the body
   against the Teams message envelope and **discards anything outside it**. A
   root-level `text` property does not survive; only what sits inside
   `attachments[0].content` reaches the actions. That is why `notify.ts` puts the
   application fields inside the card object rather than beside it.

5. Add action: **Microsoft Teams → Post message in a chat or channel**.
   - Post as: **Flow bot**
   - Post in: **Group chat**
   - Group chat: **Trucking USA + Canada**
   - Message: enter this via the **Expression** (`fx`) tab, not Dynamic content —
     the picker cannot index into an array, so the field never appears there:

     ```
     triggerOutputs()?['body']?['attachments'][0]?['content']?['body'][0]?['text']
     ```

     It must insert as a coloured chip. Pasted as plain characters it is stored as a
     literal string, which renders as an empty message — indistinguishable from a
     wrong path, and the single most time-consuming mistake to diagnose.

   **Flow bot, not User.** Posting as User makes every notification appear to come
   from whoever created the flow, as though they had typed it — which is misleading
   the first time somebody replies to it expecting a person. Flow bot posts under its
   own identity, so the message reads as automation.

   The flow's owner must be a member of the group chat for the bot to post into it.
   If the tenant blocks Flow bot in group chats, the fallbacks in order of preference
   are: post to a **channel** instead (Flow bot is always allowed there), or fall back
   to **User** and accept the attribution.
6. **Save.** The HTTP URL field reads "URL will be generated after save" and stays
   empty until you do — there is nothing to copy before this point.
7. Copy the **HTTP URL** from the trigger, whole, including `?api-version=...&sig=...`.
8. Set it as `TEAMS_WEBHOOK_URL`, locally and in Vercel, then redeploy.
9. Verify with `npm run teams:test`, which posts one sample card marked `TEST-0000`.

> The flow URL contains its own signature and is a credential. Anyone holding it can
> post into that chat. Keep it out of the repository; it belongs in `.env` and Vercel's
> environment settings.

## Configuration

```dotenv
TEAMS_WEBHOOK_URL=https://prod-00.westus.logic.azure.com/workflows/.../invoke?...
```

Unset simply means no Teams post. Email is unaffected either way — the app does not
treat a missing Teams config as an error, because it is a legitimate state.

## One flow, two actions, branched on `kind`

Everything goes through this one webhook — the chat message **and** all five emails
(assignment, reminder, expiry, weekly digest, account-created). The app holds no mail
credentials; the flow's **Send an email (V2)** action does the sending.

Both actions hang off the single trigger, so the flow needs a **Condition** to decide
which one runs:

```
Condition:  triggerOutputs()?['body']?['attachments'][0]?['content']?['kind']
            is equal to  email

  If yes →  Send an email (V2)
  If no  →  Post message in a chat or channel
```

`kind` is `assignment` for the chat message and `email` for everything else.

> **The Condition is load-bearing.** Without it every email is also posted into the
> group chat. The account-created mail contains a new member's temporary password, so
> a missing Condition would put that password in front of everyone in the chat. The
> app defends against this too — for `kind: email` the chat block carries only
> `Email sent: <subject>`, never the body — but the Condition is the real control.

> **Run history retains message bodies.** Power Automate keeps each run's action
> inputs for 28 days, so anyone with access to the flow can read every email the app
> sends, including temporary passwords. A mail provider's API does not retain bodies
> this way. This was a deliberate trade for having no mail credentials in the app.

## Payload

The app posts the Teams message envelope. Everything the flow can reach lives inside
`attachments[0].content` — the trigger discards the rest.

```json
{
  "type": "message",
  "attachments": [{
    "contentType": "application/vnd.microsoft.card.adaptive",
    "content": {
      "type": "AdaptiveCard", "version": "1.4",
      "assigneeName": "…", "assigneeEmail": "…",
      "assignerName": "…", "assignerEmail": "…",
      "emailSubject": "…", "emailBody": "…",
      "body": [{ "type": "TextBlock", "text": "the whole chat message" }]
    }
  }]
}
```

The application fields are not Adaptive Card properties. They ride inside the card
because that object is the only part of the request the trigger forwards untouched.

All expressions are prefixed `triggerOutputs()?['body']?['attachments'][0]?['content']`.

| Flow field | Expression | Present when |
|---|---|---|
| Condition | `?['kind']` | always |
| Chat message | `?['body'][0]?['text']` | always |
| Email **To** | `?['assigneeEmail']` | `kind: assignment` |
| Email **Cc** | `?['assignerEmail']` | `kind: assignment` |
| Email **To** | `?['emailTo']` | `kind: email` |
| Email **Subject** | `?['emailSubject']` | both |
| Email **Body** | `?['emailBody']` | both |

The assignment payload addresses its own email (assignee in **To**, task creator in
**Cc**). Every other email is addressed one recipient at a time via `emailTo`, because
the app fans out per person and records each one against its own notification row.

The chat message is one string in a single `TextBlock`. A second block would be
invisible — the flow reads index `0` and nothing else.

`emailBody` uses `<br>` line breaks because **Send an email (V2)** renders HTML; the
chat message uses real newlines because that field escapes HTML. The same text needs
both forms, which is why the payload carries it twice.

## @mentions

The card names people as text, not as real `@mentions`. A genuine mention needs an
`msteams.entities` block carrying each person's Azure AD object id — which the app
does not have, since it stores its own users, not directory objects.

If mentions matter, do it in the flow: look the person up by email with the
**Office 365 Users** connector and build the mention there. That keeps directory
lookups out of this codebase, where they would need Graph permissions all over again.

## Failure modes

| Symptom | Cause |
|---|---|
| Nothing posts, no error | `TEAMS_WEBHOOK_URL` unset — check the log for a Teams line at all |
| `400 WorkflowTriggerIsNotEnabled` | The flow is off, or auto-suspended after repeated failures. Turn it on; if it re-suspends, repair the Teams connection first |
| `401 DirectApiAuthorizationRequired` | **Who can trigger the flow?** is *Any user in my tenant*. Set it to **Anyone** and re-copy the URL — only then does it carry `&sp=&sv=&sig=` |
| Message arrives **blank** | The message expression resolves to null. Either it was pasted as literal text instead of committed as an expression, or its path does not match the payload |
| Message arrives as **raw JSON** | The expression points at `content` (an object) while the action expects a string. Go one level deeper, to `['body'][0]?['text']` |
| A different flow than expected responds | Two flows exist in the environment. Compare the workflow id in the URL against the one in the error text |
| `400 Flow run failed` | Flow's Teams action misconfigured, usually the wrong chat or a missing permission |
| `401` on every call, URL looks complete | **Who can trigger the flow?** is set to *Any user in my tenant*. It must be **Anyone** — see step 3 |
| `401`/`403` | The flow URL's signature was truncated when copied. It must include the full `?api-version=...&sig=...` |
| Posts appear from a person, not a bot | The Teams action is set to **User**. Change it to **Flow bot** |
| Flow bot unavailable for group chats | Tenant policy. Post to a channel instead, or accept User attribution |
