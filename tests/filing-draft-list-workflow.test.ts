import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingDraftDetailInput,
  handleFilingDraftListInput,
  handleMyCasesEntry,
  type FilingDraftListWorkflowDeps,
} from "../src/services/filing-draft-list-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { createFakeDocumentStorageDeps, type FakeDocumentStorageDeps } from "./helpers/fake-document-storage";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const DRAFT_LIST_CONTENT_SID = { en: "HXfdlistEn0000000000000000000000000", ml: "HXfdlistMl0000000000000000000000000" };
const DRAFT_DETAIL_ACTIONS_CONTENT_SID = { en: "HXfddetailEn00000000000000000000000", ml: "HXfddetailMl00000000000000000000000" };
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
const FILING_DETAILS_CONTENT_SIDS = {
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
const FILING_SIGN_CONTENT_SIDS = { draftReadyActionsContentSid: { en: "HXfdraftreadyEn0000000000000000000", ml: "HXfdraftreadyMl0000000000000000000" } };
const FILING_COMPLETION_CONTENT_SIDS = { payFeeActionsContentSid: { en: "HXffiledEn00000000000000000000000", ml: "HXffiledMl00000000000000000000000" } };
const CASE_STATUS_ACTIONS_CONTENT_SID = { en: "HXcasestatEn0000000000000000000000", ml: "HXcasestatMl0000000000000000000000" };
const FILING_DEFECT_CONTENT_SIDS = {
  caseStatusActionsContentSid: CASE_STATUS_ACTIONS_CONTENT_SID,
  defectAlertActionsContentSid: { en: "HXdalertEn0000000000000000000000000", ml: "HXdalertMl0000000000000000000000000" },
  delayDaysContentSid: { en: "HXddaysEn00000000000000000000000000", ml: "HXddaysMl00000000000000000000000000" },
  defectReviewActionsContentSid: { en: "HXdreviewEn000000000000000000000000", ml: "HXdreviewMl000000000000000000000000" },
  defectSentActionsContentSid: { en: "HXdsentEn0000000000000000000000000", ml: "HXdsentMl0000000000000000000000000" },
};

/** Covers #36 (Prototype parity — Phase 8): "My cases" — the sectioned list, per-draft detail card, resume, and discard. */
describe("filing-draft-list-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let filingDocumentRepo: InMemoryFilingDocumentRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let blobStorage: FakeDocumentStorageDeps["blobStorage"];
  let deps: FilingDraftListWorkflowDeps;
  let conversationId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    partyRepo = new InMemoryFilingPartyRepository();
    filingDocumentRepo = new InMemoryFilingDocumentRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient();
    blobStorage = createFakeDocumentStorageDeps().blobStorage;

    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    const mainMenuSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID };
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
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_CONTENT_SIDS },
      filingDocumentRepo,
      filingSignSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_SIGN_CONTENT_SIDS },
      filingCompletionSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_COMPLETION_CONTENT_SIDS },
      withTransaction: createInMemoryWithTransaction(),
    };

    deps = {
      conversationRepo,
      filingRepo,
      partyRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      filingDraftListSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        draftListContentSid: DRAFT_LIST_CONTENT_SID,
        draftDetailActionsContentSid: DRAFT_DETAIL_ACTIONS_CONTENT_SID,
        caseStatusActionsContentSid: CASE_STATUS_ACTIONS_CONTENT_SID,
      },
      mainMenuSenderDeps,
      blobStorage,
      filingDefectSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DEFECT_CONTENT_SIDS },
      filingWorkflowDeps,
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  async function createDraft(overrides: { chequeAmount?: string; accusedName?: string } = {}): Promise<string> {
    const filing = await filingRepo.createDraft(undefined, {
      conversationId,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    if (overrides.chequeAmount) {
      await filingRepo.upsertFilingFields(undefined, filing.id, { chequeAmount: overrides.chequeAmount });
    }
    if (overrides.accusedName) {
      await partyRepo.upsertFields(undefined, filing.id, "ACCUSED", { fullName: overrides.accusedName });
    }
    return filing.id;
  }

  function baseInput(overrides: Partial<Parameters<typeof handleFilingDraftListInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  describe("handleMyCasesEntry", () => {
    it("moves MAIN_MENU to FILING_DRAFT_LIST and sends the sectioned list", async () => {
      await createDraft({ accusedName: "Rajesh Menon", chequeAmount: "450000" });

      const result = await handleMyCasesEntry(deps, baseInput());

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_LIST" });
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: DRAFT_LIST_CONTENT_SID.en, contentVariables: expect.objectContaining({ "3": expect.stringContaining("Rajesh Menon") }) }),
      );
    });

    it("a stale conversation (no longer MAIN_MENU) is a safe no-op", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_CHOICE", new Date());
      const result = await handleMyCasesEntry(deps, baseInput());
      expect(result.delivered).toBe(true);
    });
  });

  describe("FILING_DRAFT_LIST", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_LIST", new Date());
    });

    it("picking row 1 (the list-picker's fixed filing:pick-row-1 stable ID) moves to FILING_DRAFT_DETAIL and sends the draft card", async () => {
      const filingId = await createDraft({ accusedName: "Rajesh Menon", chequeAmount: "450000" });

      const result = await handleFilingDraftListInput(deps, baseInput({ selection: { listId: "filing:pick-row-1" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_DETAIL", activeFilingId: filingId });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: DRAFT_DETAIL_ACTIONS_CONTENT_SID.en }));
    });

    it("picking row 1 by typed position number resolves to the exact same row a button tap would", async () => {
      const filingId = await createDraft({ accusedName: "Rajesh Menon", chequeAmount: "450000" });

      const result = await handleFilingDraftListInput(deps, baseInput({ selection: { body: "1" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_DETAIL", activeFilingId: filingId });
    });

    it("picking a filed case's row moves to FILING_DRAFT_DETAIL (#37: so its new 'Simulate scrutiny defects' action has a filing to act on) and sends the case status + actions — no filing fields are edited", async () => {
      const filing = await filingRepo.createDraft(undefined, { conversationId, language: "en", role: "COMPLAINANT_ADVOCATE", testNoticeVersion: "v1" });
      await partyRepo.upsertFields(undefined, filing.id, "ACCUSED", { fullName: "Suresh Nair" });
      const filedAt = new Date();
      const diaryNumber = await filingRepo.nextDiaryNumber(undefined, filedAt);
      await filingRepo.recordFiled(undefined, filing.id, { diaryNumber, filedAt });

      // The only filing for this conversation — Active cases come after
      // Drafts, so with zero drafts it's still row 1.
      const result = await handleFilingDraftListInput(deps, baseInput({ selection: { listId: "filing:pick-row-1" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_DETAIL", activeFilingId: filing.id });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Suresh Nair") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: CASE_STATUS_ACTIONS_CONTENT_SID.en }));
      expect(filingRepo.findById(filing.id)).toMatchObject({ status: "FILED", selectedCourt: filing.selectedCourt });
    });

    it("nav:main-menu moves to MAIN_MENU", async () => {
      const result = await handleFilingDraftListInput(deps, baseInput({ selection: { listId: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });

    it("a position with no matching row (e.g. already discarded elsewhere) redisplays the list rather than erroring", async () => {
      const filingId = await createDraft();
      await filingRepo.abandonDraft(undefined, filingId);

      // No drafts/cases remain, so row 1 doesn't exist any more.
      const result = await handleFilingDraftListInput(deps, baseInput({ selection: { listId: "filing:pick-row-1" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_LIST" });
    });

    it("unrecognized input redisplays the list", async () => {
      const result = await handleFilingDraftListInput(deps, baseInput({ selection: { body: "asdf" } }));
      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: DRAFT_LIST_CONTENT_SID.en }));
    });
  });

  describe("FILING_DRAFT_DETAIL", () => {
    let filingId: string;

    beforeEach(async () => {
      filingId = await createDraft({ accusedName: "Rajesh Menon", chequeAmount: "450000" });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DRAFT_DETAIL");
    });

    it("filing:resume-draft resumes the draft (resolved via active_filing_id) at its saved current_step", async () => {
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_PHONE_PENDING");

      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING", activeFilingId: filingId });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("phone number") }));
    });

    it("typed '1' (no stable ID) resumes via active_filing_id", async () => {
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_PHONE_PENDING");

      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { body: "1" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
    });

    it("filing:discard-draft deletes the uploaded documents (Blob + DB rows) and abandons the draft, no data loss for other drafts", async () => {
      const otherFilingId = await createDraft({ accusedName: "Someone Else" });
      await filingDocumentRepo.addDocument(undefined, {
        filingId,
        documentGroup: "cheque",
        storageUrl: "https://blob.example.test/cheque-1",
        contentType: "image/jpeg",
        originalTwilioMediaUrl: "https://api.twilio.com/media/1",
      });

      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { buttonPayload: "filing:discard-draft" } }));

      expect(result.delivered).toBe(true);
      expect(blobStorage.delete).toHaveBeenCalledWith(["https://blob.example.test/cheque-1"]);
      expect(await filingDocumentRepo.listByFiling(undefined, filingId)).toHaveLength(0);
      expect(filingRepo.findById(filingId)).toMatchObject({ status: "ABANDONED" });
      expect(filingRepo.findById(otherFilingId)).toMatchObject({ status: "DRAFT" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_LIST" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("documents you had uploaded have been deleted") }));
    });

    it("nav:main-menu moves to MAIN_MENU without touching the draft", async () => {
      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { buttonPayload: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      expect(filingRepo.findById(filingId)).toMatchObject({ status: "DRAFT" });
    });

    it("filing:resume-draft is stale (redisplays the list) once the draft being viewed was discarded elsewhere", async () => {
      await filingRepo.abandonDraft(undefined, filingId);

      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_LIST" });
    });

    it("unrecognized input redisplays the same draft card, not the list", async () => {
      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_DETAIL" });
    });
  });

  describe("FILING_DRAFT_DETAIL — FILED case status screen (#37)", () => {
    let filedFilingId: string;

    beforeEach(async () => {
      const filing = await filingRepo.createDraft(undefined, { conversationId, language: "en", role: "COMPLAINANT_ADVOCATE", testNoticeVersion: "v1" });
      filedFilingId = filing.id;
      await partyRepo.upsertFields(undefined, filedFilingId, "COMPLAINANT", { fullName: "Anitha Joseph" });
      await partyRepo.upsertFields(undefined, filedFilingId, "ACCUSED", { fullName: "Rajesh Menon" });
      const filedAt = new Date();
      const diaryNumber = await filingRepo.nextDiaryNumber(undefined, filedAt);
      await filingRepo.recordFiled(undefined, filedFilingId, { diaryNumber, filedAt });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filedFilingId, "FILING_DRAFT_DETAIL");
    });

    it("unrecognized input redisplays the case status + its actions, not the draft card", async () => {
      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: CASE_STATUS_ACTIONS_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_DETAIL" });
    });

    it("nav:main-menu moves to MAIN_MENU without touching the filing", async () => {
      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { buttonPayload: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      expect(filingRepo.findById(filedFilingId)).toMatchObject({ status: "FILED" });
    });

    it("filing:simulate-defects cascades into FILING_DEFECT_ALERT — records defectNotifiedAt and sends the alert + fixed defect list + action", async () => {
      const result = await handleFilingDraftDetailInput(deps, baseInput({ selection: { buttonPayload: "filing:simulate-defects" } }));

      expect(result.delivered).toBe(true);
      const filing = filingRepo.findById(filedFilingId);
      expect(filing).toMatchObject({ currentStep: "FILING_DEFECT_ALERT" });
      expect(filing?.defectNotifiedAt).toBeInstanceOf(Date);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_ALERT", activeFilingId: filedFilingId });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Anitha Joseph vs Rajesh Menon") }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("3 defects") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: FILING_DEFECT_CONTENT_SIDS.defectAlertActionsContentSid.en }));
    });
  });

  describe("restart independence (#26/#28 regression coverage)", () => {
    it("browsing My cases never touches the restart keyword's own reset behavior — the two features are independent by construction", async () => {
      // filing-draft-list-workflow.ts never calls resetForRestartInTx / abandons
      // anything except the one draft explicitly discarded — no shared code path
      // with handleRestartRequest in inbound-router.ts.
      const filingId = await createDraft();
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DRAFT_LIST");

      await handleFilingDraftListInput(deps, baseInput({ selection: { listId: "nav:main-menu" } }));

      expect(filingRepo.findById(filingId)).toMatchObject({ status: "DRAFT" });
    });
  });
});
