import { afterEach, describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/build-app.js";

describe("GET /api/health", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with status ok", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
