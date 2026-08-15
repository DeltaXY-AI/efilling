import { beforeEach, describe, expect, it } from "vitest";
import { handleFilingDocSupportInput, type FilingDocumentWorkflowDeps } from "../src/services/filing-document-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { createFakeDocumentStorageDeps, type FakeDocumentStorageDeps } from "./helpers/fake-document-storage";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const COMPLAINANT_REVIEW_CONTENT_SID = { en: "HXcreviewEn00000000000000000000000", ml: "HXcreviewMl00000000000000000000000" };
const COMPLAINANT_EDIT_FIELDS_CONTENT_SID = { en: "HXceditEn000000000000000000000000", ml: "HXceditMl000000000000000000000000" };

/**
 * Covers #32 (Prototype parity — Phase 4, Option A — no OCR): the handoff
 * out of FILING_DOC_SUPPORT (the last of #31's 5 document groups) into
 * COMPLAINANT_NAME_PENDING (Phase 5's current entry state). The rest of
 * #31's per-group upload/validation behaviour already has coverage in
 * filing-document.test.ts (domain layer) — this file is scoped to #32's
 * concern: the acknowledgement content and the no-dead-state cascade.
 */
describe("filing-document-workflow — #32 documents-received handoff", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let filingDocumentRepo: InMemoryFilingDocumentRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let documentStorageDeps: FakeDocumentStorageDeps;
  let deps: FilingDocumentWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    filingDocumentRepo = new InMemoryFilingDocumentRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient();
    documentStorageDeps = createFakeDocumentStorageDeps();

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

    // Place the conversation directly at the last document group
    // (FILING_DOC_SUPPORT), as if the prior 4 groups (#31) are already done
    // — this file only needs to exercise the #32 handoff out of it.
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_DOC_SUPPORT");
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DOC_SUPPORT");

    deps = {
      conversationRepo,
      filingRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      documentStorageDeps,
      complainantSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
        editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
      },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function inputEvent(overrides: Partial<Parameters<typeof handleFilingDocSupportInput>[1]> = {}) {
    return {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM1",
      language: "en" as const,
      text: "done",
      media: [],
      ...overrides,
    };
  }

  it("sends an honest 'received' acknowledgement (no reading/extraction promise) and cascades straight into COMPLAINANT_NAME_PENDING", async () => {
    const result = await handleFilingDocSupportInput(deps, inputEvent());

    expect(result.delivered).toBe(true);

    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Got all your documents") }),
    );
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("case details next") }),
    );

    // Part B: never fabricates an "extracted" screen or a reading/OCR promise.
    const sentBodies = messagingClient.sendText.mock.calls.map((call) => call[0].body).join("\n");
    expect(sentBodies).not.toMatch(/reading them now|extracted|I'm reading/i);

    // No dead intermediate state — same transaction lands directly on
    // Phase 5's current entry state (COMPLAINANT_NAME_PENDING).
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "COMPLAINANT_NAME_PENDING" });

    const filing = filingRepo.findById(filingId);
    expect(filing?.currentStep).toBe("COMPLAINANT_NAME_PENDING");
  });

  it("sends the Malayalam acknowledgement for a Malayalam advocate", async () => {
    // setLanguageAndMainMenu also resets state to MAIN_MENU — restore
    // FILING_DOC_SUPPORT afterward so this test still exercises the same
    // handoff, just in Malayalam.
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DOC_SUPPORT");

    await handleFilingDocSupportInput(deps, inputEvent({ language: "ml", text: "കഴിഞ്ഞു" }));

    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("എല്ലാ രേഖകളും ലഭിച്ചു") }),
    );
  });

  it("is a safe no-op when the conversation is no longer FILING_DOC_SUPPORT by the time this is processed (stale)", async () => {
    await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_NAME_PENDING", new Date());

    const result = await handleFilingDocSupportInput(deps, inputEvent());

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Got all your documents") }),
    );
  });
});
