import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main as createMain } from "../twilio/scripts/create-filing-details-templates";
import { main as verifyMain } from "../twilio/scripts/verify-filing-details-templates";
import type { ContentResource, ContentTemplateSpec } from "../twilio/scripts/content-api-client";

const FILE_NAMES = [
  "filing-return-reason.en.json",
  "filing-return-reason.ml.json",
  "filing-part-payment.en.json",
  "filing-part-payment.ml.json",
  "filing-witness.en.json",
  "filing-witness.ml.json",
  "filing-court.en.json",
  "filing-court.ml.json",
  "filing-review-actions.en.json",
  "filing-review-actions.ml.json",
  "filing-edit-group.en.json",
  "filing-edit-group.ml.json",
  "filing-edit-cheque-field.en.json",
  "filing-edit-cheque-field.ml.json",
  "filing-edit-narrative-field.en.json",
  "filing-edit-narrative-field.ml.json",
  "filing-declare.en.json",
  "filing-declare.ml.json",
];
const ENV_VARS = [
  "TWILIO_FILING_RETURN_REASON_SID_EN",
  "TWILIO_FILING_RETURN_REASON_SID_ML",
  "TWILIO_FILING_PART_PAYMENT_SID_EN",
  "TWILIO_FILING_PART_PAYMENT_SID_ML",
  "TWILIO_FILING_WITNESS_SID_EN",
  "TWILIO_FILING_WITNESS_SID_ML",
  "TWILIO_FILING_COURT_SID_EN",
  "TWILIO_FILING_COURT_SID_ML",
  "TWILIO_FILING_REVIEW_ACTIONS_SID_EN",
  "TWILIO_FILING_REVIEW_ACTIONS_SID_ML",
  "TWILIO_FILING_EDIT_GROUP_SID_EN",
  "TWILIO_FILING_EDIT_GROUP_SID_ML",
  "TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_EN",
  "TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_ML",
  "TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_EN",
  "TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_ML",
  "TWILIO_FILING_DECLARE_SID_EN",
  "TWILIO_FILING_DECLARE_SID_ML",
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

describe("Twilio filing-details Content Template scripts (#33 Parts C/D/F)", () => {
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

  describe("create-filing-details-templates", () => {
    it("creates all 18 templates when none exist yet", async () => {
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

    it("reuses all 18 templates without any create request when they already match", async () => {
      for (const spec of SPECS) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ contents: [resourceFrom(spec, `HXexisting${spec.friendly_name}`.slice(0, 34).padEnd(34, "0"))], meta: { next_page_url: null } }),
        );
      }

      await createMain();

      expect(process.exitCode).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(SPECS.length); // one list call per template, no creates
      expect(loggedOutput()).toContain("matches the repository specification");
    });

    it("reports a mismatch for one template without aborting the rest", async () => {
      const mismatched = resourceFrom(SPECS[0], "HXmismatch000000000000000000000000", {
        types: { "twilio/list-picker": { body: "different", button: "x", items: [], multiple_selection: null } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [mismatched], meta: { next_page_url: null } }));
      for (const spec of SPECS.slice(1)) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ contents: [resourceFrom(spec, `HXok${spec.friendly_name}`.slice(0, 34).padEnd(34, "0"))], meta: { next_page_url: null } }),
        );
      }

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

  describe("verify-filing-details-templates", () => {
    beforeEach(() => {
      for (const [index, envVar] of ENV_VARS.entries()) {
        process.env[envVar] = `HXconfigured${index}`.padEnd(34, "0");
      }
    });

    it("succeeds when all 18 configured SIDs match their specifications", async () => {
      for (const [index, spec] of SPECS.entries()) {
        fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(spec, process.env[ENV_VARS[index]]!)));
      }

      await verifyMain();

      expect(process.exitCode).toBeUndefined();
      expect(loggedOutput()).toContain("This script never submits templates for WhatsApp approval.");
    });

    it("reports a missing SID for one template while still verifying the rest", async () => {
      delete process.env[ENV_VARS[ENV_VARS.length - 1]];
      for (const [index, spec] of SPECS.slice(0, -1).entries()) {
        fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(spec, process.env[ENV_VARS[index]]!)));
      }

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(SPECS.length - 1); // the missing one never attempted a fetch
      expect(loggedOutput()).toContain(`${ENV_VARS[ENV_VARS.length - 1]} is not configured`);
    });

    it("reports a mismatch against the remote template without aborting the rest", async () => {
      const mismatched = resourceFrom(SPECS[0], process.env[ENV_VARS[0]]!, {
        types: { "twilio/list-picker": { body: "different body", button: "x", items: [], multiple_selection: null } },
      });
      fetchMock.mockResolvedValueOnce(jsonResponse(mismatched));
      for (const [index, spec] of SPECS.slice(1).entries()) {
        fetchMock.mockResolvedValueOnce(jsonResponse(resourceFrom(spec, process.env[ENV_VARS[index + 1]]!)));
      }

      await verifyMain();

      expect(process.exitCode).toBe(1);
      expect(loggedOutput()).toContain("does not match the repository specification");
    });
  });
});
