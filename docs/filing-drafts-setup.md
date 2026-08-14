# Filing drafts setup and verification guide

This guide covers the setup specific to starting a Complainant Advocate
filing and managing drafts (V5A): creating the four Twilio Content
Templates, applying the `filings` table migration, and verifying the
draft/resume/start-new flows. It assumes
[docs/main-menu-setup.md](./main-menu-setup.md) is already done — this
slice reuses that same database, Content Template mechanism, and
`menu:file-case` entry point, not a second implementation.

## 1. Apply the database migration

`menu:file-case` now checks for an active filing draft via
`conversations.active_filing_id` and persists new drafts in a `filings`
table. Apply the committed migration the same way as before:

```bash
npm run db:migrate
```

### Why this app now uses a WebSocket `Pool`, not the plain HTTP driver

Starting/resuming a filing requires an atomic "lock the conversation row,
read whether it has an active draft, then transition to one of two
different next states" — a real transaction with a row lock
(`SELECT ... FOR UPDATE`) held across a conditional read-then-write.
Neon's plain HTTP driver (`drizzle-orm/neon-http`, used by #3/#5) cannot do
this — it literally throws `"No transactions support in neon-http driver"`
if you call `.transaction()`. `src/db/client.ts` now uses
`drizzle-orm/neon-serverless` with a WebSocket-based `Pool` instead, which
supports real interactive transactions. This is transparent to callers —
`getDb()` still returns the same query-builder API — but if you're adding
new non-transactional queries elsewhere, nothing about how you write them
changes.

## 2. Create or reuse the four filing templates

The draft-choice and test-notice templates are defined as code in
`twilio/templates/filing-draft-choice.{en,ml}.json` and
`filing-notice.{en,ml}.json`.

1. With `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set in `.env`, run:

   ```bash
   npm run twilio:filing:create
   ```

   All four are processed independently and reported separately — a
   mismatch or duplicate in one never blocks or hides the others' results.
2. Copy the printed SIDs into `.env` and the Vercel project's environment:

   ```env
   TWILIO_FILING_DRAFT_CHOICE_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_FILING_DRAFT_CHOICE_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_FILING_NOTICE_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_FILING_NOTICE_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Verify all four at any time with:

   ```bash
   npm run twilio:filing:verify
   ```

All four are in-session Quick Reply templates sent only after the advocate
has already started the conversation, so none are ever submitted for
WhatsApp template approval.

> **Content review**: the Malayalam copy in
> `twilio/templates/filing-draft-choice.ml.json` and
> `filing-notice.ml.json` must be reviewed by the designated content/legal
> reviewer before production use. Until that review happens, treat the
> current copy as test-only. Note (#30): the notice's content is now the
> pre-filing document checklist rather than a "this is a demo, no real
> filing happens" disclaimer — confirm whether a separate, explicit demo
> disclaimer is still wanted elsewhere in the flow before production use.

## 3. Configure environment variables

In addition to the variables from
[docs/main-menu-setup.md](./main-menu-setup.md), set:

```env
TWILIO_FILING_DRAFT_CHOICE_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FILING_DRAFT_CHOICE_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FILING_NOTICE_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FILING_NOTICE_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

locally in `.env` and in the Vercel project's **Production** environment.
Redeploy after changing any environment variable.

## 4. Verify the no-draft flow with the Sandbox

1. Use a test advocate with no active filing.
2. Reach the main menu, select **File or resume case**.
3. Confirm the document checklist appears (#30 — not the old demo
   disclaimer).
4. Select **Main menu** — confirm no filing was created (check the
   `filings` table, or that `conversations.active_filing_id` is still
   null for this conversation).
5. Repeat and select **Start filing**.
6. Confirm exactly one filing now exists with `role = COMPLAINANT_ADVOCATE`,
   `status = DRAFT`, `current_step = ADVOCATE_ENROLMENT_PENDING`, and that
   `conversations.active_filing_id` points to it.

## 5. Verify the existing-draft flow

1. Re-enter **File or resume case** for the same advocate.
2. Confirm the draft-choice template appears (not the notice).
3. Select **Resume draft** — confirm no second filing is created and the
   conversation reaches the draft's `current_step`.
4. Repeat and select **Start new filing**, then tap **Start filing** on
   the document checklist.
5. Confirm a new filing is now active and the previous filing still exists,
   unchanged, in the `filings` table.

## 6. Verify fallback, idempotency, and concurrency

- Force or mock Content Template delivery failure and confirm the correct
  localized numbered fallback is sent.
- Replay the same signed webhook request (same `MessageSid`) for any
  filing action — confirm no duplicate draft or reply.
- Tap **Start filing** twice in quick succession (or send two concurrent
  signed requests) — confirm only one draft is ever created. This is
  enforced by locking the conversation row for the duration of the
  transaction, not just by the `MessageSid` idempotency check — see the
  concurrency tests in `tests/filing-workflow.test.ts` for the same
  guarantee proven against an in-memory double.

## Retry/reconciliation behaviour

If persisting a filing transition succeeds but the follow-up Twilio send
then fails, the webhook still acks Twilio with `200` — the transition is
never rolled back after the fact, and the processed-webhook event for that
`MessageSid` is marked `failed` for operators to investigate via the
database, rather than retried indefinitely. This is the same policy #3 and
#5 already use for their own delivery failures.
