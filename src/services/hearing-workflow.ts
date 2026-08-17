import { validateFilingDate } from "../domain/filing-details";
import { parseHearingReminderAction, validateAdjournmentGround, type HearingSelectionInput } from "../domain/hearing";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  sendAdjDateInvalid,
  sendAdjDatePrompt,
  sendAdjFiled,
  sendAdjGroundInvalid,
  sendAdjIntro,
  sendAttendOk,
  type HearingSenderDeps,
  type SendHearingMessageInput,
} from "./hearing-sender";
import type { SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #38 (Prototype parity — Phase 10): the hearing-reminder and
 * adjournment-request flow.
 *
 * Scope decision (confirmed): "hearing:will-attend" is recognized GLOBALLY —
 * checked in inbound-router.ts before per-state dispatch, exactly like
 * "restart" — and never touches conversation.state at all, so there is
 * nothing to "restore" afterward; the advocate's actual current flow (a
 * mid-form draft, My cases, wherever they were) is simply never
 * interrupted. Only "hearing:seek-adjournment" temporarily borrows the
 * conversation (HEARING_ADJOURN_GROUND_PENDING -> HEARING_ADJOURN_DATE_PENDING),
 * returning to MAIN_MENU once adjFiled is sent — not an attempt to resume
 * an arbitrary prior state, since no column exists to record one (Part B
 * lists none).
 *
 * The hearing reminder itself is sent by src/scripts/send-hearing-reminders.ts
 * (a manual/operator-run script per this issue's own Scope decision — no
 * Vercel Cron wiring in this PR), never from this file — this file only
 * owns the advocate's *responses* to a reminder already sent.
 *
 * "Which filing does this response concern" is always resolved fresh
 * inside the same transaction as the write it gates (never a pointer like
 * conversations.active_filing_id, which already means something else —
 * the in-progress DRAFT, if any, which must never be disturbed by a
 * hearing response): the one FILED filing for this conversation matching
 * the expected pre-condition for each step, locked before being mutated
 * (see lockAwaitingReminderResponse/lockAwaitingAdjournment below).
 *
 * Being globally-recognized cuts both ways: a bare "1"/"2" text reply is
 * ALSO the numbered-fallback convention nearly every other screen in this
 * codebase uses for its own primary action. inbound-router.ts only honors
 * an ambiguous text-only match once hasAwaitingReminderResponse (below)
 * confirms a reminder is genuinely pending for that conversation — a
 * stable button tap (the reminder Content Template's own payload) is
 * dispatched unconditionally, since no other screen issues those ids.
 */

export interface HearingWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed write — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  hearingSenderDeps: HearingSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface HearingReminderActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: HearingSelectionInput;
}

export interface HearingAdjournFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  mediaCount: number;
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendHearingMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

/** The one FILED filing for this conversation still awaiting a response to its reminder — soonest hearing first, a deterministic tie-break for the (rare, demo-scope) case of more than one pending reminder at once. Read-only: never locks, since a stale read here only ever widens (never narrows) what the caller then re-verifies under lock — see lockAwaitingReminderResponse. */
async function findAwaitingReminderResponse(filingRepo: FilingRepository, tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null> {
  const filings = await filingRepo.listByConversation(tx, conversationId);
  const candidates = filings
    .filter((f) => f.status === "FILED" && f.hearingAttendance === null && f.nextHearingDate !== null)
    .sort((a, b) => a.nextHearingDate!.getTime() - b.nextHearingDate!.getTime());
  return candidates[0] ?? null;
}

/**
 * Re-reads and locks the candidate filing found by findAwaitingReminderResponse
 * (`SELECT ... FOR UPDATE`, mirroring every other workflow's lockById-before-
 * mutate discipline — e.g. filing-defect-workflow.ts), then re-verifies the
 * same precondition against the freshly-locked row: a concurrent write
 * between the unlocked read above and acquiring the lock (e.g. two inbound
 * webhooks racing for the same reminder) must never let both branches treat
 * the filing as still awaiting a response.
 */
async function lockAwaitingReminderResponse(filingRepo: FilingRepository, tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null> {
  const candidate = await findAwaitingReminderResponse(filingRepo, tx, conversationId);
  if (!candidate) {
    return null;
  }
  const locked = await filingRepo.lockById(tx, candidate.id);
  return locked.status === "FILED" && locked.hearingAttendance === null && locked.nextHearingDate !== null ? locked : null;
}

/**
 * #38 — read-only existence check for inbound-router.ts's global dispatch
 * gate: an ambiguous text-only match (e.g. a bare "1"/"2", which collides
 * with the numbered-fallback convention nearly every other screen in this
 * codebase also uses) must only be treated as a hearing response when a
 * reminder is genuinely pending for this conversation — never on a stable
 * button tap alone that the reminder's own Content Template would never
 * produce for any other screen. See inbound-router.ts's own comment for the
 * full rationale.
 */
export async function hasAwaitingReminderResponse(deps: HearingWorkflowDeps, conversationId: string): Promise<boolean> {
  const filing = await deps.withTransaction((tx) => findAwaitingReminderResponse(deps.filingRepo, tx, conversationId));
  return filing !== null;
}

/** The one filing mid-adjournment for this conversation, at the given sub-step (mirrors filing-defect-workflow.ts's column-presence-as-sub-state pattern). Read-only — see lockAwaitingAdjournment for the locked re-check before any mutation. */
async function findAwaitingAdjournment(
  filingRepo: FilingRepository,
  tx: RepositoryTransaction,
  conversationId: string,
  step: "ground" | "date",
): Promise<FilingRecord | null> {
  const filings = await filingRepo.listByConversation(tx, conversationId);
  return (
    filings.find(
      (f) =>
        f.hearingAttendance === "adjournment_requested" &&
        (step === "ground" ? f.adjournmentGround === null : f.adjournmentGround !== null && f.adjournmentIaNumber === null),
    ) ?? null
  );
}

function stillAwaitingAdjournment(filing: FilingRecord, step: "ground" | "date"): boolean {
  return filing.hearingAttendance === "adjournment_requested" && (step === "ground" ? filing.adjournmentGround === null : filing.adjournmentGround !== null && filing.adjournmentIaNumber === null);
}

/** Mirrors lockAwaitingReminderResponse: locks the candidate row and re-verifies the same precondition against the freshly-locked read. */
async function lockAwaitingAdjournment(filingRepo: FilingRepository, tx: RepositoryTransaction, conversationId: string, step: "ground" | "date"): Promise<FilingRecord | null> {
  const candidate = await findAwaitingAdjournment(filingRepo, tx, conversationId, step);
  if (!candidate) {
    return null;
  }
  const locked = await filingRepo.lockById(tx, candidate.id);
  return stillAwaitingAdjournment(locked, step) ? locked : null;
}

// ---------------------------------------------------------------------------
// Global: hearing:will-attend / hearing:seek-adjournment.
// ---------------------------------------------------------------------------

export async function handleHearingReminderAction(deps: HearingWorkflowDeps, input: HearingReminderActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseHearingReminderAction(input.selection);
  if (!action) {
    // Unreachable given inbound-router.ts only calls this once parseHearingReminderAction already matched.
    return { delivered: true };
  }

  if (action === "hearing:will-attend") {
    let attended = false;
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      const filing = await lockAwaitingReminderResponse(deps.filingRepo, tx, locked.id);
      if (!filing) {
        return { committed: false };
      }
      // Deliberately does NOT call conversationRepo.setStateInTx — this
      // action never touches conversation.state (see file header).
      await deps.filingRepo.upsertFilingFields(tx, filing.id, { hearingAttendance: "attending" });
      attended = true;
      return { committed: true, sends: [{ messageType: "HEARING_ATTEND_OK_MESSAGE" as const, dedupeSuffix: "hearing-attend-ok" }] };
    });

    if (!commit.committed || !attended) {
      // Nothing pending (stale tap, or already responded to) — safe no-op.
      return { delivered: true };
    }
    const delivered = await sendAttendOk(deps.hearingSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  // hearing:seek-adjournment
  let opened = false;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    const filing = await lockAwaitingReminderResponse(deps.filingRepo, tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.upsertFilingFields(tx, filing.id, { hearingAttendance: "adjournment_requested" });
    await deps.conversationRepo.setStateInTx(tx, locked.id, "HEARING_ADJOURN_GROUND_PENDING");
    opened = true;
    return { committed: true, sends: [{ messageType: "HEARING_ADJOURN_INTRO_MESSAGE" as const, dedupeSuffix: "hearing-adj-intro" }] };
  });

  if (!commit.committed || !opened) {
    return { delivered: true };
  }
  const delivered = await sendAdjIntro(deps.hearingSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// HEARING_ADJOURN_GROUND_PENDING: the real ground (free text, required).
// ---------------------------------------------------------------------------

export async function handleHearingAdjournGroundInput(deps: HearingWorkflowDeps, input: HearingAdjournFieldInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 && !input.text.trim()) {
    return { delivered: await sendAdjGroundInvalid(deps.hearingSenderDeps, sendInput) };
  }
  const validation = validateAdjournmentGround(input.text);
  if (!validation.valid || !validation.normalized) {
    return { delivered: await sendAdjGroundInvalid(deps.hearingSenderDeps, sendInput) };
  }

  let recorded = false;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "HEARING_ADJOURN_GROUND_PENDING") {
      return { committed: false };
    }
    const filing = await lockAwaitingAdjournment(deps.filingRepo, tx, locked.id, "ground");
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.upsertFilingFields(tx, filing.id, { adjournmentGround: validation.normalized });
    await deps.conversationRepo.setStateInTx(tx, locked.id, "HEARING_ADJOURN_DATE_PENDING");
    recorded = true;
    return { committed: true, sends: [{ messageType: "HEARING_ADJOURN_DATE_PROMPT" as const, dedupeSuffix: "hearing-adj-date-prompt" }] };
  });

  if (!commit.committed || !recorded) {
    return { delivered: true };
  }
  const delivered = await sendAdjDatePrompt(deps.hearingSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// HEARING_ADJOURN_DATE_PENDING: the requested date -> files the IA.
// ---------------------------------------------------------------------------

export async function handleHearingAdjournDateInput(deps: HearingWorkflowDeps, input: HearingAdjournFieldInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 && !input.text.trim()) {
    return { delivered: await sendAdjDateInvalid(deps.hearingSenderDeps, sendInput) };
  }
  const validation = validateFilingDate(input.text);
  if (!validation.valid || !validation.normalized) {
    return { delivered: await sendAdjDateInvalid(deps.hearingSenderDeps, sendInput) };
  }

  let filedFiling: FilingRecord | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "HEARING_ADJOURN_DATE_PENDING") {
      return { committed: false };
    }
    const filing = await lockAwaitingAdjournment(deps.filingRepo, tx, locked.id, "date");
    if (!filing) {
      return { committed: false };
    }
    const iaNumber = await deps.filingRepo.nextIaNumber(tx, new Date());
    await deps.filingRepo.upsertFilingFields(tx, filing.id, { adjournmentRequestedDate: validation.normalized, adjournmentIaNumber: iaNumber });
    await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
    filedFiling = { ...filing, adjournmentRequestedDate: validation.normalized!, adjournmentIaNumber: iaNumber };
    return { committed: true, sends: [{ messageType: "HEARING_ADJOURN_FILED_MESSAGE" as const, dedupeSuffix: "hearing-adj-filed" }] };
  });

  if (!commit.committed || !filedFiling) {
    return { delivered: true };
  }
  const delivered = await sendAdjFiled(deps.hearingSenderDeps, sendInput, filedFiling);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}
