import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingDraftReadyInput,
  handleFilingOtpInput,
  resendFilingSignPromptForResume,
  type FilingSignWorkflowDeps,
} from "../src/services/filing-sign-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const DRAFT_READY_ACTIONS_CONTENT_SID = { en: "HXfdraftreadyEn0000000000000000000", ml: "HXfdraftreadyMl0000000000000000000" };
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
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };

/** Covers #34 (Prototype parity — Phase 6): the draft-ready summary, e-Sign/Edit-details dispatch, and the simulated OTP check. */
describe("filing-sign-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: FilingSignWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    const partyRepo = new InMemoryFilingPartyRepository();
    const filingDocumentRepo = new InMemoryFilingDocumentRepository();
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
    await filingRepo.upsertFilingFields(undefined, filingId, { selectedCourt: "ON Court - I, Kollam" });

    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DRAFT_READY");
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_DRAFT_READY");

    const filingSignSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, draftReadyActionsContentSid: DRAFT_READY_ACTIONS_CONTENT_SID };

    deps = {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      filingSignSenderDeps,
      filingReviewWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        filingDocumentRepo,
        outboundMessageRepo,
        filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_CONTENT_SIDS },
        mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
        filingSignSenderDeps,
        withTransaction: createInMemoryWithTransaction(),
      },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function actionInput(overrides: Partial<Parameters<typeof handleFilingDraftReadyInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  function fieldInput(overrides: Partial<Parameters<typeof handleFilingOtpInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, text: "", mediaCount: 0, ...overrides };
  }

  describe("FILING_DRAFT_READY", () => {
    it("unrecognized input redisplays the draft-ready summary with the actually-selected court, not a hardcoded one", async () => {
      const result = await handleFilingDraftReadyInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ON Court - I, Kollam") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: DRAFT_READY_ACTIONS_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_READY" });
    });

    it("filing:esign transitions to FILING_OTP_PENDING and sends the OTP prompt", async () => {
      const result = await handleFilingDraftReadyInput(deps, actionInput({ selection: { buttonPayload: "filing:esign" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_OTP_PENDING" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_OTP_PENDING" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("6-digit OTP") }));
    });

    it("the OTP prompt never claims a real Aadhaar-linked OTP was sent", async () => {
      await handleFilingDraftReadyInput(deps, actionInput({ selection: { buttonPayload: "filing:esign" } }));

      const sentBody = messagingClient.sendText.mock.calls.map((call) => call[0].body).find((body) => body.includes("OTP"));
      expect(sentBody).toBeDefined();
      expect(sentBody).not.toContain("Aadhaar-linked");
      expect(sentBody?.toLowerCase()).toContain("simulated");
    });

    it("filing:edit-details returns to FILING_REVIEW without losing previously entered data", async () => {
      const result = await handleFilingDraftReadyInput(deps, actionInput({ selection: { buttonPayload: "filing:edit-details" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_REVIEW", selectedCourt: "ON Court - I, Kollam" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_REVIEW" });
    });

    it("a stale conversation (no longer FILING_DRAFT_READY) is a safe no-op for filing:esign", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_REVIEW", new Date());

      const result = await handleFilingDraftReadyInput(deps, actionInput({ selection: { buttonPayload: "filing:esign" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_REVIEW" });
    });
  });

  describe("FILING_OTP_PENDING", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_OTP_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_OTP_PENDING");
    });

    it("a valid 6-digit OTP cascades into FILING_FILED_START (Phase 7 placeholder)", async () => {
      const result = await handleFilingOtpInput(deps, fieldInput({ text: "123456" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_FILED_START" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_FILED_START" });
    });

    it("an invalid OTP format is rejected with no state change", async () => {
      const result = await handleFilingOtpInput(deps, fieldInput({ text: "12ab56" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_OTP_PENDING" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_OTP_PENDING" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("6-digit OTP") }));
    });

    it("wrong-length input is rejected with no state change", async () => {
      const result = await handleFilingOtpInput(deps, fieldInput({ text: "12345" }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_OTP_PENDING" });
    });

    it("media-only input is rejected the same as any other invalid input", async () => {
      const result = await handleFilingOtpInput(deps, fieldInput({ text: "", mediaCount: 1 }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_OTP_PENDING" });
    });
  });

  describe("resendFilingSignPromptForResume", () => {
    it("resends the draft-ready summary + actions when resuming into FILING_DRAFT_READY", async () => {
      const filing = filingRepo.findById(filingId)!;
      const delivered = await resendFilingSignPromptForResume(
        { messagingClient, fromNumber: FROM_NUMBER, filingSignSenderDeps: deps.filingSignSenderDeps },
        filing,
        { to: WHATSAPP_NUMBER, language: "en", correlationId: "SM3" },
      );

      expect(delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ON Court - I, Kollam") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: DRAFT_READY_ACTIONS_CONTENT_SID.en }));
    });

    it("resends the same draft-ready summary + actions for the legacy DRAFT_READY_START sentinel", async () => {
      const filing = { ...filingRepo.findById(filingId)!, currentStep: "DRAFT_READY_START" };
      const delivered = await resendFilingSignPromptForResume(
        { messagingClient, fromNumber: FROM_NUMBER, filingSignSenderDeps: deps.filingSignSenderDeps },
        filing,
        { to: WHATSAPP_NUMBER, language: "en", correlationId: "SM4" },
      );

      expect(delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: DRAFT_READY_ACTIONS_CONTENT_SID.en }));
    });

    it("resends the OTP prompt when resuming into FILING_OTP_PENDING", async () => {
      const filing = { ...filingRepo.findById(filingId)!, currentStep: "FILING_OTP_PENDING" };
      const delivered = await resendFilingSignPromptForResume(
        { messagingClient, fromNumber: FROM_NUMBER, filingSignSenderDeps: deps.filingSignSenderDeps },
        filing,
        { to: WHATSAPP_NUMBER, language: "en", correlationId: "SM5" },
      );

      expect(delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("6-digit OTP") }));
    });
  });

  describe("bilingual coverage", () => {
    it("sends the Malayalam draft-ready summary, actions, and OTP prompt", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_READY", new Date());

      const result = await handleFilingDraftReadyInput(deps, actionInput({ language: "ml", selection: { buttonPayload: "filing:esign" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("OTP") }));
    });

    it("Malayalam OTP-bad message is sent for invalid input", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_OTP_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_OTP_PENDING");

      const result = await handleFilingOtpInput(deps, fieldInput({ language: "ml", text: "bad" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("OTP") }));
    });
  });
});
