# PR.md — Prototype Content-Parity Plan: Complainant Advocate / File a Case

**Status:** Draft for review — no code changes made against this document.
**Reference:** https://dristiwa.netlify.app/ (client-supplied clickable prototype), extracted directly from its source (a self-contained HTML/JS build — every scenario's exact bilingual script is embedded as data, not guessed from screenshots).
**Scope of this document:** Role = **Complainant Advocate** only, Scenario = **"File a case"** (the prototype's `filing` scenario), plus the cross-cutting **draft / "My cases" list** feature, per your instruction to focus there first. The prototype's other two Complainant Advocate scenarios (`defects` — scrutiny corrections, `updates` — hearing reminder/adjournment) are inventoried here for completeness but sequenced as later phases, matching `PRD.md`'s own P0/P1 split.
**Rule followed while writing this:** zero application code touched. This is planning only.

---

## 1. How this plan was built

The prototype is a single ~286 KB HTML file with all UI chrome, and — critically — every chat message, button label, form field, and validation string for all 6 roles × 13 scenarios inlined as JavaScript data objects (`const S = {...}`, `const DETAIL_SCREENS = [...]`, `const UPLOAD_SCREENS = [...]`, etc.), each with an `{en: "...", ml: "..."}` pair. That means every string quoted below is **copied verbatim from the client's own build**, not re-typed from memory or inferred from a screenshot — so "same content, same template style" is achievable exactly, not approximately.

---

## 2. Current app vs. prototype — the gap

| Area | Current `main` branch | Prototype (`dristiwa`) | Verdict |
|---|---|---|---|
| Language picker wording | Generic "🙏 നമസ്കാരം \| Welcome / Please choose your preferred language" | Names the service explicitly: *"This is the official WhatsApp service of the 24x7 ON Courts, Kollam. File cases, track them and get your cause list — right here in this chat."* | **Different copy** — needs a text swap (Phase 0) |
| Main menu | 4 options: File/resume, Case status, Change language, Help | 6 options: Cause list, Submissions, Case status, **File a case**, Change language, **My cases** | **Missing "My cases"**; Cause list/Submissions are out of current focus |
| Filing entry | Straight to a generic "demo disclaimer" | A **document checklist screen** first (what to keep ready, ~7 min estimate, explicit "your draft is saved if you stop") | **Missing entirely** |
| Document upload | Not implemented at all | 5 structured document groups (cheque, bank memo, notice+proof of service, ID proof, optional supporting docs), each with its own prompt, min/max file counts | **Missing entirely** |
| Simulated OCR / extraction | Not implemented | A "reading your documents" wait message, then a structured "here's what I read" confirmation screen (cheque no., amount, bank, dates, computed limitation window) | **Missing entirely** |
| Case details collected | Only: complainant name, phone, email, address | Complainant (+ litigant-vs-advocate + enrolment number), **Accused** (name, address, phone, entity type), **Cheque & notice** (number, date, amount, bank, return reason, memo date, notice date, service date, part-payment), **Narrative** (story, witness, optional written account), **Court selection**, **Review + declaration checkbox** | **Large gap** — today's flow is a small fraction of the prototype's field set |
| Review / confirmation | Plain-text summary + Confirm/Edit/Save-exit | Same idea, plus a generated draft **PDF preview** and an **e-Sign OTP** step | **Partially missing** (no document generation, no e-sign) |
| Filed acknowledgement | Not implemented (flow ends after complainant confirm) | Diary number, court name, filed timestamp, "scrutiny takes 2–3 days", then a simulated **court-fee payment** (₹500), then a final "what happens next" message | **Missing entirely** |
| Draft / case list | Not implemented (the multi-draft plan we discussed earlier) | A full **"My cases"** WhatsApp List message, sectioned *Drafts / Active cases / Closed*, each row a 24-char title + 72-char description, drafts kept 30 days, resume/discard per draft | **Missing entirely** — this is exactly the feature you asked me to plan previously; the prototype confirms the shape |
| Scrutiny defects | Not implemented | 3 named defects (cheque-number mismatch, illegible photo, time-barred correction + condonation petition), each with its own correction screen | Out of current focus (Phase 9, later) |
| Hearing update / adjournment | Not implemented | Reminder message, attend/adjourn choice, adjournment ground + date, filed IA acknowledgement | Out of current focus (Phase 10, later) |

---

## 3. Phased plan

**Tracking issues (created, not yet started):** #29 (Phase 1) · #30 (Phase 2) · #31 (Phase 3) · #32 (Phase 4) · #33 (Phase 5) · #34 (Phase 6) · #35 (Phase 7) · #36 (Phase 8) · #37 (Phase 9, deferred) · #38 (Phase 10, deferred). Each issue follows this repo's existing detailed-spec format (see #8/#10/#11) — Goal, Scope decisions, User flow, lettered Parts, Developer verification guide, Automated tests, Acceptance criteria, Definition of Done, Out of scope, Demo.

Each phase lists: **what to build**, **where it slots into today's architecture** (file/module names, following this repo's existing conventions — one domain file + one workflow file + sender file per concern, exactly like `language-selection.ts`/`language-workflow.ts` or `complainant-workflow.ts`/`complainant-sender.ts` today), and **exact source content** (see Appendix A for the full text blocks, referenced by key name so this plan doesn't repeat 40 KB of bilingual copy twice).

### Phase 0 — Content parity for what's already built
No new states. Pure copy replacement so the parts we've already shipped stop diverging from the reference wording.
- Replace `PLAIN_TEXT_LANGUAGE_MENU` (`language-workflow.ts`) with the prototype's `langPrompt.both` (Appendix A.1).
- Replace `CONFIRMATIONS` with `menuIntro` (Appendix A.1) — note the prototype's confirmation *includes* the "what would you like to do today" lead-in, so this folds our separate confirmation + menu-intro into one message, matching the reference's single bubble.
- **Decision needed from you:** the prototype's main-menu Content Template would need 6 rows, not today's 4 — do we widen the existing menu now (Phase 1) or keep 4 rows until the "File a case" and "My cases" work lands, then widen once? Recommend the latter, to avoid touching the Twilio Content Template twice.

### Phase 1 — Main menu: add "My cases" as an entry point (content only, feature in Phase 8)
- Add a 5th row *My cases* (Appendix A.2, `menuRows` — reusing only the `file` and `mine` rows, leaving `cause`/`other`/`status` for a later phase since those aren't part of "file a case").
- `menu:my-cases` action added to `src/domain/main-menu.ts`'s `TEXT_TO_ACTION` — routes to the Phase 8 draft-list screen. Until Phase 8 ships, this can point at a "coming soon" stub, or Phase 1 can simply be deferred until Phase 8 is ready to ship together — your call.

### Phase 2 — Document checklist screen (new state: `FILING_DOCS_CHECKLIST`)
- Replaces today's generic demo disclaimer as the first screen after `menu:file-case`.
- Exact content: `docsReady` (Appendix A.3) — lists the 8 documents/things to keep ready, the "~7 minutes, draft is saved if you stop" reassurance, and a single `startFiling` CTA.
- New workflow file: `filing-docs-workflow.ts` (or extend `filing-workflow.ts`'s existing `FILING_NOTICE` handling) — this content *replaces* the current `FILING_NOTICE` demo-disclaimer text and CTA, it doesn't add a new screen on top of it.

### Phase 3 — Document collection (new states, one per document group)
This is the first genuinely new subsystem — nothing like it exists today.
- 5 groups, in order, each its own state (`FILING_DOC_CHEQUE`, `FILING_DOC_MEMO`, `FILING_DOC_NOTICE`, `FILING_DOC_ID`, `FILING_DOC_SUPPORT`) — exact prompts and min/max counts in Appendix A.4 (`UPLOAD_SCREENS`).
- **Architecture decision needed:** Twilio's `MediaUrl` is only valid for a limited time and isn't meant as permanent storage. This phase needs a real storage decision — most likely Vercel Blob (already available in this stack per the platform's marketplace guidance) — plus a new `filing_documents` table: `id, filing_id, document_group (enum: cheque/memo/notice/id/support), storage_url, content_type, original_twilio_media_url (audit only), created_at`. This is new schema, not a reuse of existing tables.
- `mediaCount`/`media[]` handling already exists in the inbound pipeline (`normalize-inbound-message.ts`) for *rejecting* media-only input today — this phase is the first time media is actually **accepted and persisted**, which is a meaningfully different code path, not an extension of the existing reject-check.
- Per-group min/max validation (e.g. cheque: 1–2 files, notice: 1–5 files) mirrors the existing "validate, show error, redisplay prompt" pattern used everywhere else in this codebase.

### Phase 4 — Simulated extraction / "here's what I read"
- After the last document group, send `uploadedAck` (immediate) → (simulated delay) → `extractedIntro` + `extracted` (Appendix A.5) — the extracted cheque number/date/amount/bank/return reason/notice dates, plus a **computed limitation window** (30 days from notice service, per the NI Act — the prototype hardcodes an example; ours would compute it for real from the dates entered in Phase 5, since we have no real OCR).
- **Important content-fidelity note:** the prototype *pretends* to OCR the uploaded images. We have no OCR. Two honest options: (a) skip the "extracted" auto-fill illusion and go straight to a details form where the user types these fields themselves (simplest, matches our current architecture's "user types every field" pattern), or (b) integrate a real OCR/document-AI service to genuinely prefill from the cheque/memo images. Recommend (a) for this phase, with (b) flagged as a possible future enhancement — this is the one place the plan intentionally does **not** copy the prototype's exact mechanism, only its exact *wording*, since the prototype is itself simulating something that doesn't exist yet.

### Phase 5 — Case details form (the core content expansion)
Six screens, each becomes one or more new conversation states, following this repo's existing "one state per field, sequential" pattern (not a single combined form):
1. **Complainant** — extends today's existing name/phone/email/address collection with two new leading fields: *Filing as* (self / advocate-for-client) and, if advocate, *Enrolment number* (we already have enrolment-number collection built for the advocate themselves via #9 — this is a second, similar-shaped field for when they're filing as an advocate for a *litigant* complainant, a subtly different case worth flagging as a design decision).
2. **Accused** — entirely new: name, address, phone (optional), and *entity type* (individual / proprietor / company).
3. **Cheque & notice** — entirely new: cheque number, date, amount, bank & branch, return reason (4-option select), memo date, notice date, service date, and *paid after notice?* (no / part-payment).
4. **Story / narrative** — entirely new: free-text account of the transaction, plus *was anyone else present* (witness availability).
5. **Written account (optional)** — entirely new: optional document upload if they already have a written statement, instead of typing the story.
6. **Court & review** — entirely new: court selection (3-option select, hardcoded to Kollam's 3 courts in the prototype — we'd need this configurable, not hardcoded, for any other jurisdiction), the full review screen, and the declaration checkbox.

Full field-by-field content (labels, help text, options, validation) is in Appendix A.6.

**Data model:** a new `filing_accused` row (reuses the existing `filing_parties` table's `ACCUSED` role, which is already reserved but unused — see `schema.ts:45-47`, no migration needed there), plus new columns on `filings` for cheque/notice/narrative fields not currently modeled (`cheque_number`, `cheque_date`, `cheque_amount`, `bank_branch`, `return_reason`, `memo_date`, `notice_date`, `service_date`, `part_payment`, `narrative`, `witness_present`, `selected_court`) — this *is* a schema migration, the first one this plan requires.

### Phase 6 — Draft generation, review, and e-Sign
- `draftReady` (Appendix A.7) — court + fee amount summary.
- `esign` button → `otpAsk` (simulated OTP to "Aadhaar-linked mobile") → `otpBad` on invalid input (6-digit format check only, no real Aadhaar/UIDAI integration — matches `PRD.md`'s explicit "no real Aadhaar verification" exclusion).
- **This phase does not generate a real PDF.** The prototype's `DRAFT_DOC` is a hardcoded fictional document for the demo. A genuinely generated complaint PDF (real template, real merge fields) is a separate, larger piece of work than this plan currently scopes — flagging as an open question rather than quietly assuming it's included.

### Phase 7 — Filed acknowledgement + simulated payment
- `filed` (Appendix A.8) — diary number, court, filed timestamp, scrutiny-timeline expectation, prompts the ₹500 fee.
- `paidOk` (Appendix A.8) — simulated transaction ID/UPI receipt. **No real payment gateway** — matches `PRD.md`'s exclusion; this is a fake "paid" state flip, same spirit as this app's existing "recorded but not verified" enrolment-number pattern.
- `filingDone` (Appendix A.8) — final "nothing more needed from you, here's what happens next" message. **This is the new end of the Complainant Advocate "file a case" journey** — replacing today's dead-end at `ACCUSED_DETAILS_START`.

### Phase 8 — Draft & "My cases" list (the multi-draft feature we scoped earlier)
This phase is where the earlier multi-draft conversation and this prototype converge — the prototype confirms the exact shape to build toward:
- `minePrompt` + `mineRows` (Appendix A.9): a WhatsApp **List message**, sectioned *Drafts / Active cases / Closed*, newest first. WhatsApp's own List message limits apply and are already noted in the prototype's source comment: **max 10 rows, row titles ≤24 characters, descriptions ≤72 characters** — a hard constraint our implementation must also respect (today's codebase doesn't use List messages yet at all, only Quick Reply buttons and numbered text fallbacks — this is a new Twilio Content Template type for us).
- `draftCard` (Appendix A.9): tapping a draft shows a per-draft summary card (accused name, cheque number/amount, saved timestamp, a checklist of what's done vs. pending, and — notably — **days remaining until the limitation deadline**, a detail worth carrying over since it's genuinely useful, not just flavor text) with **Resume** / **Discard** actions.
- `discarded` (Appendix A.9): explicit confirmation that uploaded documents are deleted, not just the draft record — worth being equally explicit about in our own copy once Phase 3's document storage exists.
- **This directly supersedes the "restart abandons vs. parks" design question from our earlier conversation.** The prototype's answer is unambiguous: drafts are *kept* (30-day retention, explicit in `minePrompt`), never silently abandoned by a generic "restart" — abandonment is only ever a deliberate, per-draft "Discard draft" tap. Recommend we adopt exactly that: `restart` (already shipped) stays the full-reset escape hatch for a *confused* user, and this phase adds the deliberate, list-driven, per-draft resume/discard on top — not a replacement for either.

### Phase 9 — Scrutiny defects (deferred, matches `PRD.md` P0 §4.6 but out of your stated current focus)
Inventoried for completeness, not sequenced yet: 3 defects (cheque-number mismatch, illegible photo, time-barred correction requiring a ₹200 condonation petition), each its own correction screen, culminating in a resubmission acknowledgement. Full content in Appendix A.10.

### Phase 10 — Hearing update & adjournment (deferred, matches `PRD.md` P0 §4.7, out of current focus)
Inventoried for completeness: a hearing-tomorrow reminder, attend/adjourn choice, adjournment ground + date capture, and a filed-IA acknowledgement. Full content in Appendix A.11.

---

## 4. Schema changes by phase (summary)

Every schema change below goes through this repo's existing Drizzle workflow — see §4a for exactly how. Each is also spelled out with full SQL in that phase's own tracking issue (§3 lists the issue numbers), not just here.

| Phase | Issue | New/changed tables | Migration? |
|---|---|---|---|
| 1 | #29 | none | No |
| 2 | #30 | none | No |
| 3 | #31 | new `filing_documents` table (+ `filing_document_group` enum) | **Yes** |
| 4 | #32 | none (Option A — no OCR) | No |
| 5 | #33 | new columns on `filings` (cheque/notice/narrative/court fields); new `filing_return_reason` enum; reuses the existing (previously unused) `ACCUSED` role on `filing_parties`; new `entity_type` column on `filing_parties`; adds a `narrative` value to `filing_document_group` | **Yes** |
| 6 | #34 | none — confirm in the issue whether a persisted `esigned_at` audit column should be added before this ships | No (pending confirmation) |
| 7 | #35 | new columns on `filings`: `diary_number`, `filed_at`, `court_fee_paid_at`, `court_fee_transaction_id`; likely a new `filing_status` enum value (e.g. `FILED`) | **Yes** |
| 8 | #36 | none — pure query addition (`listByConversation`) over data already persisted by earlier phases; reuses #26/#28's existing `abandonDraft` | No |
| 9 | #37 | new columns on `filings` for defect tracking (notified/corrected/delay/resubmitted) | **Yes** |
| 10 | #38 | new columns on `filings` for hearing/adjournment tracking | **Yes** |

### 4a. How a schema change actually gets made in this repo

This project uses Drizzle ORM with a generate-then-apply workflow — nothing is ever hand-written as a migration file, and nothing is ever applied by editing the database directly:

1. **Edit `src/db/schema.ts`** — add/change the TypeScript table or enum definition (this is the single source of truth; `drizzle.config.ts` diffs against it).
2. **Run `npm run db:generate`** — this runs `drizzle-kit generate`, which diffs `schema.ts` against the migrations already committed under `drizzle/` and writes a new numbered SQL file (e.g. `drizzle/0007_<generated-name>.sql`) plus updates `drizzle/meta/`. This step never touches a real database — no `DATABASE_URL` is required for it.
3. **Commit the generated `.sql` file** along with the code that uses it, in the same pull request — exactly like every migration already in `drizzle/0000` through `0006`.
4. **Run `npm run db:migrate`** — this runs `src/db/migrate.ts` against the real `DATABASE_URL` (local dev DB, then Preview, then Production) to actually apply the pending migration(s). This step is what changes a live database; step 2 only generates the instructions for it.

Every phase issue that needs a schema change (§ table above) includes the exact SQL shape expected, so the generated migration should closely match what's already written in that issue — if `drizzle-kit generate`'s output looks meaningfully different, that is worth double-checking against the issue before committing it.

---

## 5. Testing approach (per this repo's existing conventions)

Every phase above would get, mirroring how #8/#9/#10 were each tested in this codebase:
- A domain-level unit test for any new validation/parsing logic (e.g. cheque-date format, return-reason enum).
- A workflow-level test (`tests/*-workflow.test.ts`) asserting state transitions and exact bilingual message content.
- At least one true HTTP-level integration test (`tests/twilio-webhook.test.ts`) per phase, extending the existing "routes a full conversation end to end" style tests already in that file.
- Bilingual assertions: every new prompt/validation-error test should assert both the English **and** Malayalam text, the same way `complainant-workflow.test.ts` already does (e.g. "sends the Malayalam validation error for a Malayalam advocate").

---

## 6. Open decisions needing your confirmation before any of this is built

1. **Menu widening (Phase 1):** widen the Twilio Content Template to 5–6 rows now, or wait until "My cases" (Phase 8) is ready and widen once?
2. **OCR illusion (Phase 4):** type-it-yourself form (matches current architecture, no new dependency) vs. real OCR/document-AI integration (matches the prototype's *behavior*, not just its wording, but is materially larger scope)?
3. **PDF generation (Phase 6):** in scope for this round, or a separately-scoped follow-up? The prototype's PDF is a static fictional artifact, not a real generator.
4. **Document storage (Phase 3):** confirm Vercel Blob (or your preferred alternative) as the storage target before that phase starts, since it's a new external dependency this codebase doesn't have yet.
5. **Court list (Phase 5):** the prototype hardcodes 3 Kollam courts. Confirm whether this should stay hardcoded for the pilot or be data-driven from day one.
6. **Restart vs. draft-list relationship (Phase 8):** confirming the recommendation in Phase 8 above — `restart` stays a full reset; the draft list adds deliberate per-draft resume/discard as a separate, additive capability.

---

## Appendix A — Exact source content, by phase

All text below is copied verbatim from the prototype's source (`en`/`ml` pairs), grouped by the phase that consumes it.

### A.1 — Phase 0 (language + menu intro)

**`langPrompt`** (single bilingual message):
```
🙏 നമസ്കാരം | Welcome

This is the official WhatsApp service of the 24x7 ON Courts, Kollam. File cases, track them and get your cause list — right here in this chat.

ദയവായി ഭാഷ തിരഞ്ഞെടുക്കുക.
Please choose your language.
```

**`menuIntro`**
- EN: `Perfect, we'll continue in English. 👍\n\nWhat would you like to do today?`
- ML: `നന്നായി, നമുക്ക് മലയാളത്തിൽ തുടരാം. 👍\n\nഇന്ന് എന്താണ് ചെയ്യേണ്ടത്?`

### A.2 — Phase 1 (menu rows, `file` and `mine` only — full 6-row set shown for reference)

| id | EN title | EN description | ML title | ML description |
|---|---|---|---|---|
| file | File a case | Start a new e-filing at the ON Court | കേസ് ഫയൽ ചെയ്യുക | പുതിയ ഇ-ഫയലിംഗ് ആരംഭിക്കുക |
| mine | My cases | Your filed cases and saved drafts | എന്റെ കേസുകൾ | ഫയൽ ചെയ്ത കേസുകളും ഡ്രാഫ്റ്റുകളും |
| cause* | Cause list | Today's and tomorrow's hearing list | കോസ് ലിസ്റ്റ് | ഇന്നത്തെയും നാളത്തെയും ഹിയറിംഗ് പട്ടിക |
| other* | Submissions | Applications, vakalatnama, certified copies | സമർപ്പണങ്ങൾ | അപേക്ഷകൾ, വക്കാലത്ത്, സാക്ഷ്യപ്പെടുത്തിയ പകർപ്പ് |
| status* | Case status | Track a case using CNR or case number | കേസ് സ്ഥിതി | CNR അല്ലെങ്കിൽ കേസ് നമ്പർ ഉപയോഗിച്ച് |
| lang | Change language | English / മലയാളം | ഭാഷ മാറ്റുക | English / മലയാളം |

(*marked rows are out of current focus — not part of this phase.)

### A.3 — Phase 2 (document checklist)

**`docsReady`**
- EN: `⚖️ Cheque bounce complaint — S.138, NI Act\n\nBefore we start, please keep these ready as photos or PDFs:\n\n• Cheque — front and back\n• Cheque return / dishonour memo from the bank\n• Demand notice sent to the accused\n• Postal receipt and acknowledgement card\n• Reply to the notice, if you received one\n• Proof of the debt — invoice, agreement or receipt\n• Your ID proof — Aadhaar or PAN\n• Vakalatnama, if an advocate is filing for you\n\n⏱️ It takes about 7 minutes. You can stop midway — your draft is saved.\n\nTap Start filing when you're ready.`
- ML: `⚖️ ചെക്ക് മടങ്ങിയ കേസ് — NI ആക്ട് വകുപ്പ് 138\n\nആരംഭിക്കുന്നതിന് മുൻപ് താഴെ പറയുന്ന രേഖകൾ ഫോട്ടോ അല്ലെങ്കിൽ PDF ആയി തയ്യാറാക്കി വെക്കുക:\n\n• ചെക്ക് — മുൻവശവും പിൻവശവും\n• ബാങ്കിൽ നിന്നുള്ള ചെക്ക് മടക്ക മെമ്മോ\n• എതിർകക്ഷിക്ക് അയച്ച ഡിമാൻഡ് നോട്ടീസ്\n• തപാൽ രസീതും അക്നോളജ്‌മെന്റ് കാർഡും\n• നോട്ടീസിന് മറുപടി ലഭിച്ചിട്ടുണ്ടെങ്കിൽ അത്\n• കടം തെളിയിക്കുന്ന രേഖ — ഇൻവോയ്സ്, കരാർ, രസീത്\n• നിങ്ങളുടെ തിരിച്ചറിയൽ രേഖ — ആധാർ അല്ലെങ്കിൽ പാൻ\n• അഭിഭാഷകൻ മുഖേനയാണെങ്കിൽ വക്കാലത്ത്\n\n⏱️ ഏകദേശം 7 മിനിറ്റ് മതി. ഇടയ്ക്ക് നിർത്തിയാലും ഡ്രാഫ്റ്റ് സേവ് ചെയ്യപ്പെടും.\n\nതയ്യാറാണെങ്കിൽ ഫയലിംഗ് ആരംഭിക്കുക അമർത്തുക.`
- Button: `Start filing` / `ഫയലിംഗ് ആരംഭിക്കുക`

### A.4 — Phase 3 (5 document groups)

| Group | EN heading | EN body | Min–Max | ML heading |
|---|---|---|---|---|
| cheque | The cheque | Photograph the cheque that bounced. Front and back, in good light. | 1–2 | ചെക്ക് |
| memo | Bank return memo | The memo the bank gave you when the cheque was returned unpaid. PDF or photo, must show reason + date. | 1–2 | ബാങ്ക് മടക്ക മെമ്മോ |
| notice | Notice and proof of service | Notice copy, postal/courier receipt, acknowledgement card, and reply if received. | 1–5 | നോട്ടീസും ലഭിച്ചതിന്റെ തെളിവും |
| id | Your ID proof | Aadhaar or PAN of the complainant. Mask the first 8 digits if Aadhaar. | 1–2 | തിരിച്ചറിയൽ രേഖ |
| support | Supporting documents | Optional — invoice/agreement/receipt proving the debt, bank statement, vakalatnama if an advocate is filing. | 0–2 | അനുബന്ധ രേഖകൾ |

(Full per-field help text is in the prototype source at `UPLOAD_SCREENS`, lines 1548–1602 of the fetched build — reproduced in full on request; trimmed here for length.)

### A.5 — Phase 4 (extraction illusion)

**`uploadedAck`**
- EN: `Got all your documents ✅\n\nI'm reading them now — the cheque, the memo and the notice. This usually takes under a minute. You'll get a message the moment I'm done, so you can close WhatsApp if you like.`
- ML: `എല്ലാ രേഖകളും ലഭിച്ചു ✅\n\nഞാൻ അവ വായിക്കുകയാണ് — ചെക്ക്, മെമ്മോ, നോട്ടീസ്. സാധാരണ ഒരു മിനിറ്റിൽ താഴെ മതി. പൂർത്തിയാകുമ്പോൾ സന്ദേശം ലഭിക്കും, വേണമെങ്കിൽ WhatsApp അടച്ചുവെക്കാം.`

**`extracted`**
- EN: `📄 Read from your documents\n\n• Cheque no. 004512 dated 12-03-2026\n• Amount ₹4,50,000\n• Drawn on South Indian Bank, Chinnakada branch\n• Drawer / accused: Rajesh Menon\n• Returned 18-03-2026 — "Funds insufficient"\n• Demand notice 25-03-2026, served 28-03-2026\n\n🗓️ Limitation: your complaint must be filed between 13-04-2026 and 13-05-2026. You have 23 days left.`
- ML: (mirrors EN, see source)

### A.6 — Phase 5 (case details form — full field list)

**Screen 1 — Complainant**: `role` (radio: Myself/litigant vs Advocate for client) → conditional `enrol` (text, shown only if role=adv) → `cname` (text) → `cphone` (text) → `cemail` (text, optional) → `caddr` (textarea).

**Screen 2 — Accused**: `aname` (text) → `aaddr` (textarea) → `aphone` (text, optional) → `acap` (select: Individual / Proprietor of a firm / Company-partnership).

**Screen 3 — Cheque and notice**: `chno` → `chdate` → `amt` → `bank` → `reason` (select: Funds insufficient / Payment stopped / Account closed / Signature differs) → `memodate` → `notdate` → `servdate` → `paid` (radio: No, nothing paid / Part payment received).

**Screen 4 — In your own words**: `story` (textarea, optional) → `witness` (radio: No one else / Someone was present).

**Screen 5 — Already written it down?**: optional document upload (0–2 files) as an alternative to typing the story.

**Screen 6 — Court and review**: `court` (select: ON Court — I, Kollam / ON Court — II, Kollam / JFCM, Kottarakkara) → full review of every field entered → `declare` (checkbox: "I declare that the facts stated above are true to the best of my knowledge and belief." / Malayalam equivalent).

Every field's exact label, help text, and option text is in the prototype source at `DETAIL_SCREENS`, lines 1605–1717 — reproduced in full on request; the table above is the structural summary needed to scope the work.

### A.7 — Phase 6 (draft ready / e-sign)

**`draftReady`**
- EN: `✅ Your complaint is ready\n\nI've drafted the complaint under S.138 of the NI Act with the sworn statement and the list of documents, and picked the court with jurisdiction.\n\nCourt: ON Court — I, Kollam\nCourt fee payable: ₹500`

**`otpAsk`**
- EN: `🔐 An OTP has been sent to the Aadhaar-linked mobile ending 4821.\n\nType the 6-digit OTP here to e-Sign the complaint.`

**`otpBad`**: `That doesn't look like a 6-digit OTP. Please try again.` / `അത് 6 അക്ക OTP അല്ല. വീണ്ടും ശ്രമിക്കുക.`

### A.8 — Phase 7 (filed / paid / done)

**`filed`**
- EN: `🎉 Filed successfully\n\nDiary no. KLKL01-000482-2026\nCourt: ON Court — I, Kollam\nFiled on: 20-04-2026, 9:41 AM\n\nScrutiny usually takes 2–3 working days. I'll message you the moment the case number is allotted or if the registry raises a defect.\n\nPay the court fee of ₹500 to complete the filing.`

**`paidOk`**
- EN: `✅ Court fee paid\n\n₹500 received towards the court fee in diary no. KLKL01-000482-2026.\n\nTransaction ID: GRN2604000482\nPaid on: 20-04-2026, 10:04 AM\nMode: UPI`

**`filingDone`**
- EN: `🎉 Your filing is complete\n\nNothing more is needed from you right now. Here's what happens next:\n\n1️⃣ The registry scrutinises the complaint — 2 to 3 working days\n2️⃣ If anything is missing, I'll message you with exactly what to fix\n3️⃣ Once numbered, you'll get the case number and the first hearing date here\n\nYou can check progress any time under My cases.`

(Malayalam equivalents for all three are in the source, reproduced on request.)

### A.9 — Phase 8 (My cases / drafts)

**`minePrompt`**: `Here's everything of yours at the ON Court, most recent first.\n\nDrafts are kept for 30 days.` / Malayalam equivalent.

**Example rows** (WhatsApp List message, max 10 rows / 24-char title / 72-char description):

| Section | Title | Description |
|---|---|---|
| Drafts | Draft · S.138 complaint | Rajesh Menon · ₹4,50,000 · documents uploaded |
| Drafts | Draft · Vakalatnama | CC 88/2026 · started 12-04-2026 |
| Active cases | CC 412/2025 | vs Rajesh Menon · evidence · next 28-04-2026 |
| Active cases | CC 88/2026 | vs Suresh Nair · appearance · next 05-05-2026 |
| Closed | CC 19/2024 | vs Manoj P · disposed 14-11-2025 · compounded |

**`draftCard`** (tapping a draft): `📝 Draft — cheque bounce complaint\n\nAccused: Rajesh Menon\nCheque 004512 · ₹4,50,000\nSaved 18-04-2026, 8:12 PM\n\n✅ 10 documents uploaded\n✅ Details read from the documents\n⬜ Case details not confirmed yet\n\n⏳ File before 13-05-2026 — 23 days left.`

Buttons: `Continue filing` / `ഫയലിംഗ് തുടരുക` · `Discard draft` / `ഡ്രാഫ്റ്റ് ഒഴിവാക്കുക`

**`discarded`**: `Draft discarded. The documents you had uploaded have been deleted from the court's servers.` / `ഡ്രാഫ്റ്റ് ഒഴിവാക്കി. അപ്‌ലോഡ് ചെയ്ത രേഖകൾ കോടതിയുടെ സെർവറിൽ നിന്ന് നീക്കം ചെയ്തു.`

### A.10 — Phase 9 (scrutiny defects — deferred)

3 defects: (1) cheque-number mismatch — re-enter correct number; (2) illegible cheque photo — re-upload; (3) time-barred correction — reason for delay + condonation petition (₹200 fee). Full screen definitions at `DEFECT_SCREENS` in the source, lines 2637–2699.

### A.11 — Phase 10 (hearing update / adjournment — deferred)

`updReminder` (hearing-tomorrow alert) → `willAttend`/`seekAdj` choice → `attendOk` (if attending) or `adjIntro` + ground/date capture → `adjFiled` (IA filed acknowledgement). Full text at lines 1187–1208 of the source.

---

*End of plan. Nothing above has been implemented — awaiting your review and the open decisions in §6 before any phase starts.*
