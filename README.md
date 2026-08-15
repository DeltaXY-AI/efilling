# eFiling WhatsApp MVP

One-month MVP for a WhatsApp-based 24x7 ON Courts experience, using the Twilio WhatsApp Sandbox.

## Initial scope

- Complainant Advocate journey
- English and Malayalam onboarding
- Cheque-case data and document collection
- Filing review and simulated acknowledgement
- Case status and notifications
- Scrutiny defect correction
- Hearing attendance or adjournment response
- Provider-neutral messaging architecture for later migration

See [PRD.md](./PRD.md) for the complete product requirements.

## Status

The backend is a TypeScript/Express application with a health endpoint, an
authenticated Twilio WhatsApp Sandbox webhook, a bilingual (English/
Malayalam) language-selection flow, a localized Complainant Advocate main
menu with routing, filing-draft creation/resume, advocate-enrolment number
capture/confirmation, and complainant/accused contact/address details
collection, review, and confirmation, all with transactional,
concurrency-safe state transitions and durable conversation persistence,
deployable to Vercel.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
cp .env.example .env
```

Fill in the Twilio variables in `.env` before starting the app — see
[docs/twilio-sandbox-setup.md](./docs/twilio-sandbox-setup.md) for how to obtain them
and configure the Sandbox webhook,
[docs/language-selection-setup.md](./docs/language-selection-setup.md) for provisioning
the database and creating the Twilio Content Template the language picker uses,
[docs/main-menu-setup.md](./docs/main-menu-setup.md) for creating the localized main-menu
Content Templates, [docs/filing-drafts-setup.md](./docs/filing-drafts-setup.md) for
the filing-draft templates and migration,
[docs/advocate-enrolment-setup.md](./docs/advocate-enrolment-setup.md) for the
advocate-enrolment templates and migration,
[docs/complainant-details-setup.md](./docs/complainant-details-setup.md) for the
complainant-details templates and migration, and
[docs/accused-details-setup.md](./docs/accused-details-setup.md) for the
accused-details templates and migration.

## Development

Run the app locally with hot reload:

```bash
npm run dev
```

The server listens on `http://localhost:3000` by default (configurable via `PORT` in `.env`).

## Type-checking

```bash
npm run typecheck
```

## Testing

```bash
npm test
```

## Build

Compile TypeScript to `dist/`:

```bash
npm run build
npm start
```

## API

### `GET /health`

Returns `200` with:

```json
{
  "status": "ok",
  "service": "efilling-whatsapp",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `POST /webhooks/twilio/whatsapp`

Receives inbound Twilio WhatsApp Sandbox messages. Requests are rejected with
`403` unless they carry a valid `X-Twilio-Signature` header for the exact
`PUBLIC_BASE_URL` + path Twilio was configured to call. Accepted requests are
normalized into a provider-neutral inbound-message object (see
`src/types/inbound-message.ts`) and return an empty TwiML response:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>
```

See [docs/twilio-sandbox-setup.md](./docs/twilio-sandbox-setup.md) for how to configure
and verify this webhook against a real Sandbox.

Accepted requests are then routed by conversation state
(`src/services/inbound-router.ts`): any initial inbound message from a new
advocate opens a bilingual (English/Malayalam) Quick Reply picker, a
recognized selection is persisted, moves the conversation to `MAIN_MENU`,
and immediately sends the localized main menu. From `MAIN_MENU`, `menu:file-case`
checks for an active filing draft (`FILING_DRAFT_CHOICE` if one exists,
otherwise `FILING_NOTICE`); `menu:case-status` moves to `CASE_STATUS_START`;
`menu:change-language` returns to `AWAITING_LANGUAGE`; `menu:my-cases` stays at
`MAIN_MENU` and sends a "not built yet" stub (the real screen is a later
slice); `menu`/`മെനു` redisplays the current menu. `restart`/`start over`/`വീണ്ടും തുടങ്ങുക` is recognized from
*any* state (not menu-gated) — it abandons any in-progress filing draft and
returns to `AWAITING_LANGUAGE` with the language picker resent, so a user
stuck mid-flow always has a way back to the start. Accepting the test-data notice creates exactly one filing
draft (role `COMPLAINANT_ADVOCATE`, status `DRAFT`) inside a single
row-locked transaction and reaches `ADVOCATE_ENROLMENT_PENDING`, which
immediately sends the localized enrolment-number prompt. A validated,
normalized number moves to `ADVOCATE_ENROLMENT_CONFIRM` and shows the
number back for confirmation; **Confirm** records it as
`RECORDED_UNVERIFIED` (never `VERIFIED` — no Bar Council integration
exists) and cascades straight into `COMPLAINANT_NAME_PENDING`, sending the
complainant name prompt in the same transaction; **Edit** clears the
candidate and returns to `ADVOCATE_ENROLMENT_PENDING`, and **Save and
exit** preserves the candidate/`current_step` and returns to `MAIN_MENU`.

Name, phone (normalized to E.164 with default country `IN`, via
`libphonenumber-js`, never marked verified), optional email (`Skip` stores
`NULL`), and a multiline address are collected one field at a time into a
normalized `filing_parties` row (`party_role = COMPLAINANT`), each answer
persisted immediately and advancing exactly one state. A valid address
reaches `COMPLAINANT_CONFIRM`, which sends the persisted summary as a
plain message followed by a Confirm/Edit/Save-and-exit Quick Reply;
**Confirm** marks the party `CONFIRMED` and cascades straight into
`ACCUSED_NAME_PENDING`, sending the accused name prompt in the same
transaction; **Edit** opens a List Picker to choose one field, validates
and saves only that field, and returns to the review screen; and **Save
and exit** preserves everything and returns to `MAIN_MENU`.

The accused party's full/legal name, optional phone (`Skip` stores both
`phone_original`/`phone_normalized` as `NULL`), and a required multiline
address are collected the same way into a second `filing_parties` row
(`party_role = ACCUSED`) — reusing the exact same name/phone/address
validators, Skip recognizer, and review/edit/confirm/save-exit mechanics
as the complainant flow, never a forked implementation. A valid address
reaches `ACCUSED_CONFIRM`; **Confirm** marks the party `CONFIRMED` and
reaches `CHEQUE_DETAILS_START` (owned by a later issue). This slice never
contacts the accused, never creates a WhatsApp recipient from the accused
phone number, and never claims identity/phone/address/summons/service
verification. Resuming a saved draft (see filing-draft resume, above)
restores the exact pending field prompt or the review screen for either
party. See
[docs/language-selection-setup.md](./docs/language-selection-setup.md),
[docs/main-menu-setup.md](./docs/main-menu-setup.md),
[docs/filing-drafts-setup.md](./docs/filing-drafts-setup.md),
[docs/advocate-enrolment-setup.md](./docs/advocate-enrolment-setup.md),
[docs/complainant-details-setup.md](./docs/complainant-details-setup.md),
and [docs/accused-details-setup.md](./docs/accused-details-setup.md) for
the Content Template and database setup this depends on.

## Database

Conversation state, filing drafts, complainant/accused party details, and
webhook idempotency are stored in Postgres via
[Drizzle ORM](https://orm.drizzle.team) — see `src/db/schema.ts`.
Migrations are committed under `drizzle/`:

```bash
npm run db:generate   # regenerate migration SQL after changing src/db/schema.ts
npm run db:migrate     # apply pending migrations to DATABASE_URL
```

`src/db/client.ts` uses `drizzle-orm/neon-serverless` with a WebSocket
`Pool`, not the plain HTTP driver — filing-draft creation needs a real,
row-locked transaction (`SELECT ... FOR UPDATE`) to check for an active
draft and transition atomically, which Neon's HTTP driver cannot do at all.

## Twilio Content Templates

The language picker is a Twilio Quick Reply Content Template defined as code
in `twilio/templates/language-selection.json`; the localized main menu is two
Quick Reply/List Picker Content Templates in
`twilio/templates/complainant-advocate-menu.{en,ml}.json`; the filing
draft-choice and test-data-notice templates are four more Quick Reply
templates in `twilio/templates/filing-{draft-choice,notice}.{en,ml}.json`;
the advocate-enrolment prompt (`twilio/text`) and confirmation
(`twilio/quick-reply`, with a `{{1}}` variable for the normalized number)
templates are four more in
`twilio/templates/advocate-enrolment-{prompt,confirm}.{en,ml}.json`; the
complainant-details review-actions (`twilio/quick-reply`) and edit-fields
(`twilio/list-picker`) templates are four more in
`twilio/templates/complainant-{review-actions,edit-fields}.{en,ml}.json`;
the accused-details review-actions and edit-fields templates are four more
in `twilio/templates/accused-{review-actions,edit-fields}.{en,ml}.json`;
the Prototype parity — Phase 5 (#33) case-details-form templates — the
complainant's "Filing as" role (in `create-complainant-templates.ts`), the
accused's entity type (in `create-accused-templates.ts`), and the cheque/
notice/narrative/court screens' return-reason, paid-after-notice, witness,
court, review-actions, 2-level edit picker, and declaration templates (18
more, in `twilio/templates/filing-{return-reason,part-payment,witness,
court,review-actions,edit-group,edit-cheque-field,edit-narrative-field,
declare}.{en,ml}.json`) — plus Prototype parity — Phase 6 (#34)'s
draft-ready "Review & e-Sign / Edit details" quick-reply (two more, in
`twilio/templates/filing-draft-ready-actions.{en,ml}.json`) and Phase 7
(#35)'s filed-acknowledgement "Pay court fee" quick-reply (two more, in
`twilio/templates/filing-filed-actions.{en,ml}.json`) — round out the
set. The field prompts themselves (name/phone/email/address for the
complainant; name/phone/address for the accused; cheque number/date,
amount, bank/branch, memo/notice/service dates, and the narrative for the
filing; #34's OTP prompt/error; and #35's fee-paid receipt/completion
message) have no Content Template at all and are sent as plain in-session
messages. All sets of create/verify
scripts share the same idempotent create-or-reuse logic and structural
comparison (`twilio/scripts/content-api-client.ts` and
`template-comparison.ts`):

```bash
npm run twilio:template:create        # idempotent: creates once, reuses on reruns
npm run twilio:template:verify        # confirms the deployed template matches the spec
npm run twilio:menu:create            # same, for both the English and Malayalam menus
npm run twilio:menu:verify
npm run twilio:filing:create          # same, for all four filing (draft-choice/notice) templates
npm run twilio:filing:verify
npm run twilio:enrolment:create       # same, for all four advocate-enrolment templates
npm run twilio:enrolment:verify
npm run twilio:complainant:create     # same, for all six complainant-details templates (incl. #33 Part A's role)
npm run twilio:complainant:verify
npm run twilio:accused:create         # same, for all six accused-details templates (incl. #33 Part B's entity type)
npm run twilio:accused:verify
npm run twilio:filing-details:create  # same, for all 18 #33 Parts C/D/F case-details-form templates
npm run twilio:filing-details:verify
npm run twilio:filing-sign:create     # same, for #34's draft-ready "Review & e-Sign / Edit details" template
npm run twilio:filing-sign:verify
npm run twilio:filing-completion:create  # same, for #35's filed-acknowledgement "Pay court fee" template
npm run twilio:filing-completion:verify
```

## Deployment (Vercel)

The Express app is exported as the default export of `src/index.ts` and deployed as a
single Vercel serverless function via `vercel.json`.

1. Install the [Vercel CLI](https://vercel.com/docs/cli) and log in: `vercel login`.
2. From the repository root, run `vercel` to link the project (first time only).
3. Deploy to production: `vercel --prod`.
4. Verify the deployment by requesting `https://<your-production-domain>/health`.

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`,
`TWILIO_LANGUAGE_CONTENT_SID`, `TWILIO_MAIN_MENU_CONTENT_SID_EN`,
`TWILIO_MAIN_MENU_CONTENT_SID_ML`, `TWILIO_FILING_DRAFT_CHOICE_SID_EN`,
`TWILIO_FILING_DRAFT_CHOICE_SID_ML`, `TWILIO_FILING_NOTICE_SID_EN`,
`TWILIO_FILING_NOTICE_SID_ML`, `TWILIO_ENROLMENT_PROMPT_SID_EN`,
`TWILIO_ENROLMENT_PROMPT_SID_ML`, `TWILIO_ENROLMENT_CONFIRM_SID_EN`,
`TWILIO_ENROLMENT_CONFIRM_SID_ML`, `TWILIO_COMPLAINANT_REVIEW_SID_EN`,
`TWILIO_COMPLAINANT_REVIEW_SID_ML`, `TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN`,
`TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML`, `TWILIO_ACCUSED_REVIEW_SID_EN`,
`TWILIO_ACCUSED_REVIEW_SID_ML`, `TWILIO_ACCUSED_EDIT_FIELDS_SID_EN`,
`TWILIO_ACCUSED_EDIT_FIELDS_SID_ML`, `TWILIO_COMPLAINANT_ROLE_SID_EN`,
`TWILIO_COMPLAINANT_ROLE_SID_ML`, `TWILIO_ACCUSED_ENTITY_TYPE_SID_EN`,
`TWILIO_ACCUSED_ENTITY_TYPE_SID_ML`, `TWILIO_FILING_RETURN_REASON_SID_EN`,
`TWILIO_FILING_RETURN_REASON_SID_ML`, `TWILIO_FILING_PART_PAYMENT_SID_EN`,
`TWILIO_FILING_PART_PAYMENT_SID_ML`, `TWILIO_FILING_WITNESS_SID_EN`,
`TWILIO_FILING_WITNESS_SID_ML`, `TWILIO_FILING_COURT_SID_EN`,
`TWILIO_FILING_COURT_SID_ML`, `TWILIO_FILING_REVIEW_ACTIONS_SID_EN`,
`TWILIO_FILING_REVIEW_ACTIONS_SID_ML`, `TWILIO_FILING_EDIT_GROUP_SID_EN`,
`TWILIO_FILING_EDIT_GROUP_SID_ML`, `TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_EN`,
`TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_ML`,
`TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_EN`,
`TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_ML`, `TWILIO_FILING_DECLARE_SID_EN`,
`TWILIO_FILING_DECLARE_SID_ML`, `TWILIO_FILING_DRAFT_READY_ACTIONS_SID_EN`,
`TWILIO_FILING_DRAFT_READY_ACTIONS_SID_ML`, `TWILIO_FILING_FILED_ACTIONS_SID_EN`,
`TWILIO_FILING_FILED_ACTIONS_SID_ML`, `PUBLIC_BASE_URL`, and
`DATABASE_URL`
in the Vercel project's **Production** environment (see
[docs/twilio-sandbox-setup.md](./docs/twilio-sandbox-setup.md),
[docs/language-selection-setup.md](./docs/language-selection-setup.md),
[docs/main-menu-setup.md](./docs/main-menu-setup.md),
[docs/filing-drafts-setup.md](./docs/filing-drafts-setup.md),
[docs/advocate-enrolment-setup.md](./docs/advocate-enrolment-setup.md),
[docs/complainant-details-setup.md](./docs/complainant-details-setup.md),
and [docs/accused-details-setup.md](./docs/accused-details-setup.md)).
Redeploy after changing any environment variable. Any variables added later
should also be set in Vercel and documented in `.env.example`.
