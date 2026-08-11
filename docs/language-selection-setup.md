# Language selection setup and verification guide

This guide covers the two setup steps specific to the Complainant Advocate
language-selection flow: provisioning the database and creating the Twilio
Content Template. It assumes the Twilio Sandbox is already configured per
[docs/twilio-sandbox-setup.md](./twilio-sandbox-setup.md).

## 1. Provision Postgres

Conversation state and webhook idempotency now live in Postgres — never an
in-memory map, since Vercel function instances are ephemeral.

1. Provision a database and get its connection string as `DATABASE_URL`.
   The recommended path is Neon through the Vercel Marketplace
   (`vercel integration add neon`), which also injects `DATABASE_URL` into
   the linked Vercel project automatically.
2. Set `DATABASE_URL` in `.env` for local development.
3. Apply the committed migrations (schema: `src/db/schema.ts`, SQL: `drizzle/`):

   ```bash
   npm run db:migrate
   ```

   This runs against whatever `DATABASE_URL` currently points to — a local
   dev database, a Neon branch, or production. Re-running it is safe;
   already-applied migrations are skipped.
4. If the schema changes in a future slice, regenerate a new migration with
   `npm run db:generate` (this only diffs `src/db/schema.ts` against the
   committed migrations journal — it does not require a live `DATABASE_URL`)
   and commit the resulting SQL file under `drizzle/`.

## 2. Create the Twilio Content Template

The bilingual language picker is a Twilio Quick Reply Content Template,
defined as code in `twilio/templates/language-selection.json` so it never
has to be recreated by hand through the Twilio Console.

1. With `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set in `.env`, run:

   ```bash
   npm run twilio:template:create
   ```

   - First run: creates the template and prints its Content SID.
   - Later runs: reuse the existing template if it's unchanged and print
     the same Content SID — no duplicate is ever created.
   - If a template with the same name exists but differs in content, or if
     duplicates already exist, the command exits non-zero with details
     instead of touching anything.
2. Copy the printed `TWILIO_LANGUAGE_CONTENT_SID` into `.env` and into the
   Vercel project's environment variables.
3. Verify the deployed Content SID still matches the committed
   specification at any time with:

   ```bash
   npm run twilio:template:verify
   ```

This template is a bilingual in-session picker sent only after the advocate
has already started the conversation, so it is never submitted for WhatsApp
template approval.

## 3. Configure environment variables

In addition to the variables from
[docs/twilio-sandbox-setup.md](./twilio-sandbox-setup.md), set:

```env
TWILIO_LANGUAGE_CONTENT_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DATABASE_URL=postgres://...
```

locally in `.env` and in the Vercel project's **Production** environment.
Redeploy after changing any environment variable.

## 4. Verify with the Sandbox

1. From a phone joined to the Sandbox, send `Hi`.
2. Confirm the bilingual Quick Reply picker arrives.
3. Tap **English** — confirm `✓ English selected.` arrives, followed
   immediately by the localized main menu (see
   [docs/main-menu-setup.md](./main-menu-setup.md)), and that the
   conversation is persisted with `language = en`, `state = MAIN_MENU`.
4. In a fresh test conversation, tap **മലയാളം** — confirm the Malayalam
   confirmation and main menu arrive with `language = ml`.
5. Send another ordinary message — confirm the picker does **not** reopen.
6. Send `language` or `ഭാഷ` — confirm the picker reopens.
7. Replay the same signed webhook request (e.g. by resending a test fixture
   with the same `MessageSid`) — confirm only one outbound message was ever
   sent for it.

If the Content Template send fails for any reason, the numbered plain-text
fallback is sent instead and the conversation stays in `AWAITING_LANGUAGE`;
Twilio's internal error is never shown to the advocate.
