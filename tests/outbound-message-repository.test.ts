import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";

describe("InMemoryOutboundMessageRepository — delivery-status reconciliation (#16 task 7)", () => {
  let repo: InMemoryOutboundMessageRepository;
  const withTransaction = createInMemoryWithTransaction();

  beforeEach(() => {
    repo = new InMemoryOutboundMessageRepository();
  });

  async function enqueueAndMarkSent(providerMessageId: string) {
    const record = await withTransaction((tx) =>
      repo.enqueue(tx, { dedupeKey: `dk-${providerMessageId}`, conversationId: "conv-1", messageType: "MAIN_MENU", language: "en" }),
    );
    await repo.markSent(record!.id, providerMessageId);
    return record!.id;
  }

  it("records providerMessageId on markSent", async () => {
    const id = await enqueueAndMarkSent("wamid.1");
    expect(repo.findById(id)).toMatchObject({ status: "sent", providerMessageId: "wamid.1", deliveryStatus: null });
  });

  it("applies a delivery-status update to the row whose providerMessageId matches", async () => {
    const id = await enqueueAndMarkSent("wamid.2");

    const { matched } = await repo.recordDeliveryStatus("wamid.2", "delivered", new Date("2026-01-01T00:00:01Z"));

    expect(matched).toBe(true);
    expect(repo.findById(id)).toMatchObject({ deliveryStatus: "delivered" });
  });

  it("reports matched: false for a providerMessageId that was never sent through this deployment", async () => {
    const { matched } = await repo.recordDeliveryStatus("wamid.unknown", "delivered", new Date());
    expect(matched).toBe(false);
  });

  it("applies sent -> delivered -> read in order", async () => {
    const id = await enqueueAndMarkSent("wamid.3");

    await repo.recordDeliveryStatus("wamid.3", "sent", new Date("2026-01-01T00:00:01Z"));
    await repo.recordDeliveryStatus("wamid.3", "delivered", new Date("2026-01-01T00:00:02Z"));
    await repo.recordDeliveryStatus("wamid.3", "read", new Date("2026-01-01T00:00:03Z"));

    expect(repo.findById(id)).toMatchObject({ deliveryStatus: "read" });
  });

  it("does not let an out-of-order retry regress a status already newer than the incoming event", async () => {
    const id = await enqueueAndMarkSent("wamid.4");

    await repo.recordDeliveryStatus("wamid.4", "read", new Date("2026-01-01T00:00:05Z"));
    const { matched } = await repo.recordDeliveryStatus("wamid.4", "sent", new Date("2026-01-01T00:00:01Z"));

    // Still "matched" — the row exists — but the earlier-timestamped "sent"
    // must not overwrite the later "read".
    expect(matched).toBe(true);
    expect(repo.findById(id)).toMatchObject({ deliveryStatus: "read" });
  });

  it("records the error code on a failed status", async () => {
    const id = await enqueueAndMarkSent("wamid.5");

    await repo.recordDeliveryStatus("wamid.5", "failed", new Date(), "131047");

    expect(repo.findById(id)).toMatchObject({ deliveryStatus: "failed", deliveryErrorCode: "131047" });
  });
});
