import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main as createMain } from "../twilio/scripts/create-filing-templates";
import { main as verifyMain } from "../twilio/scripts/verify-filing-templates";
import type { ContentResource, ContentTemplateSpec } from "../twilio/scripts/content-api-client";

const FILE_NAMES = ["filing-draft-choice.en.json", "filing-draft-choice.ml.json", "filing-notice.en.json", "filing-notice.ml.json"];
const ENV_VARS = [
  "TWILIO_FILING_DRAFT_CHOICE_SID_EN",
  "TWILIO_FILING_DRAFT_CHOICE_SID_ML",
  "TWILIO_FILING_NOTICE_SID_EN",
  "TWILIO_FILING_NOTICE_SID_ML",
];

const SPECS: ContentTemplateSpec[] = FILE_NAMES.map(
  (fileName) => JSON.parse(readFileSync(join(__dirname, "..", "twilio", "templates", fileName), "utf8")) as ContentTemplateSpec,
);

function resourceFrom(spec: ContentTemplateSpec, sid: string, overrides: Partial<ContentTemplateSpec> = {}): ContentResource {
  return { ...spec, ...overrides, sid };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Twilio filing Content Template scripts", () => {
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

  describe("create-filing-templates", () => {
    it("creates all four templates when none exist yet", async () => {
      for (const spec of SPECS) {
        fetchMock
          .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
          .mockResolvedValueOnce(jsonResponse(resourceFrom(spec, `HXnew${spec.friendly_name}`.slice(0, 34).padEnd(34, "0")), 201));
      }

      await createMain();

      expect(process.exitCode).toBeUndefined();
      const output = loggedOutput();
      for (const envVar of ENV_VARS) {
        expect(output).toContain(envVar);
      }
    });

    it("reuses all four templates without any create request when they already match", async () => {
      for (const spec of SPECS) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ contents: [resourceFrom(spec, `HXexisting${spec.language}`.padEnd(34, "0"))], meta: { next_page_url: null } }),
        );
      }

      await createMain();

      expect(process.exitCode).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(4); // one list call per template, no creates
      expect(loggedOutput()).toContain("matches the repository specification");
    });

    it("reports a mismatch for one template without aborting the rest", async () => {
      const mismatched = resourceFrom(SPECS[0], "HXmismatch000000000000000000000000", {
        types: { "twilio/quick-reply": { body: "different", actions: [] } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [mismatched], meta: { next_page_url: null } }));
      for (const spec of SPECS.slice(1)) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ contents: [resourceFrom(spec, `HXok${spec.language}`.padEnd(34, "0"))], meta: { next_page_url: null } }),
        );
      }

      await createMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain(mismatched.sid);
      expect(output).toContain("_v2");
      // The other three were still processed and reported.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("never logs the Auth Token", async () => {
      for (const spec of SPECS) {
        fetchMock
          .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
          .mockResolvedValueOnce(jsonResponse(resourceFrom(spec, `HXnoauth${spec.language}`.padEnd(34, "0")), 201));
      }

      await createMain();

      expect(loggedOutput()).not.toContain("test-auth-token");
    });
  });

  describe("verify-filing-templates", () => {
    beforeEach(() => {
      process.env.TWILIO_FILING_DRAFT_CHOICE_SID_EN = "HXconfiguredA00000000000000000000";
      process.env.TWILIO_FILING_DRAFT_CHOICE_SID_ML = "HXconfiguredB00000000000000000000";
      process.env.TWILIO_FILING_NOTICE_SID_EN = "HXconfiguredC00000000000000000000";
      process.env.TWILIO_FILING_NOTICE_SID_ML = "HXconfiguredD00000000000000000000";
    });

    it("succeeds when all four configured SIDs match their specifications", async () => {
      const sids = [
        process.env.TWILIO_FILING_DRAFT_CHOICE_SID_EN!,
        process.env.TWILIO_FILING_DRAFT_CHOICE_SID_ML!,
        process.env.TWILIO_FILING_NOTICE_SID_EN!,
        process.env.TWILIO_FILING_NOTICE_SID_ML!,
      ];
      for (const [index, spec] of SPECS.entries()) {
        fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(spec, sids[index])));
      }

      await verifyMain();

      expect(process.exitCode).toBeUndefined();
      expect(loggedOutput()).toContain("This script never submits templates for WhatsApp approval.");
    });

    it("reports a missing SID for one template while still verifying the rest", async () => {
      delete process.env.TWILIO_FILING_NOTICE_SID_ML;
      const sids = [
        process.env.TWILIO_FILING_DRAFT_CHOICE_SID_EN!,
        process.env.TWILIO_FILING_DRAFT_CHOICE_SID_ML!,
        process.env.TWILIO_FILING_NOTICE_SID_EN!,
      ];
      for (const [index, spec] of SPECS.slice(0, 3).entries()) {
        fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(spec, sids[index])));
      }

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(3); // the missing one never attempted a fetch
      expect(loggedOutput()).toContain("TWILIO_FILING_NOTICE_SID_ML is not configured");
    });
  });
});
