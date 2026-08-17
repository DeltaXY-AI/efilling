import Anthropic from "@anthropic-ai/sdk";

/**
 * Reads one document photo/PDF and returns a structured field extraction
 * (#40, document auto-extraction) — the one place in this codebase that
 * sends file bytes to a third-party AI service. Behind an interface
 * (mirroring `TwilioMessagingClient`/`BlobStorage`) so document-extraction.ts
 * depends on a contract, not the `@anthropic-ai/sdk` SDK directly, and tests
 * can inject a fake instead of calling Anthropic.
 */
export interface VisionExtractionInput {
  imageBuffer: Buffer;
  /** One of this app's own allowed upload types (image/jpeg, image/png, application/pdf) — never anything wider. */
  contentType: string;
  systemPrompt: string;
  /** Forces the model's reply through this exact tool call, so the result is always structured JSON, never prose to parse. */
  toolName: string;
  toolSchema: Record<string, unknown>;
}

export interface VisionClient {
  /**
   * Returns the tool call's input object, or `null` for any failure at
   * all — timeout, API error, an unreadable/blank image, or a response that
   * didn't come back as the forced tool call. Never throws: every caller in
   * this codebase treats extraction as best-effort, so a failure here must
   * degrade silently to "nothing was read," never break document upload.
   */
  extractStructured(input: VisionExtractionInput): Promise<Record<string, unknown> | null>;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TOKENS = 1024;

const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png"]);

export function createAnthropicVisionClient(apiKey: string, baseURL?: string, model?: string): VisionClient {
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const modelId = model ?? DEFAULT_MODEL;

  return {
    async extractStructured({ imageBuffer, contentType, systemPrompt, toolName, toolSchema }) {
      try {
        const base64 = imageBuffer.toString("base64");
        // Cheque/memo/notice groups accept photos (JPEG/PNG) or a scanned
        // PDF (see domain/filing-document.ts's ALLOWED_CONTENT_TYPES) — the
        // Anthropic API takes those as two different content-block shapes.
        const documentBlock = IMAGE_MEDIA_TYPES.has(contentType)
          ? { type: "image" as const, source: { type: "base64" as const, media_type: contentType as "image/jpeg" | "image/png", data: base64 } }
          : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } };

        const response = await client.messages.create(
          {
            model: modelId,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            tools: [{ name: toolName, description: "Records the fields extracted from the document.", input_schema: toolSchema as Anthropic.Tool.InputSchema }],
            tool_choice: { type: "tool", name: toolName },
            messages: [
              {
                role: "user",
                content: [documentBlock, { type: "text", text: "Read this document and extract the requested fields." }],
              },
            ],
          },
          { timeout: REQUEST_TIMEOUT_MS },
        );

        const toolUse = response.content.find((block) => block.type === "tool_use" && block.name === toolName);
        if (!toolUse || toolUse.type !== "tool_use" || typeof toolUse.input !== "object" || toolUse.input === null) {
          return null;
        }
        return toolUse.input as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}
