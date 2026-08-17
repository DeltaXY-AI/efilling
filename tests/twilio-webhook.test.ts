import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getExpectedTwilioSignature } from "twilio";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import type { ConversationState } from "../src/repositories/conversation-repository";
import { InMemoryProcessedWebhookRepository } from "../src/repositories/in-memory/processed-webhook-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryFilingPartyRepository } from "../src/repositories/in-memory/filing-party-repository";
import { InMemoryFilingDocumentRepository } from "../src/repositories/in-memory/filing-document-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import type { ProcessedWebhookRepository } from "../src/repositories/processed-webhook-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { createFakeDocumentStorageDeps } from "./helpers/fake-document-storage";

const ROUTE_PATH = "/webhooks/twilio/whatsapp";
const WEBHOOK_URL = `${env.PUBLIC_BASE_URL}${ROUTE_PATH}`;
const MAIN_MENU_CONTENT_SID = { en: env.TWILIO_MAIN_MENU_CONTENT_SID_EN, ml: env.TWILIO_MAIN_MENU_CONTENT_SID_ML };
const DRAFT_CHOICE_CONTENT_SID = { en: env.TWILIO_FILING_DRAFT_CHOICE_SID_EN, ml: env.TWILIO_FILING_DRAFT_CHOICE_SID_ML };
const NOTICE_CONTENT_SID = { en: env.TWILIO_FILING_NOTICE_SID_EN, ml: env.TWILIO_FILING_NOTICE_SID_ML };
const CASE_TYPE_PROMPT_CONTENT_SID = { en: env.TWILIO_FILING_CASE_TYPE_SID_EN, ml: env.TWILIO_FILING_CASE_TYPE_SID_ML };
const OTHER_CASE_TYPES_CONTENT_SID = { en: env.TWILIO_FILING_OTHER_CASE_TYPES_SID_EN, ml: env.TWILIO_FILING_OTHER_CASE_TYPES_SID_ML };
const ENROLMENT_PROMPT_CONTENT_SID = { en: env.TWILIO_ENROLMENT_PROMPT_SID_EN, ml: env.TWILIO_ENROLMENT_PROMPT_SID_ML };
const ENROLMENT_CONFIRM_CONTENT_SID = { en: env.TWILIO_ENROLMENT_CONFIRM_SID_EN, ml: env.TWILIO_ENROLMENT_CONFIRM_SID_ML };
const COMPLAINANT_REVIEW_CONTENT_SID = { en: env.TWILIO_COMPLAINANT_REVIEW_SID_EN, ml: env.TWILIO_COMPLAINANT_REVIEW_SID_ML };
const COMPLAINANT_EDIT_FIELDS_CONTENT_SID = { en: env.TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN, ml: env.TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML };
const ACCUSED_REVIEW_CONTENT_SID = { en: env.TWILIO_ACCUSED_REVIEW_SID_EN, ml: env.TWILIO_ACCUSED_REVIEW_SID_ML };
const ACCUSED_EDIT_FIELDS_CONTENT_SID = { en: env.TWILIO_ACCUSED_EDIT_FIELDS_SID_EN, ml: env.TWILIO_ACCUSED_EDIT_FIELDS_SID_ML };
const ACCUSED_ENTITY_TYPE_CONTENT_SID = { en: env.TWILIO_ACCUSED_ENTITY_TYPE_SID_EN, ml: env.TWILIO_ACCUSED_ENTITY_TYPE_SID_ML };
const COMPLAINANT_ROLE_CONTENT_SID = { en: env.TWILIO_COMPLAINANT_ROLE_SID_EN, ml: env.TWILIO_COMPLAINANT_ROLE_SID_ML };
const FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS = {
  returnReasonContentSid: { en: env.TWILIO_FILING_RETURN_REASON_SID_EN, ml: env.TWILIO_FILING_RETURN_REASON_SID_ML },
  partPaymentContentSid: { en: env.TWILIO_FILING_PART_PAYMENT_SID_EN, ml: env.TWILIO_FILING_PART_PAYMENT_SID_ML },
  witnessContentSid: { en: env.TWILIO_FILING_WITNESS_SID_EN, ml: env.TWILIO_FILING_WITNESS_SID_ML },
  courtContentSid: { en: env.TWILIO_FILING_COURT_SID_EN, ml: env.TWILIO_FILING_COURT_SID_ML },
  reviewActionsContentSid: { en: env.TWILIO_FILING_REVIEW_ACTIONS_SID_EN, ml: env.TWILIO_FILING_REVIEW_ACTIONS_SID_ML },
  editGroupContentSid: { en: env.TWILIO_FILING_EDIT_GROUP_SID_EN, ml: env.TWILIO_FILING_EDIT_GROUP_SID_ML },
  editChequeFieldContentSid: { en: env.TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_EN, ml: env.TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_ML },
  editNarrativeFieldContentSid: { en: env.TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_EN, ml: env.TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_ML },
  declareContentSid: { en: env.TWILIO_FILING_DECLARE_SID_EN, ml: env.TWILIO_FILING_DECLARE_SID_ML },
};
const FILING_SIGN_SENDER_DEPS_CONTENT_SIDS = {
  draftReadyActionsContentSid: { en: env.TWILIO_FILING_DRAFT_READY_ACTIONS_SID_EN, ml: env.TWILIO_FILING_DRAFT_READY_ACTIONS_SID_ML },
};
const FILING_COMPLETION_SENDER_DEPS_CONTENT_SIDS = {
  payFeeActionsContentSid: { en: env.TWILIO_FILING_FILED_ACTIONS_SID_EN, ml: env.TWILIO_FILING_FILED_ACTIONS_SID_ML },
};
const FILING_DRAFT_LIST_SENDER_DEPS_CONTENT_SIDS = {
  draftListContentSid: { en: env.TWILIO_FILING_DRAFT_LIST_SID_EN, ml: env.TWILIO_FILING_DRAFT_LIST_SID_ML },
  draftDetailActionsContentSid: { en: env.TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_EN, ml: env.TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_ML },
  caseStatusActionsContentSid: { en: env.TWILIO_CASE_STATUS_ACTIONS_SID_EN, ml: env.TWILIO_CASE_STATUS_ACTIONS_SID_ML },
};
const FILING_DEFECT_SENDER_DEPS_CONTENT_SIDS = {
  caseStatusActionsContentSid: { en: env.TWILIO_CASE_STATUS_ACTIONS_SID_EN, ml: env.TWILIO_CASE_STATUS_ACTIONS_SID_ML },
  defectAlertActionsContentSid: { en: env.TWILIO_DEFECT_ALERT_ACTIONS_SID_EN, ml: env.TWILIO_DEFECT_ALERT_ACTIONS_SID_ML },
  delayDaysContentSid: { en: env.TWILIO_DEFECT_DAYS_SID_EN, ml: env.TWILIO_DEFECT_DAYS_SID_ML },
  defectReviewActionsContentSid: { en: env.TWILIO_DEFECT_REVIEW_ACTIONS_SID_EN, ml: env.TWILIO_DEFECT_REVIEW_ACTIONS_SID_ML },
  defectSentActionsContentSid: { en: env.TWILIO_DEFECT_SENT_ACTIONS_SID_EN, ml: env.TWILIO_DEFECT_SENT_ACTIONS_SID_ML },
};
const HEARING_SENDER_DEPS_CONTENT_SIDS = {
  hearingReminderActionsContentSid: { en: env.TWILIO_HEARING_REMINDER_ACTIONS_SID_EN, ml: env.TWILIO_HEARING_REMINDER_ACTIONS_SID_ML },
};

function sign(params: Record<string, string>): string {
  return getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, WEBHOOK_URL, params);
}

function findLoggedEvent(logSpy: ReturnType<typeof vi.spyOn>, messageSid: string): Record<string, unknown> {
  const loggedLine = logSpy.mock.calls
    .map((call: unknown[]) => call[0])
    .find((line: unknown): line is string => typeof line === "string" && line.includes(messageSid));

  expect(loggedLine).toBeDefined();
  return JSON.parse(loggedLine as string);
}

function buildDeps(
  conversationRepo: InMemoryConversationRepository,
  processedWebhookRepo: ProcessedWebhookRepository,
  messagingClient: FakeMessagingClient,
) {
  const mainMenuSenderDeps = { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, contentSidByLanguage: MAIN_MENU_CONTENT_SID };
  const enrolmentSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    promptContentSid: ENROLMENT_PROMPT_CONTENT_SID,
    confirmContentSid: ENROLMENT_CONFIRM_CONTENT_SID,
  };
  const complainantSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    reviewActionsContentSid: COMPLAINANT_REVIEW_CONTENT_SID,
    editFieldsContentSid: COMPLAINANT_EDIT_FIELDS_CONTENT_SID,
    rolePromptContentSid: COMPLAINANT_ROLE_CONTENT_SID,
  };
  const accusedSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    reviewActionsContentSid: ACCUSED_REVIEW_CONTENT_SID,
    editFieldsContentSid: ACCUSED_EDIT_FIELDS_CONTENT_SID,
    entityTypeContentSid: ACCUSED_ENTITY_TYPE_CONTENT_SID,
  };
  const filingDetailsSenderDeps = { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...FILING_DETAILS_SENDER_DEPS_CONTENT_SIDS };
  const filingSignSenderDeps = { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...FILING_SIGN_SENDER_DEPS_CONTENT_SIDS };
  const filingCompletionSenderDeps = { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...FILING_COMPLETION_SENDER_DEPS_CONTENT_SIDS };
  const filingDraftListSenderDeps = { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...FILING_DRAFT_LIST_SENDER_DEPS_CONTENT_SIDS };
  const filingRepo = new InMemoryFilingRepository(conversationRepo);
  const partyRepo = new InMemoryFilingPartyRepository();
  const filingDocumentRepo = new InMemoryFilingDocumentRepository();
  const outboundMessageRepo = new InMemoryOutboundMessageRepository();
  const blobStorage = createFakeDocumentStorageDeps().blobStorage;
  const caseTypeSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    caseTypePromptContentSid: CASE_TYPE_PROMPT_CONTENT_SID,
    otherCaseTypesContentSid: OTHER_CASE_TYPES_CONTENT_SID,
  };
  const filingSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
    noticeContentSid: NOTICE_CONTENT_SID,
  };
  const filingWorkflowDeps = {
    conversationRepo,
    filingRepo,
    partyRepo,
    outboundMessageRepo,
    filingSenderDeps,
    caseTypeSenderDeps,
    mainMenuSenderDeps,
    enrolmentSenderDeps,
    complainantSenderDeps,
    accusedSenderDeps,
    filingDetailsSenderDeps,
    filingDocumentRepo,
    filingSignSenderDeps,
    filingCompletionSenderDeps,
    blobStorage,
    withTransaction: createInMemoryWithTransaction(),
  };
  const caseTypeWorkflowDeps = {
    conversationRepo,
    outboundMessageRepo,
    caseTypeSenderDeps,
    filingSenderDeps,
    withTransaction: createInMemoryWithTransaction(),
  };
  return {
    conversationRepo,
    processedWebhookRepo,
    languageWorkflowDeps: {
      conversationRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    },
    mainMenuSenderDeps,
    filingWorkflowDeps,
    caseTypeWorkflowDeps,
    enrolmentWorkflowDeps: {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      enrolmentSenderDeps,
      mainMenuSenderDeps,
      complainantSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    filingDocumentWorkflowDeps: {
      conversationRepo,
      filingRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      documentStorageDeps: createFakeDocumentStorageDeps(),
      complainantSenderDeps,
      filingDetailsSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    complainantWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      complainantSenderDeps,
      mainMenuSenderDeps,
      accusedSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    accusedWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      accusedSenderDeps,
      mainMenuSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    filingDetailsWorkflowDeps: {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      filingDetailsSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    filingReviewWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      filingDetailsSenderDeps,
      mainMenuSenderDeps,
      filingSignSenderDeps,
      blobStorage,
      withTransaction: createInMemoryWithTransaction(),
    },
    filingSignWorkflowDeps: {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      filingSignSenderDeps,
      filingCompletionSenderDeps,
      filingReviewWorkflowDeps: {
        conversationRepo,
        filingRepo,
        partyRepo,
        filingDocumentRepo,
        outboundMessageRepo,
        filingDetailsSenderDeps,
        mainMenuSenderDeps,
        filingSignSenderDeps,
        blobStorage,
        withTransaction: createInMemoryWithTransaction(),
      },
      withTransaction: createInMemoryWithTransaction(),
    },
    filingCompletionWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      filingCompletionSenderDeps,
      blobStorage,
      mainMenuSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    filingDraftListWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      filingDraftListSenderDeps,
      mainMenuSenderDeps,
      blobStorage: createFakeDocumentStorageDeps().blobStorage,
      filingDefectSenderDeps: { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...FILING_DEFECT_SENDER_DEPS_CONTENT_SIDS },
      filingWorkflowDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    filingDefectWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      documentStorageDeps: createFakeDocumentStorageDeps(),
      filingDefectSenderDeps: { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...FILING_DEFECT_SENDER_DEPS_CONTENT_SIDS },
      mainMenuSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
    hearingWorkflowDeps: {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      hearingSenderDeps: { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, ...HEARING_SENDER_DEPS_CONTENT_SIDS },
      withTransaction: createInMemoryWithTransaction(),
    },
  };
}

describe("POST /webhooks/twilio/whatsapp", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let messagingClient: FakeMessagingClient;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    messagingClient = createFakeMessagingClient();
    app = createApp({
      twilioWebhookDeps: buildDeps(new InMemoryConversationRepository(), new InMemoryProcessedWebhookRepository(), messagingClient),
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("accepts a validly signed text message, returns empty TwiML, and opens the language picker", async () => {
    const params = {
      MessageSid: "SM1111111111111111111111111111111",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      WaId: "15005550006",
      ProfileName: "Test User",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/xml/);
    expect(response.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    const logged = findLoggedEvent(logSpy, params.MessageSid);
    expect(logged).toMatchObject({ status: 200, outcome: "accepted", mediaCount: 0 });

    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: "whatsapp:+15005550006",
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
    });
  });

  it("accepts a validly signed media message", async () => {
    const params = {
      MessageSid: "SM2222222222222222222222222222222",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/one",
      MediaContentType0: "image/jpeg",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);

    const logged = findLoggedEvent(logSpy, params.MessageSid);
    expect(logged).toMatchObject({ status: 200, outcome: "accepted", mediaCount: 1 });
  });

  it("opens the language picker for a first media-only message too", async () => {
    const params = {
      MessageSid: "SM9999999999999999999999999999999",
      From: "whatsapp:+15005550009",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/one",
      MediaContentType0: "image/jpeg",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: "whatsapp:+15005550009",
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
    });
  });

  it("rejects a request with an invalid signature", async () => {
    const params = {
      MessageSid: "SM3333333333333333333333333333333",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", "definitely-not-valid")
      .send(params);

    expect(response.status).toBe(403);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("rejects a non-form-encoded request with 403 instead of crashing", async () => {
    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Twilio-Signature", "whatever")
      .send({ Body: "hi" });

    expect(response.status).toBe(403);
  });

  it("rejects a request with a missing signature", async () => {
    const params = {
      MessageSid: "SM4444444444444444444444444444444",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(app).post(ROUTE_PATH).type("form").send(params);

    expect(response.status).toBe(403);
  });

  it("never logs the auth token, signature, message body, or media URL", async () => {
    const params = {
      MessageSid: "SM5555555555555555555555555555555",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "this is a secret complaint detail",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/super-secret-evidence",
      MediaContentType0: "image/jpeg",
    };
    const signature = sign(params);

    await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", signature).send(params);

    const loggedOutput = logSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");

    expect(loggedOutput).not.toContain(env.TWILIO_AUTH_TOKEN);
    expect(loggedOutput).not.toContain(signature);
    expect(loggedOutput).not.toContain(params.Body);
    expect(loggedOutput).not.toContain(params.MediaUrl0);
  });

  it("does not send a second message for a duplicate MessageSid", async () => {
    const params = {
      MessageSid: "SM6666666666666666666666666666666",
      From: "whatsapp:+15005550007",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };
    const signature = sign(params);

    const first = await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", signature).send(params);
    const second = await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", signature).send(params);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledTimes(1);
  });

  it("persists a Quick Reply button selection, sends the localized confirmation, then the main menu", async () => {
    const from = "whatsapp:+15005550008";
    const firstParams = {
      MessageSid: "SM7777777777777777777777777777777",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };
    await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", sign(firstParams)).send(firstParams);
    messagingClient.sendContentTemplate.mockClear();

    const selectionParams = {
      MessageSid: "SM8888888888888888888888888888888",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "English",
      ButtonPayload: "language:en",
      ButtonText: "English",
      NumMedia: "0",
    };
    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(selectionParams))
      .send(selectionParams);

    expect(response.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      body: "✓ English selected.",
    });
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      contentSid: env.TWILIO_MAIN_MENU_CONTENT_SID_EN,
    });
  });

  it("routes a full conversation from Hi through a created filing draft, end to end (#8's no-draft flow)", async () => {
    const from = "whatsapp:+15005550011";
    const send = (params: Record<string, string>) =>
      request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", sign(params)).send(params);

    await send({ MessageSid: "SMflowa000000000000000000000000001", From: from, To: "whatsapp:+14155238886", Body: "Hi", NumMedia: "0" });
    await send({
      MessageSid: "SMflowa000000000000000000000000002",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "English",
      ButtonPayload: "language:en",
      NumMedia: "0",
    });

    const caseTypeResponse = await send({
      MessageSid: "SMflowa000000000000000000000000003",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "File or resume case",
      ButtonPayload: "menu:file-case",
      NumMedia: "0",
    });

    expect(caseTypeResponse.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      contentSid: env.TWILIO_FILING_CASE_TYPE_SID_EN,
    });

    const noticeResponse = await send({
      MessageSid: "SMflowa000000000000000000000000003b",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Cheque bounce (S.138)",
      ButtonPayload: "filing:case-type-cheque",
      NumMedia: "0",
    });

    expect(noticeResponse.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      contentSid: env.TWILIO_FILING_NOTICE_SID_EN,
    });

    const acceptResponse = await send({
      MessageSid: "SMflowa000000000000000000000000004",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Continue",
      ButtonPayload: "filing:accept-test-notice",
      NumMedia: "0",
    });

    expect(acceptResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      body: expect.stringContaining("Your filing draft is ready"),
    });
  });

  it("routes a full conversation from enrolment confirm through accused details confirm, end to end (#10/#11)", async () => {
    const from = "whatsapp:+15005550012";
    const send = (params: Record<string, string>) =>
      request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", sign(params)).send(params);

    await send({ MessageSid: "SMflowb000000000000000000000000001", From: from, To: "whatsapp:+14155238886", Body: "Hi", NumMedia: "0" });
    await send({
      MessageSid: "SMflowb000000000000000000000000002",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "English",
      ButtonPayload: "language:en",
      NumMedia: "0",
    });
    await send({
      MessageSid: "SMflowb000000000000000000000000003",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "File or resume case",
      ButtonPayload: "menu:file-case",
      NumMedia: "0",
    });
    await send({
      MessageSid: "SMflowb000000000000000000000000003b",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Cheque bounce (S.138)",
      ButtonPayload: "filing:case-type-cheque",
      NumMedia: "0",
    });
    await send({
      MessageSid: "SMflowb000000000000000000000000004",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Continue",
      ButtonPayload: "filing:accept-test-notice",
      NumMedia: "0",
    });
    await send({
      MessageSid: "SMflowb000000000000000000000000005",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "KER/1234/2010",
      NumMedia: "0",
    });

    const enrolmentConfirmResponse = await send({
      MessageSid: "SMflowb000000000000000000000000006",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Confirm",
      ButtonPayload: "enrolment:confirm",
      NumMedia: "0",
    });

    // #31: confirming enrolment now cascades into the document-collection
    // steps (cheque, memo, notice, id, support) before the complainant name
    // prompt — not straight into it as it did pre-#31.
    expect(enrolmentConfirmResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("The cheque") }));

    // Walk all 5 document groups: one photo + "done" for each required group
    // (cheque, memo, notice, id), then "done" alone for the optional support
    // group (min 0 — "done" with zero files satisfies it).
    const documentGroupSids: Array<{ label: string; withMedia: boolean }> = [
      { label: "cheque", withMedia: true },
      { label: "memo", withMedia: true },
      { label: "notice", withMedia: true },
      { label: "id", withMedia: true },
      { label: "support", withMedia: false },
    ];
    let docSeq = 100;
    for (const group of documentGroupSids) {
      if (group.withMedia) {
        const mediaResponse = await send({
          MessageSid: `SMflowb0000000000000000000000${docSeq++}`,
          From: from,
          To: "whatsapp:+14155238886",
          Body: "",
          NumMedia: "1",
          MediaUrl0: `https://api.twilio.com/media/${group.label}.jpg`,
          MediaContentType0: "image/jpeg",
        });
        expect(mediaResponse.status).toBe(200);
      }

      const doneResponse = await send({
        MessageSid: `SMflowb0000000000000000000000${docSeq++}`,
        From: from,
        To: "whatsapp:+14155238886",
        Body: "done",
        NumMedia: "0",
      });
      expect(doneResponse.status).toBe(200);
    }

    // Only after the optional support group's "done" does the flow reach
    // #33 Part A's new leading "Filing as" field.
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: env.TWILIO_COMPLAINANT_ROLE_SID_EN }),
    );

    const roleResponse = await send({
      MessageSid: "SMflowb000000000000000000000000006b",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Myself (litigant)",
      ButtonPayload: "complainant:role-self",
      NumMedia: "0",
    });
    expect(roleResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Enter the complainant's full name") }),
    );

    await send({ MessageSid: "SMflowb000000000000000000000000007", From: from, To: "whatsapp:+14155238886", Body: "Anitha Joseph", NumMedia: "0" });
    await send({ MessageSid: "SMflowb000000000000000000000000008", From: from, To: "whatsapp:+14155238886", Body: "9876543210", NumMedia: "0" });
    await send({ MessageSid: "SMflowb000000000000000000000000009", From: from, To: "whatsapp:+14155238886", Body: "Skip", NumMedia: "0" });

    const addressResponse = await send({
      MessageSid: "SMflowb000000000000000000000000010",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Thekkumkattil House\nKadappakada, Kollam 691008",
      NumMedia: "0",
    });

    expect(addressResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Anitha Joseph") }));
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: env.TWILIO_COMPLAINANT_REVIEW_SID_EN }),
    );

    const confirmResponse = await send({
      MessageSid: "SMflowb000000000000000000000000011",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Confirm",
      ButtonPayload: "complainant:confirm",
      NumMedia: "0",
    });

    expect(confirmResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Complainant details recorded") }),
    );
    // #11 Part A: the same Confirm tap cascades straight into the accused
    // name prompt — ACCUSED_DETAILS_START is never a separate step.
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Enter the accused person's full or legal name") }),
    );

    await send({ MessageSid: "SMflowb000000000000000000000000012", From: from, To: "whatsapp:+14155238886", Body: "Rajesh Menon", NumMedia: "0" });
    await send({ MessageSid: "SMflowb000000000000000000000000013", From: from, To: "whatsapp:+14155238886", Body: "Skip", NumMedia: "0" });

    const accusedAddressResponse = await send({
      MessageSid: "SMflowb000000000000000000000000014",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "32/1147, Menon Villa\nChinnakada, Kollam 691001",
      NumMedia: "0",
    });

    expect(accusedAddressResponse.status).toBe(200);
    // #33 Part B: address now advances to the new entity-type field, not the review directly.
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: env.TWILIO_ACCUSED_ENTITY_TYPE_SID_EN }),
    );

    const entityTypeResponse = await send({
      MessageSid: "SMflowb000000000000000000000000014b",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Individual",
      ButtonPayload: "accused:entity-individual",
      NumMedia: "0",
    });
    expect(entityTypeResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: env.TWILIO_ACCUSED_REVIEW_SID_EN }),
    );

    const accusedConfirmResponse = await send({
      MessageSid: "SMflowb000000000000000000000000015",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Confirm",
      ButtonPayload: "accused:confirm",
      NumMedia: "0",
    });

    expect(accusedConfirmResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Accused party details recorded") }),
    );
    // #33 Part C: the same Confirm tap cascades straight into the cheque/notice screen's first field.
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Enter the cheque number") }));
    // Part L: never send anything to the accused's own phone number.
    for (const call of [...messagingClient.sendText.mock.calls, ...messagingClient.sendContentTemplate.mock.calls]) {
      expect((call[0] as { to: string }).to).toBe(from);
    }
  });

  it("acks with 200 and logs safely instead of a 500 when the idempotency claim itself fails (e.g. DB unreachable)", async () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenProcessedWebhookRepo = {
      tryClaim: vi.fn().mockRejectedValue(new Error("connection refused")),
      markOutcome: vi.fn(),
    };
    const brokenApp = createApp({
      twilioWebhookDeps: buildDeps(new InMemoryConversationRepository(), brokenProcessedWebhookRepo, messagingClient),
    });

    const params = {
      MessageSid: "SM0000000000000000000000000000001",
      From: "whatsapp:+15005550010",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(brokenApp)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(response.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    // No side effects ran — the claim itself failed before anything else did.
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(brokenProcessedWebhookRepo.markOutcome).not.toHaveBeenCalled();

    const errorOutput = errorLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(errorOutput).toContain("processed_webhook_claim_failed");
    expect(errorOutput).not.toContain("connection refused");

    errorLogSpy.mockRestore();
  });

  it("recovers a conversation stuck in a legacy state unknown to this deployment instead of a silent 200/no-op (#26)", async () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const conversationRepo = new InMemoryConversationRepository();
    const from = "whatsapp:+15005550013";
    await conversationRepo.createAwaitingLanguage(from, new Date());
    await conversationRepo.setLanguageAndMainMenu(from, "en", new Date());
    // Simulates the incident that originally motivated #26: a conversation
    // persisted (e.g. by a different/newer deployment's migration) in a
    // state that isn't in this branch's ConversationState union at all. The
    // real incident's example was CHEQUE_DETAILS_START — since #33/#11 that
    // value is a known (if still-unimplemented) state, so this fixture uses
    // a value that will never legitimately exist instead.
    await conversationRepo.setState(from, "SOME_FUTURE_STATE_NOT_YET_KNOWN" as ConversationState, new Date());
    const recoveryApp = createApp({
      twilioWebhookDeps: buildDeps(conversationRepo, new InMemoryProcessedWebhookRepository(), messagingClient),
    });

    const params = {
      MessageSid: "SM0000000000000000000000000000002",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "some private filing detail",
      NumMedia: "0",
    };

    const response = await request(recoveryApp)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(response.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: from, body: expect.stringContaining("no longer available") }),
    );
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: from, contentSid: env.TWILIO_LANGUAGE_CONTENT_SID }),
    );

    const conversation = await conversationRepo.findByWhatsappNumber(from);
    expect(conversation).toMatchObject({ state: "AWAITING_LANGUAGE", language: null });

    const errorOutput = errorLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(errorOutput).toContain("unsupported_conversation_state");
    expect(errorOutput).toContain("SOME_FUTURE_STATE_NOT_YET_KNOWN");
    expect(errorOutput).not.toContain("15005550013");
    expect(errorOutput).not.toContain(params.Body);

    errorLogSpy.mockRestore();
  });

  it("restarts a conversation stuck mid-flow, abandoning its active filing draft (restart feature)", async () => {
    const conversationRepo = new InMemoryConversationRepository();
    const from = "whatsapp:+15005550014";
    const conversation = await conversationRepo.createAwaitingLanguage(from, new Date());
    await conversationRepo.setLanguageAndMainMenu(from, "en", new Date());
    const restartDeps = buildDeps(conversationRepo, new InMemoryProcessedWebhookRepository(), messagingClient);
    const filingRepo = restartDeps.filingWorkflowDeps.filingRepo as InMemoryFilingRepository;
    const filing = await filingRepo.createDraft(undefined, {
      conversationId: conversation.id,
      language: "en",
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: "v1",
    });
    await conversationRepo.setActiveFilingAndState(undefined, conversation.id, filing.id, "COMPLAINANT_NAME_PENDING");
    const restartApp = createApp({ twilioWebhookDeps: restartDeps });

    const params = {
      MessageSid: "SM0000000000000000000000000000003",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "restart",
      NumMedia: "0",
    };

    const response = await request(restartApp)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: from, body: expect.stringContaining("Starting over") }),
    );
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: from, contentSid: env.TWILIO_LANGUAGE_CONTENT_SID }),
    );

    const conversationAfter = await conversationRepo.findByWhatsappNumber(from);
    expect(conversationAfter).toMatchObject({ state: "AWAITING_LANGUAGE", language: null, activeFilingId: null });
    expect(filingRepo.findById(filing.id)).toMatchObject({ status: "ABANDONED" });
  });
});
