# Complainant details setup and verification guide

This guide covers the setup specific to collecting, reviewing, editing, and
confirming the complainant's contact and address details (V6A / #10):
applying the `filing_parties` migration, creating the two Twilio Content
Templates, and verifying the collect/review/edit/confirm/save-and-exit/
resume flows. It assumes
[docs/filing-drafts-setup.md](./filing-drafts-setup.md) is already
done — this slice reuses that same database and transaction/outbox
mechanism, not a second implementation. The entry point is reached via the
document-collection cascade (see `filing-document-workflow.ts`), which
follows accepting the test notice directly — there is no separate
advocate-enrolment gate in between (retired; see `filing-workflow.ts`'s
`handleFilingNoticeInput`).

The MVP supports exactly one complainant per filing. Accused details are
out of scope — they belong to V6B, which will reuse the same
`filing_parties` table with `party_role = ACCUSED`. No identity, phone,
email, or address verification is performed in this slice; the phone
number is normalized but never marked "verified".

## 1. Apply the database migration

Adds a normalized `filing_parties` table (`id`, `filing_id`, `party_role`,
`full_name`, `phone_original`, `phone_normalized`, `email_normalized`,
`address`, `status`, `confirmed_at`, timestamps) with a unique constraint on
`(filing_id, party_role)`, plus eleven new `conversation_state` values and
eight new `outbound_message_type` values. No column is added to `filings`
itself — the party's fields live in the new table, keyed off the filing.

```bash
npm run db:migrate
```

This is purely additive: it applies to an empty database and upgrades the
schema produced by V5B/V5C without touching any existing `filings` or
`conversations` row.

## 2. Create or reuse the two complainant-details templates

Only two rich interactive templates exist for this slice — the
review-actions `twilio/quick-reply` and the edit-fields `twilio/list-picker`
— defined as code in
`twilio/templates/complainant-review-actions.{en,ml}.json` and
`complainant-edit-fields.{en,ml}.json`. The four field prompts (name,
phone, email, address) are plain in-session messages with no Content
Template at all (kept in `src/services/complainant-workflow.ts`).

1. With `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set in `.env`, run:

   ```bash
   npm run twilio:complainant:create
   ```

   All four SIDs (two templates × two languages) are processed
   independently and reported separately — a mismatch or duplicate in one
   never blocks or hides the others' results.
2. Copy the printed SIDs into `.env` and the Vercel project's environment:

   ```env
   TWILIO_COMPLAINANT_REVIEW_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_COMPLAINANT_REVIEW_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Verify all four at any time with:

   ```bash
   npm run twilio:complainant:verify
   ```

Both templates are in-session, sent only after the advocate is already
mid-filing, so neither is ever submitted for WhatsApp template approval.

> **Content review**: the Malayalam copy in
> `twilio/templates/complainant-{review-actions,edit-fields}.ml.json` and in
> the field prompts/validation errors/completion text
> (`src/services/complainant-workflow.ts`, `src/services/complainant-sender.ts`)
> must be reviewed by the designated content/legal reviewer before
> production use. Until that review happens, treat the current copy as
> test-only.

## 3. Configure environment variables

In addition to the variables from
[docs/filing-drafts-setup.md](./filing-drafts-setup.md), set:

```env
TWILIO_COMPLAINANT_REVIEW_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_COMPLAINANT_REVIEW_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

locally in `.env` and in the Vercel project's **Production** environment.
Redeploy after changing any environment variable.

## 4. Verify the collect/review/confirm flow with the Sandbox

1. Confirm an advocate enrolment number (V5B) — the same Confirm tap
   cascades straight into the complainant name prompt, in the advocate's
   selected language, with no extra step needed.
2. Enter a valid full name (try Malayalam too) — confirm the phone prompt
   appears.
3. Enter an invalid phone (e.g. `12345`), then a valid one (`9876543210` or
   `+91 98765 43210`) — confirm the error, then the E.164-normalized number
   is accepted and the email prompt appears.
4. Reply `Skip` to the email prompt — confirm the address prompt appears
   and the database stores `email_normalized = NULL`.
5. Enter a multiline address — confirm the persisted summary appears as a
   plain message, immediately followed by the review-actions template.
6. Select **Edit**, choose a field from the list-picker, submit a
   replacement — confirm only that field changed and the full summary is
   re-sent with the review actions.
7. Select **Save and exit** — confirm the saved message and main menu are
   both sent, and the party stays `DRAFT` with `filings.current_step`
   unchanged in the database.
8. Re-enter **File or resume case** from the main menu, then **Resume
   draft** — confirm the exact pending field prompt (or the full review
   screen, if resumed at `COMPLAINANT_CONFIRM`) is restored.
9. Select **Confirm** — confirm the database records
   `filing_parties.status = CONFIRMED` with a `confirmed_at` timestamp, and
   both `filings.current_step` and `conversations.state` reach
   `ACCUSED_DETAILS_START`.
10. Confirm application logs (local and Vercel) never contain the
    complainant's name, phone, email, address, or the persisted summary —
    only safe error codes and the Twilio `MessageSid` for correlation.

## 5. Verify fallback, idempotency, and concurrency

- Force or mock Content Template delivery failure for both the
  review-actions and edit-fields templates and confirm the correct
  localized numbered plain-text fallback is sent.
- Replay the same signed webhook request (same `MessageSid`) for any field
  answer or review action — confirm no duplicate update or reply.
- Send two concurrent signed requests for Confirm and Edit on the same
  filing at `COMPLAINANT_CONFIRM` — confirm only the first valid transition
  applies. This is enforced by locking both the conversation row and the
  filing row for the duration of the transaction — see the concurrency
  tests in `tests/complainant-workflow.test.ts` for the same guarantee
  proven against an in-memory double.
- Confirming twice must not update the confirmation timestamp or send a
  second completion message — the second attempt finds the filing's
  `current_step` no longer `COMPLAINANT_CONFIRM` and is a no-op.

## Retry/reconciliation behaviour

Exactly as in
[docs/filing-drafts-setup.md](./filing-drafts-setup.md): every
committed complainant-details transition enqueues a durable
`outbound_messages` row inside the same transaction as the domain write,
before it commits. If the follow-up Twilio send then fails, the webhook
still acks Twilio with `200`, the domain write is never rolled back, and
the outbound row is marked `failed` (never left `pending`) for operators to
reconcile.

## No accused details in this slice

V6A never requests, stores, or processes accused-party information. The
`filing_parties` table's `party_role` column already supports `ACCUSED` at
the schema level so V6B can reuse this same table, but no code path in this
slice ever writes a row with that role.
