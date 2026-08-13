# Data-flow and threat model: Meta → Kapso → Vercel → Neon (#16 Deliverables)

**Status:** Describes the data flow and threat surface this spike's code
actually creates, plus what remains genuinely unknown pending vendor
due-diligence answers (see `kapso-vendor-due-diligence-questions.md`). This
document does not assert Kapso's subprocessor list, certifications, or
retention behavior as fact — those are open questions, listed as such below,
not filled in with assumptions. Nothing here authorizes a production change;
the Kapso path this describes is off by default (`KAPSO_SPIKE_ENABLED=false`)
everywhere, including Production.

## Data flow

### Inbound (advocate → application)

```
Advocate's WhatsApp app
        │  (WhatsApp/Signal-protocol-encrypted transport, Meta's own)
        ▼
Meta WhatsApp Business Platform
        │  (Meta → Kapso webhook, per Kapso's own infrastructure/subprocessors — unconfirmed, see below)
        ▼
Kapso platform (receives, buffers 1–60s per its docs, signs, forwards)
        │  HTTPS POST, X-Webhook-Signature: HMAC-SHA256(raw body, KAPSO_WEBHOOK_SECRET)
        ▼
Vercel serverless function — POST /webhooks/kapso/whatsapp
        │  1. Capture raw bytes (express.json's verify callback)
        │  2. Verify signature BEFORE any parsing/logging (kapso-webhook.route.ts)
        │  3. Normalize into provider-neutral InboundMessage (no PII in the normalizer itself)
        │  4. Claim MessageSid/wamid in processed_webhook_events (idempotency)
        │  5. Route to the same domain workflows Twilio's webhook already uses
        ▼
Neon Postgres (conversations, filings, filing_parties, outbound_messages, processed_webhook_events)
```

### Outbound (application → advocate)

```
Domain workflow decides to send (main-menu-sender.ts, filing-sender.ts, ...)
        │  commitWithOutbound enqueues an outbound_messages row (status=pending) in the SAME transaction as the domain write
        ▼
MessagingClient.sendInteractiveButtons/List/sendText (createKapsoMessagingClient)
        │  HTTPS POST to Kapso's Meta-passthrough REST API, X-API-Key: KAPSO_API_KEY
        ▼
Kapso platform → Meta WhatsApp Business Platform → Advocate's WhatsApp app
        │
        ▼ (asynchronously, later)
Kapso delivery-status webhook (sent/delivered/read/failed)
        │  Same signature verification path as inbound
        ▼
outbound_messages.delivery_status reconciled (recordDeliveryStatus, out-of-order-guarded)
```

## Systems in the path, and what each one sees

| System | Sees | Confirmed how |
|---|---|---|
| Meta WhatsApp Business Platform | Full plaintext message content, media, phone number/BSUID — this is unavoidable; Meta is the transport for any WhatsApp integration, Kapso or Twilio | Inherent to WhatsApp Business API |
| **Kapso** | Full plaintext message content and media it relays (Meta does not end-to-end encrypt Business API traffic the way the consumer app does client-to-client) | Kapso is a message-relay platform by design — this is the entire premise of using it |
| Kapso's own subprocessors | **Unknown.** Kapso's public docs do not publish a subprocessor list (a due-diligence question, not yet answered — see `kapso-vendor-due-diligence-questions.md`) | Not confirmed — open item |
| Vercel (this app's host) | Full plaintext message content and media URLs/ids, transiently, in the request/response cycle of a serverless function invocation | Existing architecture, unchanged by this spike |
| Neon Postgres | Normalized conversation/filing state, masked phone numbers (`processed_webhook_events.whatsapp_number_masked_or_hash`), and whatever the domain layer chooses to persist (currently: filing content the advocate typed — same as today's Twilio path) | `src/lib/logger.ts`'s `maskSender`; schema.ts |
| Application logs (Vercel) | Only what `logWebhookEvent`/`logWorkflowError`/`logDeliveryStatusEvent` explicitly construct: route, status, masked sender, message/provider ids, safe error codes — never raw body, never signatures, never credentials | `src/lib/logger.ts`, enforced by convention across every sender/workflow file; verified by this branch's own tests (e.g. `tests/kapso-webhook.test.ts` asserts no signature/secret/body leakage) |

## Threat walkthrough (what could go wrong at each hop, and what mitigates it today)

### 1. Forged webhook (attacker posts a fake "inbound message" or "delivery status" directly to our endpoint)

- **Mitigation:** `isValidKapsoSignature` — HMAC-SHA256 over the exact raw
  request bytes, timing-safe comparison, verified *before* any JSON parsing,
  logging, or routing (`kapso-webhook.route.ts`). A missing or invalid
  signature returns `403` with zero payload processing.
- **Residual risk:** if `KAPSO_WEBHOOK_SECRET` itself leaks (see the
  "Credential handling" section in the runbook — it was pasted into a chat
  transcript during this spike and must be rotated before any further use),
  an attacker with the secret can forge valid signatures. This is a secret-
  management problem, not a code-design one; the verification code itself is
  sound.

### 2. Replay of a legitimate webhook (Kapso itself retries, or an attacker replays a captured request)

- **Mitigation:** `processed_webhook_events` claims each event's id
  (`wamid` for inbound, `${providerMessageId}:${status}` for delivery
  status) before any side effect. A second delivery of the same id is a
  silent no-op — no duplicate state transition, no duplicate reply.
- **Residual risk:** none identified beyond the secret-leak scenario above
  (a replayed request with a still-valid signature is exactly what the
  idempotency claim is designed to absorb).

### 3. Sensitive data reaching logs, error messages, or crash reports

- **Mitigation:** every logging call site in the Kapso path
  (`logWebhookEvent`, `logWorkflowError`, `logDeliveryStatusEvent`) takes
  only pre-constructed safe fields — never the raw request object, never
  `req.body`, never the signature header, never `KAPSO_API_KEY`/
  `KAPSO_WEBHOOK_SECRET`. `maskSender` masks the phone number before it ever
  reaches a log line. Errors from Kapso's own API responses are deliberately
  **not** included in thrown errors (`messaging-client.ts`'s comment: "Kapso/
  Meta error payloads can echo back recipient numbers or message content").
- **Residual risk:** Vercel's own platform-level request logs (outside this
  application's control) may capture more than the application's own
  structured logs do — this is true of the existing Twilio path too and is
  not a Kapso-specific gap.

### 4. Data at rest in Neon

- **Mitigation:** unchanged from the existing Twilio-backed architecture —
  Neon's own encryption-at-rest, `whatsapp_number_masked_or_hash` for the
  idempotency table, no message body/media content stored in
  `processed_webhook_events` (only in `filings`/`filing_parties`, which is
  the domain data the advocate explicitly typed, same as today).
- **Residual risk/open item:** Neon's own security posture (encryption
  guarantees, backup/retention, access control) is out of this spike's
  scope — it's the same Neon database the Twilio path already writes to, so
  this spike introduces no *new* Neon-side risk, but also doesn't newly
  verify Neon's posture either.

### 5. BSUID/identity confusion (two different advocates' conversations merging, or one advocate's history attaching to the wrong row)

- **Mitigation today:** none needed yet — no code path produces or consumes
  a BSUID. The schema has nullable, unique-constrained columns
  (`business_scoped_user_id`, `whatsapp_username`) as groundwork only (task 2,
  commit `41d83a7`); `conversations.whatsapp_number` remains the sole
  identity key in every actual code path.
- **Open item:** if/when Kapso's `whatsapp.contact.identity_changed` event
  and phone-less BSUID identity are actually wired in, the re-keying logic
  needs its own explicit design and test coverage before it touches real
  conversations — flagged in the ADR, not solved here, because nothing yet
  produces a real BSUID to design against.

### 6. Media handling

- **Mitigation:** Kapso's inbound media fields are normalized into a
  `mediaId` (not a URL) precisely so the existing "never log the media URL"
  discipline extends automatically — there is no URL to accidentally log
  until a future `get-media-url` → `download-media-file` resolution step is
  built, and that step doesn't exist in this branch's code at all.
- **Open item:** the two-step media resolution itself (not yet built) will
  need the same no-URL-in-logs discipline applied explicitly when it's
  written — noted here so it isn't forgotten, not because it's a live gap
  today.

## Known unknowns (deliberately not assumed)

These are Kapso-side facts this document cannot responsibly state, because they
depend on answers only Kapso can give — tracked in
`kapso-vendor-due-diligence-questions.md`, cross-referenced here so the threat
model doesn't silently assume a favorable answer:

- Kapso's actual subprocessor list and their processing regions.
- Whether Kapso uses message/media content for model training or human review.
- Kapso's actual encryption-at-rest/in-transit guarantees for content, media,
  credentials, backups, and logs.
- Kapso's actual retention/deletion timeline and whether it's negotiable for
  legal data (public policy: indefinite while active, ~30–90 days post-termination).
- Kapso's breach-notification commitments and incident-response process.
- Kapso's own subprocessors' security posture (inherited risk this
  application cannot independently verify).

A threat model that assumed favorable answers to the above would be more
reassuring than honest. Until Kapso answers in writing, treat every item in
this section as **unmitigated** for the purposes of any GO decision.

## What this spike does NOT change about the threat surface

- Production traffic — 100% Twilio today, unconditionally; the Kapso route
  is never mounted in Production (`app.ts`'s `KAPSO_SPIKE_ENABLED` check).
- Twilio's own credentials, webhook, or data flow — byte-for-byte unchanged.
- Neon's connection string, access control, or backup policy.
- Any real advocate's data — this spike's own required testing scope (issue
  #16 Part C) is anonymized test data only, on an isolated Preview
  deployment and an isolated spike database (`KAPSO_SPIKE_DATABASE_URL`),
  never the application's real `DATABASE_URL`.
