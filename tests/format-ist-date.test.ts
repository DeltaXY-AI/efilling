import { describe, expect, it } from "vitest";
import { formatIsoDateAsDisplay, formatIstTimestamp } from "../src/lib/format-ist-date";

describe("formatIsoDateAsDisplay", () => {
  it("converts YYYY-MM-DD to DD-MM-YYYY, matching this app's own display format", () => {
    expect(formatIsoDateAsDisplay("2026-04-13")).toBe("13-04-2026");
  });

  it("pads single-digit day/month", () => {
    expect(formatIsoDateAsDisplay("2026-01-05")).toBe("05-01-2026");
  });
});

describe("formatIstTimestamp", () => {
  it("renders DD-MM-YYYY, h:mm AM/PM in the Asia/Kolkata timezone", () => {
    // 2026-04-20T04:11:00Z is 09:41 AM IST (UTC+5:30).
    const result = formatIstTimestamp(new Date("2026-04-20T04:11:00Z"));
    expect(result).toBe("20-04-2026, 9:41 AM");
  });
});
