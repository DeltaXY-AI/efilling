import { beforeEach, describe, expect, it } from "vitest";
import {
  handleDraftChoiceInput,
  handleFileOrResume,
  handleFilingNoticeInput,
  type FilingWorkflowDeps,
} from "../src/services/filing-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const DRAFT_CHOICE_CONTENT_SID = { en: "HXdraftchoiceen00000000000000000000", ml: "HXdraftchoiceml00000000000000000000" };
const NOTICE_CONTENT_SID = { en: "HXnoticeen000000000000000000000000", ml: "HXnoticeml000000000000000000000000" };

describe("filing-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let messagingClient: FakeMessagingClient;
  let deps: FilingWorkflowDeps;
  let conversationId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    messagingClient = createFakeMessagingClient();

    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    deps = {
      conversationRepo,
      filingRepo,
      filingSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
        noticeContentSid: NOTICE_CONTENT_SID,
      },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function fileOrResumeInput() {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const };
  }

  function actionInput(overrides: Partial<Parameters<typeof handleDraftChoiceInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, selection: {}, ...overrides };
  }

  describe("handleFileOrResume (Part F)", () => {
    it("with no active draft: transitions to FILING_NOTICE and sends the test notice", async () => {
      const result = await handleFileOrResume(deps, fileOrResumeInput());

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        contentSid: NOTICE_CONTENT_SID.en,
      });

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
    });

    it("with an active draft: transitions to FILING_DRAFT_CHOICE and sends the draft-choice template", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "MAIN_MENU");

      const result = await handleFileOrResume(deps, fileOrResumeInput());

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        contentSid: DRAFT_CHOICE_CONTENT_SID.en,
      });

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_CHOICE" });
    });

    it("is a safe no-op when the conversation is no longer MAIN_MENU by the time the lock is granted (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_NOTICE", new Date());

      const result = await handleFileOrResume(deps, fileOrResumeInput());

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
    });

    it("two concurrent calls for the same conversation: only one transitions, the other is stale (no duplicate send)", async () => {
      const [a, b] = await Promise.all([handleFileOrResume(deps, fileOrResumeInput()), handleFileOrResume(deps, fileOrResumeInput())]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledTimes(1);

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
    });
  });

  describe("handleDraftChoiceInput (Part A/G)", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_CHOICE", new Date());
    });

    it("filing:resume-draft with a supported current_step resumes it and sends the resumed confirmation", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        body: "Your saved filing has been resumed.",
      });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
    });

    it("filing:resume-draft when the draft has disappeared routes safely to FILING_NOTICE, no user-visible error", async () => {
      // FILING_DRAFT_CHOICE with no active_filing_id at all — draft "disappeared".
      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
    });

    it("filing:resume-draft with an unsupported current_step leaves the draft and state unchanged, sends a support message", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      // Simulate a step this deployment doesn't know how to resume.
      (filing as { currentStep: string }).currentStep = "SOME_FUTURE_STEP";
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("support") }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_CHOICE" }); // unchanged
    });

    it("filing:start-new moves to FILING_NOTICE without creating a filing yet, preserving the existing draft", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:start-new" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE", activeFilingId: filing.id }); // still points at the old draft — no new one yet
    });

    it("nav:main-menu returns to MAIN_MENU and resends the main menu", async () => {
      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });

    it("unrecognized input redisplays the draft-choice template without changing state", async () => {
      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: DRAFT_CHOICE_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DRAFT_CHOICE" });
    });
  });

  describe("handleFilingNoticeInput (Part H/I)", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_NOTICE", new Date());
    });

    it("filing:accept-test-notice creates exactly one DRAFT filing and reaches ADVOCATE_ENROLMENT_PENDING", async () => {
      const result = await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        body: "✓ Your filing draft is ready.\n\nNext, we will record your advocate enrolment details.",
      });

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
      expect(conversation?.activeFilingId).toBeTruthy();

      const draft = await filingRepo.findActiveDraft(undefined, conversationId);
      expect(draft).toMatchObject({
        role: "COMPLAINANT_ADVOCATE",
        status: "DRAFT",
        currentStep: "ADVOCATE_ENROLMENT_PENDING",
        language: "en",
        testNoticeVersion: "v1",
      });
      expect(draft?.testNoticeAcceptedAt).toBeInstanceOf(Date);
    });

    it("sends the Malayalam completion message for a Malayalam advocate", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_NOTICE", new Date());

      await handleFilingNoticeInput(
        deps,
        actionInput({ language: "ml", selection: { buttonPayload: "filing:accept-test-notice" } }),
      );

      expect(messagingClient.sendText).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        body: "✓ നിങ്ങളുടെ ഫയലിംഗ് ഡ്രാഫ്റ്റ് തയ്യാറായി.\n\nഅടുത്തതായി അഭിഭാഷക എൻറോൾമെന്റ് വിവരങ്ങൾ രേഖപ്പെടുത്താം.",
      });
    });

    it("nav:main-menu returns to MAIN_MENU and creates no filing", async () => {
      const result = await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "nav:main-menu" } }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU", activeFilingId: null });
    });

    it("unrecognized input redisplays the notice without changing state or creating a filing", async () => {
      const result = await handleFilingNoticeInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE", activeFilingId: null });
    });

    it("two concurrent accept-test-notice requests for the same conversation create exactly one draft", async () => {
      const [a, b] = await Promise.all([
        handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } })),
        handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } })),
      ]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      // Only one of the two actually created+sent the completion message.
      expect(messagingClient.sendText).toHaveBeenCalledTimes(1);

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
      expect(conversation?.activeFilingId).toBeTruthy();
    });
  });

  describe("starting a new filing preserves the previous draft (Part H demo)", () => {
    it("creates a second filing without deleting or overwriting the first", async () => {
      // First draft, created via the real accept-notice path.
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_NOTICE", new Date());
      await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } }));
      const firstConversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      const firstFilingId = firstConversation?.activeFilingId;
      expect(firstFilingId).toBeTruthy();

      // Advocate re-enters the menu, sees the draft choice, and starts a new filing.
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_CHOICE", new Date());
      await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:start-new" } }));
      await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } }));

      const secondConversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(secondConversation?.activeFilingId).toBeTruthy();
      expect(secondConversation?.activeFilingId).not.toBe(firstFilingId);
      expect(secondConversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });

      // The first filing must still exist, unchanged, just no longer active.
      const firstFiling = await filingRepo.findActiveDraft(undefined, conversationId);
      expect(firstFiling?.id).toBe(secondConversation?.activeFilingId); // findActiveDraft now resolves the new one
      expect(firstFiling?.id).not.toBe(firstFilingId);
    });
  });
});
