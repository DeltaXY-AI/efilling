import { beforeEach, describe, expect, it } from "vitest";
import { handleInboundForLanguageSelection, type LanguageWorkflowDeps } from "../src/services/language-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const CONTENT_SID = "HXtest00000000000000000000000000";
const FROM_NUMBER = "whatsapp:+14155238886";

function baseInput(overrides: Partial<Parameters<typeof handleInboundForLanguageSelection>[1]> = {}) {
  return {
    whatsappNumber: WHATSAPP_NUMBER,
    messageId: "SM0000000000000000000000000000000",
    selection: {},
    ...overrides,
  };
}

describe("handleInboundForLanguageSelection", () => {
  let conversationRepo: InMemoryConversationRepository;
  let messagingClient: FakeMessagingClient;
  let deps: LanguageWorkflowDeps;

  beforeEach(() => {
    conversationRepo = new InMemoryConversationRepository();
    messagingClient = createFakeMessagingClient();
    deps = { conversationRepo, messagingClient, fromNumber: FROM_NUMBER, contentSid: CONTENT_SID };
  });

  it("opens the picker for a brand-new advocate, even if the first message already looks like a selection", async () => {
    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { body: "English" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      contentSid: CONTENT_SID,
    });

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
  });

  it("persists English and moves to MAIN_MENU on the next message", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    messagingClient.sendContentTemplate.mockClear();

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:en" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: "✓ English selected.",
    });
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });

  it("persists Malayalam and moves to MAIN_MENU on the next message", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:ml" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: "✓ മലയാളം തിരഞ്ഞെടുത്തു.",
    });

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "ml" });
  });

  it("re-sends the picker for an unrecognized reply while awaiting language, without changing state", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    messagingClient.sendContentTemplate.mockClear();

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { body: "huh?" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledTimes(1);

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
  });

  it("does not reopen the picker for an already-selected advocate's ordinary message", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:en" } }));
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { body: "What's next?" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();
  });

  it('reopens the picker and clears the language when the advocate sends "language" or "ഭാഷ"', async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:en" } }));
    messagingClient.sendContentTemplate.mockClear();

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { body: "language" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledTimes(1);

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
  });

  it("falls back to the plain-text menu when the Content Template send fails", async () => {
    messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

    const result = await handleInboundForLanguageSelection(deps, baseInput());

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("1. English") }),
    );
  });

  it("marks delivery as failed when both the Content Template and the fallback fail", async () => {
    messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));
    messagingClient.sendText.mockRejectedValueOnce(new Error("Twilio 500"));

    const result = await handleInboundForLanguageSelection(deps, baseInput());

    expect(result.delivered).toBe(false);
  });
});
