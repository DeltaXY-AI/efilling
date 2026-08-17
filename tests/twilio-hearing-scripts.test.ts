import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main as createMain } from "../twilio/scripts/create-hearing-templates";
import { main as verifyMain } from "../twilio/scripts/verify-hearing-templates";
import type { ContentResource, ContentTemplateSpec } from "../twilio/scripts/content-api-client";

const FILE_NAMES = ["hearing-reminder-actions.en.json", "hearing-reminder-actions.ml.json"];
const ENV_VARS = ["TWILIO_HEARING_REMINDER_ACTIONS_SID_EN", "TWILIO_HEARING_REMINDER_ACTIONS_SID_ML"];

const SPECS: ContentTemplateSpec[] = FILE_NAMES.map(
  (fileName) => JSON.parse(readFileSync(join(__dirname, "..", "twilio", "templates", fileName), "utf8")) as ContentTemplateSpec,
);

function resourceFrom(spec: ContentTemplateSpec, sid: string, overrides: Partial<ContentTemplateSpec> = {}): ContentResource {
  return { ...spec, ...overrides, sid };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Twilio hearing Content Template scripts (#38)", () => {
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

  describe("create-hearing-templates", () => {
    it("creates both templates when none exist yet", async () => {
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
      expect(output).toContain("must be submitted for and receive WhatsApp approval");
    });

    it("reuses both templates without any create request when they already match", async () => {
      for (const spec of SPECS) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ contents: [resourceFrom(spec, `HXexisting${spec.friendly_name}`.slice(0, 34).padEnd(34, "0"))], meta: { next_page_url: null } }),
        );
      }

      await createMain();

      expect(process.exitCode).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(SPECS.length);
      expect(loggedOutput()).toContain("matches the repository specification");
    });

    it("reports a mismatch for one template without aborting the rest", async () => {
      const mismatched = resourceFrom(SPECS[0], "HXmismatch000000000000000000000000", {
        types: { "twilio/quick-reply": { body: "different", actions: [] } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [mismatched], meta: { next_page_url: null } }));
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ contents: [resourceFrom(SPECS[1], `HXok${SPECS[1].friendly_name}`.slice(0, 34).padEnd(34, "0"))], meta: { next_page_url: null } }),
      );

      await createMain();

      expect(process.exitCode).toBe(1);
      const output = loggedOutput();
      expect(output).toContain(mismatched.sid);
      expect(output).toContain("_v2");
      expect(fetchMock).toHaveBeenCalledTimes(SPECS.length);
    });

    it("never logs the Auth Token", async () => {
      for (const spec of SPECS) {
        fetchMock
          .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
          .mockResolvedValueOnce(jsonResponse(resourceFrom(spec, `HXnoauth${spec.friendly_name}`.slice(0, 34).padEnd(34, "0")), 201));
      }

      await createMain();

      expect(loggedOutput()).not.toContain("test-auth-token");
    });

    it("never submits any template for WhatsApp approval — the create call is a plain POST, never an approval endpoint", async () => {
      for (const spec of SPECS) {
        fetchMock
          .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
          .mockResolvedValueOnce(jsonResponse(resourceFrom(spec, `HXapproval${spec.friendly_name}`.slice(0, 34).padEnd(34, "0")), 201));
      }

      await createMain();

      for (const call of fetchMock.mock.calls) {
        expect(String(call[0])).not.toContain("/ApprovalRequests");
      }
    });
  });

  describe("verify-hearing-templates", () => {
    beforeEach(() => {
      for (const [index, envVar] of ENV_VARS.entries()) {
        process.env[envVar] = `HXconfigured${index}`.padEnd(34, "0");
      }
    });

    it("succeeds when both configured SIDs match their specifications", async () => {
      for (const [index, spec] of SPECS.entries()) {
        fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(spec, process.env[ENV_VARS[index]]!)));
      }

      await verifyMain();

      expect(process.exitCode).toBeUndefined();
      expect(loggedOutput()).toContain("This script never submits templates for WhatsApp approval, and never checks approval status");
    });

    it("reports a missing SID for one template while still verifying the rest", async () => {
      delete process.env[ENV_VARS[ENV_VARS.length - 1]];
      fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(SPECS[0], process.env[ENV_VARS[0]]!)));

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(loggedOutput()).toContain(`${ENV_VARS[ENV_VARS.length - 1]} is not configured`);
    });

    it("reports a mismatch against the remote template without aborting the rest", async () => {
      const mismatched = resourceFrom(SPECS[0], process.env[ENV_VARS[0]]!, {
        types: { "twilio/quick-reply": { body: "different body", actions: [] } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse(mismatched));
      fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(SPECS[1], process.env[ENV_VARS[1]]!)));

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(loggedOutput()).toContain("does not match the repository specification");
    });
  });
});
