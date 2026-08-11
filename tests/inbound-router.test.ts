import { beforeEach, describe, expect, it } from "vitest";
import { routeInboundMessage, type InboundRouterDeps } from "../src/services/inbound-router";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const LANGUAGE_CONTENT_SID = "HXlanguage0000000000000000000000000";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };

function baseInput(overrides: Partial<Parameters<typeof routeInboundMessage>[1]> = {}) {
  return {
    whatsappNumber: WHATSAPP_NUMBER,
    messageId: "SM0000000000000000000000000000000",
    body: "",
    ...overrides,
  };
}

describe("routeInboundMessage", () => {
  let conversationRepo: InMemoryConversationRepository;
  let messagingClient: FakeMessagingClient;
  let deps: InboundRouterDeps;

  beforeEach(() => {
    conversationRepo = new InMemoryConversationRepository();
    messagingClient = createFakeMessagingClient();
    deps = {
      conversationRepo,
      languageWorkflowDeps: {
        conversationRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        contentSid: LANGUAGE_CONTENT_SID,
        mainMenuContentSid: MAIN_MENU_CONTENT_SID,
      },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
    };
  });

  it("routes a brand-new conversation to the language workflow", async () => {
    await routeInboundMessage(deps, baseInput({ body: "Hi" }));

    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
    );
  });

  it("routes an AWAITING_LANGUAGE conversation to the language workflow", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    messagingClient.sendContentTemplate.mockClear();

    await routeInboundMessage(deps, baseInput({ buttonPayload: "language:en" }));

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });

  it("routes a MAIN_MENU conversation to the main-menu workflow", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    messagingClient.sendContentTemplate.mockClear();

    await routeInboundMessage(deps, baseInput({ buttonPayload: "menu:file-case" }));

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_START" });
  });

  it("keeps a FILING_START conversation alive without sending anything (out of scope for this slice)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_START", new Date());
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await routeInboundMessage(deps, baseInput({ body: "some filing detail" }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_START" });
  });

  it("keeps a CASE_STATUS_START conversation alive without sending anything (out of scope for this slice)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "CASE_STATUS_START", new Date());
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await routeInboundMessage(deps, baseInput({ body: "some case reference" }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();
  });
});
