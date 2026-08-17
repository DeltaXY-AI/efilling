import { beforeEach, describe, expect, it } from "vitest";
import {
  handleCaseTypePendingInput,
  handleOtherCaseTypesPendingInput,
  type CaseTypeWorkflowDeps,
} from "../src/services/case-type-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const CASE_TYPE_PROMPT_CONTENT_SID = { en: "HXctypeEn0000000000000000000000000", ml: "HXctypeMl0000000000000000000000000" };
const OTHER_CASE_TYPES_CONTENT_SID = { en: "HXotypesEn000000000000000000000000", ml: "HXotypesMl000000000000000000000000" };
const NOTICE_CONTENT_SID = { en: "HXnoticeen000000000000000000000000", ml: "HXnoticeml000000000000000000000000" };

describe("case-type-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: CaseTypeWorkflowDeps;
  let conversationId: string;

  beforeEach(async () => {
    conversationRepo = new InMemoryConversationRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient();

    const conversation = await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    conversationId = conversation.id;
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
    await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_CASE_TYPE_PENDING", new Date());

    deps = {
      conversationRepo,
      outboundMessageRepo,
      caseTypeSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        caseTypePromptContentSid: CASE_TYPE_PROMPT_CONTENT_SID,
        otherCaseTypesContentSid: OTHER_CASE_TYPES_CONTENT_SID,
      },
      filingSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        draftChoiceContentSid: { en: "HXdraftEn000000000000000000000000000", ml: "HXdraftMl000000000000000000000000000" },
        noticeContentSid: NOTICE_CONTENT_SID,
      },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function actionInput(overrides: Partial<Parameters<typeof handleCaseTypePendingInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  describe("handleCaseTypePendingInput", () => {
    it("'Cheque bounce' hands off to FILING_NOTICE", async () => {
      const result = await handleCaseTypePendingInput(deps, actionInput({ selection: { buttonPayload: "filing:case-type-cheque" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
    });

    it("'Other case types' opens the full 5-item list, with an informational intro first", async () => {
      const result = await handleCaseTypePendingInput(deps, actionInput({ selection: { buttonPayload: "filing:case-type-other" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("takes cheque cases") }),
      );
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: OTHER_CASE_TYPES_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_OTHER_CASE_TYPES_PENDING" });
    });

    it("unrecognized input redisplays the same prompt without changing state", async () => {
      const result = await handleCaseTypePendingInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: CASE_TYPE_PROMPT_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_CASE_TYPE_PENDING" });
    });

    it("is a safe no-op when the conversation is no longer FILING_CASE_TYPE_PENDING (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

      const result = await handleCaseTypePendingInput(deps, actionInput({ selection: { buttonPayload: "filing:case-type-cheque" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });
  });

  describe("handleOtherCaseTypesPendingInput", () => {
    beforeEach(async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_OTHER_CASE_TYPES_PENDING", new Date());
    });

    it("re-selecting 'Cheque bounce' here also hands off to FILING_NOTICE", async () => {
      const result = await handleOtherCaseTypesPendingInput(deps, actionInput({ selection: { listId: "filing:case-type-cheque" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: NOTICE_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_NOTICE" });
    });

    it.each(["money", "rent", "consumer", "matrimonial"] as const)(
      "picking the non-cheque type '%s' replies with where it's actually handled, never creates a filing, and returns to FILING_CASE_TYPE_PENDING",
      async (type) => {
        const result = await handleOtherCaseTypesPendingInput(
          deps,
          actionInput({ selection: { listId: `filing:other-type-${type}` } }),
        );

        expect(result.delivered).toBe(true);
        expect(messagingClient.sendText).toHaveBeenCalledWith(
          expect.objectContaining({ body: expect.stringContaining("not through this service") }),
        );
        expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
          expect.objectContaining({ contentSid: CASE_TYPE_PROMPT_CONTENT_SID.en }),
        );
        const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
        expect(conversation).toMatchObject({ state: "FILING_CASE_TYPE_PENDING" });
      },
    );

    it("unrecognized input redisplays the same list without changing state", async () => {
      const result = await handleOtherCaseTypesPendingInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: OTHER_CASE_TYPES_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_OTHER_CASE_TYPES_PENDING" });
    });

    it("is a safe no-op when the conversation is no longer FILING_OTHER_CASE_TYPES_PENDING (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "MAIN_MENU", new Date());

      const result = await handleOtherCaseTypesPendingInput(
        deps,
        actionInput({ selection: { listId: "filing:other-type-money" } }),
      );

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });
  });
});
