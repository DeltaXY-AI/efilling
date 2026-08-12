import { vi } from "vitest";
import type { MessagingClient } from "../../src/types/messaging-client";

export interface FakeMessagingClient extends MessagingClient {
  sendContentTemplate: ReturnType<typeof vi.fn<MessagingClient["sendContentTemplate"]>>;
  sendText: ReturnType<typeof vi.fn<MessagingClient["sendText"]>>;
}

/** A MessagingClient test double that resolves successfully by default — provider-agnostic, usable for any adapter under test. */
export function createFakeMessagingClient(): FakeMessagingClient {
  return {
    sendContentTemplate: vi.fn<MessagingClient["sendContentTemplate"]>().mockResolvedValue(undefined),
    sendText: vi.fn<MessagingClient["sendText"]>().mockResolvedValue(undefined),
  };
}
