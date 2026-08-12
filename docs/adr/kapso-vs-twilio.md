# ADR: Kapso vs. Twilio for WhatsApp messaging

**Status:** Draft — spike evidence and cost model only. **Not a migration decision.**
**Date:** 2026-08-12
**Related:** #16 (this spike), #2, #3, #5, #8 (implemented Twilio slices)

## Why this document exists, and what it is not

Issue #16 asks for a sourced Kapso-vs-Twilio comparison and cost model as part of a larger due-diligence spike. This document is Part A of that spike. It is **not** the GO/CONDITIONAL GO/NO-GO decision issue #16 also asks for (that's a separate writeup, blocked on two things this document cannot supply — see [Open items](#open-items-blocking-a-decision) at the bottom). Nothing here authorizes a production change. Twilio remains the only provider wired into Production and the only one this application actually sends real traffic through.

## Functional comparison

Sourced against Kapso's public docs and Twilio's public docs, both retrieved 2026-08-12. Where a page didn't state a fact clearly enough to cite, it's marked "not confirmed" rather than guessed.

| Dimension | Kapso | Twilio |
|---|---|---|
| Inbound/outbound text | Yes — Meta-passthrough REST API, JSON | Yes — REST API, form-encoded webhook |
| Quick replies / lists | Native interactive buttons (max 3) and lists (max 10 rows) — Meta's own message types, sent directly, no pre-approval step | Content Templates — must be created and approved in Twilio's Content API before use |
| Stable action payloads | `interactive.button_reply.id` / `list_reply.id` — built this branch's dispatch on it (task 6); works identically to Twilio's `ButtonPayload`/`ListId` | `ButtonPayload` / `ListId` — already in production use (#5) |
| Malayalam/Unicode | Not confirmed either way in Kapso's docs. Meta's real character limits (20-char button title, 24-char list-row title) apply regardless of provider — this branch found existing Malayalam phrases in `domain/*.ts` that plausibly exceed the row-title limit and flagged it in code (see `main-menu-sender.ts`) rather than guessing at a fix |
| Media (webhook) | Gives a media **id**, not a URL — a separate `get-media-url` → `download-media-file` call resolves it, and that download URL is explicitly "short-lived" | Gives `MediaUrl0`/`MediaContentType0` directly — an authenticated but not short-lived Twilio API resource |
| Production templates | Meta template lifecycle (create, submit, sync) via Kapso's API | Twilio Content API — Twilio-specific resource, **not** portable to Kapso or Meta directly (confirmed in issue #16's own text) |
| Webhook events | `whatsapp.message.received`, `.sent`, `.delivered`, `.read`, `.failed` via `X-Webhook-Event` header — implemented in this branch (tasks 5, 7) | Single webhook with inline status params; Twilio's separate status-callback mechanism was not in scope for this branch |
| Webhook signature | HMAC-SHA256 over raw body, `X-Webhook-Signature` header — implemented and tested this branch (`verify-signature.ts`) | HMAC-SHA1-based `X-Twilio-Signature` over the full signed URL + params — already in production (#2) |
| Retries | Documented: 3 retries at 10s/40s/90s after the first failure (~2.5 min total), then marked failed; webhook auto-pauses above 85% failure rate in a 15-min window (20+ deliveries, 10+ failures) | Twilio's retry behavior for WhatsApp webhooks was not re-verified this branch; existing idempotency design (#8's `processed_webhook_events`) is provider-agnostic either way |
| Idempotency | `wamid` per message; this branch further keys delivery-status idempotency as `${wamid}:${status}` since the same wamid recurs across its lifecycle | `MessageSid`, already the app's existing dedupe key |
| Ordering/buffering | Configurable batching window (1–60s, default 5s) and batch size (1–100, default 50); documents "possible out-of-order delivery" after the buffer timeout — this branch's `recordDeliveryStatus` guards against exactly that by timestamp comparison | Not evaluated this branch |
| Sandbox restrictions | No production template sending or multi-recipient sending in Sandbox — expected limitation, not a defect, per issue #16 | Twilio Sandbox similarly restricted; already the app's current test environment |
| Indian number/WABA ownership | Kapso's pre-verified instant numbers are **US numbers**; an Indian production number requires the organization's own SIM/WABA connected through Kapso's Embedded Signup flow — **not yet confirmed** whether Kapso or the organization ends up as the technical/billing owner of that WABA | Twilio Sandbox is test-only; production would equally require an organization-owned Indian WABA |
| API/SDK maturity | Meta-compatible REST API + open-source TypeScript SDK; this branch used raw `fetch` against the documented REST shape rather than the SDK package, to keep the spike's dependency footprint minimal | Mature, official SDK; in production use (#2) |
| Inbox / workflows / human handoff | Native shared inbox, visual workflow canvas, AI agent node — none used or needed by this branch's deterministic, code-driven state machine | No equivalent in this codebase's Twilio usage — Twilio Studio/Flex exist but were never adopted here either |
| Privacy / retention | Kapso's public privacy policy (per issue #16's own text, not re-verified this branch) states WhatsApp messages/project data are retained indefinitely while the account is active, with deletion taking ~30–90 days after termination | Governed by Twilio's own data-retention terms — not compared this branch |
| Support / SLA | Public pricing implies a contractual SLA only on custom/Enterprise arrangements | Twilio publishes a standard API SLA |
| Migration/rollback risk | This branch is additive proof: Twilio's code path is untouched at every commit (3–8), verified by running the full test suite after each change | N/A — Twilio is the incumbent |

## Cost model

**What's actually published, sourced 2026-08-12:**

**Twilio** ([pricing page](https://www.twilio.com/en-us/whatsapp/pricing)):
- $0.005 per message (inbound or outbound), Twilio's own fee
- $0.001 additional fee specifically on messages that end up `Failed`
- Meta's template fees pass through on top: Utility $0.0034/msg outside the 24h customer-service window (free inside it), Authentication $0.0034/msg, Marketing $0 (Meta doesn't charge for marketing-category messages), free-form messages $0 (only usable inside the 24h window)

**Kapso** ([pricing page](https://kapso.com/pricing), [pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq)):
- Explicitly **no markup on Meta's fees**: "Kapso pays Meta for billable messages and deducts Meta's published USD price from your project credits... Kapso adds no fee to Meta's price."
- Free plan: 2,000 messages/month, 1 connected number, 1GB storage, $0
- Pro plan: 100,000 messages/month, 3 connected numbers (then $10/extra), 100GB storage, 1,000 integration calls/month — **subscription price not published**
- Platform plan: 1,000,000 messages/month, 50 connected numbers (then $5/extra), 1TB storage, 10,000 integration calls/month — **subscription price not published**

That gap is real and worth stating plainly: **Kapso does not publish what Pro or Platform actually cost in dollars.** Only the Free tier's price ($0) and the message/number/storage allowances per tier are public. A real comparison at any volume above 2,000 messages/month requires contacting Kapso directly — this document cannot responsibly estimate a number Kapso hasn't published, and issue #16 explicitly warns against using "marketing examples" instead of real pricing.

**What can be compared directly — Twilio's own fee, at issue #16's requested volumes:**

| Volume/month | Twilio's own fee (messages only, excl. Meta's template fees) | Kapso's own fee |
|---|---|---|
| Current/test volume | ~$0 (low volume) | $0 (Free tier covers up to 2,000/mo) |
| 2,000 | $10.00 | $0 (fits Free tier) |
| 5,000 | $25.00 | Unpublished (exceeds Free tier; requires Pro) |
| 50,000 | $250.00 | Unpublished (requires Pro) |
| 100,000 | $500.00 | Unpublished (fits Pro's allowance exactly) |
| 1,000,000 | $5,000.00 | Unpublished (fits Platform's allowance exactly) |

Meta's own template/conversation fees apply identically on both providers at every volume — they're Meta's charge, not the provider's, and neither provider marks them up (confirmed for Kapso above; confirmed for Twilio, which passes through Meta's published rate). So the real question a full cost comparison reduces to is: **does Kapso's unpublished Pro/Platform subscription price beat Twilio's $0.005/message fee at the relevant volume?** At 100,000 messages/month that's a $500/month bar; at 1,000,000 it's $5,000/month. Kapso's pricing page's own framing ("lower published platform pricing at medium/high message volume," per issue #16's text) suggests they expect to win that comparison, but until an actual number is obtained directly from Kapso, that's their marketing claim, not a sourced fact this ADR can confirm.

Not included in the table above, and not evaluated this branch: phone-number/SIM costs for an Indian production number, engineering migration cost, and ongoing operational cost — issue #16 asks for all of these in a complete cost model, and they're deferred to whoever picks up Part A's remaining work.

## Migration complexity — what this branch actually proved

Tasks 3–8 built and tested a working, additive Kapso path without touching Twilio's:

- Provider-neutral `MessagingClient`/`InboundMessage` contracts (task 3) — proved by task 5–7 dropping Kapso in behind them with zero changes to Twilio's adapter or the domain workflows.
- Schema groundwork for Kapso's possible phone-less BSUID identity (task 4) — deliberately schema-only; no resolution logic written, since nothing yet produces a real BSUID to resolve against.
- A working Kapso webhook route, messaging client, and native interactive buttons/lists (tasks 5–6), with Twilio's Content-Template model correctly identified as **not portable** — Kapso has no SID equivalent, so the migration target for the current flows is native interactive messages, not templates.
- Delivery-status webhook handling and outbound-message reconciliation (task 7), verified against a real (isolated, non-production) Postgres database, not just in-memory.

At every commit on this branch, the full test suite (248 tests as of this document) passed and Twilio's own code path was unchanged — the migration's *code* risk looks low. The remaining risk is almost entirely in the parts this branch could not touch: legal/security due diligence (#16 task 2, not started) and a real Sandbox spike run against live Kapso infrastructure (#16 task 9, blocked on credentials — see below).

## Open items blocking a decision

This ADR is Part A only. Issue #16 also requires, before any GO/NO-GO:

1. **Vendor due-diligence answers** (DPA, subprocessors, data residency for Indian legal data, retention/deletion timelines, model-training use, SLA, support tiers, breach notification, exit terms) — not started; this is a business/legal conversation with Kapso, not something derivable from public docs.
2. **A real Sandbox spike run** exercising this branch's code against live Kapso infrastructure — blocked on a webhook secret, which requires registering an isolated Preview deployment's URL in the Kapso dashboard first.
3. **Indian production-number ownership** — whether the organization or Kapso ends up the technical/billing owner of the WABA is not confirmed from public docs alone.
4. **Kapso's actual Pro/Platform subscription price** — needed to complete the cost model above; requires contacting Kapso directly.

Until those are answered, the honest state of this decision is: **not yet decidable**, not "leaning yes" or "leaning no."
