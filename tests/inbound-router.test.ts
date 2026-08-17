import { beforeEach, describe, expect, it } from "vitest";
import { routeInboundMessage, type InboundRouterDeps } from "../src/services/inbound-router";
import type { ConversationState } from "../src/repositories/conversation-repository";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { createFakeDocumentStorageDeps } from "./helpers/fake-document-storage";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const LANGUAGE_CONTENT_SID = "HXlanguage0000000000000000000000000";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const DRAFT_CHOICE_CONTENT_SID = { en: "HXdraftchoiceen00000000000000000000", ml: "HXdraftchoiceml00000000000000000000" };
const NOTICE_CONTENT_SID = { en: "HXnoticeen000000000000000000000000", ml: "HXnoticeml000000000000000000000000" };
const CASE_TYPE_PROMPT_CONTENT_SID = { en: "HXctypeEn0000000000000000000000000", ml: "HXctypeMl0000000000000000000000000" };
const OTHER_CASE_TYPES_CONTENT_SID = { en: "HXotypesEn000000000000000000000000", ml: "HXotypesMl000000000000000000000000" };
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
const FILING_SIGN_SENDER_DEPS_CONTENT_SIDS = {
  draftReadyActionsContentSid: { en: "HXfdraftreadyEn0000000000000000000", ml: "HXfdraftreadyMl0000000000000000000" },
};
const FILING_COMPLETION_SENDER_DEPS_CONTENT_SIDS = {
  payFeeActionsContentSid: { en: "HXffiledEn00000000000000000000000", ml: "HXffiledMl00000000000000000000000" },
};
const FILING_DRAFT_LIST_SENDER_DEPS_CONTENT_SIDS = {
  draftListContentSid: { en: "HXfdlistEn0000000000000000000000000", ml: "HXfdlistMl0000000000000000000000000" },
  draftDetailActionsContentSid: { en: "HXfddetailEn00000000000000000000000", ml: "HXfddetailMl00000000000000000000000" },
  caseStatusActionsContentSid: { en: "HXcasestatEn0000000000000000000000", ml: "HXcasestatMl0000000000000000000000" },
};
const FILING_DEFECT_SENDER_DEPS_CONTENT_SIDS = {
  caseStatusActionsContentSid: { en: "HXcasestatEn0000000000000000000000", ml: "HXcasestatMl0000000000000000000000" },
  defectAlertActionsContentSid: { en: "HXdalertEn0000000000000000000000000", ml: "HXdalertMl0000000000000000000000000" },
  delayDaysContentSid: { en: "HXddaysEn00000000000000000000000000", ml: "HXddaysMl00000000000000000000000000" },
  defectReviewActionsContentSid: { en: "HXdreviewEn000000000000000000000000", ml: "HXdreviewMl000000000000000000000000" },
  defectSentActionsContentSid: { en: "HXdsentEn0000000000000000000000000", ml: "HXdsentMl0000000000000000000000000" },
};
const HEARING_SENDER_DEPS_CONTENT_SIDS = {
  hearingReminderActionsContentSid: { en: "HXhearingEn00000000000000000000000", ml: "HXhearingMl00000000000000000000000" },
};

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
    const filingDocumentRepo = new InMemoryFilingDocumentRepository();
    const outboundMessageRepo = new InMemoryOutboundMessageRepository();
    const complainantSenderDeps = {
      messagingClient,
      fromNumber: FROM_NUMBER,
      reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
      editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
      rolePromptContentSid: COMPLAINANT_ROLE_CONTENT_SID,
    };
    const accusedSenderDeps = {
      messagingClient,
      fromNumber: FROM_NUMBER,
      reviewActionsContentSid: ACCUSED_REVIEW_CONTENT_SID,
      editFieldsContentSid: ACCUSED_EDIT_FIELDS_CONTENT_SID,
      entityTypeContentSid: ACCUSED_ENTITY_TYPE_CONTENT_SID,
    };
    const filingDetailsSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS };
    const filingSignSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, ...FILING_SIGN_SENDER_DEPS_CONTENT_SIDS };
    const filingCompletionSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, ...FILING_COMPLETION_SENDER_DEPS_CONTENT_SIDS };
    const filingDraftListSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DRAFT_LIST_SENDER_DEPS_CONTENT_SIDS };
    const filingWorkflowDeps = {
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
      caseTypeSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        caseTypePromptContentSid: CASE_TYPE_PROMPT_CONTENT_SID,
        otherCaseTypesContentSid: OTHER_CASE_TYPES_CONTENT_SID,
      },
      mainMenuSenderDeps,
      enrolmentSenderDeps,
      complainantSenderDeps,
      accusedSenderDeps,
      filingDetailsSenderDeps,
      filingDocumentRepo,
      filingSignSenderDeps,
      filingCompletionSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    };
    const caseTypeWorkflowDeps = {
      conversationRepo,
      outboundMessageRepo,
      caseTypeSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        caseTypePromptContentSid: CASE_TYPE_PROMPT_CONTENT_SID,
        otherCaseTypesContentSid: OTHER_CASE_TYPES_CONTENT_SID,
      },
      filingSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
        noticeContentSid: NOTICE_CONTENT_SID,
      },
      withTransaction: createInMemoryWithTransaction(),
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
      filingWorkflowDeps,
      caseTypeWorkflowDeps,
      enrolmentWorkflowDeps: {
        conversationRepo,
        filingRepo,
        outboundMessageRepo,
        enrolmentSenderDeps,
        mainMenuSenderDeps,
        complainantSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      filingDocumentWorkflowDeps: {
        conversationRepo,
        filingRepo,
        filingDocumentRepo,
        outboundMessageRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        documentStorageDeps: createFakeDocumentStorageDeps(),
        complainantSenderDeps,
        filingDetailsSenderDeps,
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
      filingDetailsWorkflowDeps: {
        conversationRepo,
        filingRepo,
        outboundMessageRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        filingDetailsSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      filingReviewWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        filingDocumentRepo,
        outboundMessageRepo,
        filingDetailsSenderDeps,
        mainMenuSenderDeps,
        filingSignSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      filingSignWorkflowDeps: {
        conversationRepo,
        filingRepo,
        outboundMessageRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        filingSignSenderDeps,
        filingCompletionSenderDeps,
        filingReviewWorkflowDeps: {
          conversationRepo,
          filingRepo,
          partyRepo,
          filingDocumentRepo,
          outboundMessageRepo,
          filingDetailsSenderDeps,
          mainMenuSenderDeps,
          filingSignSenderDeps,
          withTransaction: createInMemoryWithTransaction(),
        },
        withTransaction: createInMemoryWithTransaction(),
      },
      filingCompletionWorkflowDeps: {
        conversationRepo,
        filingRepo,
        outboundMessageRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        filingCompletionSenderDeps,
        mainMenuSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      filingDraftListWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        filingDocumentRepo,
        outboundMessageRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        filingDraftListSenderDeps,
        mainMenuSenderDeps,
        blobStorage: createFakeDocumentStorageDeps().blobStorage,
        filingDefectSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DEFECT_SENDER_DEPS_CONTENT_SIDS },
        filingWorkflowDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      filingDefectWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        filingDocumentRepo,
        outboundMessageRepo,
        messagingClient,
        fromNumber: FROM_NUMBER,
        documentStorageDeps: createFakeDocumentStorageDeps(),
        filingDefectSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DEFECT_SENDER_DEPS_CONTENT_SIDS },
        mainMenuSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      hearingWorkflowDeps: {
        conversationRepo,
        filingRepo,
        outboundMessageRepo,
        hearingSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...HEARING_SENDER_DEPS_CONTENT_SIDS },
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
    expect(conversation).toMatchObject({ state: "FILING_CASE_TYPE_PENDING" });
  });

  it("routes a FILING_DRAFT_CHOICE conversation to the filing workflow", async () => {
    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_CHOICE", new Date());

    await routeInboundMessage(deps, baseInput({ buttonPayload: "filing:start-new" }));

    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ id: conversation.id, state: "FILING_CASE_TYPE_PENDING" });
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
    expect(conversation).toMatchObject({ state: "FILING_CASE_TYPE_PENDING" }); // in the real V5A flow, not stuck

    // Confirm it isn't just stuck one screen later either — picking cheque
    // bounce still reaches FILING_NOTICE, exactly as before this case-type
    // gate was inserted.
    const followUp = await routeInboundMessage(deps, baseInput({ buttonPayload: "filing:case-type-cheque" }));
    expect(followUp.delivered).toBe(true);
    const afterCaseType = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(afterCaseType).toMatchObject({ state: "FILING_NOTICE" });
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
    // #31: confirming enrolment now cascades straight into FILING_DOC_CHEQUE,
    // the first of 5 document-upload groups — replaces #10 Part A's original
    // COMPLAINANT_NAME_PENDING cascade target.
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "FILING_DOC_CHEQUE" });
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("The cheque") }));
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
      filingAsRole: "SELF",
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
      entityType: "INDIVIDUAL",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "ACCUSED_CONFIRM");

    const result = await routeInboundMessage(deps, baseInput({ buttonPayload: "accused:confirm" }));

    expect(result.delivered).toBe(true);
    // #33: confirming the accused now cascades straight into
    // FILING_CHEQUE_NUMBER_PENDING — CHEQUE_DETAILS_START is legacy-only.
    const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(after).toMatchObject({ state: "FILING_CHEQUE_NUMBER_PENDING" });
  });

  it("keeps a legacy CHEQUE_DETAILS_START conversation alive without sending anything (never persisted going forward — see schema.ts)", async () => {
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "CHEQUE_DETAILS_START", new Date());
    messagingClient.sendContentTemplate.mockClear();
    messagingClient.sendText.mockClear();

    const result = await routeInboundMessage(deps, baseInput({ body: "some cheque detail" }));

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(messagingClient.sendText).not.toHaveBeenCalled();
  });

  describe("restart request", () => {
    it("resets a MAIN_MENU conversation to AWAITING_LANGUAGE and resends the picker", async () => {
      await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      messagingClient.sendContentTemplate.mockClear();
      messagingClient.sendText.mockClear();

      const result = await routeInboundMessage(deps, baseInput({ body: "restart" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Starting over") }),
      );
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
    });

    it("abandons the active filing draft and clears active_filing_id when restarting mid-flow", async () => {
      const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      const filing = await filingRepo.createDraft(undefined, {
        conversationId: conversation.id,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "COMPLAINANT_NAME_PENDING");

      const result = await routeInboundMessage(deps, baseInput({ body: "start over" }));

      expect(result.delivered).toBe(true);
      const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(after).toMatchObject({ state: "AWAITING_LANGUAGE", language: null, activeFilingId: null });
      expect(filingRepo.findById(filing.id)).toMatchObject({ status: "ABANDONED" });
    });

    it("still resets and abandons the draft even if the confirmation text send fails", async () => {
      const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      const filing = await filingRepo.createDraft(undefined, {
        conversationId: conversation.id,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "COMPLAINANT_NAME_PENDING");
      messagingClient.sendText.mockRejectedValueOnce(new Error("boom"));

      const result = await routeInboundMessage(deps, baseInput({ body: "restart" }));

      expect(result.delivered).toBe(false);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
      );
      const after = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(after).toMatchObject({ state: "AWAITING_LANGUAGE", activeFilingId: null });
      expect(filingRepo.findById(filing.id)).toMatchObject({ status: "ABANDONED" });
    });

    it("does not treat 'restart' as a restart for a brand-new conversation or one still AWAITING_LANGUAGE", async () => {
      messagingClient.sendContentTemplate.mockClear();

      // Brand-new: nothing to restart — falls through to the language picker.
      await routeInboundMessage(deps, baseInput({ body: "restart" }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
      );

      // Already AWAITING_LANGUAGE: unrecognized language input just resends the picker (same outcome either way).
      messagingClient.sendContentTemplate.mockClear();
      await routeInboundMessage(deps, baseInput({ body: "restart" }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
      );
    });
  });

  describe("#38's global hearing-reminder check never swallows another screen's own numbered reply", () => {
    // Regression coverage: "1"/"2" are also the numbered-fallback convention
    // nearly every other screen in this app uses for its own primary
    // action. The global check must only intercept an ambiguous text-only
    // match (no stable buttonPayload) when a hearing reminder is genuinely
    // pending for this conversation — never unconditionally.
    it("a bare '1' reply at MAIN_MENU, with no hearing reminder ever sent, still reaches menu:file-case", async () => {
      await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

      const result = await routeInboundMessage(deps, baseInput({ body: "1" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: CASE_TYPE_PROMPT_CONTENT_SID.en }),
      );
    });

    it("a stable hearing button tap is still recognized globally even with no pending reminder (safe no-op, not swallowed input)", async () => {
      const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

      const result = await routeInboundMessage(deps, baseInput({ buttonPayload: "hearing:will-attend" }));

      expect(result.delivered).toBe(true);
      // No reminder was ever sent for this conversation, so this is a safe
      // no-op — never a crash, and never misattributed to some other filing.
      const stillMainMenu = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(stillMainMenu).toMatchObject({ id: conversation.id, state: "MAIN_MENU" });
    });

    it("a bare '1' reply IS still treated as hearing:will-attend once a reminder is genuinely pending", async () => {
      const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      const filing = await filingRepo.createDraft(undefined, { conversationId: conversation.id, language: "en", role: "COMPLAINANT_ADVOCATE", testNoticeVersion: "v1" });
      const filedAt = new Date();
      const diaryNumber = await filingRepo.nextDiaryNumber(undefined, filedAt);
      await filingRepo.recordFiled(undefined, filing.id, { diaryNumber, filedAt });
      await filingRepo.upsertFilingFields(undefined, filing.id, { nextHearingDate: new Date("2026-04-28T05:30:00.000Z") });

      const result = await routeInboundMessage(deps, baseInput({ body: "1" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filing.id)).toMatchObject({ hearingAttendance: "attending" });
      // Never left resting at MAIN_MENU as if nothing happened, and never
      // routed into the file-case flow instead.
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
      );
    });
  });

  describe("unsupported persisted state recovery (#26)", () => {
    // Simulates the incident that originally motivated #26: a conversation
    // persisted in a state (e.g. by a different/newer deployment's
    // migration) that isn't in this branch's ConversationState union at all.
    // The real incident's example was CHEQUE_DETAILS_START — since #33/#11
    // that value is a known (if still-unimplemented) state, so this fixture
    // uses a value that will never legitimately exist instead.
    const UNSUPPORTED_STATE = "SOME_FUTURE_STATE_NOT_YET_KNOWN" as ConversationState;

    it("sends a recovery response and resets to AWAITING_LANGUAGE instead of a silent no-op", async () => {
      await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, UNSUPPORTED_STATE, new Date());
      messagingClient.sendContentTemplate.mockClear();
      messagingClient.sendText.mockClear();

      const result = await routeInboundMessage(deps, baseInput({ body: "Hi" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("no longer available") }),
      );
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });
    });

    it("still resets to AWAITING_LANGUAGE and resends the picker even if the recovery text send fails", async () => {
      await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, UNSUPPORTED_STATE, new Date());
      messagingClient.sendText.mockRejectedValueOnce(new Error("boom"));

      const result = await routeInboundMessage(deps, baseInput({ body: "Hi" }));

      expect(result.delivered).toBe(false);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: LANGUAGE_CONTENT_SID }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE" });
    });

    it("logs the unsupported state with a correlation id and safe state name — never the phone number or message body", async () => {
      await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, UNSUPPORTED_STATE, new Date());

      const originalError = console.error;
      const lines: string[] = [];
      console.error = (...args: unknown[]) => lines.push(args.join(" "));

      try {
        await routeInboundMessage(deps, baseInput({ body: "some private filing detail" }));
      } finally {
        console.error = originalError;
      }

      const logged = lines.join("\n");
      expect(logged).toContain("unsupported_conversation_state");
      expect(logged).toContain("SOME_FUTURE_STATE_NOT_YET_KNOWN");
      expect(logged).toContain("SM0000000000000000000000000000000"); // correlation id (messageId)
      expect(logged).not.toContain("15005550006");
      expect(logged).not.toContain("some private filing detail");
    });
  });
});
