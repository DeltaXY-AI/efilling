import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingAmountInput,
  handleFilingBankBranchInput,
  handleFilingChequeDateInput,
  handleFilingChequeNumberInput,
  handleFilingMemoDateInput,
  handleFilingNoticeDateInput,
  handleFilingPartPaymentInput,
  handleFilingReturnReasonInput,
  handleFilingServiceDateInput,
  handleFilingStoryInput,
  handleFilingWitnessInput,
  type FilingDetailsWorkflowDeps,
} from "../src/services/filing-details-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
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

/** Covers #33 Parts C-D: cheque/notice particulars and the narrative, cascading into Part E's entry point. */
describe("filing-details-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: FilingDetailsWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
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
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_CHEQUE_NUMBER_PENDING");
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_CHEQUE_NUMBER_PENDING");

    deps = {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_CONTENT_SIDS },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function fieldEvent(overrides: Partial<Parameters<typeof handleFilingChequeNumberInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, text: "", mediaCount: 0, ...overrides };
  }

  function actionInput(overrides: Partial<Parameters<typeof handleFilingReturnReasonInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, selection: {}, ...overrides };
  }

  describe("linear text fields (Part C)", () => {
    it("a valid cheque number advances to FILING_CHEQUE_DATE_PENDING", async () => {
      const result = await handleFilingChequeNumberInput(deps, fieldEvent({ text: "004512" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("cheque date") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_CHEQUE_DATE_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({ chequeNumber: "004512", currentStep: "FILING_CHEQUE_DATE_PENDING" });
    });

    it("an invalid cheque date keeps the same state and sends the localized error", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_CHEQUE_DATE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_CHEQUE_DATE_PENDING");

      const result = await handleFilingChequeDateInput(deps, fieldEvent({ text: "not a date" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("DD-MM-YYYY") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_CHEQUE_DATE_PENDING" });
    });

    it("a valid amount strips comma grouping and advances to FILING_BANK_BRANCH_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_AMOUNT_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_AMOUNT_PENDING");

      const result = await handleFilingAmountInput(deps, fieldEvent({ text: "4,50,000" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ chequeAmount: "450000", currentStep: "FILING_BANK_BRANCH_PENDING" });
    });

    it("Skip on bank/branch (optional) leaves it null and advances to the return-reason select", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_BANK_BRANCH_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_BANK_BRANCH_PENDING");

      const result = await handleFilingBankBranchInput(deps, fieldEvent({ text: "Skip" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.returnReasonContentSid.en }),
      );
      expect(filingRepo.findById(filingId)).toMatchObject({ bankBranch: null, currentStep: "FILING_RETURN_REASON_PENDING" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_RETURN_REASON_PENDING" });
    });
  });

  describe("return reason (optional select, Part C)", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_RETURN_REASON_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_RETURN_REASON_PENDING");
    });

    it("a selected reason is persisted and advances to memo date", async () => {
      const result = await handleFilingReturnReasonInput(deps, actionInput({ selection: { buttonPayload: "filing:reason-funds" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("memo") }));
      expect(filingRepo.findById(filingId)).toMatchObject({ returnReason: "funds", currentStep: "FILING_MEMO_DATE_PENDING" });
    });

    it("Skip leaves the reason unset and still advances (optional field)", async () => {
      const result = await handleFilingReturnReasonInput(deps, actionInput({ selection: { body: "skip" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ returnReason: null, currentStep: "FILING_MEMO_DATE_PENDING" });
    });

    it("unrecognized input redisplays the same prompt, no state change", async () => {
      const result = await handleFilingReturnReasonInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.returnReasonContentSid.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_RETURN_REASON_PENDING" });
    });
  });

  describe("the remaining required dates (Part C)", () => {
    it("memo date advances to FILING_NOTICE_DATE_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_MEMO_DATE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_MEMO_DATE_PENDING");

      const result = await handleFilingMemoDateInput(deps, fieldEvent({ text: "18-03-2026" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ memoDate: "2026-03-18", currentStep: "FILING_NOTICE_DATE_PENDING" });
    });

    it("notice date advances to FILING_SERVICE_DATE_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_NOTICE_DATE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_NOTICE_DATE_PENDING");

      const result = await handleFilingNoticeDateInput(deps, fieldEvent({ text: "25-03-2026" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ noticeDate: "2026-03-25", currentStep: "FILING_SERVICE_DATE_PENDING" });
    });

    it("service date advances to the paid-after-notice select", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_SERVICE_DATE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_SERVICE_DATE_PENDING");

      const result = await handleFilingServiceDateInput(deps, fieldEvent({ text: "28-03-2026" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.partPaymentContentSid.en }),
      );
      expect(filingRepo.findById(filingId)).toMatchObject({ serviceDate: "2026-03-28", currentStep: "FILING_PART_PAYMENT_PENDING" });
    });
  });

  describe("paid after notice? (required radio, Part C)", () => {
    it("a selected value is persisted and advances into the narrative (Part D)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_PART_PAYMENT_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_PART_PAYMENT_PENDING");

      const result = await handleFilingPartPaymentInput(deps, actionInput({ selection: { buttonPayload: "filing:paid-part" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("What happened") }));
      expect(filingRepo.findById(filingId)).toMatchObject({ partPayment: true, currentStep: "FILING_STORY_PENDING" });
    });
  });

  describe("narrative and witness (Part D)", () => {
    it("Skip on the optional story leaves it null and advances to the witness select", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_STORY_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_STORY_PENDING");

      const result = await handleFilingStoryInput(deps, fieldEvent({ text: "Skip" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: FILING_DETAILS_CONTENT_SIDS.witnessContentSid.en }),
      );
      expect(filingRepo.findById(filingId)).toMatchObject({ narrative: null, currentStep: "FILING_WITNESS_PENDING" });
    });

    it("witness cascades straight into Part E's written-account entry — no dead state", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_WITNESS_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_WITNESS_PENDING");

      const result = await handleFilingWitnessInput(deps, actionInput({ selection: { buttonPayload: "filing:witness-yes" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ witnessPresent: true, currentStep: "FILING_WRITTEN_ACCOUNT_PENDING" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_WRITTEN_ACCOUNT_PENDING" });
      // Part E's own entry prompt — proves the cascade actually reaches it, not just the state.
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Already written it down") }));
    });
  });

  describe("bilingual and stale-state safety", () => {
    it("sends the Malayalam validation error for a Malayalam advocate", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_CHEQUE_NUMBER_PENDING");

      await handleFilingChequeNumberInput(deps, fieldEvent({ language: "ml", text: "" }));

      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ചെക്ക് നമ്പർ") }));
    });

    it("is a safe no-op when the conversation is no longer the expected pending state (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_AMOUNT_PENDING", new Date());

      const result = await handleFilingChequeNumberInput(deps, fieldEvent({ text: "004512" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ chequeNumber: null });
    });
  });
});
