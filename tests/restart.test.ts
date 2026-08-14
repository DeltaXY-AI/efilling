import { describe, expect, it } from "vitest";
import { isRestartRequest } from "../src/domain/restart";

describe("isRestartRequest", () => {
  it.each(["restart", "RESTART", "start over", "Start Over", "വീണ്ടും തുടങ്ങുക", " restart "])("recognizes %s", (value) => {
    expect(isRestartRequest({ body: value })).toBe(true);
  });

  it("returns false for anything else, without fuzzy matching", () => {
    expect(isRestartRequest({ body: "Hi" })).toBe(false);
    expect(isRestartRequest({ body: "restarting" })).toBe(false);
    expect(isRestartRequest({ body: "" })).toBe(false);
    expect(isRestartRequest({})).toBe(false);
  });

  it("prefers ButtonPayload over ButtonText and Body", () => {
    expect(isRestartRequest({ buttonPayload: "menu:file-case", buttonText: "restart", body: "restart" })).toBe(false);
  });

  it("falls back to ButtonText when there is no ButtonPayload", () => {
    expect(isRestartRequest({ buttonText: "restart", body: "Hi" })).toBe(true);
  });
});
