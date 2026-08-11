import { describe, expect, it } from "vitest";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";

describe("in-memory lockById + withTransaction", () => {
  it("serializes two concurrent transactions racing for the same conversation", async () => {
    const conversationRepo = new InMemoryConversationRepository();
    const withTransaction = createInMemoryWithTransaction();
    const conversation = await conversationRepo.createAwaitingLanguage("whatsapp:+15005550006", new Date());
    await conversationRepo.setLanguageAndMainMenu("whatsapp:+15005550006", "en", new Date());

    const order: string[] = [];

    async function racer(name: string, delayMs: number): Promise<string> {
      return withTransaction(async (tx) => {
        const locked = await conversationRepo.lockById(tx, conversation.id);
        order.push(`${name}:locked:${locked.state}`);
        // Simulate work happening while holding the lock — if locking were
        // a no-op, the other racer's read below would interleave here and
        // both would see the pre-transition state.
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        if (locked.state !== "MAIN_MENU") {
          order.push(`${name}:stale`);
          return "stale";
        }

        await conversationRepo.setStateInTx(tx, conversation.id, "FILING_NOTICE");
        order.push(`${name}:transitioned`);
        return "transitioned";
      });
    }

    const [first, second] = await Promise.all([racer("A", 20), racer("B", 0)]);

    // Exactly one of the two actually transitioned; the other saw the
    // already-changed state and backed off instead of transitioning again.
    const results = [first, second];
    expect(results.filter((r) => r === "transitioned")).toHaveLength(1);
    expect(results.filter((r) => r === "stale")).toHaveLength(1);

    // The second racer's lock acquisition only happened after the first
    // released it (proving real serialization, not just a lucky ordering).
    const lockEvents = order.filter((entry) => entry.endsWith(":locked:MAIN_MENU") || entry.endsWith(":locked:FILING_NOTICE"));
    expect(lockEvents).toHaveLength(2);
    expect(lockEvents[0]).toContain(":locked:MAIN_MENU");
    expect(lockEvents[1]).toContain(":locked:FILING_NOTICE");

    const conversationAfter = await conversationRepo.findByWhatsappNumber("whatsapp:+15005550006");
    expect(conversationAfter).toMatchObject({ state: "FILING_NOTICE" });
  });
});
