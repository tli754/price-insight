import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildTestApp } from "./helpers/build-app.js";

// ── URL helpers ───────────────────────────────────────────────────────────────

const SECRET = "fake-webhook-secret";

function shoppingUrl(overrides: Record<string, string> = {}): string {
  const p = new URLSearchParams({ secret: SECRET, id: "task-1", tag: "1", ...overrides });
  return `/webhooks/dataforseo/pingback/shopping?${p}`;
}

function infoUrl(overrides: Record<string, string> = {}): string {
  const p = new URLSearchParams({ secret: SECRET, id: "task-1", tag: "1", ...overrides });
  return `/webhooks/dataforseo/pingback/product_info?${p}`;
}

// ── Shopping pingback ─────────────────────────────────────────────────────────

describe("GET /webhooks/dataforseo/pingback/shopping", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(async () => {
    ({ app, mocks } = await buildTestApp());
  });
  afterEach(() => app.close());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when secret is wrong", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ secret: "WRONG" }) });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when secret is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/dataforseo/pingback/shopping?id=task-1&tag=1"
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 200 and skips when taskId is missing", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ id: "" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is not a number", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "abc" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is zero", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "0" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when productId is negative", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ tag: "-5" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).not.toHaveBeenCalled();
  });

  // ── Enqueue path ──────────────────────────────────────────────────────────

  it("enqueues a process-shopping-pingback message and returns 200", async () => {
    const res = await app.inject({ method: "GET", url: shoppingUrl({ id: "task-42", tag: "7" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).toHaveBeenCalledWith("dataforseo_competitors", {
      type: "process-shopping-pingback",
      taskId: "task-42",
      productId: 7,
    });
    expect(mocks.dataForSeoService.fetchShoppingTaskResult).not.toHaveBeenCalled();
  });
});

// ── Product info pingback ─────────────────────────────────────────────────────

describe("GET /webhooks/dataforseo/pingback/product_info", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(async () => {
    ({ app, mocks } = await buildTestApp());
  });
  afterEach(() => app.close());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when secret is wrong", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ secret: "WRONG" }) });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when secret is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/dataforseo/pingback/product_info?id=task-1&tag=1"
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 200 and skips when productId is invalid", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ tag: "not-a-number" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).not.toHaveBeenCalled();
  });

  it("returns 200 and skips when taskId is missing", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ id: "" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).not.toHaveBeenCalled();
  });

  // ── Enqueue path ──────────────────────────────────────────────────────────

  it("enqueues a process-product-info-pingback message and returns 200", async () => {
    const res = await app.inject({ method: "GET", url: infoUrl({ id: "task-99", tag: "5" }) });
    expect(res.statusCode).toBe(200);
    expect(mocks.pgmqClient.send).toHaveBeenCalledWith("dataforseo_competitors", {
      type: "process-product-info-pingback",
      taskId: "task-99",
      productId: 5,
    });
    expect(mocks.dataForSeoService.fetchProductInfoTaskResult).not.toHaveBeenCalled();
  });
});
