import { beforeEach, describe, expect, it } from "vitest";
import { handleInboundForMainMenu, type MainMenuWorkflowDeps } from "../src/services/main-menu-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const LANGUAGE_CONTENT_SID = "HXlanguage0000000000000000000000000";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const DRAFT_CHOICE_CONTENT_SID = { en: "HXdraftchoiceen00000000000000000000", ml: "HXdraftchoiceml00000000000000000000" };
const NOTICE_CONTENT_SID = { en: "HXnoticeen000000000000000000000000", ml: "HXnoticeml000000000000000000000000" };
const ENROLMENT_PROMPT_CONTENT_SID = { en: "HXenrolpromptEn00000000000000000000", ml: "HXenrolpromptMl00000000000000000000" };
const ENROLMENT_CONFIRM_CONTENT_SID = { en: "HXenrolconfirmEn0000000000000000000", ml: "HXenrolconfirmMl0000000000000000000" };
const COMPLAINANT_REVIEW_CONTENT_SID = { en: "HXcreviewEn00000000000000000000000", ml: "HXcreviewMl00000000000000000000000" };
const COMPLAINANT_EDIT_FIELDS_CONTENT_SID = { en: "HXceditEn000000000000000000000000", ml: "HXceditMl000000000000000000000000" };
const ACCUSED_REVIEW_CONTENT_SID = { en: "HXareviewEn000000000000000000000000", ml: "HXareviewMl000000000000000000000000" };
const ACCUSED_EDIT_FIELDS_CONTENT_SID = { en: "HXaeditEn0000000000000000000000000", ml: "HXaeditMl0000000000000000000000000" };
const ACCUSED_ENTITY_TYPE_CONTENT_SID = { en: "HXaentityEn0000000000000000000000000", ml: "HXaentityMl0000000000000000000000000" };
const COMPLAINANT_ROLE_CONTENT_SID = { en: "HXcroleEn000000000000000000000000", ml: "HXcroleMl000000000000000000000000" };
const FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS = {
  returnReasonContentSid: { en: "HXfreasonEn0000000000000000000000000", ml: "HXfreasonMl0000000000000000000000000" },
  partPaymentContentSid: { en: "HXfpaidEn00000000000000000000000000", ml: "HXfpaidMl00000000000000000000000000" },
  witnessContentSid: { en: "HXfwitnessEn000000000000000000000000", ml: "HXfwitnessMl000000000000000000000000" },
  courtContentSid: { en: "HXfcourtEn0000000000000000000000000", ml: "HXfcourtMl0000000000000000000000000" },
  reviewActionsContentSid: { en: "HXfreviewEn0000000000000000000000000", ml: "HXfreviewMl0000000000000000000000000" },
  editGroupContentSid: { en: "HXfegroupEn0000000000000000000000000", ml: "HXfegroupMl0000000000000000000000000" },
  editChequeFieldContentSid: { en: "HXfechequeEn00000000000000000000000", ml: "HXfechequeMl00000000000000000000000" },
  editNarrativeFieldContentSid: { en: "HXfenarrEn0000000000000000000000000", ml: "HXfenarrMl0000000000000000000000000" },
  declareContentSid: { en: "HXfdeclareEn00000000000000000000000", ml: "HXfdeclareMl00000000000000000000000" },
};

describe("handleInboundForMainMenu", () => {
  let conversationRepo: InMemoryConversationRepository;
  let messagingClient: FakeMessagingClient;
  let deps: MainMenuWorkflowDeps;
  let conversationId: string;

  function baseInput(overrides: Partial<Parameters<typeof handleInboundForMainMenu>[1]> = {}) {
    return {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM0000000000000000000000000000000",
      language: "en" as const,
      selection: {},
      ...overrides,
    };
  }

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    messagingClient = createFakeMessagingClient();
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    const languageWorkflowDeps = {
      conversationRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      contentSid: LANGUAGE_CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    };
    const mainMenuSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID };

    deps = {
      conversationRepo,
      mainMenuSenderDeps,
      languageWorkflowDeps,
      filingWorkflowDeps: {
        conversationRepo,
        filingRepo: new InMemoryFilingRepository(conversationRepo),
        partyRepo: new InMemoryFilingPartyRepository(),
        outboundMessageRepo: new InMemoryOutboundMessageRepository(),
        filingSenderDeps: {
          messagingClient,
          fromNumber: FROM_NUMBER,
          draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
          noticeContentSid: NOTICE_CONTENT_SID,
        },
        mainMenuSenderDeps,
        enrolmentSenderDeps: {
          messagingClient,
          fromNumber: FROM_NUMBER,
          promptContentSid: ENROLMENT_PROMPT_CONTENT_SID,
          confirmContentSid: ENROLMENT_CONFIRM_CONTENT_SID,
        },
        complainantSenderDeps: {
          messagingClient,
          fromNumber: FROM_NUMBER,
          reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
          editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
          rolePromptContentSid: COMPLAINANT_ROLE_CONTENT_SID,
        },
        accusedSenderDeps: {
          messagingClient,
          fromNumber: FROM_NUMBER,
          reviewActionsContentSid: ACCUSED_REVIEW_CONTENT_SID,
          editFieldsContentSid: ACCUSED_EDIT_FIELDS_CONTENT_SID,
          entityTypeContentSid: ACCUSED_ENTITY_TYPE_CONTENT_SID,
        },
        filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS },
        filingDocumentRepo: new InMemoryFilingDocumentRepository(),
        withTransaction: createInMemoryWithTransaction(),
      },
    };
  });

  it("redisplays the current-language menu on 'menu', without changing state", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { body: "menu" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });

  it("redisplays the Malayalam menu on 'മെനു' for a Malayalam advocate", async () => {
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());

    const result = await handleInboundForMainMenu(deps, baseInput({ language: "ml", selection: { body: "മെനു" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.ml }),
    );
  });

  it("delegates menu:file-case to the filing workflow (#8) — no active draft opens the test notice", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { buttonPayload: "menu:file-case" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
  });

  it("routes menu:case-status to CASE_STATUS_START with the localized acknowledgement", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { buttonPayload: "menu:case-status" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: "Let's check your case status.",
    });

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "CASE_STATUS_START" });
  });

  it("routes menu:change-language back to AWAITING_LANGUAGE and reuses #3's picker — not a second implementation", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { buttonPayload: "menu:change-language" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      contentSid: LANGUAGE_CONTENT_SID,
    });

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
  });

  it('routes "language"/"ഭാഷ" (the #3 trigger) to the same change-language action', async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { body: "language" } }));

    expect(result.delivered).toBe(true);
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
  });

  it("keeps MAIN_MENU and redisplays after menu:help, sending the localized help text first", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { buttonPayload: "menu:help" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: expect.stringContaining("Complainant Advocate"),
    });
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU" });
  });

  it("keeps MAIN_MENU and redisplays after menu:my-cases, sending the stub text first (#29)", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { buttonPayload: "menu:my-cases" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("isn't ready yet") }),
    );
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU" });
  });

  it("sends the Malayalam stub for menu:my-cases when the advocate is on the Malayalam menu (#29)", async () => {
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());

    const result = await handleInboundForMainMenu(deps, baseInput({ language: "ml", selection: { buttonPayload: "menu:my-cases" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("ലഭ്യമല്ല") }),
    );
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.ml }),
    );
  });

  it("does not change state for unrecognized input, and redisplays the menu with a clarification", async () => {
    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { body: "asdf" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.not.stringContaining("menu:") }),
    );
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });

  it("treats a stale/unknown stable ID as unrecognized, even with a Body that looks like a valid number", async () => {
    const result = await handleInboundForMainMenu(
      deps,
      baseInput({ selection: { buttonPayload: "menu:removed-item", body: "1" } }),
    );

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.not.stringContaining("menu:") }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "MAIN_MENU", language: "en" });
  });

  it("falls back to the numbered plain-text menu when the list-picker Content Template fails", async () => {
    messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

    const result = await handleInboundForMainMenu(deps, baseInput({ selection: { body: "menu" } }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("1. File or resume a case") }),
    );
  });
});
