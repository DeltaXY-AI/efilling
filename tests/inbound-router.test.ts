import { beforeEach, describe, expect, it } from "vitest";
import { routeInboundMessage, type InboundRouterDeps } from "../src/services/inbound-router";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const LANGUAGE_CONTENT_SID = "HXlanguage0000000000000000000000000";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const DRAFT_CHOICE_CONTENT_SID = { en: "HXdraftchoiceen00000000000000000000", ml: "HXdraftchoiceml00000000000000000000" };
const NOTICE_CONTENT_SID = { en: "HXnoticeen000000000000000000000000", ml: "HXnoticeml000000000000000000000000" };

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
    const mainMenuSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID };
    deps = {
      conversationRepo,
      languageWorkflowDeps: {
        conversationRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        contentSid: LANGUAGE_CONTENT_SID,
        mainMenuContentSid: MAIN_MENU_CONTENT_SID,
      },
      mainMenuSenderDeps,
      filingWorkflowDeps: {
        conversationRepo,
        filingRepo: new InMemoryFilingRepository(conversationRepo),
        outboundMessageRepo: new InMemoryOutboundMessageRepository(),
        filingSenderDeps: {
          messagingClient,
          fromNumber: FROM_NUMBER,
          draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
          noticeContentSid: NOTICE_CONTENT_SID,
        },
        mainMenuSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
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

  it("routes a MAIN_MENU conversation to the main-menu workflow, which delegates menu:file-case to filing-workflow (#8)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    messagingClient.sendContentTemplate.mockClear();

    await routeInboundMessage(deps, baseInput({ buttonPayload: "menu:file-case" }));

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
  });

  it("routes a FILING_DRAFT_CHOICE conversation to the filing workflow", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_CHOICE", new Date());

    await routeInboundMessage(deps, baseInput({ buttonPayload: "filing:start-new" }));

    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ id: conversation.id, state: "FILING_NOTICE" });
  });

  it("routes a FILING_NOTICE conversation to the filing workflow", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_NOTICE", new Date());

    await routeInboundMessage(deps, baseInput({ buttonPayload: "filing:accept-test-notice" }));

    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
    expect(after?.activeFilingId).toBeTruthy();
  });

  it("keeps a FILING_START conversation alive without sending anything — this is exactly why migration 0003 backfills it away", async () => {
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

  it("migration 0003 compatibility: a pre-V5A FILING_START conversation, once backfilled to MAIN_MENU, enters the real filing flow", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    // Simulate a conversation left over from #5, in the now-unroutable
    // FILING_START state, then corrected by migration 0003's backfill
    // UPDATE (see drizzle/0003_backfill_filing_start_state.sql).
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_START", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

    const result = await routeInboundMessage(deps, baseInput({ buttonPayload: "menu:file-case" }));

    expect(result.delivered).toBe(true);
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_NOTICE" }); // in the real V5A flow, not stuck
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

  it("keeps an ADVOCATE_ENROLMENT_PENDING conversation alive without sending anything (owned by V5B)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "ADVOCATE_ENROLMENT_PENDING", new Date());
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await routeInboundMessage(deps, baseInput({ body: "some enrolment detail" }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();
  });
});
