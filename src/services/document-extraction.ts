import type { VisionClient } from "../adapters/anthropic-vision-client";
import { validatePersonName } from "../domain/complainant";
import { validateBankBranch, validateChequeNumber, validateFilingAmount, validateFilingDate } from "../domain/filing-details";
import type { FilingReturnReason } from "../repositories/filing-repository";

/**
 * Reads the cheque/return-memo/demand-notice photos an advocate has already
 * uploaded and returns whatever fields can be confidently read off them
 * (#40, document auto-extraction) — reversing the earlier "no OCR" scope
 * decision (#32) now that a real extraction engine exists. Only cheque,
 * memo, and notice are ever read; `id` (Aadhaar/PAN) and `support` are never
 * sent anywhere, matching the prototype's own scope.
 *
 * Every extracted candidate value is run back through the SAME validators
 * already used for manually-typed input (validateChequeNumber,
 * validateFilingDate, etc., from domain/filing-details.ts and
 * domain/complainant.ts) — never a second, looser acceptance path. A value
 * the model returns that doesn't pass validation is simply omitted, exactly
 * as if nothing had been read for that field; this also means a hallucinated
 * or malformed value can never reach the database in a shape manual entry
 * itself would have rejected.
 */
export interface DocumentExtractionDeps {
  visionClient: VisionClient;
}

export interface ChequeExtractionResult {
  chequeNumber?: string;
  chequeDate?: string;
  chequeAmount?: string;
  bankBranch?: string;
  /** The drawer/accused's name as printed on the cheque — pre-fills the accused party's fullName, never the filing row itself. */
  accusedName?: string;
}

export interface MemoExtractionResult {
  returnReason?: FilingReturnReason;
  memoDate?: string;
}

export interface NoticeExtractionResult {
  noticeDate?: string;
  serviceDate?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** ISO "YYYY-MM-DD" via the same date validator every typed date field uses — rejects anything not calendar-valid, never stores the model's raw text. */
function normalizedDate(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const result = validateFilingDate(raw);
  return result.valid && result.normalized ? result.normalized : undefined;
}

const RETURN_REASON_PATTERNS: Array<{ pattern: RegExp; value: FilingReturnReason }> = [
  { pattern: /insufficien|inadequate|no.*fund|not.*fund/i, value: "funds" },
  { pattern: /stop.*payment|payment.*stop/i, value: "stop" },
  { pattern: /account.*clos|clos.*account/i, value: "acct" },
  { pattern: /signat/i, value: "sign" },
];

/** Maps the model's free-form reading of the return memo (e.g. "Funds Insufficient") onto this app's own fixed 4-option enum — an unrecognized answer is simply omitted, falling back to the advocate's own selection. */
function normalizedReturnReason(value: unknown): FilingReturnReason | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  return RETURN_REASON_PATTERNS.find((entry) => entry.pattern.test(raw))?.value;
}

const CHEQUE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    chequeNumber: { type: "string", description: "The cheque number printed on the cheque." },
    chequeDate: { type: "string", description: "The date printed on the cheque, formatted DD-MM-YYYY." },
    chequeAmount: { type: "string", description: "The amount in figures on the cheque, digits only, no currency symbol or commas." },
    bankBranch: { type: "string", description: "The issuing bank and branch name printed on the cheque." },
    accusedName: { type: "string", description: "The name of the person or entity who signed/issued the cheque (the drawer)." },
  },
};

const CHEQUE_SYSTEM_PROMPT =
  "You are reading a photograph or scan of an Indian bank cheque for a legal-filing assistant. Extract only what is clearly legible; omit any field you cannot read with real confidence. Never guess or infer a value that is not actually printed or written on the cheque.";

export async function extractChequeFields(deps: DocumentExtractionDeps, buffer: Buffer, contentType: string): Promise<ChequeExtractionResult> {
  const result = await deps.visionClient.extractStructured({
    imageBuffer: buffer,
    contentType,
    systemPrompt: CHEQUE_SYSTEM_PROMPT,
    toolName: "extract_cheque_details",
    toolSchema: CHEQUE_TOOL_SCHEMA,
  });
  if (!result) return {};

  const patch: ChequeExtractionResult = {};
  const number = str(result.chequeNumber);
  if (number) {
    const validated = validateChequeNumber(number);
    if (validated.valid && validated.normalized) patch.chequeNumber = validated.normalized;
  }
  const date = normalizedDate(result.chequeDate);
  if (date) patch.chequeDate = date;
  const amount = str(result.chequeAmount);
  if (amount) {
    const validated = validateFilingAmount(amount);
    if (validated.valid && validated.normalized) patch.chequeAmount = validated.normalized;
  }
  const bank = str(result.bankBranch);
  if (bank) {
    const validated = validateBankBranch(bank);
    if (validated.valid && validated.normalized) patch.bankBranch = validated.normalized;
  }
  const name = str(result.accusedName);
  if (name) {
    const validated = validatePersonName(name);
    if (validated.valid && validated.normalized) patch.accusedName = validated.normalized;
  }
  return patch;
}

const MEMO_TOOL_SCHEMA = {
  type: "object",
  properties: {
    returnReason: {
      type: "string",
      description: "The reason the bank returned the cheque unpaid, in the bank's own words (e.g. 'Funds Insufficient', 'Payment Stopped', 'Account Closed', 'Signature Differs').",
    },
    memoDate: { type: "string", description: "The date printed on the bank's return memo, formatted DD-MM-YYYY." },
  },
};

const MEMO_SYSTEM_PROMPT =
  "You are reading a bank's cheque-return memo (the slip a bank issues when a cheque bounces) for a legal-filing assistant. Extract only what is clearly legible; omit any field you cannot read with real confidence.";

export async function extractMemoFields(deps: DocumentExtractionDeps, buffer: Buffer, contentType: string): Promise<MemoExtractionResult> {
  const result = await deps.visionClient.extractStructured({
    imageBuffer: buffer,
    contentType,
    systemPrompt: MEMO_SYSTEM_PROMPT,
    toolName: "extract_memo_details",
    toolSchema: MEMO_TOOL_SCHEMA,
  });
  if (!result) return {};

  const patch: MemoExtractionResult = {};
  const reason = normalizedReturnReason(result.returnReason);
  if (reason) patch.returnReason = reason;
  const date = normalizedDate(result.memoDate);
  if (date) patch.memoDate = date;
  return patch;
}

const NOTICE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    noticeDate: { type: "string", description: "The date the demand notice itself was sent/dated, formatted DD-MM-YYYY." },
    serviceDate: {
      type: "string",
      description: "The date the notice was delivered to/served on the accused, e.g. from a postal acknowledgement or courier receipt, formatted DD-MM-YYYY.",
    },
  },
};

const NOTICE_SYSTEM_PROMPT =
  "You are reading a legal demand notice and/or its proof of service (e.g. a postal acknowledgement card, courier receipt, or tracking slip) for a cheque-bounce case. Extract only what is clearly legible; omit any field you cannot read with real confidence.";

export async function extractNoticeFields(deps: DocumentExtractionDeps, buffer: Buffer, contentType: string): Promise<NoticeExtractionResult> {
  const result = await deps.visionClient.extractStructured({
    imageBuffer: buffer,
    contentType,
    systemPrompt: NOTICE_SYSTEM_PROMPT,
    toolName: "extract_notice_details",
    toolSchema: NOTICE_TOOL_SCHEMA,
  });
  if (!result) return {};

  const patch: NoticeExtractionResult = {};
  const noticeDate = normalizedDate(result.noticeDate);
  if (noticeDate) patch.noticeDate = noticeDate;
  const serviceDate = normalizedDate(result.serviceDate);
  if (serviceDate) patch.serviceDate = serviceDate;
  return patch;
}
