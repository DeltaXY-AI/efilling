import { beforeEach, describe, expect, it } from "vitest";
import {
  handleComplainantAddressInput,
  handleComplainantConfirmInput,
  handleComplainantEditAddressInput,
  handleComplainantEditEmailInput,
  handleComplainantEditFieldSelection,
  handleComplainantEditNameInput,
  handleComplainantEmailInput,
  handleComplainantNameInput,
  handleComplainantPhoneInput,
  type ComplainantWorkflowDeps,
} from "../src/services/complainant-workflow";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const MAIN_MENU_CONTENT_SID = { en: "HXmenuen00000000000000000000000000", ml: "HXmenuml00000000000000000000000000" };
const REVIEW_CONTENT_SID = { en: "HXreviewEn0000000000000000000000000", ml: "HXreviewMl0000000000000000000000000" };
const EDIT_FIELDS_CONTENT_SID = { en: "HXeditFieldsEn000000000000000000000", ml: "HXeditFieldsMl000000000000000000000" };

describe("complainant-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let partyRepo: InMemoryFilingPartyRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: ComplainantWorkflowDeps;
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
    await conversationRepo.setActiveFilingAndState(undefined, conversationId, filing.id, "COMPLAINANT_NAME_PENDING");
    await filingRepo.setCurrentStep(undefined, filing.id, "COMPLAINANT_NAME_PENDING");

    deps = {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      complainantSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        reviewActionsContentSid: REVIEW_CONTENT_SID,
        editFieldsContentSid: EDIT_FIELDS_CONTENT_SID,
      },
      mainMenuSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function fieldEvent(overrides: Partial<Parameters<typeof handleComplainantNameInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, text: "", mediaCount: 0, ...overrides };
  }

  function actionInput(overrides: Partial<Parameters<typeof handleComplainantConfirmInput>[1]> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM2", language: "en" as const, selection: {}, ...overrides };
  }

  async function fillLinearFieldsUpToConfirm(): Promise<void> {
    await handleComplainantNameInput(deps, fieldEvent({ messageId: "SM-name", text: "Anitha Joseph" }));
    await handleComplainantPhoneInput(deps, fieldEvent({ messageId: "SM-phone", text: "9876543210" }));
    await handleComplainantEmailInput(deps, fieldEvent({ messageId: "SM-email", text: "Skip" }));
    await handleComplainantAddressInput(deps, fieldEvent({ messageId: "SM-address", text: "Thekkumkattil House\nKadappakada, Kollam 691008" }));
  }

  describe("linear field entry (Part G)", () => {
    it("a valid name saves the party as DRAFT, advances to COMPLAINANT_PHONE_PENDING, and sends the phone prompt", async () => {
      const result = await handleComplainantNameInput(deps, fieldEvent({ text: "Anitha Joseph" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("phone number") }),
      );

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "COMPLAINANT_PHONE_PENDING" });

      const party = partyRepo.findById((await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT"))!.id);
      expect(party).toMatchObject({ fullName: "Anitha Joseph", status: "DRAFT" });

      const outbound = outboundMessageRepo.findByDedupeKey("SM1:phone-prompt");
      expect(outbound).toMatchObject({ status: "sent", messageType: "COMPLAINANT_PHONE_PROMPT" });
    });

    it("invalid name keeps COMPLAINANT_NAME_PENDING and sends the localized validation error, never touching the party", async () => {
      const result = await handleComplainantNameInput(deps, fieldEvent({ text: "A" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("2–120") }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_NAME_PENDING" });
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT")).toBeNull();
    });

    it("media-only input (no text) is rejected the same as any other invalid input", async () => {
      const result = await handleComplainantNameInput(deps, fieldEvent({ text: "", mediaCount: 1 }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_NAME_PENDING" });
    });

    it("accepts a Malayalam name unchanged", async () => {
      await handleComplainantNameInput(deps, fieldEvent({ text: "അനിത ജോസഫ്" }));
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.fullName).toBe("അനിത ജോസഫ്");
    });

    it("a valid phone normalizes to E.164, preserves the trimmed original, and advances to COMPLAINANT_EMAIL_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_PHONE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_PHONE_PENDING");

      const result = await handleComplainantPhoneInput(deps, fieldEvent({ text: "9876543210" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("email address") }));
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party).toMatchObject({ phoneOriginal: "9876543210", phoneNormalized: "+919876543210" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_EMAIL_PENDING" });
    });

    it("invalid phone keeps COMPLAINANT_PHONE_PENDING and sends the localized error", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_PHONE_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_PHONE_PENDING");

      const result = await handleComplainantPhoneInput(deps, fieldEvent({ text: "12345" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("phone number") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
    });

    it("Skip stores complainant email as null and advances to COMPLAINANT_ADDRESS_PENDING", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_EMAIL_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_EMAIL_PENDING");

      const result = await handleComplainantEmailInput(deps, fieldEvent({ text: "Skip" }));

      expect(result.delivered).toBe(true);
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.emailNormalized).toBeNull();
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_ADDRESS_PENDING" });
    });

    it("a valid email is normalized (domain lower-cased) and stored", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_EMAIL_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_EMAIL_PENDING");

      await handleComplainantEmailInput(deps, fieldEvent({ text: "Anitha.Joseph@Example.COM" }));

      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.emailNormalized).toBe("Anitha.Joseph@example.com");
    });

    it("invalid email keeps COMPLAINANT_EMAIL_PENDING and sends the localized error", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_EMAIL_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_EMAIL_PENDING");

      const result = await handleComplainantEmailInput(deps, fieldEvent({ text: "not-an-email" }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_EMAIL_PENDING" });
    });

    it("a valid address preserves line breaks, advances to COMPLAINANT_CONFIRM, and sends the persisted summary + review actions", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_ADDRESS_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_ADDRESS_PENDING");
      await partyRepo.upsertFields(undefined, filingId, "COMPLAINANT", {
        fullName: "Anitha Joseph",
        phoneOriginal: "9876543210",
        phoneNormalized: "+919876543210",
        emailNormalized: null,
      });

      const result = await handleComplainantAddressInput(
        deps,
        fieldEvent({ text: "Thekkumkattil House\r\nKadappakada, Kollam 691008" }),
      );

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Thekkumkattil House") }),
      );
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Not provided") }));
      // Displayed reformatted for readability (Part F's example), even
      // though the stored value stays strict E.164.
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("+91 98765 43210") }),
      );
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }),
      );

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_CONFIRM" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "COMPLAINANT_CONFIRM" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.address).toBe("Thekkumkattil House\nKadappakada, Kollam 691008");
    });

    it("is a safe no-op when the conversation is no longer the expected pending state (stale)", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_CONFIRM", new Date());

      const result = await handleComplainantNameInput(deps, fieldEvent({ text: "Anitha Joseph" }));

      expect(result.delivered).toBe(true);
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT")).toBeNull();
    });

    it("two concurrent valid submissions for the same field: only the first advances the workflow", async () => {
      const [a, b] = await Promise.all([
        handleComplainantNameInput(deps, fieldEvent({ messageId: "SM-a", text: "Anitha Joseph" })),
        handleComplainantNameInput(deps, fieldEvent({ messageId: "SM-b", text: "Different Name" })),
      ]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      // Exactly one of the two names won — never a corrupted mix, never both applied.
      expect(["Anitha Joseph", "Different Name"]).toContain(party?.fullName);
    });

    it("does not send a misleading success message when the transaction itself fails, and saves no candidate", async () => {
      const brokenDeps: ComplainantWorkflowDeps = {
        ...deps,
        withTransaction: async () => {
          throw new Error("connection refused");
        },
      };

      await expect(handleComplainantNameInput(brokenDeps, fieldEvent({ text: "Anitha Joseph" }))).rejects.toThrow("connection refused");
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT")).toBeNull();
    });

    it("sends the Malayalam validation error for a Malayalam advocate", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());

      await handleComplainantNameInput(deps, fieldEvent({ language: "ml", text: "A" }));

      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("സാധുവായി") }));
    });

    it("never logs complainant name, phone, email, or address", async () => {
      const originalLog = console.log;
      const originalError = console.error;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => lines.push(args.join(" "));
      console.error = (...args: unknown[]) => lines.push(args.join(" "));

      try {
        await handleComplainantNameInput(deps, fieldEvent({ text: "Anitha Joseph" }));
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      expect(lines.join("\n")).not.toContain("Anitha");
    });

    it("falls back to plain text with numbered options when the review-actions Content Template send fails", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_ADDRESS_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_ADDRESS_PENDING");
      await partyRepo.upsertFields(undefined, filingId, "COMPLAINANT", {
        fullName: "Anitha Joseph",
        phoneOriginal: "9876543210",
        phoneNormalized: "+919876543210",
        emailNormalized: null,
      });
      messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleComplainantAddressInput(deps, fieldEvent({ text: "Thekkumkattil House\nKollam 691008" }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("1. Confirm") }));
    });

    it("commits the field write and enqueues a durable outbound record even when the next prompt send fails — never left stuck pending", async () => {
      messagingClient.sendText.mockRejectedValueOnce(new Error("Twilio 500"));

      const result = await handleComplainantNameInput(deps, fieldEvent({ text: "Anitha Joseph" }));

      // The domain write committed regardless of the send outcome.
      expect(result.delivered).toBe(false);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_PHONE_PENDING" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.fullName).toBe("Anitha Joseph");

      const outbound = outboundMessageRepo.findByDedupeKey("SM1:phone-prompt");
      expect(outbound).toMatchObject({ status: "failed", errorCode: "send_failed", messageType: "COMPLAINANT_PHONE_PROMPT" });

      // A later retry/reconciliation for the same advocate must not
      // duplicate or re-run the write: the conversation is no longer
      // COMPLAINANT_NAME_PENDING, so this is treated as stale.
      const retry = await handleComplainantNameInput(deps, fieldEvent({ messageId: "SM-retry", text: "Someone Else" }));
      expect(retry.delivered).toBe(true); // stale no-op, not a fresh success
      expect((await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT"))?.fullName).toBe("Anitha Joseph");
    });
  });

  describe("handleComplainantConfirmInput (Parts J/K)", () => {
    beforeEach(async () => {
      await fillLinearFieldsUpToConfirm();
      messagingClient.sendText.mockClear();
      messagingClient.sendContentTemplate.mockClear();
    });

    it("complainant:confirm marks the party CONFIRMED and advances to ACCUSED_DETAILS_START", async () => {
      const result = await handleComplainantConfirmInput(deps, actionInput({ selection: { buttonPayload: "complainant:confirm" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("Complainant details recorded") }),
      );

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "ACCUSED_DETAILS_START" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "ACCUSED_DETAILS_START" });

      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.status).toBe("CONFIRMED");
      expect(party?.confirmedAt).toBeInstanceOf(Date);
    });

    it("confirming twice does not update the timestamp or send a second completion message", async () => {
      await handleComplainantConfirmInput(deps, actionInput({ selection: { buttonPayload: "complainant:confirm" } }));
      const confirmedAt = (await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT"))?.confirmedAt;
      messagingClient.sendText.mockClear();

      const retry = await handleComplainantConfirmInput(
        deps,
        actionInput({ messageId: "SM-retry", selection: { buttonPayload: "complainant:confirm" } }),
      );

      expect(retry.delivered).toBe(true);
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      expect((await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT"))?.confirmedAt).toEqual(confirmedAt);
    });

    it("two concurrent Confirm/Edit calls: only the first valid transition applies", async () => {
      const [a, b] = await Promise.all([
        handleComplainantConfirmInput(deps, actionInput({ messageId: "SM-a", selection: { buttonPayload: "complainant:confirm" } })),
        handleComplainantConfirmInput(deps, actionInput({ messageId: "SM-b", selection: { buttonPayload: "complainant:edit" } })),
      ]);

      expect(a.delivered).toBe(true);
      expect(b.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(["ACCUSED_DETAILS_START", "COMPLAINANT_EDIT_FIELD"]).toContain(conversation?.state);
    });

    it("does not send a misleading success message when the transaction itself fails, and confirms nothing", async () => {
      const brokenDeps: ComplainantWorkflowDeps = {
        ...deps,
        withTransaction: async () => {
          throw new Error("connection refused");
        },
      };

      await expect(
        handleComplainantConfirmInput(brokenDeps, actionInput({ selection: { buttonPayload: "complainant:confirm" } })),
      ).rejects.toThrow("connection refused");
      expect(messagingClient.sendText).not.toHaveBeenCalled();
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.status).toBe("DRAFT");
    });

    it("complainant:edit opens the edit-field list-picker without changing any party data", async () => {
      const result = await handleComplainantConfirmInput(deps, actionInput({ selection: { buttonPayload: "complainant:edit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: EDIT_FIELDS_CONTENT_SID.en }),
      );
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_EDIT_FIELD" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party).toMatchObject({ fullName: "Anitha Joseph", status: "DRAFT" });
    });

    it("filing:save-exit preserves party DRAFT status and filing.current_step, keeps active_filing_id, and returns to MAIN_MENU", async () => {
      const result = await handleComplainantConfirmInput(deps, actionInput({ selection: { buttonPayload: "filing:save-exit" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("has been saved") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: MAIN_MENU_CONTENT_SID.en }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU", activeFilingId: filingId });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "COMPLAINANT_CONFIRM" });
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.status).toBe("DRAFT");
    });

    it("unrecognized input redisplays the persisted summary and review actions, without changing state", async () => {
      const result = await handleComplainantConfirmInput(deps, actionInput({ selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Anitha Joseph") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_CONFIRM" });
    });
  });

  describe("edit flow (Part I)", () => {
    beforeEach(async () => {
      await fillLinearFieldsUpToConfirm();
      messagingClient.sendText.mockClear();
      messagingClient.sendContentTemplate.mockClear();
    });

    it("selecting a field from the edit-field picker transitions to its edit-pending state and sends that field's prompt", async () => {
      await handleComplainantConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "complainant:edit" } }));

      const result = await handleComplainantEditFieldSelection(
        deps,
        actionInput({ messageId: "SM-select-phone", selection: { listId: "complainant:edit-phone" } }),
      );

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("phone number") }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_EDIT_PHONE_PENDING" });
    });

    it("unrecognized input at COMPLAINANT_EDIT_FIELD redisplays the same list-picker", async () => {
      await handleComplainantConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "complainant:edit" } }));
      messagingClient.sendContentTemplate.mockClear();

      const result = await handleComplainantEditFieldSelection(deps, actionInput({ messageId: "SM-bad", selection: { body: "asdf" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: EDIT_FIELDS_CONTENT_SID.en }));
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_EDIT_FIELD" });
    });

    it("editing the name only changes fullName, returns to COMPLAINANT_CONFIRM, and resends the full updated summary", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_EDIT_NAME_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_EDIT_NAME_PENDING");

      const result = await handleComplainantEditNameInput(deps, fieldEvent({ messageId: "SM-edit-name", text: "Anitha K Joseph" }));

      expect(result.delivered).toBe(true);
      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party).toMatchObject({
        fullName: "Anitha K Joseph",
        phoneNormalized: "+919876543210", // unrelated fields left unchanged
        address: "Thekkumkattil House\nKadappakada, Kollam 691008",
      });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Anitha K Joseph") }));
      expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: REVIEW_CONTENT_SID.en }));

      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_CONFIRM" });
      expect(filingRepo.findById(filingId)).toMatchObject({ currentStep: "COMPLAINANT_CONFIRM" });
    });

    it("editing email to Skip stores null, permitted as a valid replacement", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_CONFIRM", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_CONFIRM");
      await partyRepo.upsertFields(undefined, filingId, "COMPLAINANT", { emailNormalized: "anitha@example.com" });
      await handleComplainantConfirmInput(deps, actionInput({ messageId: "SM-open-edit", selection: { buttonPayload: "complainant:edit" } }));
      await handleComplainantEditFieldSelection(
        deps,
        actionInput({ messageId: "SM-select-email", selection: { listId: "complainant:edit-email" } }),
      );

      await handleComplainantEditEmailInput(deps, fieldEvent({ messageId: "SM-edit-email", text: "Skip" }));

      const party = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");
      expect(party?.emailNormalized).toBeNull();
    });

    it("invalid replacement leaves the edit-pending state and the party unchanged", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_EDIT_ADDRESS_PENDING", new Date());
      await filingRepo.setCurrentStep(undefined, filingId, "COMPLAINANT_EDIT_ADDRESS_PENDING");
      const before = await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT");

      const result = await handleComplainantEditAddressInput(deps, fieldEvent({ messageId: "SM-bad-address", text: "short" }));

      expect(result.delivered).toBe(true);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "COMPLAINANT_EDIT_ADDRESS_PENDING" });
      expect(await partyRepo.findByFilingAndRole(undefined, filingId, "COMPLAINANT")).toEqual(before);
    });
  });
});
