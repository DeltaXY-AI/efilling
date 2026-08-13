# Accused-details setup and verification guide

This guide covers the setup specific to collecting, reviewing, editing, and
confirming the accused party's basic details (V6B / #11): creating the two
Twilio Content Templates, and verifying the collect/review/edit/confirm/
save-and-exit/resume flows. It assumes
[docs/complainant-details-setup.md](./complainant-details-setup.md) is
already done — this slice reuses that same `filing_parties` table (no new
migration for the table itself), transaction/outbox mechanism, and
`COMPLAINANT_CONFIRM -> ...` entry point, not a second implementation.

The MVP supports exactly one accused party per filing. This slice never
contacts the accused, never creates a WhatsApp recipient from the accused
phone number, and never claims identity, phone, address, summons, or
service verification.

## 1. Apply the database migration

No new table is needed — V6B reuses #10's `filing_parties` table and its
existing `(filing_id, party_role)` unique constraint, writing rows with
`party_role = ACCUSED`. The only schema change is nine new
`conversation_state` values and seven new `outbound_message_type` values:

```bash
npm run db:migrate
```

This is purely additive: it applies to an empty database and upgrades the
schema produced by V6A without touching any existing row.

## 2. Create or reuse the two accused-details templates

As with V6A, only two rich interactive templates exist for this slice — the
review-actions `twilio/quick-reply` and the edit-fields `twilio/list-picker`
— defined as code in
`twilio/templates/accused-review-actions.{en,ml}.json` and
`accused-edit-fields.{en,ml}.json`. The three field prompts (name, phone,
address) are plain in-session messages with no Content Template at all
(kept in `src/services/accused-workflow.ts`).

1. With `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set in `.env`, run:

   ```bash
   npm run twilio:accused:create
   ```

   All four SIDs (two templates × two languages) are processed
   independently and reported separately.
2. Copy the printed SIDs into `.env` and the Vercel project's environment:

   ```env
   TWILIO_ACCUSED_REVIEW_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ACCUSED_REVIEW_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ACCUSED_EDIT_FIELDS_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ACCUSED_EDIT_FIELDS_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Verify all four at any time with:

   ```bash
   npm run twilio:accused:verify
   ```

Both templates are in-session, sent only after the advocate is already
mid-filing, so neither is ever submitted for WhatsApp template approval.

> **Content review**: the Malayalam copy in
> `twilio/templates/accused-{review-actions,edit-fields}.ml.json` and in
> the field prompts/validation errors/completion text
> (`src/services/accused-workflow.ts`, `src/services/accused-sender.ts`)
> must be reviewed by the designated content/legal reviewer before
> production use. Until that review happens, treat the current copy as
> test-only.

## 3. Configure environment variables

In addition to the variables from
[docs/complainant-details-setup.md](./complainant-details-setup.md), set:

```env
TWILIO_ACCUSED_REVIEW_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_ACCUSED_REVIEW_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_ACCUSED_EDIT_FIELDS_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_ACCUSED_EDIT_FIELDS_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

locally in `.env` and in the Vercel project's **Production** environment.
Redeploy after changing any environment variable.

## 4. Verify the collect/review/confirm flow with the Sandbox

1. Confirm the complainant's details (V6A) — the same Confirm tap cascades
   straight into the accused name prompt, in the advocate's selected
   language, with no extra step needed.
2. Enter a valid full/legal name (try Malayalam, initials, and a business
   name too) — confirm the phone prompt appears.
3. Reply `Skip` to the phone prompt — confirm the address prompt appears
   and the database stores both `phone_original` and `phone_normalized` as
   `NULL`. Repeat with a valid phone number instead and confirm it
   normalizes to E.164.
4. Enter a multiline address — confirm the persisted summary appears as a
   plain message (phone shown as "Not provided" if skipped), immediately
   followed by the review-actions template.
5. Select **Edit**, choose a field from the list-picker, submit a
   replacement — confirm only that field changed and the full summary is
   re-sent with the review actions. Confirm editing phone to `Skip` clears
   it back to `NULL`.
6. Select **Save and exit** — confirm the saved message and main menu are
   both sent, and the party stays `DRAFT` with `filings.current_step`
   unchanged in the database.
7. Re-enter **File or resume case** from the main menu, then **Resume
   draft** — confirm the exact pending field prompt (or the full review
   screen, if resumed at `ACCUSED_CONFIRM`) is restored.
8. Select **Confirm** — confirm the database records
   `filing_parties.status = CONFIRMED` (`party_role = ACCUSED`) with a
   `confirmed_at` timestamp, and both `filings.current_step` and
   `conversations.state` reach `CHEQUE_DETAILS_START`.
9. Confirm application logs (local and Vercel) never contain the accused's
   name, phone, address, or the persisted summary — only safe error codes
   and the Twilio `MessageSid` for correlation.
10. Confirm in the Twilio console that no outbound message was ever sent
    to the accused's phone number — every send in this flow targets only
    the advocate's own WhatsApp number.

## 5. Verify fallback, idempotency, and concurrency

- Force or mock Content Template delivery failure for both the
  review-actions and edit-fields templates and confirm the correct
  localized numbered plain-text fallback is sent.
- Replay the same signed webhook request (same `MessageSid`) for any field
  answer or review action — confirm no duplicate update or reply.
- Send two concurrent signed requests for Confirm and Edit on the same
  filing at `ACCUSED_CONFIRM` — confirm only the first valid transition
  applies. This is enforced by locking both the conversation row and the
  filing row for the duration of the transaction — see the concurrency
  tests in `tests/accused-workflow.test.ts` for the same guarantee proven
  against an in-memory double.
- Confirming twice must not update the confirmation timestamp or send a
  second completion message — the second attempt finds the filing's
  `current_step` no longer `ACCUSED_CONFIRM` and is a no-op.

## Retry/reconciliation behaviour

Exactly as in
[docs/complainant-details-setup.md](./complainant-details-setup.md): every
committed accused-details transition enqueues a durable `outbound_messages`
row inside the same transaction as the domain write, before it commits. If
the follow-up Twilio send then fails, the webhook still acks Twilio with
`200`, the domain write is never rolled back, and the outbound row is
marked `failed` (never left `pending`) for operators to reconcile.

## Legal and privacy boundaries

This slice must never:

- send any message to the accused (there is no code path that ever uses
  the accused's phone number as a message recipient — every send targets
  only the advocate's own WhatsApp number);
- claim identity, phone, address, summons, or service verification;
- log the accused's name, phone, address, or the rendered summary.

No cheque, notice, court, or document information is collected in this
issue — `CHEQUE_DETAILS_START` is owned by a later slice.
