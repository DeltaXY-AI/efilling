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
authenticated Twilio WhatsApp Sandbox webhook, and a bilingual (English/
Malayalam) language-selection flow with durable conversation persistence,
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
and configure the Sandbox webhook, and
[docs/language-selection-setup.md](./docs/language-selection-setup.md) for provisioning
the database and creating the Twilio Content Template the language picker uses.

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

Accepted requests are then routed through the language-selection workflow: any
initial inbound message from a new advocate opens a bilingual (English/
Malayalam) Quick Reply picker, a recognized selection is persisted and moves
the conversation to `MAIN_MENU`, and sending `language`/`ഭാഷ` reopens the
picker. See [docs/language-selection-setup.md](./docs/language-selection-setup.md)
for the Content Template and database setup this depends on.

## Database

Conversation state and webhook idempotency are stored in Postgres via
[Drizzle ORM](https://orm.drizzle.team) — see `src/db/schema.ts`. Migrations are
committed under `drizzle/`:

```bash
npm run db:generate   # regenerate migration SQL after changing src/db/schema.ts
npm run db:migrate     # apply pending migrations to DATABASE_URL
```

## Twilio Content Template

The language picker is a Twilio Quick Reply Content Template defined as code
in `twilio/templates/language-selection.json`:

```bash
npm run twilio:template:create   # idempotent: creates once, reuses on reruns
npm run twilio:template:verify   # confirms the deployed template matches the spec
```

## Deployment (Vercel)

The Express app is exported as the default export of `src/index.ts` and deployed as a
single Vercel serverless function via `vercel.json`.

1. Install the [Vercel CLI](https://vercel.com/docs/cli) and log in: `vercel login`.
2. From the repository root, run `vercel` to link the project (first time only).
3. Deploy to production: `vercel --prod`.
4. Verify the deployment by requesting `https://<your-production-domain>/health`.

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`,
`TWILIO_LANGUAGE_CONTENT_SID`, `PUBLIC_BASE_URL`, and `DATABASE_URL` in the Vercel
project's **Production** environment (see
[docs/twilio-sandbox-setup.md](./docs/twilio-sandbox-setup.md) and
[docs/language-selection-setup.md](./docs/language-selection-setup.md)). Redeploy after
changing any environment variable. Any variables added later should also be set in
Vercel and documented in `.env.example`.
