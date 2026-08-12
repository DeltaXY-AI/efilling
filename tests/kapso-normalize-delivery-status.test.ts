import { describe, expect, it } from "vitest";
import { normalizeKapsoDeliveryStatuses } from "../src/adapters/kapso/normalize-delivery-status";

describe("normalizeKapsoDeliveryStatuses", () => {
  it("normalizes a single delivered status", () => {
    const updates = normalizeKapsoDeliveryStatuses({
      message: { id: "wamid.1", kapso: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000000", recipient_id: "15551234567" }] } },
    });

    expect(updates).toEqual([{ providerMessageId: "wamid.1", status: "delivered", occurredAt: new Date(1700000000 * 1000), errorCode: undefined }]);
  });

  it("normalizes multiple batched status entries", () => {
    const updates = normalizeKapsoDeliveryStatuses({
      message: {
        kapso: {
          statuses: [
            { id: "wamid.1", status: "sent", timestamp: "1700000000" },
            { id: "wamid.2", status: "delivered", timestamp: "1700000010" },
          ],
        },
      },
    });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ providerMessageId: "wamid.1", status: "sent" });
    expect(updates[1]).toMatchObject({ providerMessageId: "wamid.2", status: "delivered" });
  });

  it("extracts the error code from a failed status", () => {
    const updates = normalizeKapsoDeliveryStatuses({
      message: {
        kapso: {
          statuses: [
            {
              id: "wamid.3",
              status: "failed",
              timestamp: "1700000020",
              errors: [{ code: 131047, title: "Re-engagement message", message: "More than 24 hours have passed" }],
            },
          ],
        },
      },
    });

    expect(updates).toEqual([{ providerMessageId: "wamid.3", status: "failed", occurredAt: new Date(1700000020 * 1000), errorCode: "131047" }]);
  });

  it("skips an entry with an unrecognized status value rather than throwing (forward compatibility)", () => {
    const updates = normalizeKapsoDeliveryStatuses({
      message: { kapso: { statuses: [{ id: "wamid.4", status: "some_future_status", timestamp: "1700000030" }] } },
    });

    expect(updates).toEqual([]);
  });

  it("skips an entry with no id", () => {
    const updates = normalizeKapsoDeliveryStatuses({
      message: { kapso: { statuses: [{ status: "delivered", timestamp: "1700000030" }] } },
    });

    expect(updates).toEqual([]);
  });

  it("returns an empty array when there is no statuses field at all", () => {
    expect(normalizeKapsoDeliveryStatuses({})).toEqual([]);
    expect(normalizeKapsoDeliveryStatuses({ message: {} })).toEqual([]);
  });

  it("falls back to the current time when a status entry has no timestamp", () => {
    const before = Date.now();
    const updates = normalizeKapsoDeliveryStatuses({ message: { kapso: { statuses: [{ id: "wamid.5", status: "sent" }] } } });

    expect(updates[0].occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
