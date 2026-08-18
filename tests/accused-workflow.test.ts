import { beforeEach, describe, expect, it } from "vitest";
import {
  handleAccusedAddressInput,
  handleAccusedConfirmInput,
  handleAccusedEditAddressInput,
  handleAccusedEditEntityTypeInput,
  handleAccusedEditFieldSelection,
  handleAccusedEditNameInput,
  handleAccusedEditPhoneInput,
  handleAccusedEntityTypeInput,
  handleAccusedNameInput,
  handleAccusedPhoneInput,
  type AccusedWorkflowDeps,
} from "../src/services/accused-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const REVIEW_CONTENT_SID = { en: "HXareviewEn000000000000000000000000", ml: "HXareviewMl000000000000000000000000" };
const EDIT_FIELDS_CONTENT_SID = { en: "HXaeditFieldsEn0000000000000000000", ml: "HXaeditFieldsMl0000000000000000000" };
const ENTITY_TYPE_CONTENT_SID = { en: "HXaentityEn0000000000000000000000000", ml: "HXaentityMl0000000000000000000000000" };

describe("accused-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: AccusedWorkflowDeps;
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
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "ACCUSED_NAME_PENDING");
    await filingRepo.setCurrentStep(undefined, filing.id, "ACCUSED_NAME_PENDING");

    deps = {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      accusedSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        reviewActionsContentSid: REVIEW_CONTENT_SID,
        editFieldsContentSid: EDIT_FIELDS_CONTENT_SID,
        entityTypeContentSid: ENTITY_TYPE_CONTENT_SID,
      },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function fieldEvent(overrides: Partial<Parameters<typeof handleAccusedNameInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, text: "", mediaCount: 0, ...overrides };
  }

  function actionInput(overrides: Partial<Parameters<typeof handleAccusedConfirmInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, selection: {}, ...overrides };
  }

  async function fillLinearFieldsUpToConfirm(): Promise<void> {
    await handleAccusedNameInput(deps, fieldEvent({ messageId: "SM-name", text: "Rajesh Menon" }));
    await handleAccusedPhoneInput(deps, fieldEvent({ messageId: "SM-phone", text: "Skip" }));
    await handleAccusedAddressInput(deps, fieldEvent({ messageId: "SM-address", text: "32/1147, Menon Villa\nChinnakada, Kollam 691001" }));
    // #33 Part B: address now advances to the new entity-type field, not ACCUSED_CONFIRM directly.
    await handleAccusedEntityTypeInput(deps, actionInput({ messageId: "SM-entity", selection: { buttonPayload: "accused:entity-individual" } }));
  }

  describe("linear field entry (Part G)", () => {
    it("a valid name saves the party as DRAFT, advances to ACCUSED_PHONE_PENDING, and sends the phone prompt", async () => {
      const result = await handleAccusedNameInput(deps, fieldEvent({ text: "Rajesh Menon" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("phone number") }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_PHONE_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_PHONE_PENDING" });

      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({ fullName: "Rajesh Menon", status: "DRAFT" });

      const outbound = outboundMessageRepo.findByDedupeKey("SM1:phone-prompt");
      expect(outbound).toMatchObject({ status: "sent", messageType: "ACCUSED_PHONE_PROMPT" });
    });

    it("invalid name keeps ACCUSED_NAME_PENDING and sends the localized validation error, never touching the party", async () => {
      const result = await handleAccusedNameInput(deps, fieldEvent({ text: "A" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("2–120") }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_NAME_PENDING" });
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED")).toBeNull();
    });

    it("media-only input (no text) is rejected the same as any other invalid input", async () => {
      const result = await handleAccusedNameInput(deps, fieldEvent({ text: "", mediaCount: 1 }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_NAME_PENDING" });
    });

    it("accepts a Malayalam name unchanged", async () => {
      await handleAccusedNameInput(deps, fieldEvent({ text: "രാജേഷ് മേനോൻ" }));
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.fullName).toBe("രാജേഷ് മേനോൻ");
    });

    it("Skip stores both accused phone fields as null and advances to ACCUSED_ADDRESS_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_PHONE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_PHONE_PENDING");

      const result = await handleAccusedPhoneInput(deps, fieldEvent({ text: "Skip" }));

      expect(result.delivered).toBe(true);
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({ phoneOriginal: null, phoneNormalized: null });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_ADDRESS_PENDING" });
    });

    it("a valid phone normalizes to E.164 and advances to ACCUSED_ADDRESS_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_PHONE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_PHONE_PENDING");

      const result = await handleAccusedPhoneInput(deps, fieldEvent({ text: "9876543210" }));

      expect(result.delivered).toBe(true);
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({ phoneOriginal: "9876543210", phoneNormalized: "+919876543210" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_ADDRESS_PENDING" });
    });

    it("invalid phone (not Skip, not valid) keeps ACCUSED_PHONE_PENDING and sends the localized error", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_PHONE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_PHONE_PENDING");

      const result = await handleAccusedPhoneInput(deps, fieldEvent({ text: "12345" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("phone number") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_PHONE_PENDING" });
    });

    it("a valid address preserves line breaks and advances to ACCUSED_ENTITY_TYPE_PENDING (#33 Part B)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_ADDRESS_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_ADDRESS_PENDING");
      await partyRepo.upsertFields(undefined, filingId, "ACCUSED", { fullName: "Rajesh Menon", phoneOriginal: null, phoneNormalized: null });

      const result = await handleAccusedAddressInput(deps, fieldEvent({ text: "32/1147, Menon Villa\r\nChinnakada, Kollam 691001" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: ENTITY_TYPE_CONTENT_SID.en }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_ENTITY_TYPE_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_ENTITY_TYPE_PENDING" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.address).toBe("32/1147, Menon Villa\nChinnakada, Kollam 691001");
    });

    it("selecting an entity type advances to ACCUSED_CONFIRM and sends the persisted summary + review actions (#33 Part B)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_ENTITY_TYPE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_ENTITY_TYPE_PENDING");
      await partyRepo.upsertFields(undefined, filingId, "ACCUSED", {
        fullName: "Rajesh Menon",
        phoneOriginal: null,
        phoneNormalized: null,
        address: "32/1147, Menon Villa\nChinnakada, Kollam 691001",
      });

      const result = await handleAccusedEntityTypeInput(deps, actionInput({ selection: { buttonPayload: "accused:entity-company" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Menon Villa") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_CONFIRM" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_CONFIRM" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.entityType).toBe("COMPANY");
    });

    it("unrecognized entity-type selection redisplays the same prompt, no state change", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_ENTITY_TYPE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_ENTITY_TYPE_PENDING");

      const result = await handleAccusedEntityTypeInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: ENTITY_TYPE_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_ENTITY_TYPE_PENDING" });
    });

    it("is a safe no-op when the conversation is no longer the expected pending state (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_CONFIRM", new Date());

      const result = await handleAccusedNameInput(deps, fieldEvent({ text: "Rajesh Menon" }));

      expect(result.delivered).toBe(true);
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED")).toBeNull();
    });

    it("two concurrent valid submissions for the same field: only the first advances the workflow", async () => {
      const [a, b] = await Promise.all([
        handleAccusedNameInput(deps, fieldEvent({ messageId: "SM-a", text: "Rajesh Menon" })),
        handleAccusedNameInput(deps, fieldEvent({ messageId: "SM-b", text: "Different Name" })),
      ]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_PHONE_PENDING" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(["Rajesh Menon", "Different Name"]).toContain(party?.fullName);
    });

    it("does not send a misleading success message when the transaction itself fails, and saves no candidate", async () => {
      const brokenDeps: AccusedWorkflowDeps = {
        ...deps,
        withTransaction: async () => {
          throw new Error("connection refused");
        },
      };

      await expect(handleAccusedNameInput(brokenDeps, fieldEvent({ text: "Rajesh Menon" }))).rejects.toThrow("connection refused");
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED")).toBeNull();
    });

    it("sends the Malayalam validation error for a Malayalam advocate", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());

      await handleAccusedNameInput(deps, fieldEvent({ language: "ml", text: "A" }));

      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("സാധുവായി") }));
    });

    it("never logs accused name, phone, or address", async () => {
      const originalLog = console.log;
      const originalError = console.error;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => lines.push(args.join(" "));
      console.error = (...args: unknown[]) => lines.push(args.join(" "));

      try {
        await handleAccusedNameInput(deps, fieldEvent({ text: "Rajesh Menon" }));
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      expect(lines.join("\n")).not.toContain("Rajesh");
    });

    it("falls back to plain text with numbered options when the review-actions Content Template send fails", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_ENTITY_TYPE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_ENTITY_TYPE_PENDING");
      await partyRepo.upsertFields(undefined, filingId, "ACCUSED", {
        fullName: "Rajesh Menon",
        phoneOriginal: null,
        phoneNormalized: null,
        address: "32/1147, Menon Villa\nKollam 691001",
      });
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleAccusedEntityTypeInput(deps, actionInput({ selection: { buttonPayload: "accused:entity-individual" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("1. Confirm") }));
    });

    it("commits the field write and enqueues a durable outbound record even when the next prompt send fails — never left stuck pending", async () => {
      messagingClient.sendText.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleAccusedNameInput(deps, fieldEvent({ text: "Rajesh Menon" }));

      expect(result.delivered).toBe(false);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_PHONE_PENDING" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.fullName).toBe("Rajesh Menon");

      const outbound = outboundMessageRepo.findByDedupeKey("SM1:phone-prompt");
      expect(outbound).toMatchObject({ status: "failed", errorCode: "send_failed", messageType: "ACCUSED_PHONE_PROMPT" });

      const retry = await handleAccusedNameInput(deps, fieldEvent({ messageId: "SM-retry", text: "Someone Else" }));
      expect(retry.delivered).toBe(true);
      expect((await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED"))?.fullName).toBe("Rajesh Menon");
    });
  });

  describe("handleAccusedConfirmInput (Parts I/J)", () => {
    beforeEach(async () => {
      await fillLinearFieldsUpToConfirm();
      messagingClient.sendText.mockClear();
      messagingClient.sendContentTemplate.mockClear();
    });

    it("accused:confirm marks the party CONFIRMED and cascades straight into FILING_CHEQUE_NUMBER_PENDING (#33 Part C)", async () => {
      const result = await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:confirm" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Accused party details recorded") }),
      );
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("no message has been sent to the accused") }),
      );
      // #33: the same Confirm tap also sends the first cheque/notice-group prompt.
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("cheque number") }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "FILING_CHEQUE_NUMBER_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "FILING_CHEQUE_NUMBER_PENDING" });

      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.status).toBe("CONFIRMED");
      expect(party?.confirmedAt).toBeInstanceOf(Date);
    });

    // #40 (document auto-extraction).
    it("shows the auto-filled cheque number in the cheque-number prompt when the cheque photo already yielded one", async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { chequeNumber: "004512" });

      await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:confirm" } }));

      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Auto-filled from your documents: 004512") }),
      );
    });

    it("never sends any message directly to the accused phone number — only to the advocate's own WhatsApp number", async () => {
      await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:confirm" } }));

      for (const call of [...messagingClient.sendText.mock.calls, ...messagingClient.sendContentTemplate.mock.calls]) {
        expect((call[0] as { to: string }).to).toBe(WHATSAPP_NUMBER);
      }
    });

    it("confirming twice does not update the timestamp or send a second completion message", async () => {
      await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:confirm" } }));
      const confirmedAt = (await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED"))?.confirmedAt;
      messagingClient.sendText.mockClear();

      const retry = await handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-retry", selection: { buttonPayload: "accused:confirm" } }));

      expect(retry.delivered).toBe(true);
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      expect((await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED"))?.confirmedAt).toEqual(confirmedAt);
    });

    it("two concurrent Confirm/Edit calls: only the first valid transition applies", async () => {
      const [a, b] = await Promise.all([
        handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-a", selection: { buttonPayload: "accused:confirm" } })),
        handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-b", selection: { buttonPayload: "accused:edit" } })),
      ]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(["FILING_CHEQUE_NUMBER_PENDING", "ACCUSED_EDIT_FIELD"]).toContain(conversation?.state);
    });

    it("does not send a misleading success message when the transaction itself fails, and confirms nothing", async () => {
      const brokenDeps: AccusedWorkflowDeps = {
        ...deps,
        withTransaction: async () => {
          throw new Error("connection refused");
        },
      };

      await expect(
        handleAccusedConfirmInput(brokenDeps, actionInput({ selection: { buttonPayload: "accused:confirm" } })),
      ).rejects.toThrow("connection refused");
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.status).toBe("DRAFT");
    });

    it("accused:confirm is a safe no-op when a mandatory field (address) is missing from the party row (#11 Part I)", async () => {
      // Simulate an inconsistent row (e.g. an interrupted/corrupted draft) —
      // the normal linear flow can never reach ACCUSED_CONFIRM without an
      // address, but Confirm must still refuse safely if it somehow did.
      const incompleteFiling = await filingRepo.createDraft(undefined, {
        conversationId,
        language: "en",
        role: "COMPLAINANT_ADVOCATE",
        testNoticeVersion: "v1",
      });
      await filingRepo.setCurrentStep(undefined, incompleteFiling.id, "ACCUSED_CONFIRM");
      await partyRepo.upsertFields(undefined, incompleteFiling.id, "ACCUSED", { fullName: "Rajesh Menon" }); // no address
      await conversationRepo.setActiveFilingAndState(undefined, conversationId, incompleteFiling.id, "ACCUSED_CONFIRM");
      messagingClient.sendText.mockClear();

      const result = await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:confirm" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).not.toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Accused party details recorded") }),
      );
      const party = await partyRepo.findByFilingAndRole(undefined, incompleteFiling.id, "ACCUSED");
      expect(party?.status).toBe("DRAFT"); // never confirmed
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_CONFIRM" }); // never advanced
    });

    it("accused:edit opens the edit-field list-picker without changing any party data", async () => {
      const result = await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:edit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: EDIT_FIELDS_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_EDIT_FIELD" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({ fullName: "Rajesh Menon", status: "DRAFT" });
    });

    it("filing:save-exit preserves party DRAFT status and filing.current_step, keeps active_filing_id, and returns to MAIN_MENU", async () => {
      const result = await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "filing:save-exit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("has been saved") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU", activeFilingId: filingId });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_CONFIRM" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party?.status).toBe("DRAFT");
    });

    it("unrecognized input redisplays the persisted summary and review actions, without changing state", async () => {
      const result = await handleAccusedConfirmInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_CONFIRM" });
    });
  });

  describe("edit flow (Part H)", () => {
    beforeEach(async () => {
      await fillLinearFieldsUpToConfirm();
      messagingClient.sendText.mockClear();
      messagingClient.sendContentTemplate.mockClear();
    });

    it("selecting a field from the edit-field picker transitions to its edit-pending state and sends that field's prompt", async () => {
      await handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "accused:edit" } }));

      const result = await handleAccusedEditFieldSelection(
        deps,
        actionInput({ messageId: "SM-select-phone", selection: { listId: "accused:edit-phone" } }),
      );

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("phone number") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_EDIT_PHONE_PENDING" });
    });

    it("unrecognized input at ACCUSED_EDIT_FIELD redisplays the same list-picker", async () => {
      await handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "accused:edit" } }));
      messagingClient.sendContentTemplate.mockClear();

      const result = await handleAccusedEditFieldSelection(deps, actionInput({ messageId: "SM-bad", selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: EDIT_FIELDS_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_EDIT_FIELD" });
    });

    it("falls back to plain text with numbered options when the edit-fields Content Template send fails (#11 Part K)", async () => {
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleAccusedConfirmInput(deps, actionInput({ selection: { buttonPayload: "accused:edit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("1. Full/legal name") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_EDIT_FIELD" });
    });

    it("editing the name only changes fullName, returns to ACCUSED_CONFIRM, and resends the full updated summary", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_EDIT_NAME_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_EDIT_NAME_PENDING");

      const result = await handleAccusedEditNameInput(deps, fieldEvent({ messageId: "SM-edit-name", text: "Rajesh K Menon" }));

      expect(result.delivered).toBe(true);
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({
        fullName: "Rajesh K Menon",
        address: "32/1147, Menon Villa\nChinnakada, Kollam 691001", // unrelated field left unchanged
      });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh K Menon") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_CONFIRM" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_CONFIRM" });
    });

    it("editing phone permits replacing a number with null through Skip", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_CONFIRM", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_CONFIRM");
      await partyRepo.upsertFields(undefined, filingId, "ACCUSED", { phoneOriginal: "9876543210", phoneNormalized: "+919876543210" });
      await handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "accused:edit" } }));
      await handleAccusedEditFieldSelection(deps, actionInput({ messageId: "SM-select-phone", selection: { listId: "accused:edit-phone" } }));

      await handleAccusedEditPhoneInput(deps, fieldEvent({ messageId: "SM-edit-phone", text: "Skip" }));

      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({ phoneOriginal: null, phoneNormalized: null });
    });

    it("invalid replacement leaves the edit-pending state and the party unchanged", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_EDIT_ADDRESS_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_EDIT_ADDRESS_PENDING");
      const before = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");

      const result = await handleAccusedEditAddressInput(deps, fieldEvent({ messageId: "SM-bad-address", text: "short" }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_EDIT_ADDRESS_PENDING" });
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED")).toEqual(before);
    });

    it("selecting entity type from the edit-field picker sends the entity-type template, not plain text (#33 Part B)", async () => {
      await handleAccusedConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "accused:edit" } }));

      const result = await handleAccusedEditFieldSelection(
        deps,
        actionInput({ messageId: "SM-select-entity", selection: { listId: "accused:edit-entity-type" } }),
      );

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: ENTITY_TYPE_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_EDIT_ENTITY_TYPE_PENDING" });
    });

    it("editing entity type only changes that field, returns to ACCUSED_CONFIRM, and resends the full updated summary", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "ACCUSED_EDIT_ENTITY_TYPE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "ACCUSED_EDIT_ENTITY_TYPE_PENDING");

      const result = await handleAccusedEditEntityTypeInput(deps, actionInput({ messageId: "SM-edit-entity", selection: { buttonPayload: "accused:entity-proprietor" } }));

      expect(result.delivered).toBe(true);
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "ACCUSED");
      expect(party).toMatchObject({
        entityType: "PROPRIETOR",
        fullName: "Rajesh Menon", // unrelated field left unchanged
      });
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_CONFIRM" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_CONFIRM" });
    });
  });
});
