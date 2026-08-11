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
menu with routing, filing-draft creation/resume, and advocate-enrolment
number capture/confirmation, all with transactional, concurrency-safe state
transitions and durable conversation persistence, deployable to Vercel.

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
the filing-draft templates and migration, and
[docs/advocate-enrolment-setup.md](./docs/advocate-enrolment-setup.md) for the
advocate-enrolment templates and migration.

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
`menu:change-language` returns to `AWAITING_LANGUAGE`; `menu`/`മെനു` redisplays
the current menu. Accepting the test-data notice creates exactly one filing
draft (role `COMPLAINANT_ADVOCATE`, status `DRAFT`) inside a single
row-locked transaction and reaches `ADVOCATE_ENROLMENT_PENDING`, which
immediately sends the localized enrolment-number prompt. A validated,
normalized number moves to `ADVOCATE_ENROLMENT_CONFIRM` and shows the
number back for confirmation; **Confirm** records it as
`RECORDED_UNVERIFIED` (never `VERIFIED` — no Bar Council integration
exists) and reaches `COMPLAINANT_DETAILS_START`, **Edit** clears the
candidate and returns to `ADVOCATE_ENROLMENT_PENDING`, and **Save and
exit** preserves the candidate/`current_step` and returns to `MAIN_MENU`.
See [docs/language-selection-setup.md](./docs/language-selection-setup.md),
[docs/main-menu-setup.md](./docs/main-menu-setup.md),
[docs/filing-drafts-setup.md](./docs/filing-drafts-setup.md), and
[docs/advocate-enrolment-setup.md](./docs/advocate-enrolment-setup.md) for
the Content Template and database setup this depends on.

## Database

Conversation state, filing drafts, and webhook idempotency are stored in
Postgres via [Drizzle ORM](https://orm.drizzle.team) — see `src/db/schema.ts`.
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
`twilio/templates/advocate-enrolment-{prompt,confirm}.{en,ml}.json`. All
sets of create/verify scripts share the same idempotent create-or-reuse
logic and structural comparison (`twilio/scripts/content-api-client.ts`
and `template-comparison.ts`):

```bash
npm run twilio:template:create   # idempotent: creates once, reuses on reruns
npm run twilio:template:verify   # confirms the deployed template matches the spec
npm run twilio:menu:create       # same, for both the English and Malayalam menus
npm run twilio:menu:verify
npm run twilio:filing:create     # same, for all four filing templates
npm run twilio:filing:verify
npm run twilio:enrolment:create  # same, for all four advocate-enrolment templates
npm run twilio:enrolment:verify
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
`TWILIO_ENROLMENT_CONFIRM_SID_ML`, `PUBLIC_BASE_URL`, and `DATABASE_URL` in
the Vercel project's **Production** environment (see
[docs/twilio-sandbox-setup.md](./docs/twilio-sandbox-setup.md),
[docs/language-selection-setup.md](./docs/language-selection-setup.md),
[docs/main-menu-setup.md](./docs/main-menu-setup.md),
[docs/filing-drafts-setup.md](./docs/filing-drafts-setup.md), and
[docs/advocate-enrolment-setup.md](./docs/advocate-enrolment-setup.md)).
Redeploy after changing any environment variable. Any variables added later
should also be set in Vercel and documented in `.env.example`.
