import express, { type Express } from "express";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.route";
import {
  createDefaultTwilioWebhookRouterDeps,
  createTwilioWebhookRouter,
  type TwilioWebhookRouterDeps,
} from "./routes/twilio-webhook.route";
import {
  createDefaultKapsoWebhookRouterDeps,
  createKapsoWebhookRouter,
  type KapsoWebhookRouterDeps,
} from "./routes/kapso-webhook.route";

export interface CreateAppOptions {
  /** Override the Twilio webhook route's dependencies — used by tests to inject fake repos/messaging client. */
  twilioWebhookDeps?: TwilioWebhookRouterDeps;
  /**
   * Override the Kapso webhook route's dependencies. Passing this always
   * mounts the route regardless of KAPSO_SPIKE_ENABLED, so tests can
   * exercise it without flipping env config. Real (non-test) requests only
   * ever reach the Kapso route when KAPSO_SPIKE_ENABLED=true — see issue #16.
   */
  kapsoWebhookDeps?: KapsoWebhookRouterDeps;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Twilio's webhook body validation (and our own signature check) needs the
  // parsed form fields, so this must run before the webhook route. The Kapso
  // route parses its own JSON body at the route level instead (it needs the
  // raw bytes for signature verification), so it doesn't need this global.
  app.use(express.urlencoded({ extended: false }));

  app.use(healthRouter);
  app.use(createTwilioWebhookRouter(options.twilioWebhookDeps ?? createDefaultTwilioWebhookRouterDeps()));

  // Off by default everywhere, including Production — only mounted when a
  // test explicitly injects deps, or KAPSO_SPIKE_ENABLED=true on an isolated,
  // non-production deployment (issue #16 gate).
  if (options.kapsoWebhookDeps || env.KAPSO_SPIKE_ENABLED) {
    app.use(createKapsoWebhookRouter(options.kapsoWebhookDeps ?? createDefaultKapsoWebhookRouterDeps()));
  }

  return app;
}
