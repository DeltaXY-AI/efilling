/** Result of any successful outbound send — the provider's own message id, for delivery-status reconciliation (#16 task 7). */
export interface SendResult {
  providerMessageId: string;
}

/**
 * Outcome of a sender helper (sendMainMenu, sendDraftChoice, ...), which may
 * have tried several tiers (interactive -> Content Template -> plain text)
 * before succeeding or exhausting all of them. `providerMessageId` is only
 * present when a send actually succeeded — callers that don't need
 * reconciliation (e.g. a menu redisplay outside the outbox) can ignore it.
 */
export interface SendOutcome {
  delivered: boolean;
  providerMessageId?: string;
}

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title?: string;
  rows: InteractiveListRow[];
}

/**
 * Provider-neutral outbound messaging contract, independent of the vendor
 * (Twilio today, Kapso under evaluation per issue #16). Every workflow/sender
 * depends on this interface — never on a specific provider's SDK types —
 * so a new adapter can be dropped in without touching domain code.
 *
 * sendInteractiveButtons/sendInteractiveList are optional: Twilio represents
 * "an interactive message" as a pre-approved Content Template (already
 * covered by sendContentTemplate), so its adapter does not implement them.
 * Kapso has no template-SID equivalent and sends interactive structure
 * directly, so its adapter does. Senders check for the capability and fall
 * back to sendContentTemplate → plain text exactly as before when it's
 * absent — see main-menu-sender.ts / filing-sender.ts / language-workflow.ts.
 */
export interface MessagingClient {
  sendContentTemplate(input: { from: string; to: string; contentSid: string }): Promise<SendResult>;
  sendText(input: { from: string; to: string; body: string }): Promise<SendResult>;
  sendInteractiveButtons?(input: { from: string; to: string; bodyText: string; buttons: InteractiveButton[] }): Promise<SendResult>;
  sendInteractiveList?(input: {
    from: string;
    to: string;
    bodyText: string;
    buttonText: string;
    sections: InteractiveListSection[];
  }): Promise<SendResult>;
}
