import { beforeEach, describe, expect, it } from "vitest";
import { routeInboundMessage, type InboundRouterDeps } from "../src/services/inbound-router";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
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
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let messagingClient: FakeMessagingClient;
  let deps: InboundRouterDeps;

  beforeEach(() => {
    conversationRepo = new InMemoryConversationRepository();
    messagingClient = createFakeMessagingClient();
    const mainMenuSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID };
    const enrolmentSenderDeps = {
      messagingClient,
      fromNumber: FROM_NUMBER,
      promptContentSid: ENROLMENT_PROMPT_CONTENT_SID,
      confirmContentSid: ENROLMENT_CONFIRM_CONTENT_SID,
    };
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    partyRepo = new InMemoryFilingPartyRepository();
    const outboundMessageRepo = new InMemoryOutboundMessageRepository();
    const complainantSenderDeps = {
      messagingClient,
      fromNumber: FROM_NUMBER,
      reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
      editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
    };
    const accusedSenderDeps = {
      messagingClient,
      fromNumber: FROM_NUMBER,
      reviewActionsContentSid: ACCUSED_REVIEW_CONTENT_SID,
      editFieldsContentSid: ACCUSED_EDIT_FIELDS_CONTENT_SID,
    };
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
        filingRepo,
        partyRepo,
        outboundMessageRepo,
        filingSenderDeps: {
          messagingClient,
          fromNumber: FROM_NUMBER,
          draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
          noticeContentSid: NOTICE_CONTENT_SID,
        },
        mainMenuSenderDeps,
        enrolmentSenderDeps,
        complainantSenderDeps,
        accusedSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      enrolmentWorkflowDeps: {
        conversationRepo,
        filingRepo,
        outboundMessageRepo,
        enrolmentSenderDeps,
        mainMenuSenderDeps,
        complainantSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      complainantWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        outboundMessageRepo,
        complainantSenderDeps,
        mainMenuSenderDeps,
        accusedSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      accusedWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        outboundMessageRepo,
        accusedSenderDeps,
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

  it("routes an ADVOCATE_ENROLMENT_PENDING conversation to the enrolment workflow (#9)", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "ADVOCATE_ENROLMENT_PENDING");

    const result = await routeInboundMessage(deps, baseInput({ body: "ker / 1234 / 2010" }));

    expect(result.delivered).toBe(true);
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "ADVOCATE_ENROLMENT_CONFIRM" });
  });

  it("routes an ADVOCATE_ENROLMENT_CONFIRM conversation to the enrolment workflow (#9)", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await filingRepo.saveEnrolmentCandidate(undefined, filing.id, { original: "KER/1234/2010", normalized: "KER/1234/2010" });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "ADVOCATE_ENROLMENT_CONFIRM");

    const result = await routeInboundMessage(deps, baseInput({ buttonPayload: "enrolment:confirm" }));

    expect(result.delivered).toBe(true);
    // #10 Part A: confirming enrolment cascades straight into
    // COMPLAINANT_NAME_PENDING — COMPLAINANT_DETAILS_START is never
    // actually persisted.
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "COMPLAINANT_NAME_PENDING" });
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("full name") }));
  });

  it("keeps a legacy COMPLAINANT_DETAILS_START conversation alive without sending anything (never persisted going forward — see schema.ts)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_DETAILS_START", new Date());
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await routeInboundMessage(deps, baseInput({ body: "some complainant detail" }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();
  });

  it("routes a COMPLAINANT_NAME_PENDING conversation to the complainant workflow (#10)", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "COMPLAINANT_NAME_PENDING");

    const result = await routeInboundMessage(deps, baseInput({ body: "Anitha Joseph" }));

    expect(result.delivered).toBe(true);
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
  });

  it("routes a COMPLAINANT_CONFIRM conversation to the complainant workflow (#10)", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await filingRepo.setCurrentStep(undefined, filing.id, "COMPLAINANT_CONFIRM");
    await partyRepo.upsertFields(undefined, filing.id, "COMPLAINANT", {
      fullName: "Anitha Joseph",
      phoneOriginal: "9876543210",
      phoneNormalized: "+919876543210",
      emailNormalized: null,
      address: "Thekkumkattil House\nKollam 691008",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "COMPLAINANT_CONFIRM");

    const result = await routeInboundMessage(deps, baseInput({ buttonPayload: "complainant:confirm" }));

    expect(result.delivered).toBe(true);
    // #11 Part A: confirming the complainant cascades straight into
    // ACCUSED_NAME_PENDING — ACCUSED_DETAILS_START is never persisted.
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "ACCUSED_NAME_PENDING" });
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("legal name") }));
  });

  it("keeps a legacy ACCUSED_DETAILS_START conversation alive without sending anything (never persisted going forward — see schema.ts)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_DETAILS_START", new Date());
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await routeInboundMessage(deps, baseInput({ body: "some accused detail" }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();
  });

  it("routes an ACCUSED_NAME_PENDING conversation to the accused workflow (#11)", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "ACCUSED_NAME_PENDING");

    const result = await routeInboundMessage(deps, baseInput({ body: "Rajesh Menon" }));

    expect(result.delivered).toBe(true);
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "ACCUSED_PHONE_PENDING" });
  });

  it("routes an ACCUSED_CONFIRM conversation to the accused workflow (#11)", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await filingRepo.setCurrentStep(undefined, filing.id, "ACCUSED_CONFIRM");
    await partyRepo.upsertFields(undefined, filing.id, "ACCUSED", {
      fullName: "Rajesh Menon",
      phoneOriginal: null,
      phoneNormalized: null,
      address: "32/1147, Menon Villa\nChinnakada, Kollam 691001",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "ACCUSED_CONFIRM");

    const result = await routeInboundMessage(deps, baseInput({ buttonPayload: "accused:confirm" }));

    expect(result.delivered).toBe(true);
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "CHEQUE_DETAILS_START" });
  });
});
