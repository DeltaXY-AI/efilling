import { beforeEach, describe, expect, it } from "vitest";
import {
  handleDraftChoiceInput,
  handleFileOrResume,
  handleFilingNoticeInput,
  type FilingWorkflowDeps,
} from "../src/services/filing-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const DRAFT_CHOICE_CONTENT_SID = { en: "HXdraftchoiceen00000000000000000000", ml: "HXdraftchoiceml00000000000000000000" };
const NOTICE_CONTENT_SID = { en: "HXnoticeen000000000000000000000000", ml: "HXnoticeml000000000000000000000000" };
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

describe("filing-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: FilingWorkflowDeps;
  let conversationId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    filingRepo = new InMemoryFilingRepository(conversationRepo);
    partyRepo = new InMemoryFilingPartyRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient();

    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());

    deps = {
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
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
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
      filingDetailsSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS },
      filingDocumentRepo: new InMemoryFilingDocumentRepository(),
      filingSignSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, ...FILING_SIGN_SENDER_DEPS_CONTENT_SIDS },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function fileOrResumeInput(overrides: Partial<Parameters<typeof handleFileOrResume>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, ...overrides };
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

    it("falls back to the numbered plain-text document checklist when the Content Template send fails (no active draft) (#30)", async () => {
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleFileOrResume(deps, fileOrResumeInput());

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Cheque — front and back") }),
      );
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("1. Start filing") }));
    });

    it("falls back to the Malayalam plain-text document checklist when the Content Template send fails (#30)", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleFileOrResume(deps, fileOrResumeInput({ language: "ml" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("മുൻവശവും പിൻവശവും") }),
      );
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("1. ഫയലിംഗ് ആരംഭിക്കുക") }),
      );
    });

    it("falls back to the numbered plain-text draft-choice menu when the Content Template send fails (active draft)", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "MAIN_MENU");
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleFileOrResume(deps, fileOrResumeInput());

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("1. Resume draft") }),
      );
    });

    it("does not send a misleading success message when the transaction itself fails (e.g. DB unreachable)", async () => {
      const brokenDeps: FilingWorkflowDeps = {
        ...deps,
        withTransaction: async () => {
          throw new Error("connection refused");
        },
      };

      await expect(handleFileOrResume(brokenDeps, fileOrResumeInput())).rejects.toThrow("connection refused");

      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      // The route layer (src/routes/twilio-webhook.route.ts) is what catches
      // this, acks 200 anyway, and marks the webhook event failed — it never
      // reaches here as a false "success".
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
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

    it("#9 Part I: resuming a draft at ADVOCATE_ENROLMENT_CONFIRM restores that step and resends the confirmation with the saved candidate", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await filingRepo.saveEnrolmentCandidate(undefined, filing.id, { original: "KER/1234/2010", normalized: "KER/1234/2010" });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        contentSid: ENROLMENT_CONFIRM_CONTENT_SID.en,
        contentVariables: { "1": "KER/1234/2010" },
      });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_CONFIRM" });
    });

    it("#10 Part A/B: resuming a legacy draft still at COMPLAINANT_DETAILS_START self-corrects both current_step and conversation state to COMPLAINANT_NAME_PENDING", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      // Simulate a filing left over from #9 before this cascade existed.
      await filingRepo.setCurrentStep(undefined, filing.id, "COMPLAINANT_DETAILS_START");
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("full name") }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_NAME_PENDING" });
      // The filing's current_step is corrected together with the
      // conversation state, in the same transaction — never left stale.
      expect(filingRepo.findById(filing.id)).toMatchObject({ currentStep: "COMPLAINANT_NAME_PENDING" });
    });

    it("#10 Part K: resuming a draft at a complainant field-pending step resends that field's own prompt", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await filingRepo.setCurrentStep(undefined, filing.id, "COMPLAINANT_PHONE_PENDING");
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("phone number") }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
    });

    it("#10 Part K: resuming a draft at COMPLAINANT_CONFIRM restores the review screen and resends the persisted summary", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await filingRepo.setCurrentStep(undefined, filing.id, "COMPLAINANT_CONFIRM");
      await partyRepo.upsertFields(undefined, filing.id, "COMPLAINANT", {
        fullName: "Anitha Joseph",
        phoneOriginal: "9876543210",
        phoneNormalized: "+919876543210",
        emailNormalized: null,
        address: "Thekkumkattil House\nKollam 691008",
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Anitha Joseph") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: COMPLAINANT_REVIEW_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_CONFIRM" });
    });

    it("#11 Part A/B: resuming a legacy draft still at ACCUSED_DETAILS_START self-corrects both current_step and conversation state to ACCUSED_NAME_PENDING", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await filingRepo.setCurrentStep(undefined, filing.id, "ACCUSED_DETAILS_START");
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("legal name") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_NAME_PENDING" });
      expect(filingRepo.findById(filing.id)).toMatchObject({ currentStep: "ACCUSED_NAME_PENDING" });
    });

    it("#11 Part J: resuming a draft at an accused field-pending step resends that field's own prompt", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await filingRepo.setCurrentStep(undefined, filing.id, "ACCUSED_PHONE_PENDING");
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("phone number") }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_PHONE_PENDING" });
    });

    it("#11 Part J: resuming a draft at ACCUSED_CONFIRM restores the review screen and resends the persisted summary", async () => {
      const filing = await filingRepo.createDraft(undefined, {
        conversationId,
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
      });
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "FILING_DRAFT_CHOICE");

      const result = await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:resume-draft" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: ACCUSED_REVIEW_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_CONFIRM" });
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

      const outbound = outboundMessageRepo.findByDedupeKey("SM2:draft-created");
      expect(outbound).toMatchObject({ status: "sent", messageType: "FILING_DRAFT_CREATED", conversationId });
    });

    it("#9 acceptance criterion: entering ADVOCATE_ENROLMENT_PENDING sends the enrolment prompt, durably tracked in its own outbound record", async () => {
      const result = await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        contentSid: ENROLMENT_PROMPT_CONTENT_SID.en,
      });

      const outbound = outboundMessageRepo.findByDedupeKey("SM2:enrolment-prompt");
      expect(outbound).toMatchObject({ status: "sent", messageType: "ADVOCATE_ENROLMENT_PROMPT", conversationId });
    });

    it("commits the draft and enqueues a durable outbound record even when the completion send fails, and a later retry cannot duplicate it", async () => {
      messagingClient.sendText.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } }));

      // The domain write committed regardless of the send outcome — this
      // is the whole point: a crash or Twilio failure here must never
      // silently lose the fact that a draft was created.
      expect(result.delivered).toBe(false);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
      const filingId = conversation?.activeFilingId;
      expect(filingId).toBeTruthy();

      // The outbound record is durable, queryable evidence of what was
      // owed for this MessageSid — enqueued as "pending" inside the same
      // transaction as the draft, then explicitly marked "failed" after
      // the send failed. It is never left stuck at "pending" forever, and
      // an ops/reconciliation job could find it by dedupe key even if the
      // process crashed immediately after this call returned.
      const outbound = outboundMessageRepo.findByDedupeKey("SM2:draft-created");
      expect(outbound).toMatchObject({ status: "failed", errorCode: "send_failed", messageType: "FILING_DRAFT_CREATED" });

      // A later retry/reconciliation attempt for the same advocate must not
      // duplicate the draft: the conversation is no longer FILING_NOTICE,
      // so this is treated as stale and no second filing is created.
      const retry = await handleFilingNoticeInput(
        deps,
        actionInput({ messageId: "SM-retry", selection: { buttonPayload: "filing:accept-test-notice" } }),
      );
      expect(retry.delivered).toBe(true); // stale no-op, not a fresh success

      const draftAfterRetry = await filingRepo.findActiveDraft(undefined, conversationId);
      expect(draftAfterRetry?.id).toBe(filingId); // same filing — no duplicate was created
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
      // #9: entering ADVOCATE_ENROLMENT_PENDING also sends the Malayalam prompt template.
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: ENROLMENT_PROMPT_CONTENT_SID.ml }),
      );
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
      const firstFilingBefore = filingRepo.findById(firstFilingId!);
      expect(firstFilingBefore).toMatchObject({ status: "DRAFT", currentStep: "ADVOCATE_ENROLMENT_PENDING" });

      // Advocate re-enters the menu, sees the draft choice, and starts a new filing.
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DRAFT_CHOICE", new Date());
      await handleDraftChoiceInput(deps, actionInput({ selection: { buttonPayload: "filing:start-new" } }));
      await handleFilingNoticeInput(deps, actionInput({ selection: { buttonPayload: "filing:accept-test-notice" } }));

      const secondConversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(secondConversation?.activeFilingId).toBeTruthy();
      expect(secondConversation?.activeFilingId).not.toBe(firstFilingId);
      expect(secondConversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });

      // The first filing row itself — fetched directly by id, not via
      // findActiveDraft (which would now resolve the new one) — must still
      // exist, completely unchanged: same status, step, and timestamps.
      const firstFilingAfter = filingRepo.findById(firstFilingId!);
      expect(firstFilingAfter).toEqual(firstFilingBefore);

      // And the new active filing is a genuinely different row.
      const secondFiling = await filingRepo.findActiveDraft(undefined, conversationId);
      expect(secondFiling?.id).toBe(secondConversation?.activeFilingId);
      expect(secondFiling?.id).not.toBe(firstFilingId);
    });
  });
});
