/**
 * Tests for buildApp() wiring in src/app.ts.
 *
 * vi.mock() intercepts createDatabase and createRedis before buildApp() runs,
 * so no real MySQL or Redis connection is ever opened.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Must be declared before importing the module under test.
// Vitest hoists vi.mock() calls to the top of the file automatically.
vi.mock("../db/index.js", () => ({ createDatabase: vi.fn() }));
vi.mock("../services/cache.js", () => ({
  createRedis: vi.fn(),
  getJson: vi.fn().mockResolvedValue(null),
  setJson: vi.fn().mockResolvedValue(undefined)
}));

import { buildApp } from "../app.js";
import { createDatabase } from "../db/index.js";
import { createRedis } from "../services/cache.js";
import { fakeEnv } from "./helpers/build-app.js";
import { makeMockDb } from "./helpers/mock-db.js";

const mockPool = { end: vi.fn().mockResolvedValue(undefined) };

function makeMockRedis() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue("PONG")
  };
}

describe("buildApp()", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockRedis: ReturnType<typeof makeMockRedis>;

  beforeEach(() => {
    mockDb = makeMockDb();
    mockRedis = makeMockRedis();
    vi.mocked(createDatabase).mockReturnValue({ db: mockDb as any, pool: mockPool as any });
    vi.mocked(createRedis).mockReturnValue(mockRedis as any);
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it("boots and shuts down without throwing", async () => {
    const app = await buildApp(fakeEnv);
    await app.close();

    expect(mockRedis.connect).toHaveBeenCalledOnce();
    expect(mockRedis.quit).toHaveBeenCalledOnce();
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
    // parseProductId("abc") throws AppError(400, "INVALID_PRODUCT_ID", ...)
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
