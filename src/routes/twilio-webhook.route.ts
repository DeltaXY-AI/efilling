import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { buildTwilioWebhookUrl, isValidTwilioSignature } from "../adapters/twilio/verify-signature";
import { normalizeInboundMessage, type TwilioWebhookBody } from "../adapters/twilio/normalize-inbound-message";
import { logWebhookEvent } from "../lib/logger";

const ROUTE_PATH = "/webhooks/twilio/whatsapp";
const EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export const twilioWebhookRouter = Router();

twilioWebhookRouter.post(ROUTE_PATH, (req: Request, res: Response) => {
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
