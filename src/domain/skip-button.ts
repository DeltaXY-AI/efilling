/**
 * Stable WhatsApp quick-reply button ID shared by every optional free-text
 * field's "Skip" button — complainant email, accused phone, and filing
 * details' bank/branch and story fields. One generic Content Template
 * (twilio/quick-reply, "filing-field-skip", body `{{1}}`) is reused across
 * all of them via the field's own contentSid + prompt text — see
 * filing-sender.ts's sendFilingFieldPrompt.
 *
 * Kept in its own module (rather than living inside complainant.ts, whose
 * `isSkipCommand` this mirrors) so none of complainant/accused/filing-details
 * needs to import from another's domain file just for this constant.
 */
export const SKIP_BUTTON_ID = "field:skip";
