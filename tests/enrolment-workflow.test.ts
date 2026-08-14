import { beforeEach, describe, expect, it } from "vitest";
import {
  handleEnrolmentConfirmInput,
  handleEnrolmentInput,
  type EnrolmentWorkflowDeps,
} from "../src/services/enrolment-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const ENROLMENT_PROMPT_CONTENT_SID = { en: "HXenrolpromptEn00000000000000000000", ml: "HXenrolpromptMl00000000000000000000" };
const ENROLMENT_CONFIRM_CONTENT_SID = { en: "HXenrolconfirmEn0000000000000000000", ml: "HXenrolconfirmMl0000000000000000000" };
const COMPLAINANT_REVIEW_CONTENT_SID = { en: "HXcreviewEn00000000000000000000000", ml: "HXcreviewMl00000000000000000000000" };
const COMPLAINANT_EDIT_FIELDS_CONTENT_SID = { en: "HXceditEn000000000000000000000000", ml: "HXceditMl000000000000000000000000" };

describe("enrolment-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: EnrolmentWorkflowDeps;
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
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "ADVOCATE_ENROLMENT_PENDING");

    deps = {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      enrolmentSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        promptContentSid: ENROLMENT_PROMPT_CONTENT_SID,
        confirmContentSid: ENROLMENT_CONFIRM_CONTENT_SID,
      },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      complainantSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
        editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
      },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function inputEvent(overrides: Partial<Parameters<typeof handleEnrolmentInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, text: "", mediaCount: 0, ...overrides };
  }

  function actionInput(overrides: Partial<Parameters<typeof handleEnrolmentConfirmInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, selection: {}, ...overrides };
  }

  describe("handleEnrolmentInput (Part F)", () => {
    it("a valid number saves the candidate, advances to ADVOCATE_ENROLMENT_CONFIRM, and sends the confirmation with the normalized value", async () => {
      const result = await handleEnrolmentInput(deps, inputEvent({ text: "ker / 1234 / 2010" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
        from: FROM_NUMBER,
        to: WHATSAPP_NUMBER,
        contentSid: ENROLMENT_CONFIRM_CONTENT_SID.en,
        contentVariables: { "1": "KER/1234/2010" },
      });

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_CONFIRM" });

      const filing = filingRepo.findById(filingId);
      expect(filing).toMatchObject({
        advocateEnrolmentOriginal: "ker / 1234 / 2010",
        advocateEnrolmentNormalized: "KER/1234/2010",
        advocateEnrolmentStatus: "PENDING_CONFIRMATION",
        currentStep: "ADVOCATE_ENROLMENT_CONFIRM",
      });

      const outbound = outboundMessageRepo.findByDedupeKey("SM1:enrolment-confirm");
      expect(outbound).toMatchObject({ status: "sent", messageType: "ADVOCATE_ENROLMENT_CONFIRM" });
    });

    it("invalid input keeps ADVOCATE_ENROLMENT_PENDING and sends the localized validation error, never touching the filing", async () => {
      const result = await handleEnrolmentInput(deps, inputEvent({ text: "??" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("does not appear to be in a supported format") }),
      );
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({ advocateEnrolmentNormalized: null, currentStep: "ADVOCATE_ENROLMENT_PENDING" });
    });

    it("media-only input (no text) is rejected the same as any other invalid input", async () => {
      const result = await handleEnrolmentInput(deps, inputEvent({ text: "", mediaCount: 1 }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("does not appear to be in a supported format") }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
    });

    it("sends the Malayalam validation error for a Malayalam advocate", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());

      await handleEnrolmentInput(deps, inputEvent({ language: "ml", text: "??" }));

      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("പിന്തുണയുള്ള ഫോർമാറ്റിൽ") }),
      );
    });

    it("is a safe no-op when the conversation is no longer ADVOCATE_ENROLMENT_PENDING by the time the lock is granted (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ADVOCATE_ENROLMENT_CONFIRM", new Date());

      const result = await handleEnrolmentInput(deps, inputEvent({ text: "KER/1234/2010" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    });

    it("falls back to plain text with the numbered options when the confirmation Content Template send fails", async () => {
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleEnrolmentInput(deps, inputEvent({ text: "KER/1234/2010" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("KER/1234/2010") }),
      );
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("1. Confirm") }));
    });

    it("does not send a misleading success message when the transaction itself fails, and enters no candidate", async () => {
      const brokenDeps: EnrolmentWorkflowDeps = {
        ...deps,
        withTransaction: async () => {
          throw new Error("connection refused");
        },
      };

      await expect(handleEnrolmentInput(brokenDeps, inputEvent({ text: "KER/1234/2010" }))).rejects.toThrow("connection refused");
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
      expect(filingRepo.findById(filingId)).toMatchObject({ advocateEnrolmentNormalized: null });
    });

    it("never logs the original or normalized enrolment value", async () => {
      const originalLog = console.log;
      const originalError = console.error;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => lines.push(args.join(" "));
      console.error = (...args: unknown[]) => lines.push(args.join(" "));

      try {
        messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));
        await handleEnrolmentInput(deps, inputEvent({ text: "ker / 1234 / 2010" }));
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      const logged = lines.join("\n");
      expect(logged).not.toContain("1234");
      expect(logged).not.toContain("KER");
    });
  });

  describe("handleEnrolmentConfirmInput (Parts G/H/I)", () => {
    beforeEach(async () => {
      await filingRepo.saveEnrolmentCandidate(undefined, filingId, { original: "ker / 1234 / 2010", normalized: "KER/1234/2010" });
      await conversationRepo.setState(WHATSAPP_NUMBER, "ADVOCATE_ENROLMENT_CONFIRM", new Date());
    });

    it("enrolment:confirm records RECORDED_UNVERIFIED with a confirmation timestamp and cascades straight into FILING_DOC_CHEQUE (#31)", async () => {
      const result = await handleEnrolmentConfirmInput(deps, actionInput({ selection: { buttonPayload: "enrolment:confirm" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Advocate enrolment number recorded") }),
      );
      // #31: the same Confirm tap also sends the first document-upload
      // group's prompt — replaces #10 Part A's original complainant name
      // prompt, which is now reached only after all 5 groups are done.
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("The cheque") }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_DOC_CHEQUE" });

      const filing = filingRepo.findById(filingId);
      expect(filing?.advocateEnrolmentStatus).toBe("RECORDED_UNVERIFIED");
      expect(filing?.advocateEnrolmentConfirmedAt).toBeInstanceOf(Date);
      expect(filing?.currentStep).toBe("FILING_DOC_CHEQUE");
      // Never "VERIFIED" — no Bar Council integration exists.
      expect(filing?.advocateEnrolmentStatus).not.toBe("VERIFIED");
    });

    it("confirming twice does not update the timestamp or send a second completion message", async () => {
      await handleEnrolmentConfirmInput(deps, actionInput({ selection: { buttonPayload: "enrolment:confirm" } }));
      const confirmedAt = filingRepo.findById(filingId)?.advocateEnrolmentConfirmedAt;
      messagingClient.sendText.mockClear();

      const retry = await handleEnrolmentConfirmInput(
        deps,
        actionInput({ messageId: "SM-retry", selection: { buttonPayload: "enrolment:confirm" } }),
      );

      expect(retry.delivered).toBe(true); // stale no-op, not a fresh success
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      expect(filingRepo.findById(filingId)?.advocateEnrolmentConfirmedAt).toEqual(confirmedAt);
    });

    it("two concurrent Confirm/Edit calls: only the first valid transition applies", async () => {
      const [a, b] = await Promise.all([
        handleEnrolmentConfirmInput(deps, actionInput({ messageId: "SM-a", selection: { buttonPayload: "enrolment:confirm" } })),
        handleEnrolmentConfirmInput(deps, actionInput({ messageId: "SM-b", selection: { buttonPayload: "enrolment:edit" } })),
      ]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      // Exactly one of the two transitions won — never both.
      expect(["FILING_DOC_CHEQUE", "ADVOCATE_ENROLMENT_PENDING"]).toContain(conversation?.state);
    });

    it("enrolment:edit clears the candidate and returns to ADVOCATE_ENROLMENT_PENDING with the prompt resent", async () => {
      const result = await handleEnrolmentConfirmInput(deps, actionInput({ selection: { buttonPayload: "enrolment:edit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: ENROLMENT_PROMPT_CONTENT_SID.en }),
      );

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({
        advocateEnrolmentOriginal: null,
        advocateEnrolmentNormalized: null,
        advocateEnrolmentStatus: null,
        currentStep: "ADVOCATE_ENROLMENT_PENDING",
      });
    });

    it("filing:save-exit preserves the candidate and current_step, keeps active_filing_id, and returns to MAIN_MENU", async () => {
      const result = await handleEnrolmentConfirmInput(deps, actionInput({ selection: { buttonPayload: "filing:save-exit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("has been saved") }),
      );
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }),
      );

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU", activeFilingId: filingId });
      expect(filingRepo.findById(filingId)).toMatchObject({
        advocateEnrolmentNormalized: "KER/1234/2010",
        currentStep: "ADVOCATE_ENROLMENT_CONFIRM",
      });
    });

    it("unrecognized input redisplays the confirmation with the current candidate, without changing state", async () => {
      const result = await handleEnrolmentConfirmInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: ENROLMENT_CONFIRM_CONTENT_SID.en, contentVariables: { "1": "KER/1234/2010" } }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ADVOCATE_ENROLMENT_CONFIRM" });
    });
  });
});
