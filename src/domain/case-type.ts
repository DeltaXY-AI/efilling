/**
 * Case-type gating, inserted between "File a case" and #8's existing
 * FILING_NOTICE screen: only cheque-bounce (S.138) is actually filed here.
 * Every other case type is shown for transparency (so an advocate can see
 * what this service does and doesn't cover) but always resolves to an
 * informational "not available yet, here's where it goes" reply, never its
 * own filing flow. Mirrors domain/filing.ts's shape exactly.
 */

export type CaseTypeAction = "filing:case-type-cheque" | "filing:case-type-other";

const CASE_TYPE_ACTIONS: ReadonlySet<string> = new Set(["filing:case-type-cheque", "filing:case-type-other"]);

const CASE_TYPE_TEXT_TO_ACTION: Record<string, CaseTypeAction> = {
  "1": "filing:case-type-cheque",
  "cheque bounce": "filing:case-type-cheque",
  "cheque bounce (s.138)": "filing:case-type-cheque",
  "ചെക്ക് മടങ്ങൽ": "filing:case-type-cheque",
  "2": "filing:case-type-other",
  "other case types": "filing:case-type-other",
  "മറ്റ് കേസ് തരങ്ങൾ": "filing:case-type-other",
};

/** The 4 case types this service doesn't file, each just told where it actually goes. */
export type OtherCaseType = "money" | "rent" | "consumer" | "matrimonial";

/** The full "Case types" list's own action set: re-selecting cheque bounce here does the same thing as the top-level prompt; the other 4 are informational-only. */
export type OtherCaseTypesAction = "filing:case-type-cheque" | `filing:other-type-${OtherCaseType}`;

const OTHER_CASE_TYPES_ACTIONS: ReadonlySet<string> = new Set([
  "filing:case-type-cheque",
  "filing:other-type-money",
  "filing:other-type-rent",
  "filing:other-type-consumer",
  "filing:other-type-matrimonial",
]);

const OTHER_CASE_TYPES_TEXT_TO_ACTION: Record<string, OtherCaseTypesAction> = {
  "1": "filing:case-type-cheque",
  "cheque bounce": "filing:case-type-cheque",
  "2": "filing:other-type-money",
  "money recovery": "filing:other-type-money",
  "3": "filing:other-type-rent",
  "rent and eviction": "filing:other-type-rent",
  "4": "filing:other-type-consumer",
  "consumer complaint": "filing:other-type-consumer",
  "5": "filing:other-type-matrimonial",
  matrimonial: "filing:other-type-matrimonial",
};

export interface CaseTypeSelectionInput {
  /** Twilio's stable ID for a quick-reply tap. */
  buttonPayload?: string;
  buttonText?: string;
  /** Twilio's stable ID for a twilio/list-picker selection. */
  listId?: string;
  listTitle?: string;
  body?: string;
}

function resolveStableId(input: CaseTypeSelectionInput): string {
  return (input.buttonPayload || input.listId || "").trim();
}

function resolveTextCandidates(input: CaseTypeSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || input.listTitle || "").trim().toLowerCase()];
}

/** Resolves the top-level Cheque-bounce/Other-case-types choice. A supplied stable ID is authoritative, exactly like every other action parser in this codebase. */
export function parseCaseTypeAction(input: CaseTypeSelectionInput): CaseTypeAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return CASE_TYPE_ACTIONS.has(stableId) ? (stableId as CaseTypeAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in CASE_TYPE_TEXT_TO_ACTION) {
      return CASE_TYPE_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

/** Resolves a selection from the full 5-item "Case types" list. */
export function parseOtherCaseTypesAction(input: CaseTypeSelectionInput): OtherCaseTypesAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return OTHER_CASE_TYPES_ACTIONS.has(stableId) ? (stableId as OtherCaseTypesAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in OTHER_CASE_TYPES_TEXT_TO_ACTION) {
      return OTHER_CASE_TYPES_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

/** Where each non-cheque case type is actually handled — told to the advocate instead of silently refusing. */
export const OTHER_CASE_TYPE_DESTINATION: Record<OtherCaseType, Record<"en" | "ml", string>> = {
  money: {
    en: "Money recovery suits are handled at the Munsiff Court, not through this service.",
    ml: "പണം തിരികെ വാങ്ങാനുള്ള കേസുകൾ മുൻസിഫ് കോടതിയിലാണ് കൈകാര്യം ചെയ്യുന്നത്, ഈ സേവനത്തിലൂടെയല്ല.",
  },
  rent: {
    en: "Rent and eviction cases are handled at the Rent Control Court, Kollam, not through this service.",
    ml: "വാടകയും കുടിയൊഴിപ്പിക്കലും സംബന്ധിച്ച കേസുകൾ കൊല്ലം റെന്റ് കൺട്രോൾ കോടതിയിലാണ് കൈകാര്യം ചെയ്യുന്നത്, ഈ സേവനത്തിലൂടെയല്ല.",
  },
  consumer: {
    en: "Consumer complaints are handled at the District Consumer Commission, not through this service.",
    ml: "ഉപഭോക്തൃ പരാതികൾ ജില്ലാ ഉപഭോക്തൃ കമ്മീഷനിലാണ് കൈകാര്യം ചെയ്യുന്നത്, ഈ സേവനത്തിലൂടെയല്ല.",
  },
  matrimonial: {
    en: "Matrimonial cases are handled at the Family Court, Kollam, not through this service.",
    ml: "കുടുംബ കോടതി (കൊല്ലം) ആണ് വൈവാഹിക കേസുകൾ കൈകാര്യം ചെയ്യുന്നത്, ഈ സേവനത്തിലൂടെയല്ല.",
  },
};

/** Extracts the OtherCaseType from an OtherCaseTypesAction of the form "filing:other-type-X", for looking up OTHER_CASE_TYPE_DESTINATION. */
export function otherCaseTypeFromAction(action: OtherCaseTypesAction): OtherCaseType | null {
  if (action === "filing:case-type-cheque") {
    return null;
  }
  return action.slice("filing:other-type-".length) as OtherCaseType;
}
