import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContentTemplate,
  diffTemplates,
  getContentTemplate,
  listContentTemplates,
  loadTwilioCredentialsFromEnv,
  templatesMatch,
  type ContentResource,
  type ContentTemplateSpec,
} from "../twilio/scripts/content-api-client";

const CREDENTIALS = { accountSid: "ACtest00000000000000000000000000", authToken: "test-auth-token" };

const SPEC: ContentTemplateSpec = {
  friendly_name: "oncourts_language_selection_v1",
  language: "en",
  types: {
    "twilio/quick-reply": {
      body: "Welcome",
      actions: [
        { type: "QUICK_REPLY", title: "English", id: "language:en" },
        { type: "QUICK_REPLY", title: "മലയാളം", id: "language:ml" },
      ],
    },
  },
};

function resourceFrom(spec: ContentTemplateSpec, sid: string): ContentResource {
  return { ...spec, sid, url: `https://content.twilio.com/v1/Content/${sid}` };
}

describe("loadTwilioCredentialsFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns the credentials when both variables are set", () => {
    process.env.TWILIO_ACCOUNT_SID = CREDENTIALS.accountSid;
    process.env.TWILIO_AUTH_TOKEN = CREDENTIALS.authToken;

    expect(loadTwilioCredentialsFromEnv()).toEqual(CREDENTIALS);
  });

  it("throws naming the missing variable, without ever including credential values", () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_AUTH_TOKEN = "some-token";

    expect(() => loadTwilioCredentialsFromEnv()).toThrow(/TWILIO_ACCOUNT_SID/);
  });
});

describe("templatesMatch / diffTemplates", () => {
  it("matches an identical template regardless of object key order", () => {
    const reordered: ContentTemplateSpec = {
      language: SPEC.language,
      types: SPEC.types,
      friendly_name: SPEC.friendly_name,
    };

    expect(templatesMatch(SPEC, reordered)).toBe(true);
    expect(diffTemplates(SPEC, reordered)).toEqual([]);
  });

  it("does not ignore whitespace differences in the body", () => {
    const withTrailingSpace: ContentTemplateSpec = {
      ...SPEC,
      types: { "twilio/quick-reply": { ...SPEC.types["twilio/quick-reply"], body: "Welcome " } },
    };

    expect(templatesMatch(SPEC, withTrailingSpace)).toBe(false);
  });

  it("treats a different action order as a mismatch", () => {
    const reorderedActions: ContentTemplateSpec = {
      ...SPEC,
      types: {
        "twilio/quick-reply": {
          body: SPEC.types["twilio/quick-reply"].body,
          actions: [...SPEC.types["twilio/quick-reply"].actions].reverse(),
        },
      },
    };

    expect(templatesMatch(SPEC, reorderedActions)).toBe(false);
    expect(diffTemplates(SPEC, reorderedActions).some((line) => line.includes("actions"))).toBe(true);
  });

  it("reports each differing top-level field", () => {
    const different: ContentTemplateSpec = { ...SPEC, friendly_name: "other_name", language: "ml" };

    const diff = diffTemplates(SPEC, different);
    expect(diff).toEqual(
      expect.arrayContaining([expect.stringContaining("friendly_name"), expect.stringContaining("language")]),
    );
  });
});

describe("Content API client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows pagination until the last page", async () => {
    const pageOne = resourceFrom(SPEC, "HXpageone00000000000000000000000");
    const pageTwo = resourceFrom(SPEC, "HXpagetwo00000000000000000000000");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ contents: [pageOne], meta: { next_page_url: "https://content.twilio.com/v1/Content?Page=2" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ contents: [pageTwo], meta: { next_page_url: null } })));

    const results = await listContentTemplates(CREDENTIALS);

    expect(results).toEqual([pageOne, pageTwo]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends Basic auth built from the account SID and auth token", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ contents: [], meta: { next_page_url: null } })));

    await listContentTemplates(CREDENTIALS);

    const [, options] = fetchMock.mock.calls[0];
    const expected = `Basic ${Buffer.from(`${CREDENTIALS.accountSid}:${CREDENTIALS.authToken}`).toString("base64")}`;
    expect(options.headers.Authorization).toBe(expected);
  });

  it("returns null for a 404 when fetching a single template", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));

    await expect(getContentTemplate(CREDENTIALS, "HXmissing0000000000000000000000")).resolves.toBeNull();
  });

  it("returns the resource when it exists", async () => {
    const resource = resourceFrom(SPEC, "HXexisting000000000000000000000");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(resource)));

    await expect(getContentTemplate(CREDENTIALS, resource.sid)).resolves.toEqual(resource);
  });

  it("posts the spec as JSON when creating a template", async () => {
    const created = resourceFrom(SPEC, "HXcreated00000000000000000000000");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));

    const result = await createContentTemplate(CREDENTIALS, SPEC);

    expect(result).toEqual(created);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://content.twilio.com/v1/Content");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual(SPEC);
  });

  it("throws a descriptive, credential-free error on a failed request", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server exploded", { status: 500 }));

    await expect(createContentTemplate(CREDENTIALS, SPEC)).rejects.toThrow(/HTTP 500/);
  });
});
