# WhatsApp Flow document-upload spike (Phase 0)

Manual steps only — nothing here touches the app's code or database. Goal:
find out whether a Flow's `complete` action delivers the uploaded files
through the ordinary Twilio webhook, or whether Meta requires a live
encrypted `data_exchange` endpoint for any screen with a `DocumentPicker`.
That answer decides how Phase 1 gets built (see
`C:\Users\Jishnu\.claude\plans\distributed-strolling-leaf.md`, Part 2).

## 1. Create the Flow in Meta's Flow Builder

1. Open **Meta Business Manager → WhatsApp Manager → Account tools → Flows**
   for the WABA behind this project's Twilio number.
2. **Create Flow** → give it a throwaway name (e.g. `doc-upload-spike`) →
   choose **Blank Flow** / start from the JSON editor.
3. Paste in the draft at
   [`twilio/flows/filing-document-upload.flow.json`](../twilio/flows/filing-document-upload.flow.json).
4. The editor validates live. It will likely flag something — most probably
   the `version`/`data_api_version` values, or the `${data.*}` bindings on
   `min-uploaded-documents`/`max-uploaded-documents` (those might need to be
   literal integers rather than dynamic). Fix whatever it flags; the
   **Preview** panel on the right lets you test the screen directly in the
   browser before publishing.
5. **Save**, then **Publish** (draft/test mode is fine — this never needs
   Meta's template-approval process, since Flows themselves aren't approved
   the way Message Templates are).
6. Copy the **Flow ID** from the Flow's details page — you'll need it below
   and to hand back to me.

## 2. Capture the raw webhook payload (no code changes)

Rather than add temporary logging to this app (which would risk logging
phone numbers/content this codebase otherwise never logs — see
`src/lib/logger.ts`), point Twilio at a disposable inspector for this one
test:

1. Open a new tab at [webhook.site](https://webhook.site) — copy the unique
   URL it gives you.
2. In the Twilio Console, temporarily change this WhatsApp sender's inbound
   webhook URL (Messaging → Senders → your number → **When a message
   comes in**) from `PUBLIC_BASE_URL/webhooks/twilio/whatsapp` to that
   webhook.site URL. (Or, if you'd rather not touch the live sender
   config, Twilio's own **Monitor → Logs → Errors/Debugger** view also
   shows the full inbound request Twilio received for each message — either
   works.)
3. Leave this app's own webhook URL configured as-is otherwise — you're only
   rerouting for the duration of this one test.

## 3. Send the Flow and submit a real document

1. Using the existing pattern in `twilio/scripts/content-api-client.ts`
   (`ensureContentTemplate`), or directly via the Twilio Console's Content
   Template Builder, create a **`whatsapp/flows`** Content Template
   referencing the Flow ID from step 1 — required fields are `body`,
   `button_text`, `flow_id` (see `docs/advocate-enrolment-setup.md`'s git
   history for the exact create-script shape this repo uses, or ask me to
   write `twilio/scripts/create-filing-document-upload-flow-templates.ts`
   once you have the Flow ID — happy to do that part).
2. Send that template to your own WhatsApp number (via the Console's "Send
   test message" or a one-off `messages.create` call).
3. Tap the button, upload a real photo or PDF on the `DocumentPicker`
   screen, tap **Continue**.
4. On webhook.site (or the Twilio Debugger), find the resulting inbound
   request and copy its **full raw body** — every field, not just the ones
   that look relevant.

## 4. What to send back to me

Paste (or attach) the full raw webhook body from step 3.4, plus:
- The Flow ID from step 1.
- Whatever the Flow Builder's validator flagged/auto-corrected in step 1.4
  (tells us the real answer to the JSON-schema open questions in the draft
  file's `_comment`).

From that payload I can tell definitively whether a file reference is
present (→ Path A, no encryption endpoint needed) or whether the response
only contains a `flow_token` with no file data (→ Path B, build the
encrypted `data_exchange` endpoint) — and then build Phase 1 accordingly.
