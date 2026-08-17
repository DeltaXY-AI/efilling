import {
  OTHER_CASE_TYPE_DESTINATION,
  otherCaseTypeFromAction,
  parseCaseTypeAction,
  parseOtherCaseTypesAction,
  type CaseTypeSelectionInput,
} from "../domain/case-type";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import { sendCaseTypePrompt, sendOtherCaseTypesList, type CaseTypeSenderDeps } from "./case-type-sender";
import { sendFilingNotice, type FilingSenderDeps } from "./filing-sender";
import type { SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import { logWorkflowError } from "../lib/logger";

/**
 * Case-type gating, inserted before #8's FILING_NOTICE (see domain/case-type.ts
 * for why): FILING_CASE_TYPE_PENDING's top-level Cheque-bounce/Other-case-types
 * choice, and FILING_OTHER_CASE_TYPES_PENDING's full 5-item list. Picking
 * "Cheque bounce" from either screen hands off to #8's existing
 * sendFilingNotice/FILING_NOTICE — never a second notice-screen
 * implementation. Picking any of the other 4 types is always informational:
 * it never creates a filing, and always returns to FILING_CASE_TYPE_PENDING.
 */

export interface CaseTypeWorkflowDeps {
  conversationRepo: ConversationRepository;
  outboundMessageRepo: OutboundMessageRepository;
  caseTypeSenderDeps: CaseTypeSenderDeps;
  /** Reused as-is for handing off to FILING_NOTICE once "Cheque bounce" is picked — never a second implementation. */
  filingSenderDeps: FilingSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface CaseTypeActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: CaseTypeSelectionInput;
}

export interface CaseTypeWorkflowResult {
  delivered: boolean;
}

function sendInputFor(input: CaseTypeActionInput) {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

async function sendPlainInfo(deps: CaseTypeWorkflowDeps, input: CaseTypeActionInput, body: string, errorCode: string): Promise<boolean> {
  try {
    await deps.caseTypeSenderDeps.messagingClient.sendText({
      from: deps.caseTypeSenderDeps.fromNumber,
      to: input.whatsappNumber,
      body,
    });
    return true;
  } catch {
    logWorkflowError({ code: errorCode, correlationId: input.messageId });
    return false;
  }
}

const OTHER_CASE_TYPES_INTRO_TEXT: Record<SupportedLanguage, string> = {
  en: "The ON Court at Kollam takes cheque cases. For anything else I'll tell you where it goes.",
  ml: "കൊല്ലം ON കോടതി ചെക്ക് കേസുകൾ കൈകാര്യം ചെയ്യുന്നു. മറ്റെന്തിനും അത് എവിടെ പോകുന്നു എന്ന് ഞാൻ പറയാം.",
};

/**
 * Handles input at FILING_CASE_TYPE_PENDING. "Cheque bounce" hands off to
 * #8's FILING_NOTICE; "Other case types" opens the full 5-item list.
 * Unrecognized input redisplays this same prompt without changing state.
 */
export async function handleCaseTypePendingInput(deps: CaseTypeWorkflowDeps, input: CaseTypeActionInput): Promise<CaseTypeWorkflowResult> {
  const action = parseCaseTypeAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    return { delivered: await sendCaseTypePrompt(deps.caseTypeSenderDeps, sendInput) };
  }

  if (action === "filing:case-type-cheque") {
    return proceedToChequeBounceNotice(deps, input, "FILING_CASE_TYPE_PENDING");
  }

  // filing:case-type-other
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_CASE_TYPE_PENDING") {
      return { committed: false };
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_OTHER_CASE_TYPES_PENDING");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_CASE_TYPE_OTHER_INFO" as const, dedupeSuffix: "case-type-other-info" },
        { messageType: "FILING_OTHER_CASE_TYPES_PROMPT" as const, dedupeSuffix: "other-case-types-prompt" },
      ],
    };
  });

  if (!commit.committed) {
    // Stale — state already moved on. Safe no-op, matches every other screen.
    return { delivered: true };
  }

  const introDelivered = await sendPlainInfo(deps, input, OTHER_CASE_TYPES_INTRO_TEXT[input.language], "case_type_other_info_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], introDelivered);

  const listDelivered = await sendOtherCaseTypesList(deps.caseTypeSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], listDelivered);

  return { delivered: introDelivered && listDelivered };
}

/**
 * Handles input at FILING_OTHER_CASE_TYPES_PENDING. Re-selecting "Cheque
 * bounce" here does the same hand-off to FILING_NOTICE as the top-level
 * prompt. Any of the other 4 types always replies with where that case type
 * is actually handled, then returns to FILING_CASE_TYPE_PENDING — never its
 * own filing flow. Unrecognized input redisplays this same list without
 * changing state.
 */
export async function handleOtherCaseTypesPendingInput(
  deps: CaseTypeWorkflowDeps,
  input: CaseTypeActionInput,
): Promise<CaseTypeWorkflowResult> {
  const action = parseOtherCaseTypesAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    return { delivered: await sendOtherCaseTypesList(deps.caseTypeSenderDeps, sendInput) };
  }

  if (action === "filing:case-type-cheque") {
    return proceedToChequeBounceNotice(deps, input, "FILING_OTHER_CASE_TYPES_PENDING");
  }

  const otherType = otherCaseTypeFromAction(action);
  // Unreachable given parseOtherCaseTypesAction's own action set, but keeps
  // this function total rather than assuming the narrowing above.
  if (!otherType) {
    return { delivered: await sendOtherCaseTypesList(deps.caseTypeSenderDeps, sendInput) };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_OTHER_CASE_TYPES_PENDING") {
      return { committed: false };
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_CASE_TYPE_PENDING");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_CASE_TYPE_UNAVAILABLE_INFO" as const, dedupeSuffix: `case-type-unavailable-${otherType}` },
        { messageType: "FILING_CASE_TYPE_PROMPT" as const, dedupeSuffix: "case-type-prompt-resend" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const unavailableDelivered = await sendPlainInfo(
    deps,
    input,
    OTHER_CASE_TYPE_DESTINATION[otherType][input.language],
    "case_type_unavailable_send_failed",
  );
  await finalizeOutbound(deps, commit.outboundIds[0], unavailableDelivered);

  const promptDelivered = await sendCaseTypePrompt(deps.caseTypeSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], promptDelivered);

  return { delivered: unavailableDelivered && promptDelivered };
}

/** Shared by both screens' "Cheque bounce" branch: transitions straight to #8's FILING_NOTICE, guarded by whichever state the tap actually came from. */
async function proceedToChequeBounceNotice(
  deps: CaseTypeWorkflowDeps,
  input: CaseTypeActionInput,
  fromState: "FILING_CASE_TYPE_PENDING" | "FILING_OTHER_CASE_TYPES_PENDING",
): Promise<CaseTypeWorkflowResult> {
  const sendInput = sendInputFor(input);

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== fromState) {
      return { committed: false };
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
    return { committed: true, sends: [{ messageType: "FILING_NOTICE" as const, dedupeSuffix: "filing-notice" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendFilingNotice(deps.filingSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}
