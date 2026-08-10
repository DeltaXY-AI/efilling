import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index";

describe("GET /health", () => {
  it("returns 200 with the documented status payload", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "efilling-whatsapp",
    });
    expect(typeof response.body.timestamp).toBe("string");
    expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
  });
});
