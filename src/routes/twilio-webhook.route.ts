import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { buildTwilioWebhookUrl, isValidTwilioSignature } from "../adapters/twilio/verify-signature";
import { normalizeInboundMessage, type TwilioWebhookBody } from "../adapters/twilio/normalize-inbound-message";
import { createTwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { normalizeWhatsappNumber } from "../lib/normalize-whatsapp-number";
import { logWebhookEvent, logWorkflowError, maskSender } from "../lib/logger";
import { routeInboundMessage, type InboundRouterDeps } from "../services/inbound-router";
import { DrizzleConversationRepository } from "../repositories/drizzle-conversation-repository";
import { DrizzleProcessedWebhookRepository } from "../repositories/drizzle-processed-webhook-repository";
import { DrizzleFilingRepository } from "../repositories/drizzle-filing-repository";
import { DrizzleFilingPartyRepository } from "../repositories/drizzle-filing-party-repository";
import { DrizzleFilingDocumentRepository } from "../repositories/drizzle-filing-document-repository";
import { DrizzleOutboundMessageRepository } from "../repositories/drizzle-outbound-message-repository";
import type { ProcessedWebhookRepository } from "../repositories/processed-webhook-repository";
import { createTwilioMediaDownloader } from "../adapters/twilio/media-downloader";
import { createVercelBlobStorage } from "../adapters/blob-storage";
import { withTransaction } from "../db/client";

const ROUTE_PATH = "/webhooks/twilio/whatsapp";
const EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface TwilioWebhookRouterDeps extends InboundRouterDeps {
  processedWebhookRepo: ProcessedWebhookRepository;
}

/** Real, Vercel/production-wired dependencies — a live database and the real Twilio API. */
export function createDefaultTwilioWebhookRouterDeps(): TwilioWebhookRouterDeps {
  const conversationRepo = new DrizzleConversationRepository();
  const messagingClient = createTwilioMessagingClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const mainMenuContentSid = { en: env.TWILIO_MAIN_MENU_CONTENT_SID_EN, ml: env.TWILIO_MAIN_MENU_CONTENT_SID_ML };
  const mainMenuSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    contentSidByLanguage: mainMenuContentSid,
  };

  const filingRepo = new DrizzleFilingRepository();
  const partyRepo = new DrizzleFilingPartyRepository();
  const filingDocumentRepo = new DrizzleFilingDocumentRepository();
  const outboundMessageRepo = new DrizzleOutboundMessageRepository();
  const documentStorageDeps = {
    mediaDownloader: createTwilioMediaDownloader(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN),
    blobStorage: createVercelBlobStorage(env.BLOB_READ_WRITE_TOKEN),
  };
  const enrolmentSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    promptContentSid: { en: env.TWILIO_ENROLMENT_PROMPT_SID_EN, ml: env.TWILIO_ENROLMENT_PROMPT_SID_ML },
    confirmContentSid: { en: env.TWILIO_ENROLMENT_CONFIRM_SID_EN, ml: env.TWILIO_ENROLMENT_CONFIRM_SID_ML },
  };
  const complainantSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    reviewActionsContentSid: { en: env.TWILIO_COMPLAINANT_REVIEW_SID_EN, ml: env.TWILIO_COMPLAINANT_REVIEW_SID_ML },
    editFieldsContentSid: { en: env.TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN, ml: env.TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML },
  };
  const accusedSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    reviewActionsContentSid: { en: env.TWILIO_ACCUSED_REVIEW_SID_EN, ml: env.TWILIO_ACCUSED_REVIEW_SID_ML },
    editFieldsContentSid: { en: env.TWILIO_ACCUSED_EDIT_FIELDS_SID_EN, ml: env.TWILIO_ACCUSED_EDIT_FIELDS_SID_ML },
  };

  return {
    conversationRepo,
    processedWebhookRepo: new DrizzleProcessedWebhookRepository(),
    languageWorkflowDeps: {
      conversationRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
      mainMenuContentSid,
    },
    mainMenuSenderDeps,
    filingWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      filingSenderDeps: {
        messagingClient,
        fromNumber: env.TWILIO_WHATSAPP_FROM,
        draftChoiceContentSid: { en: env.TWILIO_FILING_DRAFT_CHOICE_SID_EN, ml: env.TWILIO_FILING_DRAFT_CHOICE_SID_ML },
        noticeContentSid: { en: env.TWILIO_FILING_NOTICE_SID_EN, ml: env.TWILIO_FILING_NOTICE_SID_ML },
      },
      mainMenuSenderDeps,
      enrolmentSenderDeps,
      complainantSenderDeps,
      accusedSenderDeps,
      withTransaction,
    },
    enrolmentWorkflowDeps: {
      conversationRepo,
      filingRepo,
      outboundMessageRepo,
      enrolmentSenderDeps,
      mainMenuSenderDeps,
      complainantSenderDeps,
      withTransaction,
    },
    filingDocumentWorkflowDeps: {
      conversationRepo,
      filingRepo,
      filingDocumentRepo,
      outboundMessageRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      documentStorageDeps,
      complainantSenderDeps,
      withTransaction,
    },
    complainantWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      complainantSenderDeps,
      mainMenuSenderDeps,
      accusedSenderDeps,
      withTransaction,
    },
    accusedWorkflowDeps: {
      conversationRepo,
      filingRepo,
      partyRepo,
      outboundMessageRepo,
      accusedSenderDeps,
      mainMenuSenderDeps,
      withTransaction,
    },
  };
}

export function createTwilioWebhookRouter(deps: TwilioWebhookRouterDeps): Router {
  const router = Router();

  router.post(ROUTE_PATH, async (req: Request, res: Response) => {
    const signature = req.header("X-Twilio-Signature");
    const webhookUrl = buildTwilioWebhookUrl(env.PUBLIC_BASE_URL, req.originalUrl);
    // req.body is only populated for application/x-www-form-urlencoded requests;
    // anything else (wrong content-type, no body) must still fail signature
    // validation cleanly with 403 instead of throwing on an undefined body.
    const body = (req.body ?? {}) as TwilioWebhookBody;

    if (!isValidTwilioSignature(env.TWILIO_AUTH_TOKEN, signature, webhookUrl, body)) {
      // Reject without normalizing or logging any part of the (unverified) payload.
      logWebhookEvent({ route: ROUTE_PATH, status: 403, outcome: "invalid_signature" });
      res.status(403).send("Invalid Twilio signature");
      return;
    }

    const inboundMessage = normalizeInboundMessage(body);
    const whatsappNumber = normalizeWhatsappNumber(inboundMessage.from);

    // Twilio retries failed/timed-out deliveries with the same MessageSid.
    // Claiming it here — before any side effect — is what makes a retry a
    // silent no-op instead of a duplicate picker/confirmation send.
    let claimed: boolean;
    try {
      claimed = await deps.processedWebhookRepo.tryClaim(
        inboundMessage.messageId,
        "whatsapp_inbound",
        maskSender(inboundMessage.from),
      );
    } catch {
      // The claim itself failed (e.g. the database is unreachable) before
      // any row was written, so there is nothing to mark as failed and no
      // safe way to guarantee dedup — explicit policy: ack the request
      // (never surface a 500 here, which would leave Twilio retrying this
      // MessageSid forever) and log a safe error for operators.
      logWorkflowError({ code: "processed_webhook_claim_failed", correlationId: inboundMessage.messageId });
      logWebhookEvent({
        route: ROUTE_PATH,
        status: 200,
        outcome: "accepted",
        messageId: inboundMessage.messageId,
        mediaCount: inboundMessage.media.length,
        from: inboundMessage.from,
      });
      res.status(200).type("application/xml").send(EMPTY_TWIML_RESPONSE);
      return;
    }

    if (!claimed) {
      logWebhookEvent({
        route: ROUTE_PATH,
        status: 200,
        outcome: "accepted",
        messageId: inboundMessage.messageId,
        mediaCount: inboundMessage.media.length,
        from: inboundMessage.from,
      });
      res.status(200).type("application/xml").send(EMPTY_TWIML_RESPONSE);
      return;
    }

    try {
      const result = await routeInboundMessage(deps, {
        whatsappNumber,
        messageId: inboundMessage.messageId,
        buttonPayload: body.ButtonPayload,
        buttonText: body.ButtonText,
        listId: body.ListId,
        listTitle: body.ListTitle,
        body: inboundMessage.text,
        mediaCount: inboundMessage.media.length,
        media: inboundMessage.media,
      });
      await deps.processedWebhookRepo.markOutcome(inboundMessage.messageId, result.delivered ? "processed" : "failed");
    } catch {
      // An unexpected failure (e.g. the database is unreachable) must never
      // surface as a 500 or leave Twilio retrying forever — ack the request,
      // and mark the event failed for operators to investigate.
      logWorkflowError({ code: "inbound_routing_unexpected_error", correlationId: inboundMessage.messageId });
      await deps.processedWebhookRepo.markOutcome(inboundMessage.messageId, "failed").catch(() => undefined);
    }

    logWebhookEvent({
      route: ROUTE_PATH,
      status: 200,
      outcome: "accepted",
      messageId: inboundMessage.messageId,
      mediaCount: inboundMessage.media.length,
      from: inboundMessage.from,
    });

    res.status(200).type("application/xml").send(EMPTY_TWIML_RESPONSE);
  });

  return router;
}
