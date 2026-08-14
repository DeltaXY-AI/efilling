import type { SelectionInput } from "./language-selection";

// Text fallbacks only — restart has no stable button payload of its own,
// since (unlike every other action in this codebase) it must be recognized
// from any state, including ones with no Content Template button for it at
// all. Matching is case-insensitive for Latin text; Malayalam script has no
// case, so lower-casing it is a no-op and safe to include in the same set.
const RESTART_TRIGGERS = new Set(["restart", "start over", "വീണ്ടും തുടങ്ങുക"]);

/**
 * True when the advocate typed "restart"/"start over" (or the Malayalam
 * equivalent) to abandon the current flow and begin again from the
 * language picker. Never fuzzy-matched, since this drives a state
 * transition (and, when a filing draft is active, abandons it).
 */
export function isRestartRequest(input: SelectionInput): boolean {
  const candidate = (input.buttonPayload || input.buttonText || input.body || "").trim().toLowerCase();
  return RESTART_TRIGGERS.has(candidate);
}
