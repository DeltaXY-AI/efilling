# Kapso migration decision (#16)

**Decision: CANNOT BE DECIDED YET.** Not a lean toward GO, not a lean toward
NO-GO — genuinely undecidable until the two open gates below close. This is by
design: issue #16 requires the decision to be approved by engineering, product,
*and* a designated security/privacy/legal owner, and two of the inputs that
approval depends on don't exist yet. Producing a GO or NO-GO from what's actually
known today would mean pretending those gates are optional. They aren't.

**Prepared by:** this branch's work (tasks 3–8, 10, 11). **Approved by:** nobody
yet — that's the point of this document existing before a decision is made, not
after.

**Related documents:** `kapso-vs-twilio.md` (functional/cost comparison),
`kapso-twilio-dependency-inventory.md` (every current Twilio-coupled surface),
`kapso-data-flow-threat-model.md` (Meta → Kapso → Vercel → Neon data flow and
threat walkthrough), `kapso-vendor-due-diligence-questions.md` (Gate 1),
`kapso-migration-runbook.md` (rollout/rollback sequence).

## What's known and settled

From `kapso-vs-twilio.md` and the code actually shipped on this branch:

- **Migration is technically low-risk.** Every commit (3–8) kept Twilio's own
  code path byte-for-byte unchanged, verified by the full test suite (248 tests)
  after each one. A real Kapso adapter — webhook route, messaging client, native
  interactive buttons/lists, delivery-status reconciliation — exists, is tested,
  and is gated fully off by default (`KAPSO_SPIKE_ENABLED`, unset in Production).
- **Kapso has no template-SID equivalent to Twilio's Content Templates**, and the
  correct migration target for the current flows is native interactive
  buttons/lists, not templates — already built and tested.
- **Neither provider marks up Meta's own per-message fees.** Twilio adds its own
  $0.005/message on top; Kapso adds nothing on top of Meta's price, per Kapso's
  own billing docs.
- **Kapso's actual subscription price for the volumes that would matter (Pro at
  100k msgs/mo, Platform at 1M msgs/mo) is not publicly published.** Only the
  message/number/storage allowances are. This alone is enough to block a cost-based
  recommendation regardless of the other two gates.

## Gate 1 — Vendor due-diligence (#16 task 2): NOT STARTED

`kapso-vendor-due-diligence-questions.md` is drafted and ready to send, but nobody
has sent it yet. Until Kapso answers in writing:

- Whether they'll sign a DPA, and what their subprocessor/data-residency posture
  is for Indian legal data — **this is the single highest-stakes unknown**, given
  this application handles case-filing data for actual (if currently
  test/anonymized) court proceedings.
- Their actual retention/deletion timeline (public policy says up to ~90 days
  post-termination — unconfirmed whether that's negotiable).
- Contractual SLA and support terms at the tier we'd actually be on.
- Who owns the Meta WABA/number once connected — organization or Kapso.
- The actual Pro/Platform price.

**A NO-GO is fully possible here** — e.g. if Kapso won't sign a DPA, or won't
commit to a shorter retention window for legal data, that alone should end the
evaluation regardless of everything else looking favorable.

## Gate 2 — Real Sandbox spike (#16 task 9): BLOCKED

Blocked on a webhook secret (needs a registered Preview URL in the Kapso
dashboard) and a physical phone to actually exchange WhatsApp messages. Nothing
here has been run against live Kapso infrastructure — every test so far is either
a unit test, an in-memory integration test, or a smoke test against Kapso's
*database* pattern via a real Postgres connection (not Kapso's actual API/webhook
infrastructure). The spike checklist in issue #16 — signature verification against
a real webhook, real delivery-status events, real English/Malayalam rendering on
an actual phone — has not been executed even once.

**This gate could surface real problems the code-level work couldn't**: whether
Meta actually accepts the interactive button/list payloads this branch
constructs (particularly the Malayalam titles flagged as possibly exceeding
Meta's character limits), what Kapso's real webhook latency and retry behavior
looks like in practice, and whether the two-step media-id-to-URL resolution
(flagged but not implemented) is a real blocker for the document-extraction
feature discussed earlier.

## What would need to be true for GO

All of:
1. Kapso answers gate 1 with no disqualifying answer (DPA signed or in progress,
   acceptable retention terms for legal data, WABA ownership confirmed as the
   organization's, an actual price that beats Twilio's computable fee at the
   relevant volume).
2. Gate 2's spike runs clean — real signature verification, real delivery-status
   events, both languages rendering correctly on a real phone, no surprises Meta's
   API throws back that this branch's code doesn't already handle gracefully.
3. Product/engineering sign-off that the migration's remaining scope (steps 8–11
   in `kapso-migration-runbook.md` — Indian WABA connection, canary cutover,
   Twilio decommission) is worth scheduling.

## What would need to be true for NO-GO

Any of:
- Kapso won't sign a DPA or won't commit to retention terms compatible with legal
  data handling.
- The real Sandbox spike surfaces a correctness or reliability problem this
  branch's code can't reasonably absorb.
- Kapso's actual price, once obtained, doesn't beat Twilio's computable fee by
  enough to justify the migration effort in `kapso-migration-runbook.md`.
- The Indian WABA/number path turns out to have no better story than what Twilio
  already requires (i.e., the migration solves nothing Twilio doesn't already
  handle).

## Recommendation

Send `kapso-vendor-due-diligence-questions.md` to Kapso now — it's the
higher-leverage next step, since a disqualifying legal/privacy answer would make
the Sandbox spike moot. Run the Sandbox spike in parallel if credentials become
available sooner. Revisit this document once both close; it should take one
pass to convert into an actual GO/CONDITIONAL GO/NO-GO at that point, since
everything else is already built, tested, and written up.
