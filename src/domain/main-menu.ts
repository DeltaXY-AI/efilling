import { isLanguageChangeRequest, type SelectionInput } from "./language-selection";

export type MenuAction = "menu:file-case" | "menu:case-status" | "menu:change-language" | "menu:help";
export type MenuTargetState = "FILING_START" | "CASE_STATUS_START" | "AWAITING_LANGUAGE" | "MAIN_MENU";

export const MENU_ACTION_TARGET_STATE: Record<MenuAction, MenuTargetState> = {
  "menu:file-case": "FILING_START",
  "menu:case-status": "CASE_STATUS_START",
  "menu:change-language": "AWAITING_LANGUAGE",
  "menu:help": "MAIN_MENU",
};

const STABLE_MENU_ACTIONS: ReadonlySet<string> = new Set(Object.keys(MENU_ACTION_TARGET_STATE));

// Numbers and exact localized titles, per action. Matching is
// case-insensitive for Latin text; Malayalam script has no case, so
// lower-casing it is a no-op and safe to include in the same map.
const TEXT_TO_ACTION: Record<string, MenuAction> = {
  "1": "menu:file-case",
  "file or resume case": "menu:file-case",
  "കേസ് ഫയൽ ചെയ്യുക": "menu:file-case",
  "2": "menu:case-status",
  "check case status": "menu:case-status",
  "കേസ് സ്ഥിതി": "menu:case-status",
  "3": "menu:change-language",
  "change language": "menu:change-language",
  "ഭാഷ മാറ്റുക": "menu:change-language",
  "4": "menu:help",
  help: "menu:help",
  "സഹായം": "menu:help",
};

const MENU_REDISPLAY_TRIGGERS = new Set(["menu", "മെനു"]);

export interface MenuSelectionInput extends SelectionInput {
  /** Twilio's stable ID for a twilio/list-picker selection (analogous to ButtonPayload for quick-reply). */
  listId?: string;
  /** The selected item's title text, for twilio/list-picker responses. */
  listTitle?: string;
}

/**
 * Resolves a recognized menu action per the documented input priority:
 * stable ID (ButtonPayload or ListId) first — authoritative — then the
 * "language"/"ഭാഷ" alias for change-language (reusing #3's own trigger),
 * then exact numbered/localized-title fallbacks from Body, then from the
 * button/list item's title text. Returns `null` for anything unrecognized
 * — never fuzzy-matched, since this drives a state transition.
 */
export function parseMenuAction(input: MenuSelectionInput): MenuAction | null {
  const stableId = (input.buttonPayload || input.listId || "").trim();
  if (STABLE_MENU_ACTIONS.has(stableId)) {
    return stableId as MenuAction;
  }

  if (isLanguageChangeRequest(input)) {
    return "menu:change-language";
  }

  const bodyText = (input.body || "").trim().toLowerCase();
  if (bodyText in TEXT_TO_ACTION) {
    return TEXT_TO_ACTION[bodyText];
  }

  const titleText = (input.buttonText || input.listTitle || "").trim().toLowerCase();
  if (titleText in TEXT_TO_ACTION) {
    return TEXT_TO_ACTION[titleText];
  }

  return null;
}

/** True when the advocate typed "menu" or "മെനു" to redisplay the current-language menu. */
export function isMenuRedisplayRequest(input: SelectionInput): boolean {
  const candidate = (input.buttonPayload || input.buttonText || input.body || "").trim().toLowerCase();
  return MENU_REDISPLAY_TRIGGERS.has(candidate);
}
