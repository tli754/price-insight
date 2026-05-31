/**
 * Tests for buildApp() wiring in src/app.ts.
 *
 * vi.mock() intercepts createDatabase before buildApp() runs,
 * so no real MySQL connection is ever opened.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({ createDatabase: vi.fn() }));

import { buildApp } from "../app.js";
import { createDatabase } from "../db/index.js";
import { fakeEnv } from "./helpers/build-app.js";
import { makeMockDb } from "./helpers/mock-db.js";

const mockPool = { end: vi.fn().mockResolvedValue(undefined) };

describe("buildApp()", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    mockDb = makeMockDb();
    vi.mocked(createDatabase).mockReturnValue({ db: mockDb as any, pool: mockPool as any });
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it("boots and shuts down without throwing", async () => {
    const app = await buildApp(fakeEnv);
    await app.close();

    expect(mockPool.end).toHaveBeenCalledOnce();
  });

  it("registers the health route at /api/health", async () => {
    const app = await buildApp(fakeEnv);
    const response = await app.inject({ method: "GET", url: "/api/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("registers product routes (GET /api/products responds)", async () => {
    mockDb._select.orderBy.mockResolvedValueOnce([]);
    const app = await buildApp(fakeEnv);
    const response = await app.inject({ method: "GET", url: "/api/products" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it("error handler formats AppError with the correct HTTP status and code", async () => {
    const app = await buildApp(fakeEnv);
    const response = await app.inject({ method: "GET", url: "/api/products/abc" });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_PRODUCT_ID" } });
  });

  it("error handler formats Zod failures as 400 VALIDATION_ERROR", async () => {
    const app = await buildApp(fakeEnv);
    const response = await app.inject({
      method: "POST",
      url: "/api/products/import",
      payload: { products: "not-an-array" }
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("error handler returns 500 INTERNAL_SERVER_ERROR for unexpected throws", async () => {
    mockDb._select.orderBy.mockRejectedValueOnce(new Error("DB connection lost"));
    const app = await buildApp(fakeEnv);
    const response = await app.inject({ method: "GET", url: "/api/products" });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "INTERNAL_SERVER_ERROR" } });
  });
});
