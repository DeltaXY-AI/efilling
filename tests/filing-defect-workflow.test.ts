import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingDefect1Input,
  handleFilingDefect2Input,
  handleFilingDefect3Input,
  handleFilingDefectAlertInput,
  handleFilingDefectReviewInput,
  handleFilingDefectSentInput,
  type FilingDefectWorkflowDeps,
} from "../src/services/filing-defect-workflow";
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
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
/** A couple of clock ticks — coarse clock resolution on some platforms can otherwise give two nearby `new Date()` calls the identical millisecond, which would make the ">=" defectNotifiedAt comparison in filing-defect-workflow.ts ambiguous for these tests' own before/after ordering. Real usage always has this much real elapsed time between an upload and the next webhook turn. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

const FILING_DEFECT_CONTENT_SIDS = {
  caseStatusActionsContentSid: { en: "HXcasestatEn0000000000000000000000", ml: "HXcasestatMl0000000000000000000000" },
  defectAlertActionsContentSid: { en: "HXdalertEn0000000000000000000000000", ml: "HXdalertMl0000000000000000000000000" },
  delayDaysContentSid: { en: "HXddaysEn00000000000000000000000000", ml: "HXddaysMl00000000000000000000000000" },
  defectReviewActionsContentSid: { en: "HXdreviewEn000000000000000000000000", ml: "HXdreviewMl000000000000000000000000" },
  defectSentActionsContentSid: { en: "HXdsentEn0000000000000000000000000", ml: "HXdsentMl0000000000000000000000000" },
};

/** Covers #37 (Prototype parity — Phase 9): the scrutiny-defect correction flow, FILING_DEFECT_ALERT through FILING_DEFECT_SENT. */
describe("filing-defect-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let filingDocumentRepo: InMemoryFilingDocumentRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let documentStorageDeps: FakeDocumentStorageDeps;
  let deps: FilingDefectWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    partyRepo = new InMemoryFilingPartyRepository();
    filingDocumentRepo = new InMemoryFilingDocumentRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient();
    documentStorageDeps = createFakeDocumentStorageDeps();

    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    const filing = await filingRepo.createDraft(undefined, { conversationId, language: "en", role: "COMPLAINANT_ADVOCATE", testNoticeVersion: "v1" });
    filingId = filing.id;
    await partyRepo.upsertFields(undefined, filingId, "COMPLAINANT", { fullName: "Anitha Joseph" });
    await partyRepo.upsertFields(undefined, filingId, "ACCUSED", { fullName: "Rajesh Menon" });
    await filingRepo.upsertFilingFields(undefined, filingId, { selectedCourt: "ON Court - I, Kollam" });
    // Pre-existing Phase 3 cheque documents — the original upload, which
    // Defect 2's re-upload count must never be blocked by (see file header).
    await filingDocumentRepo.addDocument(undefined, {
      filingId,
      documentGroup: "cheque",
      storageUrl: "https://blob.example.test/cheque-original.jpg",
      contentType: "image/jpeg",
      originalTwilioMediaUrl: "https://api.twilio.com/media/original",
    });

    const filedAt = new Date();
    const diaryNumber = await filingRepo.nextDiaryNumber(undefined, filedAt);
    await filingRepo.recordFiled(undefined, filingId, { diaryNumber, filedAt });

    await tick();
    // Mirrors filing-draft-list-workflow.ts's openDefectAlert cascade.
    await filingRepo.upsertFilingFields(undefined, filingId, { defectNotifiedAt: new Date() });
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_DEFECT_ALERT");
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DEFECT_ALERT");

    deps = {
      conversationRepo,
      filingRepo,
      partyRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      documentStorageDeps,
      filingDefectSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DEFECT_CONTENT_SIDS },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function actionInput(overrides: Partial<{ language: "en" | "ml"; selection: Record<string, string> }> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  function fieldEvent(text: string, overrides: Partial<{ language: "en" | "ml"; mediaCount: number }> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, text, mediaCount: 0, ...overrides };
  }

  describe("FILING_DEFECT_ALERT", () => {
    it("unrecognized input redisplays the alert + fixed defect list + action, with the actually-persisted diary number/parties, not hardcoded", async () => {
      const filing = filingRepo.findById(filingId)!;
      const result = await handleFilingDefectAlertInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(filing.diaryNumber!) }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Anitha Joseph vs Rajesh Menon") }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("004152") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: FILING_DEFECT_CONTENT_SIDS.defectAlertActionsContentSid.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_ALERT" });
    });

    it("filing:correct-defects cascades to FILING_DEFECT_1", async () => {
      const result = await handleFilingDefectAlertInput(deps, actionInput({ selection: { buttonPayload: "filing:correct-defects" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DEFECT_1" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_1" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Defect 1 of 3") }));
    });

    it("a stale conversation (no longer FILING_DEFECT_ALERT) is a safe no-op", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

      const result = await handleFilingDefectAlertInput(deps, actionInput({ selection: { buttonPayload: "filing:correct-defects" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });
  });

  describe("FILING_DEFECT_1", () => {
    beforeEach(async () => {
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_DEFECT_1");
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DEFECT_1", new Date());
    });

    it("a valid cheque number is recorded and cascades to FILING_DEFECT_2", async () => {
      const result = await handleFilingDefect1Input(deps, fieldEvent("004512"));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ defectCorrectedChequeNumber: "004512", currentStep: "FILING_DEFECT_2" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_2" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Defect 2 of 3") }));
    });

    it("empty input is rejected without advancing", async () => {
      const result = await handleFilingDefect1Input(deps, fieldEvent("   "));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DEFECT_1", defectCorrectedChequeNumber: null });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_1" });
    });
  });

  describe("FILING_DEFECT_2", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { defectCorrectedChequeNumber: "004512" });
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_DEFECT_2");
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DEFECT_2", new Date());
    });

    it("uploading a photo adds a new filing_documents row without deleting the original Phase 3 upload", async () => {
      const result = await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM1",
        language: "en",
        text: "",
        media: [{ url: "https://api.twilio.com/media/rescan", contentType: "image/jpeg", index: 0 }],
      });

      expect(result.delivered).toBe(true);
      const documents = await filingDocumentRepo.listByFiling(undefined, filingId);
      expect(documents).toHaveLength(2);
      expect(documents.map((d) => d.originalTwilioMediaUrl)).toEqual(
        expect.arrayContaining(["https://api.twilio.com/media/original", "https://api.twilio.com/media/rescan"]),
      );
    });

    it("'docs:continue' before any upload (min 1 not met) redisplays without advancing", async () => {
      const result = await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM1",
        language: "en",
        text: "done",
        media: [],
      });

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_2" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("at least 1 photo") }));
    });

    it("'done' after one upload cascades to FILING_DEFECT_3", async () => {
      await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM1",
        language: "en",
        text: "",
        media: [{ url: "https://api.twilio.com/media/rescan", contentType: "image/jpeg", index: 0 }],
      });

      const result = await handleFilingDefect2Input(deps, { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en", text: "done", media: [] });

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DEFECT_3" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_3" });
    });

    it("the 'Done' quick-reply button (docs:continue ButtonPayload) after one upload cascades to FILING_DEFECT_3, same as typed 'done'", async () => {
      await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM1",
        language: "en",
        text: "",
        media: [{ url: "https://api.twilio.com/media/rescan", contentType: "image/jpeg", index: 0 }],
      });

      const result = await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM2",
        language: "en",
        text: "",
        buttonPayload: "docs:continue",
        media: [],
      });

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DEFECT_3" });
    });

    it("once continueOnlyContentSid is configured, the re-upload prompt/acks go out as the Done-only quick-reply Content Template instead of plain text", async () => {
      const continueOnlyContentSid = { en: "HXdocContinueOnlyEn0000000000000000", ml: "HXdocContinueOnlyMl0000000000000000" };
      deps.continueOnlyContentSid = continueOnlyContentSid;

      const result = await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM1",
        language: "en",
        text: "asdf",
        media: [],
      });

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: continueOnlyContentSid.en }));
      expect(messagingClient.sendText).not.toHaveBeenCalled();
    });

    it("a 3rd upload (max 2 for this re-upload) is rejected with the max-reached message", async () => {
      for (let i = 0; i < 2; i++) {
        await handleFilingDefect2Input(deps, {
          conversationId,
          whatsappNumber: WHATSAPP_NUMBER,
          messageId: `SM${i}`,
          language: "en",
          text: "",
          media: [{ url: `https://api.twilio.com/media/rescan-${i}`, contentType: "image/jpeg", index: i }],
        });
        await tick();
      }

      const result = await handleFilingDefect2Input(deps, {
        conversationId,
        whatsappNumber: WHATSAPP_NUMBER,
        messageId: "SM3",
        language: "en",
        text: "",
        media: [{ url: "https://api.twilio.com/media/rescan-2", contentType: "image/jpeg", index: 2 }],
      });

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("maximum (2)") }));
      // Still only the original + the 2 accepted re-uploads — the 3rd never stored.
      expect(await filingDocumentRepo.listByFiling(undefined, filingId)).toHaveLength(3);
    });
  });

  describe("FILING_DEFECT_3", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { defectCorrectedChequeNumber: "004512" });
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_DEFECT_3");
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DEFECT_3", new Date());
    });

    it("the first answer (reason not yet set) is treated as the delay reason and stays on FILING_DEFECT_3, prompting for days", async () => {
      const result = await handleFilingDefect3Input(deps, actionInput({ selection: { body: "The advocate was travelling." } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ defectDelayReason: "The advocate was travelling.", currentStep: "FILING_DEFECT_3" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_3" });
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: FILING_DEFECT_CONTENT_SIDS.delayDaysContentSid.en }));
    });

    it("an empty reason is rejected without advancing to the days prompt", async () => {
      const result = await handleFilingDefect3Input(deps, actionInput({ selection: { body: "   " } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ defectDelayReason: null });
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    });

    it("once the reason is set, the next input answers days-of-delay and cascades to FILING_DEFECT_REVIEW with all 3 defects reflected", async () => {
      await handleFilingDefect3Input(deps, actionInput({ selection: { body: "The advocate was travelling." } }));

      const result = await handleFilingDefect3Input(deps, actionInput({ selection: { buttonPayload: "filing:delay-3" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ defectDelayDays: 3, currentStep: "FILING_DEFECT_REVIEW" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_REVIEW" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("004512") }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("3 days") }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("The advocate was travelling.") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: FILING_DEFECT_CONTENT_SIDS.defectReviewActionsContentSid.en }));
    });

    it("an unrecognized days answer redisplays the days prompt rather than advancing", async () => {
      await handleFilingDefect3Input(deps, actionInput({ selection: { body: "The advocate was travelling." } }));

      const result = await handleFilingDefect3Input(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_DEFECT_3", defectDelayDays: null });
    });
  });

  describe("FILING_DEFECT_REVIEW", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { defectCorrectedChequeNumber: "004512", defectDelayReason: "Travel", defectDelayDays: 3 });
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_DEFECT_REVIEW");
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DEFECT_REVIEW", new Date());
    });

    it("unrecognized input redisplays the summary + actions", async () => {
      const result = await handleFilingDefectReviewInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("004512") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_REVIEW" });
    });

    it("filing:defect-confirm records the resubmission timestamp (durable, real — never hardcoded) and cascades to FILING_DEFECT_SENT with the same diary number", async () => {
      const before = filingRepo.findById(filingId)!;

      const result = await handleFilingDefectReviewInput(deps, actionInput({ selection: { buttonPayload: "filing:defect-confirm" } }));

      expect(result.delivered).toBe(true);
      const after = filingRepo.findById(filingId);
      expect(after).toMatchObject({ currentStep: "FILING_DEFECT_SENT", diaryNumber: before.diaryNumber });
      expect(after?.defectResubmittedAt).toBeInstanceOf(Date);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_SENT" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(before.diaryNumber!) }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: FILING_DEFECT_CONTENT_SIDS.defectSentActionsContentSid.en }));
    });

    it("a stale conversation (no longer FILING_DEFECT_REVIEW) is a safe no-op", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

      const result = await handleFilingDefectReviewInput(deps, actionInput({ selection: { buttonPayload: "filing:defect-confirm" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });
  });

  describe("FILING_DEFECT_SENT", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { defectResubmittedAt: new Date() });
      await filingRepo.setCurrentStep(undefined, filingId, "FILING_DEFECT_SENT");
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DEFECT_SENT", new Date());
    });

    it("unrecognized input redisplays the acknowledgement + actions", async () => {
      const result = await handleFilingDefectSentInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DEFECT_SENT" });
    });

    it("nav:main-menu moves to MAIN_MENU", async () => {
      const result = await handleFilingDefectSentInput(deps, actionInput({ selection: { buttonPayload: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }));
    });
  });

  describe("bilingual coverage", () => {
    it("sends the Malayalam defect alert and review summary", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DEFECT_ALERT", new Date());

      const result = await handleFilingDefectAlertInput(deps, actionInput({ language: "ml", selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ന്യൂനതകൾ") }));
    });
  });
});
