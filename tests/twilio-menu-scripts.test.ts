import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main as createMain } from "../twilio/scripts/create-main-menu-templates";
import { main as verifyMain } from "../twilio/scripts/verify-main-menu-templates";
import type { ContentResource, ContentTemplateSpec } from "../twilio/scripts/content-api-client";

const SPEC_EN: ContentTemplateSpec = JSON.parse(
  readFileSync(join(__dirname, "..", "twilio", "templates", "complainant-advocate-menu.en.json"), "utf8"),
);
const SPEC_ML: ContentTemplateSpec = JSON.parse(
  readFileSync(join(__dirname, "..", "twilio", "templates", "complainant-advocate-menu.ml.json"), "utf8"),
);

function resourceFrom(spec: ContentTemplateSpec, sid: string, overrides: Partial<ContentTemplateSpec> = {}): ContentResource {
  return { ...spec, ...overrides, sid };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Twilio main menu Content Template scripts", () => {
  const fetchMock = vi.fn();
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  function loggedOutput(): string {
    return [...logSpy.mock.calls.flat(), ...errorSpy.mock.calls.flat()].join("\n");
  }

  describe("create-main-menu-templates", () => {
    it("creates both English and Malayalam templates when neither exists yet", async () => {
      const createdEn = resourceFrom(SPEC_EN, "HXmenuen00000000000000000000000000");
      const createdMl = resourceFrom(SPEC_ML, "HXmenuml00000000000000000000000000");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } })) // list for EN
        .mockResolvedValueOnce(jsonResponse(createdEn, 201)) // create EN
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } })) // list for ML
        .mockResolvedValueOnce(jsonResponse(createdMl, 201)); // create ML

      await createMain();

      expect(process.exitCode).toBeUndefined();
      const output = loggedOutput();
      expect(output).toContain(createdEn.sid);
      expect(output).toContain(createdMl.sid);
      expect(output).toContain("TWILIO_MAIN_MENU_CONTENT_SID_EN");
      expect(output).toContain("TWILIO_MAIN_MENU_CONTENT_SID_ML");
    });

    it("reuses both templates without any create request when both already match", async () => {
      const existingEn = resourceFrom(SPEC_EN, "HXexisting0en0000000000000000000000");
      const existingMl = resourceFrom(SPEC_ML, "HXexisting0ml0000000000000000000000");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [existingEn], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse({ contents: [existingMl], meta: { next_page_url: null } }));

      await createMain();

      expect(process.exitCode).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2); // list only, per language — no create calls
      const output = loggedOutput();
      expect(output).toContain(existingEn.sid);
      expect(output).toContain(existingMl.sid);
    });

    it("reports both results clearly when English succeeds and Malayalam has a content mismatch", async () => {
      const createdEn = resourceFrom(SPEC_EN, "HXmenuen00000000000000000000000000");
      const mismatchedMl = resourceFrom(SPEC_ML, "HXmismatchml000000000000000000000", {
        types: { "twilio/list-picker": { body: "different", button: "different", items: [] } },
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse(createdEn, 201))
        .mockResolvedValueOnce(jsonResponse({ contents: [mismatchedMl], meta: { next_page_url: null } }));

      await createMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain(createdEn.sid); // English still reported as created
      expect(output).toContain(mismatchedMl.sid); // Malayalam's mismatch still reported
      expect(output).toContain("_v2");
    });

    it("reports duplicates for one language without aborting the other", async () => {
      const existingEn = resourceFrom(SPEC_EN, "HXexisting0en0000000000000000000000");
      const dup1 = resourceFrom(SPEC_ML, "HXdup1ml000000000000000000000000000");
      const dup2 = resourceFrom(SPEC_ML, "HXdup2ml000000000000000000000000000");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [existingEn], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse({ contents: [dup1, dup2], meta: { next_page_url: null } }));

      await createMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain(existingEn.sid);
      expect(output).toContain(dup1.sid);
      expect(output).toContain(dup2.sid);
    });

    it("never logs the Auth Token", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_EN, "HXnoauthtoken0000000000000000000000"), 201))
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_ML, "HXnoauthtoken0000000000000000000001"), 201));

      await createMain();

      expect(loggedOutput()).not.toContain("test-auth-token");
    });

    it("reports an unexpected failure for one language without aborting the other", async () => {
      const createdMl = resourceFrom(SPEC_ML, "HXmenuml00000000000000000000000000");
      fetchMock
        .mockResolvedValueOnce(new Response("server exploded", { status: 500 })) // list for EN fails unexpectedly
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } })) // list for ML
        .mockResolvedValueOnce(jsonResponse(createdMl, 201)); // create ML

      await createMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain("English");
      expect(output).toContain("HTTP 500");
      expect(output).toContain(createdMl.sid); // Malayalam was still attempted and reported
    });
  });

  describe("verify-main-menu-templates", () => {
    beforeEach(() => {
      process.env.TWILIO_MAIN_MENU_CONTENT_SID_EN = "HXconfiguredEn00000000000000000000";
      process.env.TWILIO_MAIN_MENU_CONTENT_SID_ML = "HXconfiguredMl00000000000000000000";
    });

    it("succeeds when both configured SIDs match their specifications", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_EN, process.env.TWILIO_MAIN_MENU_CONTENT_SID_EN!)))
        .mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_ML, process.env.TWILIO_MAIN_MENU_CONTENT_SID_ML!)));

      await verifyMain();

      expect(process.exitCode).toBeUndefined();
      expect(loggedOutput()).toContain("matches the repository specification");
    });

    it("reports a missing content SID env var for one language while still verifying the other", async () => {
      delete process.env.TWILIO_MAIN_MENU_CONTENT_SID_ML;
      fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_EN, process.env.TWILIO_MAIN_MENU_CONTENT_SID_EN!)));

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1); // English was still fetched and verified
      const output = loggedOutput();
      expect(output).toContain("TWILIO_MAIN_MENU_CONTENT_SID_ML is not configured");
      expect(output).toContain("matches the repository specification"); // English's success is still reported
    });

    it("reports both results when English matches but Malayalam does not", async () => {
      const mismatchedMl = resourceFrom(SPEC_ML, process.env.TWILIO_MAIN_MENU_CONTENT_SID_ML!, {
        types: { "twilio/list-picker": { body: "different", button: "different", items: [] } },
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_EN, process.env.TWILIO_MAIN_MENU_CONTENT_SID_EN!)))
        .mockResolvedValueOnce(jsonResponse(mismatchedMl));

      await verifyMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain("English");
      expect(output).toContain("Malayalam");
    });

    it("reports an unexpected failure fetching one language while still verifying the other", async () => {
      fetchMock
        .mockResolvedValueOnce(new Response("server exploded", { status: 500 })) // English fetch fails unexpectedly
        .mockResolvedValueOnce(jsonResponse(resourceFrom(SPEC_ML, process.env.TWILIO_MAIN_MENU_CONTENT_SID_ML!))); // Malayalam still checked

      await verifyMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain("English");
      expect(output).toContain("HTTP 500");
      expect(output).toContain("matches the repository specification"); // Malayalam's success is still reported
    });
  });
});
