import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DuplicateTemplatesError,
  TemplateMismatchError,
  createContentTemplate,
  ensureContentTemplate,
  getContentTemplate,
  listContentTemplates,
  loadTwilioCredentialsFromEnv,
  nextVersionSuggestion,
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
        { title: "English", id: "language:en" },
        { title: "മലയാളം", id: "language:ml" },
      ],
    },
  },
};

function resourceFrom(spec: ContentTemplateSpec, sid: string): ContentResource {
  return { ...spec, sid, url: `https://content.twilio.com/v1/Content/${sid}` };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

describe("nextVersionSuggestion", () => {
  it("increments an existing version suffix", () => {
    expect(nextVersionSuggestion("oncourts_language_selection_v1")).toBe("oncourts_language_selection_v2");
    expect(nextVersionSuggestion("oncourts_menu_v9")).toBe("oncourts_menu_v10");
  });

  it("appends _v2 when there is no version suffix", () => {
    expect(nextVersionSuggestion("oncourts_language_selection")).toBe("oncourts_language_selection_v2");
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

  it("never lets the Auth Token through even if Twilio's error response body echoes it back", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 20003,
          message: `Authentication failed for account ${CREDENTIALS.accountSid} using token ${CREDENTIALS.authToken}`,
          more_info: `https://twilio.com/docs/errors/20003?token=${CREDENTIALS.authToken}`,
          status: 401,
        }),
        { status: 401 },
      ),
    );

    const error = await createContentTemplate(CREDENTIALS, SPEC).catch((thrown: Error) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(CREDENTIALS.authToken);
    expect((error as Error).message).not.toContain(CREDENTIALS.accountSid);
    expect((error as Error).message).toContain("code=20003");
  });

  it("falls back to a generic message for an unrecognized/raw error body, even if it contains the token", async () => {
    fetchMock.mockResolvedValueOnce(new Response(`raw dump including ${CREDENTIALS.authToken}`, { status: 500 }));

    const error = await createContentTemplate(CREDENTIALS, SPEC).catch((thrown: Error) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(CREDENTIALS.authToken);
  });
});

describe("ensureContentTemplate", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a new template when none exists yet", async () => {
    const created = resourceFrom(SPEC, "HXnew00000000000000000000000000000");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ contents: [], meta: { next_page_url: null } }))
      .mockResolvedValueOnce(jsonResponse(created, 201));

    const result = await ensureContentTemplate(CREDENTIALS, SPEC);

    expect(result).toEqual({ outcome: "created", sid: created.sid });
  });

  it("reuses an identical existing template without a create request", async () => {
    const existing = resourceFrom(SPEC, "HXexisting0000000000000000000000");
    fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [existing], meta: { next_page_url: null } }));

    const result = await ensureContentTemplate(CREDENTIALS, SPEC);

    expect(result).toEqual({ outcome: "reused", sid: existing.sid });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws TemplateMismatchError for a same-name template with different content", async () => {
    const mismatched = resourceFrom(SPEC, "HXmismatch00000000000000000000000");
    mismatched.types = { "twilio/quick-reply": { body: "different", actions: [] } };
    fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [mismatched], meta: { next_page_url: null } }));

    const error = await ensureContentTemplate(CREDENTIALS, SPEC).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(TemplateMismatchError);
    expect((error as InstanceType<typeof TemplateMismatchError>).remoteSid).toBe(mismatched.sid);
    expect((error as InstanceType<typeof TemplateMismatchError>).differences.length).toBeGreaterThan(0);
  });

  it("throws DuplicateTemplatesError and creates nothing when duplicates exist", async () => {
    const dup1 = resourceFrom(SPEC, "HXdup100000000000000000000000000000");
    const dup2 = resourceFrom(SPEC, "HXdup200000000000000000000000000000");
    fetchMock.mockResolvedValueOnce(jsonResponse({ contents: [dup1, dup2], meta: { next_page_url: null } }));

    const error = await ensureContentTemplate(CREDENTIALS, SPEC).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(DuplicateTemplatesError);
    expect((error as InstanceType<typeof DuplicateTemplatesError>).sids).toEqual([dup1.sid, dup2.sid]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
