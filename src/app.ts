import express, { type Express } from "express";
import { healthRouter } from "./routes/health.route";
import {
  createDefaultTwilioWebhookRouterDeps,
  createTwilioWebhookRouter,
  type TwilioWebhookRouterDeps,
} from "./routes/twilio-webhook.route";

export interface CreateAppOptions {
  /** Override the webhook route's dependencies — used by tests to inject fake repos/messaging client. */
  twilioWebhookDeps?: TwilioWebhookRouterDeps;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Twilio's webhook body validation (and our own signature check) needs the
  // parsed form fields, so this must run before the webhook route.
  app.use(express.urlencoded({ extended: false }));

  app.use(healthRouter);
  app.use(createTwilioWebhookRouter(options.twilioWebhookDeps ?? createDefaultTwilioWebhookRouterDeps()));

  return app;
}
