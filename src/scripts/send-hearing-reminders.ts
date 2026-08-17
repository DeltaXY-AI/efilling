import { env } from "../config/env";
import { istDateOffset } from "../domain/hearing";
import { createTwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { withTransaction } from "../db/client";
import { DrizzleConversationRepository } from "../repositories/drizzle-conversation-repository";
import { DrizzleFilingRepository } from "../repositories/drizzle-filing-repository";
import { DrizzleOutboundMessageRepository } from "../repositories/drizzle-outbound-message-repository";
import { sendHearingReminder, sendHearingReminderActions, type HearingSenderDeps } from "../services/hearing-sender";
import { finalizeOutbound } from "../services/transactional-outbound";

/**
 * #38 (Prototype parity — Phase 10) — the proactive hearing-reminder job.
 *
 * Scope decision (confirmed): this is a manually-run operator script for
 * this PR, not a Vercel Cron job — `npm run hearing:send-reminders`, run by
 * hand (or wired into whatever external scheduler you choose later). It
 * scans every FILED filing across every conversation whose
 * next_hearing_date falls on "tomorrow" (IST), and sends exactly one
 * reminder each — idempotent across repeated runs via the SAME
 * outbound_messages dedupe-key mechanism every other proactive/reactive
 * send in this codebase already uses, just with a deterministic key
 * (`hearing-reminder:${filingId}:${date}`) instead of an inbound MessageSid,
 * since there is no inbound message to key off of here.
 */

export async function main(): Promise<void> {
  const conversationRepo = new DrizzleConversationRepository();
  const filingRepo = new DrizzleFilingRepository();
  const outboundMessageRepo = new DrizzleOutboundMessageRepository();
  const messagingClient = createTwilioMessagingClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const hearingSenderDeps: HearingSenderDeps = {
    messagingClient,
    fromNumber: env.TWILIO_WHATSAPP_FROM,
    hearingReminderActionsContentSid: { en: env.TWILIO_HEARING_REMINDER_ACTIONS_SID_EN, ml: env.TWILIO_HEARING_REMINDER_ACTIONS_SID_ML },
  };

  const tomorrow = istDateOffset(new Date(), 1);
  console.log(`Scanning for FILED filings with a hearing on ${tomorrow} (IST)...`);

  const candidates = await withTransaction((tx) => filingRepo.findFiledWithHearingOn(tx, tomorrow));
  console.log(`Found ${candidates.length} filing(s).`);

  let sent = 0;
  let alreadySent = 0;
  let failed = 0;

  for (const filing of candidates) {
    const conversation = await conversationRepo.findById(filing.conversationId);
    if (!conversation) {
      console.error(`✗ Filing ${filing.id} (${filing.diaryNumber ?? "no diary number"}): conversation ${filing.conversationId} not found — skipped.`);
      failed++;
      continue;
    }

    const dedupeKey = `hearing-reminder:${filing.id}:${tomorrow}`;
    const language = conversation.language ?? "en";
    const enqueued = await withTransaction((tx) =>
      outboundMessageRepo.enqueue(tx, { dedupeKey, conversationId: conversation.id, messageType: "HEARING_REMINDER_MESSAGE", language }),
    );

    if (!enqueued) {
      console.log(`— Filing ${filing.diaryNumber ?? filing.id}: reminder already sent for ${tomorrow} — skipped (idempotent).`);
      alreadySent++;
      continue;
    }

    const sendInput = { to: conversation.whatsappNumber, language, correlationId: `hearing-reminder-${filing.id}` };
    const reminderDelivered = await sendHearingReminder(hearingSenderDeps, sendInput, filing);
    const actionsDelivered = await sendHearingReminderActions(hearingSenderDeps, sendInput);
    const delivered = reminderDelivered && actionsDelivered;
    await finalizeOutbound({ outboundMessageRepo }, enqueued.id, delivered);

    if (delivered) {
      console.log(`✓ Filing ${filing.diaryNumber ?? filing.id}: reminder sent.`);
      sent++;
    } else {
      console.error(`✗ Filing ${filing.diaryNumber ?? filing.id}: reminder enqueued but send failed — see logs, marked failed for reconciliation.`);
      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, already sent (skipped): ${alreadySent}, failed: ${failed}.`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

/** Runs `main()` and sets a non-zero exit code on an unexpected failure. */
export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error("✗ send-hearing-reminders failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx send-hearing-reminders.ts` /
// `npm run hearing:send-reminders`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
