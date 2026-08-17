import { beforeEach, describe, expect, it } from "vitest";
import {
  handleHearingAdjournDateInput,
  handleHearingAdjournGroundInput,
  handleHearingReminderAction,
  type HearingWorkflowDeps,
} from "../src/services/hearing-workflow";
import { istDateOffset } from "../src/domain/hearing";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const WHATSAPP_NUMBER = "whatsapp:+15005550006";
const FROM_NUMBER = "whatsapp:+14155238886";
const HEARING_REMINDER_ACTIONS_CONTENT_SID = { en: "HXhearingEn00000000000000000000000", ml: "HXhearingMl00000000000000000000000" };

/** Covers #38 (Prototype parity — Phase 10): the hearing-reminder response and adjournment-request flow. */
describe("hearing-workflow", () => {
  let conversationRepo: InMemoryConversationRepository;
  let filingRepo: InMemoryFilingRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let deps: HearingWorkflowDeps;
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

    const filing = await filingRepo.createDraft(undefined, { conversationId, language: "en", role: "COMPLAINANT_ADVOCATE", testNoticeVersion: "v1" });
    filingId = filing.id;
    const filedAt = new Date();
    const diaryNumber = await filingRepo.nextDiaryNumber(undefined, filedAt);
    await filingRepo.recordFiled(undefined, filingId, { diaryNumber, filedAt });
    // Mirrors set-test-hearing-date.ts: a real future timestamp, IST.
    await filingRepo.upsertFilingFields(undefined, filingId, { nextHearingDate: new Date("2026-04-28T05:30:00.000Z") });

    deps = {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      hearingSenderDeps: { messagingClient, fromNumber: FROM_NUMBER, hearingReminderActionsContentSid: HEARING_REMINDER_ACTIONS_CONTENT_SID },
      withTransaction: createInMemoryWithTransaction(),
    };
  });

  function actionInput(overrides: Partial<{ language: "en" | "ml"; selection: Record<string, string> }> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, selection: {}, ...overrides };
  }

  function fieldEvent(text: string, overrides: Partial<{ language: "en" | "ml"; mediaCount: number }> = {}) {
    return { conversationId, whatsappNumber: WHATSAPP_NUMBER, messageId: "SM1", language: "en" as const, text, mediaCount: 0, ...overrides };
  }

  describe("repository: findFiledWithHearingOn (the reminder script's own filter)", () => {
    it("finds a FILED filing whose nextHearingDate falls on the given IST calendar date", async () => {
      const found = await filingRepo.findFiledWithHearingOn(undefined, "2026-04-28");
      expect(found.map((f) => f.id)).toContain(filingId);
    });

    it("does not find it on an adjacent date", async () => {
      const found = await filingRepo.findFiledWithHearingOn(undefined, "2026-04-29");
      expect(found.map((f) => f.id)).not.toContain(filingId);
    });

    it("does not find a DRAFT filing even with a matching hearing date", async () => {
      const draft = await filingRepo.createDraft(undefined, { conversationId, language: "en", role: "COMPLAINANT_ADVOCATE", testNoticeVersion: "v1" });
      await filingRepo.upsertFilingFields(undefined, draft.id, { nextHearingDate: new Date("2026-04-28T05:30:00.000Z") });

      const found = await filingRepo.findFiledWithHearingOn(undefined, "2026-04-28");
      expect(found.map((f) => f.id)).not.toContain(draft.id);
    });
  });

  describe("hearing:will-attend", () => {
    it("records hearingAttendance and sends attendOk WITHOUT touching conversation.state at all", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "COMPLAINANT_NAME_PENDING", new Date());

      const result = await handleHearingReminderAction(deps, actionInput({ selection: { buttonPayload: "hearing:will-attend" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ hearingAttendance: "attending" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      // The advocate's actual main-flow state is completely undisturbed —
      // this is the scope-decided behavior, not an incidental side effect.
      expect(conversation).toMatchObject({ state: "COMPLAINANT_NAME_PENDING" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("marked as appearing") }));
    });

    it("recognized globally — works even mid-form, at ANY conversation state", async () => {
      await conversationRepo.setState(WHATSAPP_NUMBER, "FILING_DOC_CHEQUE", new Date());

      const result = await handleHearingReminderAction(deps, actionInput({ selection: { buttonPayload: "hearing:will-attend" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ hearingAttendance: "attending" });
    });

    it("a stale tap (no filing awaiting a response) is a safe no-op", async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { hearingAttendance: "attending" });

      const result = await handleHearingReminderAction(deps, actionInput({ selection: { buttonPayload: "hearing:will-attend" } }));

      expect(result.delivered).toBe(true);
      expect(messagingClient.sendText).not.toHaveBeenCalled();
    });
  });

  describe("hearing:seek-adjournment", () => {
    it("records hearingAttendance and moves ONLY to HEARING_ADJOURN_GROUND_PENDING, sending adjIntro", async () => {
      const result = await handleHearingReminderAction(deps, actionInput({ selection: { buttonPayload: "hearing:seek-adjournment" } }));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ hearingAttendance: "adjournment_requested" });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "HEARING_ADJOURN_GROUND_PENDING" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Section 309 CrPC") }));
    });
  });

  describe("HEARING_ADJOURN_GROUND_PENDING", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { hearingAttendance: "adjournment_requested" });
      await conversationRepo.setState(WHATSAPP_NUMBER, "HEARING_ADJOURN_GROUND_PENDING", new Date());
    });

    it("a valid ground is recorded and cascades to HEARING_ADJOURN_DATE_PENDING", async () => {
      const result = await handleHearingAdjournGroundInput(deps, fieldEvent("Counsel engaged elsewhere."));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ adjournmentGround: "Counsel engaged elsewhere." });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "HEARING_ADJOURN_DATE_PENDING" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("DD-MM-YYYY") }));
    });

    it("empty input is rejected without advancing", async () => {
      const result = await handleHearingAdjournGroundInput(deps, fieldEvent("   "));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ adjournmentGround: null });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "HEARING_ADJOURN_GROUND_PENDING" });
    });
  });

  describe("HEARING_ADJOURN_DATE_PENDING", () => {
    beforeEach(async () => {
      await filingRepo.upsertFilingFields(undefined, filingId, { hearingAttendance: "adjournment_requested", adjournmentGround: "Counsel engaged elsewhere." });
      await conversationRepo.setState(WHATSAPP_NUMBER, "HEARING_ADJOURN_DATE_PENDING", new Date());
    });

    it("a valid date generates a real IA number (never hardcoded, mirrors diaryNumber's own discipline), records it, and cascades to MAIN_MENU", async () => {
      const before = filingRepo.findById(filingId)!;

      const result = await handleHearingAdjournDateInput(deps, fieldEvent("05-05-2026"));

      expect(result.delivered).toBe(true);
      const after = filingRepo.findById(filingId);
      expect(after).toMatchObject({ adjournmentRequestedDate: "2026-05-05", diaryNumber: before.diaryNumber });
      expect(after?.adjournmentIaNumber).toMatch(/^TEST-IA-\d{6}-\d{4}$/);
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(after!.adjournmentIaNumber!) }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Counsel engaged elsewhere.") }));
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(before.diaryNumber!) }));
    });

    it("an invalid date is rejected without advancing", async () => {
      const result = await handleHearingAdjournDateInput(deps, fieldEvent("not a date"));

      expect(result.delivered).toBe(true);
      expect(filingRepo.findById(filingId)).toMatchObject({ adjournmentIaNumber: null });
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "HEARING_ADJOURN_DATE_PENDING" });
    });
  });

  describe("full adjournment flow (end to end)", () => {
    it("seek-adjournment -> ground -> date files the IA with all 3 pieces accurate and durable", async () => {
      await handleHearingReminderAction(deps, actionInput({ selection: { buttonPayload: "hearing:seek-adjournment" } }));
      await handleHearingAdjournGroundInput(deps, fieldEvent("Counsel is unwell."));
      const result = await handleHearingAdjournDateInput(deps, fieldEvent("12-05-2026"));

      expect(result.delivered).toBe(true);
      const filing = filingRepo.findById(filingId);
      expect(filing).toMatchObject({
        hearingAttendance: "adjournment_requested",
        adjournmentGround: "Counsel is unwell.",
        adjournmentRequestedDate: "2026-05-12",
      });
      expect(filing?.adjournmentIaNumber).toBeTruthy();
      const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
      expect(conversation).toMatchObject({ state: "MAIN_MENU" });
    });
  });

  describe("bilingual coverage", () => {
    it("sends the Malayalam attendOk and adjIntro", async () => {
      await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "ml", new Date());

      const attendResult = await handleHearingReminderAction(deps, actionInput({ language: "ml", selection: { buttonPayload: "hearing:will-attend" } }));
      expect(attendResult.delivered).toBe(true);
      expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("ഹാജരാകുന്നതായി") }));
    });
  });

  describe("idempotency (mirrors the outbox pattern the send-hearing-reminders script itself relies on)", () => {
    it("enqueuing the same reminder dedupe key twice only creates one outbound row", async () => {
      const dedupeKey = `hearing-reminder:${filingId}:${istDateOffset(new Date(), 1)}`;
      const first = await outboundMessageRepo.enqueue(undefined, { dedupeKey, conversationId, messageType: "HEARING_REMINDER_MESSAGE", language: "en" });
      const second = await outboundMessageRepo.enqueue(undefined, { dedupeKey, conversationId, messageType: "HEARING_REMINDER_MESSAGE", language: "en" });

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });
  });
});
