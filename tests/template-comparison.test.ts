import { describe, expect, it } from "vitest";
import { diffTemplates, templatesMatch, type ContentTemplateSpec } from "../twilio/scripts/template-comparison";

const QUICK_REPLY_SPEC: ContentTemplateSpec = {
  friendly_name: "oncourts_language_selection_v1",
  language: "en",
  types: {
    "twilio/quick-reply": {
      body: "Welcome",
      actions: [
        { title: "English", id: "language:en" },
        { title: "മലയാളം", id: "language:ml" },
      ],
    },
  },
};

const LIST_PICKER_SPEC: ContentTemplateSpec = {
  friendly_name: "oncourts_complainant_advocate_menu_v1_en",
  language: "en",
  types: {
    "twilio/list-picker": {
      body: "What would you like to do today?",
      button: "Main menu",
      items: [
        { item: "File or resume case", description: "Start a new filing or continue a saved draft", id: "menu:file-case" },
        { item: "Help", description: "Get help", id: "menu:help" },
      ],
    },
  },
};

describe("templatesMatch / diffTemplates — twilio/quick-reply", () => {
  it("matches an identical template regardless of object key order", () => {
    const reordered: ContentTemplateSpec = {
      language: QUICK_REPLY_SPEC.language,
      types: QUICK_REPLY_SPEC.types,
      friendly_name: QUICK_REPLY_SPEC.friendly_name,
    };

    expect(templatesMatch(QUICK_REPLY_SPEC, reordered)).toBe(true);
    expect(diffTemplates(QUICK_REPLY_SPEC, reordered)).toEqual([]);
  });

  it("does not ignore whitespace differences in the body", () => {
    const withTrailingSpace: ContentTemplateSpec = {
      ...QUICK_REPLY_SPEC,
      types: { "twilio/quick-reply": { ...(QUICK_REPLY_SPEC.types["twilio/quick-reply"] as object), body: "Welcome " } },
    };

    expect(templatesMatch(QUICK_REPLY_SPEC, withTrailingSpace)).toBe(false);
  });

  it("treats a different action order as a mismatch", () => {
    const quickReply = QUICK_REPLY_SPEC.types["twilio/quick-reply"] as { body: string; actions: unknown[] };
    const reorderedActions: ContentTemplateSpec = {
      ...QUICK_REPLY_SPEC,
      types: {
        "twilio/quick-reply": { body: quickReply.body, actions: [...quickReply.actions].reverse() },
      },
    };

    expect(templatesMatch(QUICK_REPLY_SPEC, reorderedActions)).toBe(false);
    expect(diffTemplates(QUICK_REPLY_SPEC, reorderedActions).some((line) => line.includes("actions"))).toBe(true);
  });

  it.each([
    ["button title", { title: "Not English" }],
    ["button id/payload", { id: "language:xx" }],
  ])("treats a changed %s as a mismatch", (_label, override) => {
    const quickReply = QUICK_REPLY_SPEC.types["twilio/quick-reply"] as { body: string; actions: Array<Record<string, unknown>> };
    const changed: ContentTemplateSpec = {
      ...QUICK_REPLY_SPEC,
      types: {
        "twilio/quick-reply": {
          body: quickReply.body,
          actions: [{ ...quickReply.actions[0], ...override }, quickReply.actions[1]],
        },
      },
    };

    expect(templatesMatch(QUICK_REPLY_SPEC, changed)).toBe(false);
  });

  it("treats a changed language as a mismatch", () => {
    const changedLanguage: ContentTemplateSpec = { ...QUICK_REPLY_SPEC, language: "ml" };

    expect(templatesMatch(QUICK_REPLY_SPEC, changedLanguage)).toBe(false);
    expect(diffTemplates(QUICK_REPLY_SPEC, changedLanguage).some((line) => line.includes("language"))).toBe(true);
  });

  it("reports a missing content type on the remote template", () => {
    const missingType: ContentTemplateSpec = { ...QUICK_REPLY_SPEC, types: {} };

    expect(templatesMatch(QUICK_REPLY_SPEC, missingType)).toBe(false);
    expect(diffTemplates(QUICK_REPLY_SPEC, missingType).some((line) => line.includes("missing on remote"))).toBe(true);
  });

  it("reports each differing top-level field", () => {
    const different: ContentTemplateSpec = { ...QUICK_REPLY_SPEC, friendly_name: "other_name", language: "ml" };

    const diff = diffTemplates(QUICK_REPLY_SPEC, different);
    expect(diff).toEqual(
      expect.arrayContaining([expect.stringContaining("friendly_name"), expect.stringContaining("language")]),
    );
  });
});

describe("templatesMatch / diffTemplates — twilio/list-picker", () => {
  it("matches an identical list-picker template", () => {
    const identical: ContentTemplateSpec = JSON.parse(JSON.stringify(LIST_PICKER_SPEC));

    expect(templatesMatch(LIST_PICKER_SPEC, identical)).toBe(true);
    expect(diffTemplates(LIST_PICKER_SPEC, identical)).toEqual([]);
  });

  it("treats a different item order as a mismatch", () => {
    const listPicker = LIST_PICKER_SPEC.types["twilio/list-picker"] as { body: string; button: string; items: unknown[] };
    const reorderedItems: ContentTemplateSpec = {
      ...LIST_PICKER_SPEC,
      types: { "twilio/list-picker": { ...listPicker, items: [...listPicker.items].reverse() } },
    };

    expect(templatesMatch(LIST_PICKER_SPEC, reorderedItems)).toBe(false);
    expect(diffTemplates(LIST_PICKER_SPEC, reorderedItems).some((line) => line.includes("items"))).toBe(true);
  });

  it.each([
    ["item title", { item: "Something else" }],
    ["item description", { description: "Something else" }],
    ["item id", { id: "menu:other" }],
  ])("treats a changed %s as a mismatch", (_label, override) => {
    const listPicker = LIST_PICKER_SPEC.types["twilio/list-picker"] as {
      body: string;
      button: string;
      items: Array<Record<string, unknown>>;
    };
    const changed: ContentTemplateSpec = {
      ...LIST_PICKER_SPEC,
      types: {
        "twilio/list-picker": {
          body: listPicker.body,
          button: listPicker.button,
          items: [{ ...listPicker.items[0], ...override }, listPicker.items[1]],
        },
      },
    };

    expect(templatesMatch(LIST_PICKER_SPEC, changed)).toBe(false);
  });

  it("treats a changed button text as a mismatch", () => {
    const listPicker = LIST_PICKER_SPEC.types["twilio/list-picker"] as { body: string; button: string; items: unknown[] };
    const changedButton: ContentTemplateSpec = {
      ...LIST_PICKER_SPEC,
      types: { "twilio/list-picker": { ...listPicker, button: "Menu" } },
    };

    expect(templatesMatch(LIST_PICKER_SPEC, changedButton)).toBe(false);
    expect(diffTemplates(LIST_PICKER_SPEC, changedButton).some((line) => line.includes("button"))).toBe(true);
  });
});
