/**
 * Provider-neutral outbound messaging contract, independent of the vendor
 * (Twilio today, Kapso under evaluation per issue #16). Every workflow/sender
 * depends on this interface — never on a specific provider's SDK types —
 * so a new adapter can be dropped in without touching domain code.
 */
export interface MessagingClient {
  sendContentTemplate(input: { from: string; to: string; contentSid: string }): Promise<void>;
  sendText(input: { from: string; to: string; body: string }): Promise<void>;
}
