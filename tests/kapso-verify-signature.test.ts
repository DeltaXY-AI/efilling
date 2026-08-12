import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidKapsoSignature } from "../src/adapters/kapso/verify-signature";

const SECRET = "test-webhook-secret";

function sign(rawBody: Buffer, secret = SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

describe("isValidKapsoSignature", () => {
  it("accepts a signature computed over the exact raw body", () => {
    const rawBody = Buffer.from(JSON.stringify({ message: { id: "wamid.1" } }));
    expect(isValidKapsoSignature(SECRET, sign(rawBody), rawBody)).toBe(true);
  });

  it("rejects a missing signature without throwing", () => {
    const rawBody = Buffer.from(JSON.stringify({ message: { id: "wamid.1" } }));
    expect(isValidKapsoSignature(SECRET, undefined, rawBody)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = Buffer.from(JSON.stringify({ message: { id: "wamid.1" } }));
    expect(isValidKapsoSignature(SECRET, sign(rawBody, "wrong-secret"), rawBody)).toBe(false);
  });

  it("rejects a signature that does not match a re-serialized body (byte-exactness matters)", () => {
    const rawBody = Buffer.from('{"message":{"id":"wamid.1"}}');
    // Same logical content, different literal bytes (extra whitespace) —
    // must not validate, proving verification is over raw bytes, not a
    // reparsed/reserialized object.
    const differentBytes = Buffer.from('{"message": {"id": "wamid.1"}}');
    expect(isValidKapsoSignature(SECRET, sign(rawBody), differentBytes)).toBe(false);
  });

  it("rejects a malformed/short signature without throwing", () => {
    const rawBody = Buffer.from(JSON.stringify({ message: { id: "wamid.1" } }));
    expect(isValidKapsoSignature(SECRET, "not-a-real-signature", rawBody)).toBe(false);
  });
});
