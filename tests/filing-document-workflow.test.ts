import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFilingDocChequeInput,
  handleFilingDocSupportInput,
  handleFilingWrittenAccountInput,
  type FilingDocumentWorkflowDeps,
} from "../src/services/filing-document-workflow";
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
        rolePromptContentSid: COMPLAINANT_ROLE_CONTENT_SID,
      },
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS },
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

  it("sends an honest 'received' acknowledgement (no reading/extraction promise) and cascades straight into COMPLAINANT_ROLE_PENDING (#33 Part A)", async () => {
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

    // #33 Part A: the "Filing as" role prompt, a real Content Template.
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: COMPLAINANT_ROLE_CONTENT_SID.en }),
    );

    // No dead intermediate state — same transaction lands directly on
    // Phase 5's current entry state (COMPLAINANT_ROLE_PENDING).
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "COMPLAINANT_ROLE_PENDING" });

    const filing = filingRepo.findById(filingId);
    expect(filing?.currentStep).toBe("COMPLAINANT_ROLE_PENDING");
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

/**
 * Covers #33 Part E: the optional written-account upload (0-2 files),
 * reached from Part D's witness field, not the 5-group cascade above —
 * reuses the exact same media/docs:continue machinery as #31's groups.
 */
describe("filing-document-workflow — #33 Part E written-account upload", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let filingDocumentRepo: InMemoryFilingDocumentRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: FilingDocumentWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
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
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_WRITTEN_ACCOUNT_PENDING");
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_WRITTEN_ACCOUNT_PENDING");

    deps = {
      conversationRepo,
      filingRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      documentStorageDeps: createFakeDocumentStorageDeps(),
      complainantSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
        editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
        rolePromptContentSid: COMPLAINANT_ROLE_CONTENT_SID,
      },
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  it("is genuinely optional — 'done' with zero files cascades straight into FILING_COURT_PENDING", async () => {
    const result = await handleFilingWrittenAccountInput(deps, {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM1",
      language: "en",
      text: "done",
      media: [],
    });

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS.courtContentSid.en }),
    );
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_COURT_PENDING" });
    expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_COURT_PENDING" });
  });

  it("accepts an uploaded file, then 'done' cascades into FILING_COURT_PENDING", async () => {
    await handleFilingWrittenAccountInput(deps, {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM1",
      language: "en",
      text: "",
      media: [{ url: "https://api.twilio.com/media/written-account.jpg", contentType: "image/jpeg", index: 0 }],
    });
    const count = await filingDocumentRepo.countByGroup(undefined, filingId, "narrative");
    expect(count).toBe(1);

    const result = await handleFilingWrittenAccountInput(deps, {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM2",
      language: "en",
      text: "done",
      media: [],
    });

    expect(result.delivered).toBe(true);
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_COURT_PENDING" });
  });

  it("is a safe no-op when the conversation is no longer FILING_WRITTEN_ACCOUNT_PENDING (stale)", async () => {
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_COURT_PENDING", new Date());

    const result = await handleFilingWrittenAccountInput(deps, {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM1",
      language: "en",
      text: "done",
      media: [],
    });

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
  });
});

/**
 * The "sample"/"demo files" typed-only testing shortcut (docs:use-sample-files)
 * — there is no real WhatsApp equivalent of a native "Add sample files"
 * picker button, so this only ever matches typed text. Never touches
 * Twilio's media API or Blob storage.
 */
describe("filing-document-workflow — 'sample' testing shortcut", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let filingDocumentRepo: InMemoryFilingDocumentRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: FilingDocumentWorkflowDeps;
  let conversationId: string;
  let filingId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
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
    await filingRepo.setCurrentStep(undefined, filingId, "FILING_DOC_CHEQUE");
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filingId, "FILING_DOC_CHEQUE");

    deps = {
      conversationRepo,
      filingRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: FROM_NUMBER,
      documentStorageDeps: createFakeDocumentStorageDeps(),
      complainantSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
        editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
        rolePromptContentSid: COMPLAINANT_ROLE_CONTENT_SID,
      },
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function inputEvent(overrides: Partial<Parameters<typeof handleFilingDocChequeInput>[1]> = {}) {
    return {
      conversationId,
      whatsappNumber: WHATSAPP_NUMBER,
      messageId: "SM1",
      language: "en" as const,
      text: "sample",
      media: [],
      ...overrides,
    };
  }

  it("typing 'sample' adds the group's fixed demo files and clearly marks them as not real", async () => {
    const result = await handleFilingDocChequeInput(deps, inputEvent());

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("sample files for testing") }),
    );
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("not real documents") }),
    );

    const count = await filingDocumentRepo.countByGroup(undefined, filingId, "cheque");
    expect(count).toBe(2); // cheque's SAMPLE_DOCUMENTS has 2 entries, matching its own max
  });

  it("replying 'done' right after 'sample' advances the workflow, exactly like a real upload would", async () => {
    await handleFilingDocChequeInput(deps, inputEvent());
    const result = await handleFilingDocChequeInput(deps, inputEvent({ text: "done" }));

    expect(result.delivered).toBe(true);
    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    expect(conversation).toMatchObject({ state: "FILING_DOC_MEMO" });
  });

  it("never exceeds the group's max, even if 'sample' is somehow sent twice", async () => {
    await handleFilingDocChequeInput(deps, inputEvent());
    const result = await handleFilingDocChequeInput(deps, inputEvent());

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("maximum") }),
    );
    const count = await filingDocumentRepo.countByGroup(undefined, filingId, "cheque");
    expect(count).toBe(2);
  });

  it("is a safe no-op when the conversation is no longer FILING_DOC_CHEQUE (stale)", async () => {
    await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_NAME_PENDING", new Date());

    const result = await handleFilingDocChequeInput(deps, inputEvent());

    expect(result.delivered).toBe(true);
    expect(messagingClient.sendText).not.toHaveBeenCalled();
    const count = await filingDocumentRepo.countByGroup(undefined, filingId, "cheque");
    expect(count).toBe(0);
  });
});
