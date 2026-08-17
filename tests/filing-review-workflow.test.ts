import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingCourtInput,
  handleFilingDeclareInput,
  handleFilingEditChequeFieldInput,
  handleFilingEditChequeNumberInput,
  handleFilingEditCourtInput,
  handleFilingEditGroupInput,
  handleFilingEditNarrativeFieldInput,
  handleFilingEditReturnReasonInput,
  handleFilingReviewInput,
  type FilingReviewWorkflowDeps,
} from "../src/services/filing-review-workflow";
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
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
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
const FILING_SIGN_CONTENT_SIDS = {
  draftReadyActionsContentSid: { en: "HXfdraftreadyEn0000000000000000000", ml: "HXfdraftreadyMl0000000000000000000" },
};

/** Covers #33 Part F: court selection, the combined Parts A-F review, the 2-level edit picker, and the declaration. */
describe("filing-review-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let filingDocumentRepo: InMemoryFilingDocumentRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let blobStorage: ReturnType<typeof createFakeDocumentStorageDeps>["blobStorage"];
  let deps: FilingReviewWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    partyRepo = new InMemoryFilingPartyRepository();
    filingDocumentRepo = new InMemoryFilingDocumentRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient();

    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    const filing = await filingRepo.createDraft(undefined, {
      conversationId,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    filingId = filing.id;

    // Parts A-E already done, mirroring how this file only needs to
    // exercise Part F — same pattern as filing-document-workflow.test.ts
    // seeding directly at its last group.
    await partyRepo.upsertFields(undefined, filingId, "COMPLAINANT", {
      filingAsRole: "SELF",
      fullName: "Anitha Joseph",
      phoneOriginal: "9876543210",
      phoneNormalized: "+919876543210",
      emailNormalized: null,
      address: "Thekkumkattil House\nKollam 691008",
    });
    await partyRepo.upsertFields(undefined, filingId, "ACCUSED", {
      fullName: "Rajesh Menon",
      phoneOriginal: null,
      phoneNormalized: null,
      address: "32/1147, Menon Villa\nChinnakada, Kollam 691001",
      entityType: "INDIVIDUAL",
    });
    await filingRepo.upsertFilingFields(undefined, filingId, {
      chequeNumber: "004512",
      chequeDate: "2026-03-12",
      chequeAmount: "450000",
      memoDate: "2026-03-18",
      noticeDate: "2026-03-25",
      serviceDate: "2026-03-28",
      partPayment: false,
    });

    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_COURT_PENDING");
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_COURT_PENDING");

    deps = {
      conversationRepo,
      filingRepo,
      partyRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_CONTENT_SIDS },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      filingSignSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_SIGN_CONTENT_SIDS },
      blobStorage: (blobStorage = createFakeDocumentStorageDeps().blobStorage),
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function actionInput(overrides: Partial<Parameters<typeof handleFilingCourtInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  function fieldEvent(overrides: Partial<Parameters<typeof handleFilingEditChequeNumberInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, text: "", mediaCount: 0, ...overrides };
  }

  describe("FILING_COURT_PENDING (Part F entry)", () => {
    it("a selected court advances to FILING_REVIEW and sends the full Parts A-F summary + review actions", async () => {
      const result = await handleFilingCourtInput(deps, actionInput({ selection: { buttonPayload: "filing:court-1" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ selectedCourt: "ON Court - I, Kollam", currentStep: "FILING_REVIEW" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_REVIEW" });

      // The review recaps every section — complainant, accused, cheque/notice.
      const sentBodies = messagingClient.sendText.mock.calls.map((call) => call[0].body).join("\n");
      expect(sentBodies).toContain("Anitha Joseph");
      expect(sentBodies).toContain("Rajesh Menon");
      expect(sentBodies).toContain("004512");
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.reviewActionsContentSid.en }),
      );
    });

    it("unrecognized selection redisplays the same court prompt, no state change", async () => {
      const result = await handleFilingCourtInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.courtContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_COURT_PENDING" });
    });
  });

  describe("FILING_REVIEW dispatch", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { selectedCourt: "ON Court - I, Kollam" });
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_REVIEW", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_REVIEW");
      messagingClient.sendText.mockClear();
      messagingClient.sendContentTemplate.mockClear();
    });

    it("filing:confirm opens the declaration prompt", async () => {
      const result = await handleFilingReviewInput(deps, actionInput({ selection: { buttonPayload: "filing:confirm" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.declareContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DECLARE_PENDING" });
    });

    it("filing:edit opens the 2-level edit-group picker", async () => {
      const result = await handleFilingReviewInput(deps, actionInput({ selection: { buttonPayload: "filing:edit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.editGroupContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_GROUP_PENDING" });
    });

    it("filing:save-exit returns to MAIN_MENU, keeping current_step FILING_REVIEW", async () => {
      const result = await handleFilingReviewInput(deps, actionInput({ selection: { buttonPayload: "filing:save-exit" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU", activeFilingId: filingId });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_REVIEW" });
    });

    it("unrecognized input redisplays the summary and review actions, without changing state", async () => {
      const result = await handleFilingReviewInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.reviewActionsContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_REVIEW" });
    });
  });

  describe("2-level edit picker", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_GROUP_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_GROUP_PENDING");
    });

    it("choosing 'Cheque & notice' opens the 9-field list-picker", async () => {
      const result = await handleFilingEditGroupInput(deps, actionInput({ selection: { buttonPayload: "filing:edit-group-cheque" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.editChequeFieldContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_CHEQUE_FIELD_PENDING" });
    });

    it("choosing 'Story, witness & court' opens the 3-field list-picker", async () => {
      const result = await handleFilingEditGroupInput(deps, actionInput({ selection: { buttonPayload: "filing:edit-group-narrative" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.editNarrativeFieldContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_NARRATIVE_FIELD_PENDING" });
    });

    it("selecting cheque number from the cheque-field list transitions to its own edit-pending state", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_CHEQUE_FIELD_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_CHEQUE_FIELD_PENDING");

      const result = await handleFilingEditChequeFieldInput(deps, actionInput({ selection: { listId: "filing:edit-cheque-number" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_CHEQUE_NUMBER_PENDING" });
    });

    it("selecting return reason (a selection field) from the cheque-field list sends the select template, not plain text", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_CHEQUE_FIELD_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_CHEQUE_FIELD_PENDING");

      const result = await handleFilingEditChequeFieldInput(deps, actionInput({ selection: { listId: "filing:edit-return-reason" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.returnReasonContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_RETURN_REASON_PENDING" });
    });

    it("selecting court from the narrative-field list sends the court template", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_NARRATIVE_FIELD_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_NARRATIVE_FIELD_PENDING");

      const result = await handleFilingEditNarrativeFieldInput(deps, actionInput({ selection: { listId: "filing:edit-court" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.courtContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_COURT_PENDING" });
    });
  });

  describe("per-field edit input — only this one field changes, always returns to FILING_REVIEW", () => {
    it("editing cheque number (text field) writes only that field and resends the review", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_CHEQUE_NUMBER_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_CHEQUE_NUMBER_PENDING");

      const result = await handleFilingEditChequeNumberInput(deps, fieldEvent({ text: "004999" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({
        chequeNumber: "004999",
        chequeAmount: "450000", // unrelated field left unchanged
        currentStep: "FILING_REVIEW",
      });
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.reviewActionsContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_REVIEW" });
    });

    it("an invalid replacement leaves the edit-pending state and the filing unchanged", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_CHEQUE_NUMBER_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_CHEQUE_NUMBER_PENDING");

      const result = await handleFilingEditChequeNumberInput(deps, fieldEvent({ text: "" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ chequeNumber: "004512", currentStep: "FILING_EDIT_CHEQUE_NUMBER_PENDING" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_EDIT_CHEQUE_NUMBER_PENDING" });
    });

    it("editing return reason (a selection field) via button writes only that field and resends the review", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_RETURN_REASON_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_RETURN_REASON_PENDING");

      const result = await handleFilingEditReturnReasonInput(deps, actionInput({ selection: { buttonPayload: "filing:reason-stop" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ returnReason: "stop", currentStep: "FILING_REVIEW" });
    });

    it("editing court (a selection field) writes only that field and resends the review", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_EDIT_COURT_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_EDIT_COURT_PENDING");

      const result = await handleFilingEditCourtInput(deps, actionInput({ selection: { buttonPayload: "filing:court-3" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ selectedCourt: "JFCM, Kottarakkara", currentStep: "FILING_REVIEW" });
    });
  });

  describe("FILING_DECLARE_PENDING", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { selectedCourt: "ON Court - I, Kollam" });
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DECLARE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_DECLARE_PENDING");
    });

    it("filing:declare-accept records the declaration and cascades into FILING_DRAFT_READY (#34), sending the draft-ready summary with the actually-selected court", async () => {
      const result = await handleFilingDeclareInput(deps, actionInput({ selection: { buttonPayload: "filing:declare-accept" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DRAFT_READY" });
      expect(filingRepo.findById(filingId)?.declarationAcceptedAt).toBeInstanceOf(Date);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_READY" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ON Court - I, Kollam") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_SIGN_CONTENT_SIDS.draftReadyActionsContentSid.en }),
      );
    });

    it("also generates and sends the draft-complaint PDF, hosted briefly at a public URL then deleted", async () => {
      await handleFilingDeclareInput(deps, actionInput({ selection: { buttonPayload: "filing:declare-accept" } }));

      expect(blobStorage.storePublic).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: "application/pdf", pathname: expect.stringContaining("Complaint_S138_Joseph_vs_Menon.pdf") }),
      );
      expect(messagingClient.sendMediaMessage).toHaveBeenCalledWith(
        expect.objectContaining({ from: FROM_NUMBER, to: WHATSAPP_NUMBER, mediaUrl: "https://blob.example.test/fake-public-file" }),
      );
      // The public URL is deleted again right after the send — never left public indefinitely.
      expect(blobStorage.delete).toHaveBeenCalledWith(["https://blob.example.test/fake-public-file"]);
    });

    it("a PDF-attachment failure never affects the declaration's own result — the text summary/actions already succeeded", async () => {
      blobStorage.storePublic.mockRejectedValueOnce(new Error("blob store unreachable"));

      const result = await handleFilingDeclareInput(deps, actionInput({ selection: { buttonPayload: "filing:declare-accept" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendMediaMessage).not.toHaveBeenCalled();
      // The advocate still got everything that matters.
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ON Court - I, Kollam") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_SIGN_CONTENT_SIDS.draftReadyActionsContentSid.en }),
      );
    });

    it("filing:save-exit preserves current_step and returns to MAIN_MENU without declaring", async () => {
      const result = await handleFilingDeclareInput(deps, actionInput({ selection: { buttonPayload: "filing:save-exit" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DECLARE_PENDING" });
      expect(filingRepo.findById(filingId)?.declarationAcceptedAt).toBeNull();
    });

    it("unrecognized input redisplays the declaration prompt, no state change", async () => {
      const result = await handleFilingDeclareInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.declareContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DECLARE_PENDING" });
    });
  });
});
