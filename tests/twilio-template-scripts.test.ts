import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main as createMain } from "../twilio/scripts/create-language-template";
import { main as verifyMain } from "../twilio/scripts/verify-language-template";
import type { ContentResource, ContentTemplateSpec } from "../twilio/scripts/content-api-client";

const SPEC: ContentTemplateSpec = JSON.parse(
  readFileSync(join(__dirname, "..", "twilio", "templates", "language-selection.json"), "utf8"),
);

function resourceFrom(sid: string, overrides: Partial<ContentTemplateSpec> = {}): ContentResource {
  return { ...SPEC, ...overrides, sid };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Twilio Content Template scripts", () => {
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
    // Reset so a non-zero exercised path doesn't leak into the test runner's own exit code.
    process.exitCode = undefined;
  });

  function loggedOutput(): string {
    return [...logSpy.mock.calls.flat(), ...errorSpy.mock.calls.flat()].join("\n");
  }

  describe("create-language-template", () => {
    it("creates a new template when none exists yet", async () => {
      const created = resourceFrom("HXnew00000000000000000000000000000");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse(created, 201));

      await createMain();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [, createOptions] = fetchMock.mock.calls[1];
      expect(createOptions.method).toBe("POST");
      expect(loggedOutput()).toContain(created.sid);
      expect(process.exitCode).toBeUndefined();
    });

    it("reuses an identical existing template and issues no create request", async () => {
      const existing = resourceFrom("HXexisting0000000000000000000000");
      fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [existing], meta: { next_page_url: null } }));

      await createMain();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(loggedOutput()).toContain("No template was created");
      expect(loggedOutput()).toContain(existing.sid);
      expect(process.exitCode).toBeUndefined();
    });

    it("exits non-zero with a diff when a same-name template has different content", async () => {
      const mismatched = resourceFrom("HXmismatch00000000000000000000000", {
        types: { "twilio/quick-reply": { body: "a totally different body", actions: SPEC.types["twilio/quick-reply"].actions } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [mismatched], meta: { next_page_url: null } }));

      await createMain();

      expect(process.exitCode).toBe(1);
      expect(loggedOutput()).toContain(mismatched.sid);
      expect(loggedOutput()).toContain("_v2");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("exits non-zero and lists every SID when duplicates already exist", async () => {
      const dup1 = resourceFrom("HXdup100000000000000000000000000000");
      const dup2 = resourceFrom("HXdup200000000000000000000000000000");
      fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [dup1, dup2], meta: { next_page_url: null } }));

      await createMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain(dup1.sid);
      expect(output).toContain(dup2.sid);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("follows pagination when searching for an existing template", async () => {
      const existing = resourceFrom("HXpagetwo000000000000000000000000");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: "https://content.twilio.com/v1/Content?Page=2" } }))
        .mockResolvedValueOnce(jsonResponse({ contents: [existing], meta: { next_page_url: null } }));

      await createMain();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(loggedOutput()).toContain(existing.sid);
      expect(process.exitCode).toBeUndefined();
    });

    it("never logs the Auth Token", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
        .mockResolvedValueOnce(jsonResponse(resourceFrom("HXnoauthtokenleak0000000000000000"), 201));

      await createMain();

      expect(loggedOutput()).not.toContain("test-auth-token");
    });
  });

  describe("verify-language-template", () => {
    beforeEach(() => {
      process.env.TWILIO_LANGUAGE_CONTENT_SID = "HXconfigured000000000000000000000";
    });

    it("succeeds when the remote template matches the specification", async () => {
      const remote = resourceFrom(process.env.TWILIO_LANGUAGE_CONTENT_SID!);
      fetchMock.mockResolvedValueOnce(jsonResponse(remote));

      await verifyMain();

      expect(process.exitCode).toBeUndefined();
      expect(loggedOutput()).toContain(remote.sid);
    });

    it("exits non-zero when TWILIO_LANGUAGE_CONTENT_SID is not configured", async () => {
      delete process.env.TWILIO_LANGUAGE_CONTENT_SID;

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("exits non-zero when the configured SID does not exist", async () => {
      fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));

      await verifyMain();

      expect(process.exitCode).toBe(1);
    });

    it("exits non-zero with mismatch details when the remote template differs", async () => {
      const remote = resourceFrom(process.env.TWILIO_LANGUAGE_CONTENT_SID!, {
        types: { "twilio/quick-reply": { body: "different", actions: SPEC.types["twilio/quick-reply"].actions } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse(remote));

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(loggedOutput()).toContain("body");
    });
  });
});
