# Teams @mentions for assignment notifications

**Date:** 2026-08-22
**Status:** Approved, not yet implemented

## Problem

Assignment notifications post into the **Trucking USA + Canada** Teams chat naming the
assignee and assigner as plain text. Nobody gets pinged, so the message is easy to miss
in a ten-person chat — which defeats the point of posting there at all.

A genuine Teams @mention needs an identifier the directory can resolve. The app stores
its own users, not directory objects, so it has no Azure AD object id for anybody.

## Constraint that makes this possible

App user emails are the same Microsoft 365 work accounts as in the tenant directory.
That means an email is a sufficient identifier, and the resolution can happen in the
Power Automate flow via the **Office 365 Users** connector — no Graph permissions, no
app registration, no admin consent.

## Approach

The app owns *what the message says*. The flow owns *who these people are in the
directory*.

The app sends message text containing placeholders plus the two emails. The flow
resolves each email to a mention token and substitutes it into the text before posting.

```
app                                   flow
───                                   ────
build text with                       Get @mention token (assignee email)
  {{MENTION_ASSIGNEE}}        ──►     Get @mention token (assigner email)
  {{MENTION_ASSIGNER}}                replace() both placeholders
+ assignedToEmail                     Post message in chat
+ assignedByEmail
```

### Rejected alternatives

**Flow composes the whole message.** Smaller app change, but message copy moves into
Power Automate — unversioned, unreviewable, and edited in a browser. Rejected because
the wording is product copy and belongs beside the email templates.

**App resolves Azure AD object ids.** Requires an app registration and admin consent,
the exact cost that choosing a flow was meant to avoid. Rejected.

## App changes

### Context type

`TaskEmailContext` is left unchanged. It deliberately carries no addresses — templates
receive a context object, never a database row, so no internal identifier leaks. Widening
it for a different subsystem's benefit would make every email template transitively
depend on fields only Teams uses.

`notify.ts` defines its own:

```ts
type TeamsAssignmentContext = TaskEmailContext & {
  assignedToEmail: string;
  assignedByEmail: string;
};
```

### Payload

The Adaptive Card is removed. The flow posts plain text, and a card cannot render these
placeholders — a card path left in place would post literal `{{MENTION_ASSIGNEE}}` into
the chat if anyone switched the flow back. Card construction is recoverable from git if
it is ever wanted.

```json
{
  "text": "{{MENTION_ASSIGNEE}} — <b>TSK-0412</b> assigned by {{MENTION_ASSIGNER}}<br>…",
  "assignedToEmail": "…",
  "assignedByEmail": "…"
}
```

Placeholders are `{{MENTION_ASSIGNEE}}` and `{{MENTION_ASSIGNER}}` exactly — the flow's
`replace()` expressions match them literally.

### Call site

`assignTask` already builds an `emailOf` map before delivering assignment emails, so the
two addresses are in scope. The call gains two lookups and no new query.

`notifyAssignment` keeps its current contract: it never throws and returns a boolean. All
new failure surface lives in the flow.

## Flow changes

1. Two **Get an @mention token for a user** actions, fed from
   `triggerBody()?['assignedToEmail']` and `triggerBody()?['assignedByEmail']`.
2. **Message** becomes a nested `replace()` over `triggerBody()?['text']`, swapping each
   placeholder for its token.
3. Both token actions get **Configure run after → has failed**, routing to a branch that
   posts the text with the placeholders replaced by the plain names.

Step 3 is load-bearing. By default a failed lookup stops the flow and nothing posts at
all — so one departed employee would silently suppress the whole notification. Degrading
to an unmentioned name is strictly better than silence.

## Testing

`tests/teams-notify.test.ts` gains:

- the payload's `text` contains both placeholders
- both emails appear in the payload
- `notifyAssignment` returns `false` rather than throwing when the POST is rejected
- returns `false` when `TEAMS_WEBHOOK_URL` is unset

The flow side cannot be unit tested. `npm run teams:test` remains the manual check, and
confirming the mention actually pinged somebody requires looking at the chat.

## Documentation

`docs/TEAMS_SETUP.md` needs correcting alongside this work:

- **"the flow forwards it verbatim" is wrong.** A flow does nothing with the request body
  unless an action explicitly references it. This claim cost a debugging session in which
  the flow posted a hardcoded `hello` regardless of payload.
- The **@mentions** section currently says mentions are not done; replace with the setup
  above.
- Failure table is missing two rows encountered in practice:
  - `400 WorkflowTriggerIsNotEnabled` — the flow is turned off or auto-suspended after
    repeated failures. Check run history and the Teams connection.
  - `401 DirectApiAuthorizationRequired` — trigger access is *Any user in my tenant*.
    Must be **Anyone**, which regenerates the URL with the `&sp=&sv=&sig=` signature.

## Out of scope

- Retries or per-recipient tracking for Teams. It remains a best-effort broadcast; making
  it reliable needs its own notification rows keyed per recipient.
- Mentions in reminder, expiry, or digest notifications. Assignment only.

## Deployment note

`TEAMS_WEBHOOK_URL` currently points at flow `5b87cb8b…`, which is suspended. The working
flow is `0931190c…`. Until the variable is updated locally and in Vercel, this code will
be correct and still post nothing.
