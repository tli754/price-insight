import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "./helpers/build-app.js";

// ── HMAC helper ───────────────────────────────────────────────────────────────

function computeHmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("base64");
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SECRET = "fake-shopify-secret";
const WEBHOOK_ID = "webhook-abc-123";
const GID = "gid://shopify/Order/1000001051";
const ORDER_NAME = "#1051";
const UPDATED_AT = "2026-06-05T03:55:00Z";
const SHOP_DOMAIN = "example.myshopify.com";

const defaultBody = JSON.stringify({
  admin_graphql_api_id: GID,
  name: ORDER_NAME,
  updated_at: UPDATED_AT,
});

function makeHeaders(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": computeHmac(defaultBody, SECRET),
    "x-shopify-topic": "orders/updated",
    "x-shopify-webhook-id": WEBHOOK_ID,
    "x-shopify-shop-domain": SHOP_DOMAIN,
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /webhooks/shopify/orders", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];
  let mocks: Awaited<ReturnType<typeof buildTestApp>>["mocks"];

  beforeEach(async () => {
    ({ app, mocks } = await buildTestApp());
  });
  afterEach(() => app.close());

  // ── Secret not configured ─────────────────────────────────────────────────

  it("returns 503 when SHOPIFY_CLIENT_SECRET is not set", async () => {
    const { app: noSecretApp } = await buildTestApp({}, { SHOPIFY_CLIENT_SECRET: undefined });
    const res = await noSecretApp.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders(),
      payload: defaultBody,
    });
    await noSecretApp.close();
    expect(res.statusCode).toBe(503);
  });

  // ── HMAC verification ─────────────────────────────────────────────────────

  it("returns 401 when HMAC header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders({ "x-shopify-hmac-sha256": undefined }),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.cloudTasksClient?.enqueueSyncOrder).not.toHaveBeenCalled();
  });

  it("returns 401 when HMAC is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders({ "x-shopify-hmac-sha256": "aW52YWxpZA==" }),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.cloudTasksClient?.enqueueSyncOrder).not.toHaveBeenCalled();
  });

  // ── Topic filtering ───────────────────────────────────────────────────────

  it("returns 200 without enqueueing for unsupported topic", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders({ "x-shopify-topic": "orders/delete" }),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksClient?.enqueueSyncOrder).not.toHaveBeenCalled();
  });

  it.each(["orders/create", "orders/updated", "orders/paid", "orders/cancelled", "refunds/create"])(
    "returns 200 and enqueues for supported topic: %s",
    async (topic) => {
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/shopify/orders",
        headers: makeHeaders({ "x-shopify-topic": topic }),
        payload: defaultBody,
      });
      expect(res.statusCode).toBe(200);
      expect(mocks.cloudTasksClient?.enqueueSyncOrder).toHaveBeenCalledOnce();
    }
  );

  // ── Missing required fields ───────────────────────────────────────────────

  it("returns 400 when webhook ID header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders({ "x-shopify-webhook-id": undefined }),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when admin_graphql_api_id is missing", async () => {
    const body = JSON.stringify({ name: ORDER_NAME, updated_at: UPDATED_AT });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders({ "x-shopify-hmac-sha256": computeHmac(body, SECRET) }),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when updated_at is missing", async () => {
    const body = JSON.stringify({ admin_graphql_api_id: GID, name: ORDER_NAME });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders({ "x-shopify-hmac-sha256": computeHmac(body, SECRET) }),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when body is empty (HMAC fails)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders(),
      payload: "",
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns 200 and enqueues a Cloud Task with correct payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders(),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.cloudTasksClient?.enqueueSyncOrder).toHaveBeenCalledOnce();

    const [, data] = mocks.cloudTasksClient!.enqueueSyncOrder.mock.calls[0] as [string, Record<string, unknown>];
    expect(data.type).toBe("sync-order");
    expect(data.source).toBe("webhook");
    expect(data.webhookId).toBe(WEBHOOK_ID);
    expect(data.topic).toBe("orders/updated");
    expect(data.shopDomain).toBe(SHOP_DOMAIN);
    expect(data.shopifyOrderId).toBe(GID);
    expect(data.orderName).toBe(ORDER_NAME);
    expect(data.shopifyUpdatedAt).toBe(UPDATED_AT);
    expect(data).not.toHaveProperty("shopifyOrder");
  });

  // ── Cloud Tasks not configured ──────────────────────────────────────────

  it("returns 503 when Cloud Tasks is not configured", async () => {
    const { app: noTasksApp } = await buildTestApp({ cloudTasksClient: null });
    const res = await noTasksApp.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders(),
      payload: defaultBody,
    });
    await noTasksApp.close();
    expect(res.statusCode).toBe(503);
  });

  // ── Cloud Tasks enqueue failure ───────────────────────────────────────────

  it("returns 500 when Cloud Tasks enqueue fails", async () => {
    mocks.cloudTasksClient!.enqueueSyncOrder.mockRejectedValue(new Error("Cloud Tasks unavailable"));
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders(),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(500);
  });

  // ── No user session required ──────────────────────────────────────────────

  it("does not require a session cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      headers: makeHeaders(),
      payload: defaultBody,
    });
    expect(res.statusCode).toBe(200);
  });
});
