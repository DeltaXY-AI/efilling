import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingDoneInput,
  handleFilingFiledInput,
  type FilingCompletionWorkflowDeps,
} from "../src/services/filing-completion-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { createFakeDocumentStorageDeps } from "./helpers/fake-document-storage";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const FILED_ACTIONS_CONTENT_SID = { en: "HXffiledEn00000000000000000000000", ml: "HXffiledMl00000000000000000000000" };
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };

/** Covers #35 (Prototype parity — Phase 7): the filed acknowledgement, simulated court-fee payment, and completion. */
describe("filing-completion-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let blobStorage: ReturnType<typeof createFakeDocumentStorageDeps>["blobStorage"];
  let deps: FilingCompletionWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    partyRepo = new InMemoryFilingPartyRepository();
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
    await partyRepo.upsertFields(undefined, filingId, "COMPLAINANT", { fullName: "Anitha Joseph", address: "Kollam 691008" });

    const filedAt = new Date();
    const diaryNumber = await filingRepo.nextDiaryNumber(undefined, filedAt);
    await filingRepo.recordFiled(undefined, filingId, { diaryNumber, filedAt });

    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_FILED");

    deps = {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      filingCompletionSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, payFeeActionsContentSid: FILED_ACTIONS_CONTENT_SID },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      blobStorage: (blobStorage = createFakeDocumentStorageDeps().blobStorage),
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function actionInput(overrides: Partial<Parameters<typeof handleFilingFiledInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  function doneInput(overrides: Partial<Parameters<typeof handleFilingDoneInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, ...overrides };
  }

  describe("FILING_FILED", () => {
    it("unrecognized input redisplays the filed summary + pay-fee actions with the actually-persisted diary number/court, not hardcoded", async () => {
      const filing = filingRepo.findById(filingId)!;
      const result = await handleFilingFiledInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(filing.diaryNumber!) }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ON Court - I, Kollam") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: FILED_ACTIONS_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_FILED" });
    });

    it("filing:pay-fee records the simulated payment and cascades straight to FILING_DONE, sending both messages", async () => {
      const result = await handleFilingFiledInput(deps, actionInput({ selection: { buttonPayload: "filing:pay-fee" } }));

      expect(result.delivered).toBe(true);
      const filing = filingRepo.findById(filingId);
      expect(filing).toMatchObject({ currentStep: "FILING_DONE" });
      expect(filing?.courtFeePaidAt).toBeInstanceOf(Date);
      expect(filing?.courtFeeTransactionId).toMatch(/^SIM-/);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DONE" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(filing!.courtFeeTransactionId!) }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("filing is complete") }));
    });

    it("also generates and sends the fee-receipt PDF, hosted briefly at a public URL then deleted", async () => {
      await handleFilingFiledInput(deps, actionInput({ selection: { buttonPayload: "filing:pay-fee" } }));

      const filing = filingRepo.findById(filingId);
      expect(blobStorage.storePublic).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: "application/pdf", pathname: expect.stringContaining(`Receipt_${filing!.diaryNumber!.replace(/-/g, "_")}.pdf`) }),
      );
      expect(messagingClient.sendMediaMessage).toHaveBeenCalledWith(
        expect.objectContaining({ from: FROM_NUMBER, to: WHATSAPP_NUMBER, mediaUrl: "https://blob.example.test/fake-public-file" }),
      );
      expect(blobStorage.delete).toHaveBeenCalledWith(["https://blob.example.test/fake-public-file"]);
    });

    it("a receipt-PDF failure never affects the payment's own result — the fee-paid/done messages already succeeded", async () => {
      blobStorage.storePublic.mockRejectedValueOnce(new Error("blob store unreachable"));

      const result = await handleFilingFiledInput(deps, actionInput({ selection: { buttonPayload: "filing:pay-fee" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendMediaMessage).not.toHaveBeenCalled();
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("filing is complete") }));
    });

    it("the simulated transaction ID is never presented as a real payment gateway reference (SIM- prefix, no real gateway ever called)", async () => {
      await handleFilingFiledInput(deps, actionInput({ selection: { buttonPayload: "filing:pay-fee" } }));

      const filing = filingRepo.findById(filingId);
      expect(filing?.courtFeeTransactionId).toMatch(/^SIM-[0-9A-F-]+$/);
    });

    it("a stale conversation (no longer FILING_FILED) is a safe no-op for filing:pay-fee", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

      const result = await handleFilingFiledInput(deps, actionInput({ selection: { buttonPayload: "filing:pay-fee" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });

    it("nav:main-menu leaves the fee unpaid and returns to MAIN_MENU (mirrors filing-workflow.ts's own nav:main-menu branches)", async () => {
      const result = await handleFilingFiledInput(deps, actionInput({ selection: { buttonPayload: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      const filing = filingRepo.findById(filingId);
      expect(filing?.courtFeePaidAt).toBeNull();
    });
  });

  describe("FILING_DONE", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DONE", new Date());
    });

    it("any input at all moves straight to MAIN_MENU", async () => {
      const result = await handleFilingDoneInput(deps, doneInput());

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }));
    });

    it("a stale conversation (no longer FILING_DONE) is a safe no-op", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

      const result = await handleFilingDoneInput(deps, doneInput());

      expect(result.delivered).toBe(true);
    });
  });

  describe("bilingual coverage", () => {
    it("sends the Malayalam filed summary/actions and fee-paid/done messages", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_FILED", new Date());

      const result = await handleFilingFiledInput(deps, actionInput({ language: "ml", selection: { buttonPayload: "filing:pay-fee" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("കോടതി ഫീസ്") }));
    });
  });
});
