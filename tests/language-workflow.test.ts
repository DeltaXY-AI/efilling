import { beforeEach, describe, expect, it } from "vitest";
import {
  handleInboundForLanguageSelection,
  reopenLanguagePicker,
  type LanguageWorkflowDeps,
} from "../src/services/language-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const CONTENT_SID = "HXtest00000000000000000000000000";
const FROM_NUMBER = "whatsapp:+14155238886";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };

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
    deps = {
      conversationRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      contentSid: CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    };
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

  it("persists English, sends the confirmation, and immediately sends the English main menu", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    messagingClient.sendContentTemplate.mockClear();

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:en" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: "✓ English selected.",
    });
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      contentSid: MAIN_MENU_CONTENT_SID.en,
    });

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });

  it("persists Malayalam, sends the confirmation, and immediately sends the Malayalam main menu", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    messagingClient.sendContentTemplate.mockClear();

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:ml" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: "✓ മലയാളം തിരഞ്ഞെടുത്തു.",
    });
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      contentSid: MAIN_MENU_CONTENT_SID.ml,
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
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: CONTENT_SID }),
    );

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

  it("marks delivery as failed when both the picker Content Template and its fallback fail", async () => {
    messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));
    messagingClient.sendText.mockRejectedValueOnce(new Error("Twilio 500"));

    const result = await handleInboundForLanguageSelection(deps, baseInput());

    expect(result.delivered).toBe(false);
  });

  it("marks delivery as failed when the confirmation or menu send fails, even though the language was persisted", async () => {
    await handleInboundForLanguageSelection(deps, baseInput());
    messagingClient.sendText.mockRejectedValueOnce(new Error("Twilio 500"));

    const result = await handleInboundForLanguageSelection(deps, baseInput({ selection: { buttonPayload: "language:en" } }));

    expect(result.delivered).toBe(false);
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });
});

describe("reopenLanguagePicker", () => {
  let conversationRepo: InMemoryConversationRepository;
  let messagingClient: FakeMessagingClient;
  let deps: LanguageWorkflowDeps;

  beforeEach(() => {
    conversationRepo = new InMemoryConversationRepository();
    messagingClient = createFakeMessagingClient();
    deps = {
      conversationRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      contentSid: CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    };
  });

  it("clears the language, moves back to AWAITING_LANGUAGE, and resends the picker", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    const result = await reopenLanguagePicker(deps, { whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1" });

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      contentSid: CONTENT_SID,
    });

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
  });
});
