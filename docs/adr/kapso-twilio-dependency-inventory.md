# Twilio dependency inventory (#16 Deliverables)

**Status:** Complete inventory of every Twilio-coupled surface, verified against
this branch's actual codebase (based on #8; does not yet include #9/#10/#11,
which post-date this spike — see [Scope note](#scope-note) at the bottom).
This document does not recommend migration; it only records what exists today
so nothing is missed when a migration is actually scheduled.

## npm dependency

- `twilio` (`^6.0.2`, `package.json`) — the official SDK, used only by
  `src/adapters/twilio/messaging-client.ts` (send) and
  `src/adapters/twilio/verify-signature.ts` (`Twilio.validateRequest`).
  Nothing else in the codebase imports it directly.

## Inbound webhook surface

- Route: `POST /webhooks/twilio/whatsapp` (`src/routes/twilio-webhook.route.ts`,
  mounted unconditionally in `src/app.ts` — unlike the Kapso route, there is no
  feature flag gating Twilio; it is always on).
- Body parsing: `application/x-www-form-urlencoded`, via
  `express.urlencoded({ extended: false })` mounted globally in `app.ts` (shared
  with any other urlencoded route — the Kapso route parses its own JSON instead,
  see `kapso-webhook.route.ts`'s comment on why).
- Signature verification: `X-Twilio-Signature` header, verified by
  `isValidTwilioSignature` (`src/adapters/twilio/verify-signature.ts`), which
  wraps `Twilio.validateRequest` — HMAC-SHA1 over the full signed webhook URL
  (`PUBLIC_BASE_URL` + path) plus the parsed form parameters, **not** the raw
  body bytes (a real difference from Kapso's raw-body HMAC-SHA256 — see the ADR).
- `PUBLIC_BASE_URL` behavior: `buildTwilioWebhookUrl` (same file) reconstructs
  the exact URL Twilio must have signed against; a mismatch (protocol, host,
  port, path, trailing slash) fails verification even for an otherwise-valid
  request. Env-validated in `src/config/env.ts` as a required absolute URL.

## Twilio-specific payload fields consumed

All in `src/adapters/twilio/normalize-inbound-message.ts`:

- `MessageSid` → `InboundMessage.messageId`, and the dedupe key for
  `processed_webhook_events` (see below).
- `From` / `To` → `InboundMessage.from`/`to`, in Twilio's `whatsapp:+<E.164>`
  format specifically (`src/lib/normalize-whatsapp-number.ts` expects this).
- `WaId` → `InboundMessage.userId` (bare digits, no `whatsapp:+` prefix —
  currently unused downstream, kept for parity/debugging).
- `ProfileName` → `InboundMessage.profileName`.
- `Body` → `InboundMessage.text`.
- `NumMedia` + indexed `MediaUrl{n}`/`MediaContentType{n}` → `InboundMessage.media[]`.
  Twilio hands back a directly-usable authenticated URL per item — no
  second resolution call, unlike Kapso's media-id pattern (see the ADR).
- `ButtonPayload`/`ButtonText` (Quick Reply taps) and `ListId`/`ListTitle`
  (List Picker taps) → the stable action-id selection every domain parser
  (`src/domain/language-selection.ts`, `main-menu.ts`, `filing.ts`) treats as
  authoritative over any text-body match.

## Outbound sending

- `TwilioMessagingClient` interface, implemented by
  `createTwilioMessagingClient` (`src/adapters/twilio/messaging-client.ts`),
  wrapping `Twilio(accountSid, authToken).messages.create(...)`.
- Every sender/workflow file depends on the now-provider-neutral
  `MessagingClient` interface (`src/types/messaging-client.ts`), not
  `TwilioMessagingClient` directly — this generalization is task 1 of the
  migration sequence and is already done on this branch (commit `2462166`).
  `TwilioMessagingClient` itself is now just a type alias re-exporting
  `MessagingClient` for backward compatibility with existing imports.
- `sendContentTemplate({ contentSid })` — Twilio's Content API resource,
  identified by an opaque SID. Twilio represents "send an interactive
  message" as a pre-approved Content Template; there is no per-request
  interactive-structure send in the current Twilio adapter (unlike Kapso).

## The seven Twilio Content Templates/SIDs (as of this branch, post-#8)

| Content SID env var | Template file | Type |
|---|---|---|
| `TWILIO_LANGUAGE_CONTENT_SID` | `twilio/templates/language-selection.json` | `twilio/quick-reply` |
| `TWILIO_MAIN_MENU_CONTENT_SID_EN` | `twilio/templates/complainant-advocate-menu.en.json` | `twilio/list-picker` |
| `TWILIO_MAIN_MENU_CONTENT_SID_ML` | `twilio/templates/complainant-advocate-menu.ml.json` | `twilio/list-picker` |
| `TWILIO_FILING_DRAFT_CHOICE_SID_EN` | `twilio/templates/filing-draft-choice.en.json` | `twilio/quick-reply` |
| `TWILIO_FILING_DRAFT_CHOICE_SID_ML` | `twilio/templates/filing-draft-choice.ml.json` | `twilio/quick-reply` |
| `TWILIO_FILING_NOTICE_SID_EN` | `twilio/templates/filing-notice.en.json` | `twilio/quick-reply` |
| `TWILIO_FILING_NOTICE_SID_ML` | `twilio/templates/filing-notice.ml.json` | `twilio/quick-reply` |

Provisioning/verification scripts (`twilio/scripts/create-*-template*.ts`,
`verify-*-template*.ts`) share `content-api-client.ts` (Content API list/create/
fetch, redaction) and `template-comparison.ts` (structural diff, canonical key
ordering) — this template-as-code machinery has **no Kapso equivalent to port
to**, since Kapso has no Content-Template-SID resource at all (confirmed in the
ADR and in `kapso-vs-twilio.md`). The migration target for these seven templates
is native Kapso interactive buttons/lists (already built, tasks 4/6), not a
1:1 template port.

## Idempotency and conversation identity

- `processed_webhook_events.message_sid` — historically Twilio-only in name;
  this branch added a `provider` column (default `"twilio"`) alongside it
  rather than renaming the column, so existing rows and every Twilio call site
  need zero changes (task 2, commit `41d83a7`). The uniqueness constraint still
  rests on `message_sid` alone.
- `conversations.whatsapp_number` — the sole identity key today, in Twilio's
  `whatsapp:+<E.164>` format. This branch added nullable
  `business_scoped_user_id`/`whatsapp_username` columns for Kapso's possible
  phone-less BSUID identity, but wrote no resolution logic — see the ADR's
  "Identity migration" section and the schema.ts comments for why that's
  deliberately deferred.
- `outbound_messages` (introduced in #8) — the durable send-intent outbox.
  This branch added `provider_message_id`, `delivery_status`,
  `delivery_status_updated_at`, and `delivery_error_code` (task 5, commit
  `433f4ce`) so the same table reconciles either provider's delivery-status
  webhooks; nothing about the existing `dedupe_key`/`enqueue`/`markSent`/
  `markFailed` contract changed.

## Operational surfaces

- **Vercel environment variables**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_FROM`, `TWILIO_LANGUAGE_CONTENT_SID`,
  `TWILIO_MAIN_MENU_CONTENT_SID_{EN,ML}`, `TWILIO_FILING_DRAFT_CHOICE_SID_{EN,ML}`,
  `TWILIO_FILING_NOTICE_SID_{EN,ML}` — all required (`src/config/env.ts`),
  all currently set in Production. None of the `KAPSO_*` variables this branch
  adds exist in Production, and none are required unless
  `KAPSO_SPIKE_ENABLED=true`.
- **Docs/runbooks**: `docs/twilio-sandbox-setup.md`, `docs/language-selection-setup.md`,
  `docs/main-menu-setup.md`, `docs/filing-drafts-setup.md` — all Twilio-specific
  setup/verification guides. None describe a Kapso equivalent; that's this
  spike's own `docs/adr/kapso-migration-runbook.md`.
- **Tests/fixtures**: `tests/twilio-*.test.ts`, `tests/normalize-inbound-message.test.ts`,
  `tests/template-comparison.test.ts`, `tests/helpers/fake-messaging-client.ts` —
  all Twilio-specific or (after task 1's generalization) shared with the Kapso
  test suite via the same `MessagingClient` fake.
- **Logs**: `src/lib/logger.ts`'s `maskSender`/`logWebhookEvent`/`logWorkflowError`
  are already provider-neutral (they operate on the normalized `InboundMessage`
  shape, not Twilio's raw payload) — no Twilio-specific logging code exists to
  migrate.

## What migrating away from Twilio would actually touch

Summarized from the above — every one of these already has a working,
tested Kapso-side equivalent on this branch, gated behind
`KAPSO_SPIKE_ENABLED`:

1. Remove the `twilio` npm dependency and `src/adapters/twilio/*`.
2. Remove `POST /webhooks/twilio/whatsapp` and its always-on mount in `app.ts`.
3. Remove the seven Content Templates, their provisioning scripts, and
   `twilio/scripts/content-api-client.ts`/`template-comparison.ts` (unless a
   later feature still needs template-as-code for actual Meta production
   templates — see the ADR's "Interactive messages and templates" section).
4. Remove the seven `TWILIO_*_CONTENT_SID*` env vars and the four
   `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM` core vars
   from Production, **only after** the observation period in the migration
   runbook — never as part of the migration itself.
5. Remove `docs/twilio-sandbox-setup.md` and the three Twilio-specific setup
   docs (or retitle them as historical/superseded).
6. Remove `tests/twilio-*.test.ts` and `fake-messaging-client.ts`'s
   Twilio-specific assertions (its provider-neutral shape stays either way).
7. `processed_webhook_events.provider` and `outbound_messages.provider_message_id`
   etc. stay in the schema regardless — they are not Twilio-specific once
   task 1/2's generalization is in place.

This is issue #16's own Part D, step 11 ("Remove Twilio code, Content SIDs,
scripts, and dependencies only in a later cleanup PR after acceptance") — the
list above is what that cleanup PR would actually contain, once a GO decision
is reached and the observation period has passed.

## Scope note

This inventory reflects the codebase as it existed when issue #16 was opened
(post-#8: language selection, main menu, filing drafts). Three further Twilio
slices (#9 advocate enrolment, #10 complainant details, #11 accused details)
merged to `main` after this spike branch was created and are **not** reflected
above — they add four more Content Templates each to the seven listed here,
plus their own `*-sender.ts`/`*-workflow.ts` files, all following the exact
same `MessagingClient`/Content-Template/plain-text pattern this inventory
describes. Re-run this inventory (or extend it) against `main` before treating
it as complete for an actual migration decision — this spike's job was to
prove the migration *approach* against the code that existed when it started,
not to re-inventory every slice merged since.
