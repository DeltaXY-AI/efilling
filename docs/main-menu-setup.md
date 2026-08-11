# Main menu setup and verification guide

This guide covers the setup specific to the localized Complainant Advocate
main menu: creating the two Twilio Content Templates (English and
Malayalam) and verifying the routing table. It assumes
[docs/language-selection-setup.md](./language-selection-setup.md) is already
done — the main menu reuses that same database and Content Template
mechanism, not a second implementation.

## 1. Create both menu templates

The menu is two Twilio `twilio/list-picker` Content Templates, defined as
code in `twilio/templates/complainant-advocate-menu.en.json` and
`.ml.json`.

1. With `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set in `.env`, run:

   ```bash
   npm run twilio:menu:create
   ```

   Each language is processed independently and reported separately:

   - First run: creates each template and prints its Content SID.
   - Later runs: reuse each existing template if it's unchanged — no
     duplicate is ever created.
   - If one language succeeds and the other fails (mismatch or duplicate),
     both results are printed clearly and the command exits non-zero.
2. Copy the printed SIDs into `.env` and the Vercel project's environment:

   ```env
   TWILIO_MAIN_MENU_CONTENT_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_MAIN_MENU_CONTENT_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Verify both configured Content SIDs still match the committed
   specifications at any time with:

   ```bash
   npm run twilio:menu:verify
   ```

Both templates are in-session list pickers sent only after the advocate has
already selected a language, so neither is ever submitted for WhatsApp
template approval.

> **Content review**: the Malayalam menu copy in
> `twilio/templates/complainant-advocate-menu.ml.json` must be reviewed by
> the designated content/legal reviewer before production use. Until that
> review happens, treat the current copy as test-only.

## 2. Configure environment variables

In addition to the variables from
[docs/language-selection-setup.md](./language-selection-setup.md), set:

```env
TWILIO_MAIN_MENU_CONTENT_SID_EN=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MAIN_MENU_CONTENT_SID_ML=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

locally in `.env` and in the Vercel project's **Production** environment.
Redeploy after changing any environment variable.

## 3. Verify the routing table with the Sandbox

From a phone joined to the Sandbox (see
[docs/twilio-sandbox-setup.md](./twilio-sandbox-setup.md)):

1. Select English (per
   [docs/language-selection-setup.md](./language-selection-setup.md)) —
   confirm the English list picker arrives right after the confirmation.
2. In separate, resettable test conversations, select each menu item and
   confirm:
   - **File or resume case** → conversation moves to `FILING_START`, with
     the English acknowledgement `Let's start your cheque-case filing.`
   - **Check case status** → conversation moves to `CASE_STATUS_START`,
     with `Let's check your case status.`
   - **Change language** → conversation returns to `AWAITING_LANGUAGE`
     (language cleared) and the language picker from #3 reopens — the same
     picker, not a second one.
   - **Help** → conversation stays at `MAIN_MENU`, the help text is sent,
     and the menu is redisplayed.
3. While at `MAIN_MENU`, send `menu` — confirm the menu redisplays without
   changing state.
4. Send something unrecognized while at `MAIN_MENU` (e.g. a random word) —
   confirm the conversation state is unchanged, a short clarification is
   sent, and the menu redisplays. No internal action IDs or errors are ever
   shown to the advocate.
5. Repeat steps 1–4 after selecting Malayalam, confirming the Malayalam
   body/button/item text, that `മെനു` redisplays the menu, and that
   `ഭാഷ മാറ്റുക` returns to the language picker.
6. Replay the same signed webhook request (same `MessageSid`) for any menu
   action — confirm the transition and outbound message are not repeated.

If the list-picker Content Template send fails for any reason, the
appropriate localized numbered fallback is sent instead; Twilio's internal
error is never shown to the advocate.

## Retry/reconciliation behaviour

If a menu action's state transition persists successfully but the
acknowledgement or menu send then fails, the webhook still acks Twilio with
`200` — the state change is not rolled back, and the processed-webhook
event for that `MessageSid` is marked `failed` for operators to investigate
via the database, rather than left to retry indefinitely. This matches the
same policy already used for language-picker delivery failures in #3: never
leave Twilio retrying forever, and never re-run a transition or resend
because Twilio retried a already-claimed `MessageSid`.
