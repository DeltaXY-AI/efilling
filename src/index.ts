import express from "express";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.route";
import { twilioWebhookRouter } from "./routes/twilio-webhook.route";

const app = express();

// Twilio's webhook body validation (and our own signature check) needs the
// parsed form fields, so this must run before the webhook route.
app.use(express.urlencoded({ extended: false }));

app.use(healthRouter);
app.use(twilioWebhookRouter);

// Vercel imports this module purely for its default export and invokes the
// app directly as a request handler, so the app must not also start its own
// listener there. Local development (and `npm start`) still needs one.
if (env.NODE_ENV !== "test" && !process.env.VERCEL) {
  app.listen(env.PORT, () => {
    console.log(`efilling-whatsapp listening on port ${env.PORT}`);
  });
}

export default app;
