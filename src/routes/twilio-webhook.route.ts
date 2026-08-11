import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { buildTwilioWebhookUrl, isValidTwilioSignature } from "../adapters/twilio/verify-signature";
import { normalizeInboundMessage, type TwilioWebhookBody } from "../adapters/twilio/normalize-inbound-message";
import { createTwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { normalizeWhatsappNumber } from "../lib/normalize-whatsapp-number";
import { logWebhookEvent, logWorkflowError, maskSender } from "../lib/logger";
import { handleInboundForLanguageSelection, type LanguageWorkflowDeps } from "../services/language-workflow";
import { DrizzleConversationRepository } from "../repositories/drizzle-conversation-repository";
import { DrizzleProcessedWebhookRepository } from "../repositories/drizzle-processed-webhook-repository";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { ProcessedWebhookRepository } from "../repositories/processed-webhook-repository";

const ROUTE_PATH = "/webhooks/twilio/whatsapp";
const EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface TwilioWebhookRouterDeps {
  conversationRepo: ConversationRepository;
  processedWebhookRepo: ProcessedWebhookRepository;
  languageWorkflowDeps: Pick<LanguageWorkflowDeps, "messagingClient" | "fromNumber" | "contentSid">;
}

/** Real, Vercel/production-wired dependencies — a live database and the real Twilio API. */
export function createDefaultTwilioWebhookRouterDeps(): TwilioWebhookRouterDeps {
  return {
    conversationRepo: new DrizzleConversationRepository(),
    processedWebhookRepo: new DrizzleProcessedWebhookRepository(),
    languageWorkflowDeps: {
      messagingClient: createTwilioMessagingClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN),
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
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
    const claimed = await deps.processedWebhookRepo.tryClaim(
      inboundMessage.messageId,
      "whatsapp_inbound",
      maskSender(inboundMessage.from),
    );

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
      const result = await handleInboundForLanguageSelection(
        { conversationRepo: deps.conversationRepo, ...deps.languageWorkflowDeps },
        {
          whatsappNumber,
          messageId: inboundMessage.messageId,
          selection: { buttonPayload: body.ButtonPayload, buttonText: body.ButtonText, body: inboundMessage.text },
        },
      );
      await deps.processedWebhookRepo.markOutcome(inboundMessage.messageId, result.delivered ? "processed" : "failed");
    } catch {
      // An unexpected failure (e.g. the database is unreachable) must never
      // surface as a 500 or leave Twilio retrying forever — ack the request,
      // and mark the event failed for operators to investigate.
      logWorkflowError({ code: "language_workflow_unexpected_error", correlationId: inboundMessage.messageId });
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
