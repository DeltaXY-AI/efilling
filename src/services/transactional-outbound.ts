import type { ConversationRecord, ConversationRepository } from "../repositories/conversation-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import type { SupportedLanguage } from "./main-menu-sender";

export interface OutboundIntent {
  messageType: OutboundMessageType;
  dedupeSuffix: string;
}

export type TransactionalWriteOutcome = { committed: false } | { committed: true; sends: OutboundIntent[] };

export interface OutboundCommitResult {
  committed: boolean;
  /** One id per intent returned in `sends`, same order — empty when `committed` is false. */
  outboundIds: string[];
}

export interface TransactionalOutboundDeps {
  conversationRepo: ConversationRepository;
  outboundMessageRepo: OutboundMessageRepository;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

/**
 * Locks the conversation, runs `writeInTx` (which performs the domain
 * write(s) and decides what outbound message(s), if any, they imply), and
 * — only if it committed — enqueues a durable outbound record for EACH
 * intent inside the SAME transaction, before it commits. This is what
 * makes a committed state change reconcilable even if the process crashes
 * or a send fails anywhere after this function returns: every row exists
 * and is queryable as `pending` regardless of what happens next. Each
 * `dedupeKey` (`${messageId}:${dedupeSuffix}`) makes its own enqueue
 * idempotent — if it somehow raced (it shouldn't, since the webhook
 * route's MessageSid claim already guarantees this exact call only
 * happens once), that intent is dropped rather than duplicated.
 *
 * Shared by every workflow that transitions conversation state (#8's
 * filing-workflow, #9's enrolment-workflow) so there is exactly one
 * commit-then-enqueue implementation, never a second independent copy.
 */
export async function commitWithOutbound(
  deps: TransactionalOutboundDeps,
  input: { conversationId: string; messageId: string; language: SupportedLanguage },
  writeInTx: (tx: RepositoryTransaction, locked: ConversationRecord) => Promise<TransactionalWriteOutcome>,
): Promise<OutboundCommitResult> {
  let result: OutboundCommitResult = { committed: false, outboundIds: [] };

  await deps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, input.conversationId);
    const outcome = await writeInTx(tx, locked);
    if (!outcome.committed) {
      result = { committed: false, outboundIds: [] };
      return;
    }

    const outboundIds: string[] = [];
    for (const intent of outcome.sends) {
      const enqueued = await deps.outboundMessageRepo.enqueue(tx, {
        dedupeKey: `${input.messageId}:${intent.dedupeSuffix}`,
        conversationId: input.conversationId,
        messageType: intent.messageType,
        language: input.language,
      });
      if (!enqueued) {
        // Dedupe collision on this exact intent — should never happen given
        // the webhook route's MessageSid claim, but if it did, treat the
        // whole commit as already-handled rather than send a partial set.
        result = { committed: false, outboundIds: [] };
        return;
      }
      outboundIds.push(enqueued.id);
    }
    result = { committed: true, outboundIds };
  });

  return result;
}

/** Dispatches the send and records its outcome on the enqueued outbound row — never leaves it stuck at "pending". */
export async function finalizeOutbound(
  deps: { outboundMessageRepo: OutboundMessageRepository },
  outboundId: string,
  delivered: boolean,
): Promise<void> {
  if (delivered) {
    await deps.outboundMessageRepo.markSent(outboundId);
  } else {
    await deps.outboundMessageRepo.markFailed(outboundId, "send_failed");
  }
}
