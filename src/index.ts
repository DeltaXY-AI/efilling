import { env } from "./config/env";
import { createApp } from "./app";

const app = createApp();

// Vercel imports this module purely for its default export and invokes the
// app directly as a request handler, so the app must not also start its own
// listener there. Local development (and `npm start`) still needs one.
if (env.NODE_ENV !== "test" && !process.env.VERCEL) {
  app.listen(env.PORT, () => {
    console.log(`efilling-whatsapp listening on port ${env.PORT}`);
  });
}

export default app;
