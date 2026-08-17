import { vi } from "vitest";
import type { TwilioMessagingClient } from "../../src/adapters/twilio/messaging-client";

export interface FakeMessagingClient extends TwilioMessagingClient {
  sendContentTemplate: ReturnType<typeof vi.fn<TwilioMessagingClient["sendContentTemplate"]>>;
  sendText: ReturnType<typeof vi.fn<TwilioMessagingClient["sendText"]>>;
  sendMediaMessage: ReturnType<typeof vi.fn<TwilioMessagingClient["sendMediaMessage"]>>;
}

/** A TwilioMessagingClient test double that resolves successfully by default. */
export function createFakeMessagingClient(): FakeMessagingClient {
  return {
    sendContentTemplate: vi.fn<TwilioMessagingClient["sendContentTemplate"]>().mockResolvedValue(undefined),
    sendText: vi.fn<TwilioMessagingClient["sendText"]>().mockResolvedValue(undefined),
    sendMediaMessage: vi.fn<TwilioMessagingClient["sendMediaMessage"]>().mockResolvedValue(undefined),
  };
}
