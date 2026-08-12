import { vi } from "vitest";
import type { MessagingClient } from "../../src/types/messaging-client";

const FAKE_PROVIDER_MESSAGE_ID = "fake-message-id";

export interface FakeMessagingClient extends MessagingClient {
  sendContentTemplate: ReturnType<typeof vi.fn<MessagingClient["sendContentTemplate"]>>;
  sendText: ReturnType<typeof vi.fn<MessagingClient["sendText"]>>;
  sendInteractiveButtons?: ReturnType<typeof vi.fn<Required<MessagingClient>["sendInteractiveButtons"]>>;
  sendInteractiveList?: ReturnType<typeof vi.fn<Required<MessagingClient>["sendInteractiveList"]>>;
}

/**
 * A MessagingClient test double that resolves successfully by default —
 * provider-agnostic, usable for any adapter under test. Defaults to
 * Twilio's shape (no interactive methods) so every pre-existing test that
 * exercises the Content-Template fallback path keeps exercising it
 * unchanged; pass `{ interactive: true }` for tests against Kapso's real
 * shape, which always has native interactive buttons/lists (#16 task 6).
 */
export function createFakeMessagingClient(options: { interactive?: boolean } = {}): FakeMessagingClient {
  const base: FakeMessagingClient = {
    sendContentTemplate: vi.fn<MessagingClient["sendContentTemplate"]>().mockResolvedValue({ providerMessageId: FAKE_PROVIDER_MESSAGE_ID }),
    sendText: vi.fn<MessagingClient["sendText"]>().mockResolvedValue({ providerMessageId: FAKE_PROVIDER_MESSAGE_ID }),
  };

  if (!options.interactive) {
    return base;
  }

  return {
    ...base,
    sendInteractiveButtons: vi
      .fn<Required<MessagingClient>["sendInteractiveButtons"]>()
      .mockResolvedValue({ providerMessageId: FAKE_PROVIDER_MESSAGE_ID }),
    sendInteractiveList: vi
      .fn<Required<MessagingClient>["sendInteractiveList"]>()
      .mockResolvedValue({ providerMessageId: FAKE_PROVIDER_MESSAGE_ID }),
  };
}
