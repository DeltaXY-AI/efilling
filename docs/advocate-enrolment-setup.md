# Advocate enrolment setup and verification guide

This guide covers the setup specific to capturing and confirming the
Complainant Advocate's enrolment number (V5B): creating the four Twilio
Content Templates, applying the `filings` enrolment-column migration, and
verifying the validate/confirm/edit/save-and-exit/resume flows. It assumes
[docs/filing-drafts-setup.md](./filing-drafts-setup.md) is already done —
this slice reuses that same database, transaction/outbox mechanism, and
`ADVOCATE_ENROLMENT_PENDING` entry point, not a second implementation.

This slice never verifies the enrolment number with a Bar Council. It is
recorded as `RECORDED_UNVERIFIED` and the application must never state or
persist that Bar Council verification occurred.

## 1. Apply the database migration

`filings` gains four nullable enrolment columns
(`advocate_enrolment_original`, `advocate_enrolment_normalized`,
`advocate_enrolment_status`, `advocate_enrolment_confirmed_at`) and two new
conversation states (`ADVOCATE_ENROLMENT_CONFIRM`,
`COMPLAINANT_DETAILS_START`). No uniqueness constraint is added on the
enrolment number — one advocate can have multiple filings. Apply the
committed migration the same way as before:

```bash
npm run db:migrate
```

## 2. Create or reuse the four enrolment templates

The prompt (`twilio/text`) and confirmation (`twilio/quick-reply`)
templates are defined as code in
`twilio/templates/advocate-enrolment-prompt.{en,ml}.json` and
`advocate-enrolment-confirm.{en,ml}.json`. The confirmation template's body
uses a `{{1}}` variable for the normalized enrolment number.

1. With `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set in `.env`, run:

   ```bash
   npm run twilio:enrolment:create
   ```

   All four are processed independently and reported separately — a
   mismatch or duplicate in one never blocks or hides the others' results.
2. Copy the printed SIDs into `.env` and the Vercel project's environment:

   ```env
   TWILIO_ENROLMENT_PROMPT_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ENROLMENT_PROMPT_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ENROLMENT_CONFIRM_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ENROLMENT_CONFIRM_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Verify all four at any time with:

   ```bash
   npm run twilio:enrolment:verify
   ```

All four are in-session templates sent only after the advocate has already
started a filing, so none are ever submitted for WhatsApp template
approval.

> **Content review**: the Malayalam copy in
> `twilio/templates/advocate-enrolment-{prompt,confirm}.ml.json` and in the
> validation-error/completion/saved plain-text fallbacks
> (`src/services/enrolment-workflow.ts`, `src/services/enrolment-sender.ts`)
> must be reviewed by the designated content/legal reviewer before
> production use. Until that review happens, treat the current copy as
> test-only.

## 3. Configure environment variables

In addition to the variables from
[docs/filing-drafts-setup.md](./filing-drafts-setup.md), set:

```env
TWILIO_ENROLMENT_PROMPT_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_ENROLMENT_PROMPT_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_ENROLMENT_CONFIRM_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_ENROLMENT_CONFIRM_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

locally in `.env` and in the Vercel project's **Production** environment.
Redeploy after changing any environment variable.

## 4. Verify the validate/confirm flow with the Sandbox

1. Start or resume a filing until the conversation reaches
   `ADVOCATE_ENROLMENT_PENDING` — confirm the enrolment prompt is sent
   immediately, in the advocate's selected language.
2. Type an invalid number (e.g. an emoji or a URL) — confirm the localized
   validation message appears and the conversation stays
   `ADVOCATE_ENROLMENT_PENDING`.
3. Type `ker / 1234 / 2010` — confirm the confirmation message shows the
   normalized `KER/1234/2010`.
4. Select **Edit**, submit a replacement number — confirm the prompt is
   sent again and the previous candidate is cleared, not superseded.
5. Select **Save and exit** — confirm the localized saved message and the
   main menu are both sent, and the candidate/`current_step` are
   unchanged in the `filings` table.
6. Re-enter **File or resume case** from the main menu — confirm the draft
   choice appears, then **Resume draft** restores the confirmation step and
   resends it with the saved candidate.
7. Select **Confirm** — confirm the database records
   `advocate_enrolment_status = RECORDED_UNVERIFIED` with a
   `advocate_enrolment_confirmed_at` timestamp, and both `filings.current_step`
   and `conversations.state` reach `COMPLAINANT_DETAILS_START`.
8. Confirm application logs (local and Vercel) never contain the original
   or normalized enrolment value — only safe error codes and the Twilio
   `MessageSid` for correlation.

## 5. Verify fallback, idempotency, and concurrency

- Force or mock Content Template delivery failure (both the prompt and the
  confirmation) and confirm the correct localized plain-text fallback is
  sent, and that the confirmation fallback still shows the normalized
  number with the numbered `1. Confirm / 2. Edit / 3. Save and exit` options.
- Replay the same signed webhook request (same `MessageSid`) for any
  enrolment action — confirm no duplicate update or reply.
- Send two concurrent signed requests for Confirm and Edit on the same
  filing — confirm only the first valid transition applies. This is
  enforced by locking both the conversation row and the filing row for the
  duration of the transaction — see the concurrency tests in
  `tests/enrolment-workflow.test.ts` for the same guarantee proven against
  an in-memory double.
- Confirming twice must not update the confirmation timestamp or send a
  second completion message — the second attempt finds the filing's
  `current_step` no longer `ADVOCATE_ENROLMENT_CONFIRM` and is a no-op.

## Retry/reconciliation behaviour

Exactly as in [docs/filing-drafts-setup.md](./filing-drafts-setup.md): every
committed enrolment transition enqueues a durable `outbound_messages` row
inside the same transaction as the domain write, before it commits. If the
follow-up Twilio send then fails (Content Template or its plain-text
fallback), the webhook still acks Twilio with `200`, the domain write is
never rolled back, and the outbound row is marked `failed` (never left
`pending`) for operators to reconcile — the `processed_webhook_events`
claim on the same `MessageSid` prevents Twilio's own retry from
re-attempting the same transition, so the outbound row's `dedupe_key`
(`${messageSid}:${type}`) is what stays queryable evidence of what was
owed.
