import { describe, expect, it } from "vitest";
import { isMenuRedisplayRequest, parseMenuAction } from "../src/domain/main-menu";

describe("parseMenuAction", () => {
  it.each([
    ["1", "menu:file-case"],
    ["File or resume case", "menu:file-case"],
    ["കേസ് ഫയൽ ചെയ്യുക", "menu:file-case"],
    ["2", "menu:case-status"],
    ["Check case status", "menu:case-status"],
    ["കേസ് സ്ഥിതി", "menu:case-status"],
    ["3", "menu:change-language"],
    ["Change language", "menu:change-language"],
    ["ഭാഷ മാറ്റുക", "menu:change-language"],
    ["language", "menu:change-language"],
    ["ഭാഷ", "menu:change-language"],
    ["4", "menu:help"],
    ["Help", "menu:help"],
    ["സഹായം", "menu:help"],
    ["5", "menu:my-cases"],
    ["My cases", "menu:my-cases"],
    ["എന്റെ കേസുകൾ", "menu:my-cases"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseMenuAction({ body: value })).toBe(expected);
  });

  it.each([
    "menu:file-case",
    "menu:case-status",
    "menu:change-language",
    "menu:help",
    "menu:my-cases",
  ])("recognizes the stable ButtonPayload %s", (stableId) => {
    expect(parseMenuAction({ buttonPayload: stableId })).toBe(stableId);
  });

  it("prioritizes the stable ButtonPayload over Body text", () => {
    expect(parseMenuAction({ buttonPayload: "menu:help", body: "1" })).toBe("menu:help");
  });

  it("falls back to ListId (list-picker) when there is no ButtonPayload", () => {
    expect(parseMenuAction({ listId: "menu:case-status", body: "something else" })).toBe("menu:case-status");
  });

  it("falls back to ButtonText/ListTitle when Body does not match", () => {
    expect(parseMenuAction({ body: "not recognized", listTitle: "Help" })).toBe("menu:help");
  });

  it("trims whitespace and ignores Latin case", () => {
    expect(parseMenuAction({ body: "  HELP  " })).toBe("menu:help");
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseMenuAction({ body: "Helpp" })).toBeNull();
    expect(parseMenuAction({})).toBeNull();
    expect(parseMenuAction({ body: "" })).toBeNull();
  });

  it("treats an unrecognized/stale stable ID as unrecognized, never falling through to a Body match", () => {
    expect(parseMenuAction({ buttonPayload: "menu:unknown-action", body: "1" })).toBeNull();
    expect(parseMenuAction({ listId: "menu:removed-item", body: "Help" })).toBeNull();
  });
});

describe("isMenuRedisplayRequest", () => {
  it.each(["menu", "MENU", " menu ", "മെനു"])("recognizes %s", (value) => {
    expect(isMenuRedisplayRequest({ body: value })).toBe(true);
  });

  it("returns false for anything else, including a valid menu action", () => {
    expect(isMenuRedisplayRequest({ body: "Help" })).toBe(false);
    expect(isMenuRedisplayRequest({ body: "1" })).toBe(false);
  });
});
