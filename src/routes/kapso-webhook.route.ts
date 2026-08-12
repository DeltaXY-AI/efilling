import express, { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { isValidKapsoSignature } from "../adapters/kapso/verify-signature";
import { normalizeKapsoInboundMessage, extractKapsoSelection, type KapsoWebhookBody } from "../adapters/kapso/normalize-inbound-message";
import { createKapsoMessagingClient } from "../adapters/kapso/messaging-client";
import { normalizeWhatsappNumber } from "../lib/normalize-whatsapp-number";
import { logWebhookEvent, logWorkflowError, maskSender } from "../lib/logger";
import { routeInboundMessage, type InboundRouterDeps } from "../services/inbound-router";
import { DrizzleConversationRepository } from "../repositories/drizzle-conversation-repository";
import { DrizzleProcessedWebhookRepository } from "../repositories/drizzle-processed-webhook-repository";
import { DrizzleFilingRepository } from "../repositories/drizzle-filing-repository";
import { DrizzleOutboundMessageRepository } from "../repositories/drizzle-outbound-message-repository";
import type { ProcessedWebhookRepository } from "../repositories/processed-webhook-repository";
import { withTransaction } from "../db/client";

export const KAPSO_ROUTE_PATH = "/webhooks/kapso/whatsapp";

// Kapso has no Content-Template-SID equivalent (see adapters/kapso/messaging-client.ts)
// — every contentSid field below is an inert placeholder. sendContentTemplate
// always throws, so every send falls back to the existing numbered
// plain-text menus, exactly like a Twilio Content Template failure would.
// Issue #16 task 6 replaces this with native Kapso interactive buttons/lists.
const TEMPLATES_NOT_YET_WIRED = "kapso-template-not-yet-wired";

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const captureRawBody = express.json({
  verify: (req, _res, buf) => {
    (req as RequestWithRawBody).rawBody = buf;
  },
});

export interface KapsoWebhookRouterDeps extends InboundRouterDeps {
  processedWebhookRepo: ProcessedWebhookRepository;
  /**
   * Injected rather than read from `env` inside the route handler, so tests
   * can exercise real signature verification against a known secret without
   * touching process.env (which config/env.ts snapshots once at import
   * time — mutating it later in a test would silently have no effect).
   */
  webhookSecret: string;
}

/**
 * Real, database- and Kapso-API-wired dependencies. Throws if the spike
 * flag is on but the required Kapso config is missing — the env schema's
 * cross-field refine should already have caught this at boot, so reaching
 * this function with incomplete config would mean that check was bypassed.
 */
export function createDefaultKapsoWebhookRouterDeps(): KapsoWebhookRouterDeps {
  if (!env.KAPSO_API_KEY || !env.KAPSO_PHONE_NUMBER_ID || !env.KAPSO_WEBHOOK_SECRET) {
    throw new Error("KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID, and KAPSO_WEBHOOK_SECRET are required to build the Kapso webhook router");
  }

  const conversationRepo = new DrizzleConversationRepository();
  const messagingClient = createKapsoMessagingClient(env.KAPSO_API_KEY, env.KAPSO_PHONE_NUMBER_ID);
  const mainMenuContentSid = { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED };
  const mainMenuSenderDeps = { messagingClient, fromNumber: env.KAPSO_PHONE_NUMBER_ID, contentSidByLanguage: mainMenuContentSid };

  return {
    conversationRepo,
    processedWebhookRepo: new DrizzleProcessedWebhookRepository(),
    webhookSecret: env.KAPSO_WEBHOOK_SECRET,
    languageWorkflowDeps: {
      conversationRepo,
      messagingClient,
      fromNumber: env.KAPSO_PHONE_NUMBER_ID,
      contentSid: TEMPLATES_NOT_YET_WIRED,
      mainMenuContentSid,
    },
    mainMenuSenderDeps,
    filingWorkflowDeps: {
      conversationRepo,
      filingRepo: new DrizzleFilingRepository(),
      outboundMessageRepo: new DrizzleOutboundMessageRepository(),
      filingSenderDeps: {
        messagingClient,
        fromNumber: env.KAPSO_PHONE_NUMBER_ID,
        draftChoiceContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
        noticeContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
      },
      mainMenuSenderDeps,
      withTransaction,
    },
  };
}

/**
 * Kapso spike webhook route (issue #16). Mirrors twilio-webhook.route.ts's
 * shape deliberately — signature verification before any normalization or
 * logging, an idempotency claim before any side effect, and the exact same
 * routeInboundMessage dispatch — so the two adapters stay comparable and
 * the workflow engine underneath never has to know which one is calling it.
 * Only mounted at all when KAPSO_SPIKE_ENABLED=true (see app.ts).
 */
export function createKapsoWebhookRouter(deps: KapsoWebhookRouterDeps): Router {
  const router = Router();

  router.post(KAPSO_ROUTE_PATH, captureRawBody, async (req: Request, res: Response) => {
    const signature = req.header("X-Webhook-Signature");
    const rawBody = (req as RequestWithRawBody).rawBody ?? Buffer.alloc(0);

    if (!isValidKapsoSignature(deps.webhookSecret, signature, rawBody)) {
      // Reject without normalizing or logging any part of the (unverified) payload.
      logWebhookEvent({ route: KAPSO_ROUTE_PATH, status: 403, outcome: "invalid_signature" });
      res.status(403).json({ error: "Invalid Kapso signature" });
      return;
    }

    const body = (req.body ?? {}) as KapsoWebhookBody;
    const inboundMessage = normalizeKapsoInboundMessage(body);
    const whatsappNumber = normalizeWhatsappNumber(inboundMessage.from);
    const selection = extractKapsoSelection(body.message ?? {});

    // Kapso can retry a delivery for the same wamid. Claiming it here —
    // before any side effect — is what makes a retry a silent no-op instead
    // of a duplicate picker/confirmation send, exactly as for Twilio.
    let claimed: boolean;
    try {
      claimed = await deps.processedWebhookRepo.tryClaim(
        inboundMessage.messageId,
        "whatsapp_inbound",
        maskSender(inboundMessage.from),
        "kapso",
      );
    } catch {
      logWorkflowError({ code: "processed_webhook_claim_failed", correlationId: inboundMessage.messageId });
      logWebhookEvent({
        route: KAPSO_ROUTE_PATH,
        status: 200,
        outcome: "accepted",
        messageId: inboundMessage.messageId,
        mediaCount: inboundMessage.media.length,
        from: inboundMessage.from,
      });
      res.status(200).json({ status: "accepted" });
      return;
    }

    if (!claimed) {
      logWebhookEvent({
        route: KAPSO_ROUTE_PATH,
        status: 200,
        outcome: "accepted",
        messageId: inboundMessage.messageId,
        mediaCount: inboundMessage.media.length,
        from: inboundMessage.from,
      });
      res.status(200).json({ status: "accepted" });
      return;
    }

    try {
      const result = await routeInboundMessage(deps, {
        whatsappNumber,
        messageId: inboundMessage.messageId,
        buttonPayload: selection.buttonPayload,
        buttonText: selection.buttonText,
        listId: selection.listId,
        listTitle: selection.listTitle,
        body: inboundMessage.text,
      });
      await deps.processedWebhookRepo.markOutcome(inboundMessage.messageId, result.delivered ? "processed" : "failed");
    } catch {
      logWorkflowError({ code: "inbound_routing_unexpected_error", correlationId: inboundMessage.messageId });
      await deps.processedWebhookRepo.markOutcome(inboundMessage.messageId, "failed").catch(() => undefined);
    }

    logWebhookEvent({
      route: KAPSO_ROUTE_PATH,
      status: 200,
      outcome: "accepted",
      messageId: inboundMessage.messageId,
      mediaCount: inboundMessage.media.length,
      from: inboundMessage.from,
    });
    res.status(200).json({ status: "accepted" });
  });

  return router;
}
