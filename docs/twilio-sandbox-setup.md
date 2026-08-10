# Twilio Sandbox setup and verification guide

This guide walks through activating the Twilio WhatsApp Sandbox, joining it from a
test phone, configuring this application's webhook, and verifying that an inbound
message is received and authenticated end to end.

## 1. Prepare the Twilio account

1. Sign in to the [Twilio Console](https://console.twilio.com/).
2. Open **Messaging → Try it out → Send a WhatsApp message**.
3. Activate the WhatsApp Sandbox if it is not already active.
4. Record:
   - Account SID
   - Auth Token
   - Sandbox WhatsApp number
   - Sandbox join phrase, such as `join example-word`
5. Never copy credentials into source code, issues, screenshots, or logs.

## 2. Join the Sandbox from a test phone

1. Save or open the Sandbox WhatsApp number on a WhatsApp-enabled phone.
2. Send the exact join phrase displayed by Twilio.
3. Confirm that Twilio replies that the phone has joined the Sandbox.
4. Sandbox membership expires after Twilio's configured test period; rejoin if
   Twilio returns an eligibility error.

Only users who have joined the Sandbox can exchange messages with it.

## 3. Configure local environment variables

Create `.env` from `.env.example`:

```env
NODE_ENV=development
PORT=3000
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
PUBLIC_BASE_URL=https://your-public-url.example
```

`.env` must remain ignored by Git (it already is, via `.gitignore`).

## 4. Choose a public webhook URL

### Recommended: Vercel production deployment

1. Deploy the default branch to Vercel.
2. Use the stable production domain, not a temporary preview deployment.
3. Set `PUBLIC_BASE_URL` (and the other `TWILIO_*` variables) in the Vercel
   **Production** environment.
4. Redeploy after changing any environment variable.
5. Confirm this URL is reachable: `https://your-production-domain.vercel.app/health`.

### Optional: local development tunnel

1. Start the app locally: `npm run dev`.
2. Start an HTTPS tunnel, e.g. `ngrok http 3000`.
3. Set `PUBLIC_BASE_URL` to the exact HTTPS tunnel origin.
4. Restart the app after changing the value.
5. Update the Twilio webhook whenever the tunnel URL changes.

Signature validation fails if `PUBLIC_BASE_URL` differs from the URL Twilio actually
calls by protocol, hostname, port, path, or trailing slash.

## 5. Configure the Twilio inbound webhook

1. Return to the Twilio WhatsApp Sandbox settings.
2. Find **When a message comes in**.
3. Enter: `https://your-production-domain.vercel.app/webhooks/twilio/whatsapp`
4. Select method **POST**.
5. Save the Sandbox configuration.
6. Do not configure a preview URL that changes on every deployment.

## 6. Send a verification message

1. From the phone that joined the Sandbox, send `Hi`.
2. Open the Vercel function logs.
3. Locate the inbound event using its `MessageSid`. The log line looks like:

   ```json
   {"timestamp":"...","route":"/webhooks/twilio/whatsapp","status":200,"outcome":"accepted","messageId":"SM...","mediaCount":0,"from":"whatsapp:********0006"}
   ```

4. Confirm `status` is `200`, `outcome` is `accepted`, and `mediaCount` is correct.
5. Open **Twilio Console → Monitor → Logs → Messaging**.
6. Open the corresponding inbound message and compare its `MessageSid` with the
   application log.
7. Verify Twilio reports no webhook error for the request.

The absence of a bot reply is expected in this slice. The language-picker reply
belongs to the next one.

## 7. Verify media normalization

1. Send one harmless test image through WhatsApp.
2. Confirm the log for that event reports `mediaCount: 1`.
3. Confirm logs never show the full `MediaUrl0` value — only the masked sender and
   counts are logged.
4. The file is not downloaded or persisted by this slice.

## 8. Verify signature rejection

Run the automated test suite (`npm test`), which includes signed and unsigned
requests generated with a test Auth Token using Twilio's own signing algorithm
(`twilio.getExpectedTwilioSignature`). You can also send a manual request with a
deliberately wrong `X-Twilio-Signature` header; expect:

```text
HTTP 403
No normalized event
No workflow execution
No sensitive payload logging
```

Do not disable signature verification to make manual requests pass.

## Troubleshooting

| Symptom | Check |
|---|---|
| Twilio reports HTTP 404 | Verify the webhook path is exactly `/webhooks/twilio/whatsapp` and the app is deployed. |
| Twilio reports HTTP 403 | Confirm `TWILIO_AUTH_TOKEN` and the exact `PUBLIC_BASE_URL` (protocol, host, no trailing slash). |
| Signature works locally but not on Vercel | Check HTTPS, the production hostname, and that `PUBLIC_BASE_URL` matches the Sandbox-configured URL exactly. |
| No webhook request appears | Confirm the Sandbox configuration was saved and the test phone joined the Sandbox. |
| Error 63015 | The test phone has not joined, or must rejoin, the Sandbox. |
| Twilio times out | The route returns TwiML immediately with no slow work; check for network/deploy issues. |
| Duplicate requests appear | Twilio may retry failed requests; idempotency is added in a later slice. |
| Image details are absent | Check `NumMedia` and the indexed `MediaUrl`/`MediaContentType` fields Twilio sent. |
