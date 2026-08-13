# Kapso migration, rollout, and rollback runbook (#16 Part D)

**Status:** Steps 1–6 done and merged to this branch. Steps 7–11 not started — each is
gated on something outside this branch's control (real credentials, a business
decision, or both). This runbook describes the full sequence issue #16 asks for,
marks exactly where the branch actually is today, and gives the rollback procedure
for the part that *has* shipped.

## Sequence

| # | Step | Status | Where | Tracking issue |
|---|---|---|---|---|
| 1 | Generalize provider-neutral inbound/outbound interfaces, no behavior change | ✅ Done | `2462166` | — |
| 2 | Generalize webhook-event persistence and identity schema, incl. BSUID support | ✅ Done | `41d83a7` | — |
| 3 | Add the Kapso client and signed webhook adapter behind a feature flag | ✅ Done | `87426dd` | — |
| 4 | Add native interactive buttons/lists, preserving numbered fallbacks | ✅ Done | `acebb62` | — |
| 5 | Add delivery-status handling and Kapso-aware outbox reconciliation | ✅ Done | `433f4ce` | — |
| 6 | Complete automated contract/integration tests | ✅ Done (248 tests, folded into 3–5) | — | — |
| — | Send vendor due-diligence questions, record answers (Gate 1) | ⏳ Drafted, not sent | `kapso-vendor-due-diligence-questions.md` | [#19](https://github.com/DeltaXY-AI/efilling/issues/19) |
| 7 | Run Preview/Sandbox English and Malayalam mobile verification (Gate 2) | ⏳ Blocked — needs a real webhook secret and a phone | — | [#20](https://github.com/DeltaXY-AI/efilling/issues/20) |
| — | Resolve small open technical items this spike flagged | ❌ Not started | — | [#21](https://github.com/DeltaXY-AI/efilling/issues/21) |
| 8 | Connect and verify the approved Indian production number/WABA | ❌ Not started — blocked on Gates 1+2 | — | [#22](https://github.com/DeltaXY-AI/efilling/issues/22) |
| 9 | Controlled canary/cutover with monitoring | ❌ Not started — blocked on step 8 | — | [#23](https://github.com/DeltaXY-AI/efilling/issues/23) |
| 10 | Keep Twilio rollback available for the observation period | N/A — nothing has cut over yet | — | (part of #23) |
| 11 | Remove Twilio code/Content SIDs/scripts only after acceptance | ❌ Not started, correctly deferred | — | [#24](https://github.com/DeltaXY-AI/efilling/issues/24) |

Every step 1–6 commit left Twilio's own code path byte-for-byte unchanged, verified
by running the full suite after each one — that's what makes steps 7+ safe to
attempt without steps 1–6 needing to be redone. Issues #19–#24 are the "sequence
of small implementation issues/PRs" issue #16 Part D asks for, sliced so each is
independently reviewable and explicitly ordered by its real dependencies (#22
cannot start before #19 and #20 close; #23 cannot start before #22; #24 cannot
start before #23's observation period passes with no rollback).

## Owners and prerequisites

- **Code owner (this branch):** whoever picks this up next — nothing here requires
  the original author specifically.
- **Vendor/legal owner:** whoever sends `kapso-vendor-due-diligence-questions.md`
  and owns the DPA/security conversation. Step 8 cannot proceed without this
  closing.
- **Number/WABA owner:** whoever controls the organization's Meta Business
  Manager account — needed for step 8's Indian number connection.
- **On-call/ops owner:** whoever watches the canary in step 9 and can execute the
  rollback procedure below if it goes wrong.

Prerequisite for step 7: the three items in [Environment variables](#environment-variables) below, all currently missing or placeholder.

## Environment variables

All Kapso-related variables are optional and default to disabled — see `.env.example`. None of these exist in Production today, and step 9 is the only step that would ever add them there.

| Variable | Where it lives today | Needed for |
|---|---|---|
| `KAPSO_SPIKE_ENABLED` | Unset (defaults `false`) everywhere | Gates the whole Kapso route — must stay `false` in Production until step 9 |
| `KAPSO_API_KEY` | `.env.local`, gitignored | Sending via Kapso's API |
| `KAPSO_PHONE_NUMBER_ID` | `.env.local`, gitignored | Identifies the sending number |
| `KAPSO_BUSINESS_ACCOUNT_ID`, `KAPSO_CONFIG_ID` | `.env.local`, gitignored | Recorded for reference; not read by any code path yet |
| `KAPSO_WEBHOOK_SECRET` | **Missing** — blank in `.env.local` | Signature verification; only obtainable by registering a real webhook URL in the Kapso dashboard |
| `KAPSO_SPIKE_DATABASE_URL` | `.env.local`, gitignored | An isolated Neon database, separate from the app's real `DATABASE_URL` — used for every migration/smoke-test in tasks 4 and 7 |

**Secret rotation:** `KAPSO_API_KEY` was pasted into a chat transcript during this
spike and should be rotated in the Kapso dashboard before this branch goes anywhere
near step 8. The Neon password behind `KAPSO_SPIKE_DATABASE_URL` was also pasted
into chat and should be rotated the same way, in the Neon console. Neither is used
by Production today, so rotating them has zero blast radius — do it regardless of
whether this migration proceeds.

## Vercel configuration

- Step 7 needs an **isolated Preview deployment** (not Production) with
  `KAPSO_SPIKE_ENABLED=true` and the three Kapso variables above set as
  Preview-only environment variables in the Vercel dashboard.
- Register that Preview deployment's URL (`https://<preview>.vercel.app/webhooks/kapso/whatsapp`)
  in the Kapso dashboard as the webhook target — this is what generates the real
  `KAPSO_WEBHOOK_SECRET`.
- Production's environment variables are not touched by any step before 9, and
  step 9 itself should add them behind the same `KAPSO_SPIKE_ENABLED` flag,
  flipped only after the canary in step 9 is judged healthy.

## WABA/number/template setup (step 8, when it happens)

1. Confirm the answer to the due-diligence question "who owns the Meta Business
   Portfolio/WABA/number" *before* connecting anything — this is one of issue
   #16's non-negotiable gates, not a detail to sort out after.
2. Connect the organization's own Indian SIM/number through Kapso's Embedded
   Signup flow (Kapso's pre-verified instant numbers are US numbers and are not
   the production path).
3. Recreate the current Twilio Content Templates as native Kapso interactive
   messages — this branch's `main-menu-sender.ts`/`filing-sender.ts`/
   `language-workflow.ts` already send native interactive buttons/lists when the
   capability is present (task 6), so this step is largely "verify it renders
   correctly against production Meta review," not new engineering.
4. Get Meta's business verification, display-name approval, and template approval
   done — timeline unknown; ask about it in the due-diligence conversation.

## Database migrations and backups

Every schema change in this spike (`drizzle/0005_*.sql`, `drizzle/0006_*.sql`) is
purely additive — new nullable/defaulted columns and enums, no column drops, no
type narrowing, no data rewrites. That means:

- Applying them to Production is low-risk in isolation (confirmed by running each
  migration against the isolated spike DB and smoke-testing the real Drizzle
  queries against it — see task 4 and task 7 commit messages).
- Rolling them back is equally low-risk: a compensating migration would simply
  drop the new columns/enums, and no existing Twilio-path code reads or writes
  them, so there is nothing to reconcile on rollback.
- **Before applying to Production**, take a normal Neon branch/backup snapshot
  first regardless — this runbook's confidence is based on a spike DB, not
  Production's actual data shape or volume.

## Cutover and validation steps (step 9, when it happens)

1. Deploy with `KAPSO_SPIKE_ENABLED=true` behind a canary — a small, explicit
   percentage of traffic or a specific test cohort, not 100% of advocates.
2. Validate the full committed English + Malayalam flow end to end against the
   canary: language picker → main menu → draft choice / test notice → advocate
   enrolment capture (once that flow is ported) — using the same acceptance
   criteria the original Twilio slices (#2, #3, #5, #8) were validated against.
3. Watch the monitoring below for the agreed observation period before expanding
   the canary.

## Monitoring

| Signal | What to watch | Where |
|---|---|---|
| Health | Route mounts correctly, `KAPSO_SPIKE_ENABLED` reflects intent | `health.route.ts` pattern; extend if needed |
| Webhook failures | 403s (signature mismatches), 5xx responses from the route | Structured logs via `logWebhookEvent` |
| Delivery failures | `outbound_messages.status = 'failed'`, `delivery_status = 'failed'` with `delivery_error_code` populated | Query `outbound_messages`; `logDeliveryStatusEvent` for real-time signal |
| Latency | Time from inbound webhook receipt to outbound send completing | Not currently instrumented — add before a real cutover, not before |
| Queue/outbox health | Rows stuck at `status = 'pending'` past a reasonable window (a crash between enqueue and `finalizeOutbound`) | Query `outbound_messages` for stale `pending` rows |
| Business-flow correctness | Conversations reaching expected states (`MAIN_MENU`, `FILING_NOTICE`, etc.) at expected rates | Query `conversations.state` distribution |

## Stop conditions and rollback triggers

Stop the canary and roll back immediately if any of:
- Signature verification failure rate rises unexpectedly (could mean the webhook
  secret was rotated without updating the deployment, or a real attack).
- `outbound_messages` rows accumulate in `failed` status beyond what Twilio's
  historical failure rate would predict.
- Any advocate-facing flow silently drops a state transition Twilio's equivalent
  flow handles correctly today.
- Kapso's own status page (`status.kapso.ai`) reports an active incident.

## Rollback procedure

Because every change through task 7 is additive and gated behind
`KAPSO_SPIKE_ENABLED`:

1. Set `KAPSO_SPIKE_ENABLED=false` in the affected environment (Preview or, if it
   ever got there, Production). This alone stops all Kapso traffic — the route
   simply stops being mounted (`app.ts`'s conditional), and Twilio's route is
   completely unaffected since it was never touched.
2. No data reconciliation is required for the rollback itself: conversations and
   filings are keyed by `whatsapp_number`, which doesn't change; Kapso-specific
   columns (`provider`, `provider_message_id`, `delivery_status`, ...) simply stop
   being written to and can be left in place harmlessly, or dropped in a later
   cleanup migration once the decision is final either way.
3. If a canary cohort was mid-conversation at the moment of rollback, those
   advocates' conversations remain exactly where they were in `conversations.state`
   — nothing is lost, they simply need to be re-pointed at whichever channel is
   live (a support/manual-follow-up concern, not a data-loss one).
4. Twilio's credentials, code, Content Templates, and scripts are never touched by
   any rollback — step 11 (their eventual removal) only happens after acceptance,
   explicitly *after* the observation period below, never as part of a rollback.

## Post-cutover observation period

Not yet defined — this should be set by whoever owns the eventual step 9 canary,
informed by Kapso's own documented failure-rate/retry windows (a 15-minute window
with 20+ deliveries is what Kapso itself uses to auto-pause a misbehaving webhook,
which is a reasonable floor for how long to watch before calling a canary healthy).

## Credential cleanup

Twilio's `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/Content SIDs and this branch's
`KAPSO_*` variables should only be rotated or removed **after** the observation
period above has passed with no rollback triggered — removing Twilio access while
rollback might still be needed would make the rollback procedure above
non-executable.
