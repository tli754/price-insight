import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node-cron before importing scheduler so we can capture the callback.
vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

import { schedule } from "node-cron";
import { setupScheduler } from "../scheduler.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

function makeShopifyService() {
  return { getAccessToken: vi.fn().mockResolvedValue("fake-token") };
}

function makeShopifyGraphQLService() {
  return { fetchOrders: vi.fn().mockResolvedValue([]) };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Order/1001",
    name: "#WD1001",
    updatedAt: "2026-06-13T10:00:00Z",
    email: null,
    createdAt: "2026-06-13T09:00:00Z",
    processedAt: null,
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    currencyCode: "NZD",
    tags: [],
    sourceName: "web",
    subtotalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "NZD" } },
    totalDiscountsSet: { shopMoney: { amount: "0.00", currencyCode: "NZD" } },
    totalShippingPriceSet: { shopMoney: { amount: "10.00", currencyCode: "NZD" } },
    totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "NZD" } },
    totalPriceSet: { shopMoney: { amount: "110.00", currencyCode: "NZD" } },
    customer: null,
    lineItems: { nodes: [] },
    ...overrides,
  };
}

// Calls setupScheduler and returns the captured cron callback for direct invocation.
function captureCallback(
  queue: ReturnType<typeof makeQueue>,
  shopifyService: ReturnType<typeof makeShopifyService>,
  shopifyGraphQLService: ReturnType<typeof makeShopifyGraphQLService>
): () => Promise<void> {
  setupScheduler(queue as any, shopifyService as any, shopifyGraphQLService as any);
  const calls = vi.mocked(schedule).mock.calls;
  const lastCall = calls[calls.length - 1];
  return lastCall[1] as () => Promise<void>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("setupScheduler", () => {
  beforeEach(() => {
    vi.mocked(schedule).mockClear();
  });

  it("registers cron at 0 14 * * * (2am NZST)", () => {
    const queue = makeQueue();
    setupScheduler(queue as any, makeShopifyService() as any, makeShopifyGraphQLService() as any);
    expect(vi.mocked(schedule)).toHaveBeenCalledOnce();
    expect(vi.mocked(schedule).mock.calls[0][0]).toBe("0 14 * * *");
  });

  it("fetches orders with a 24-hour filter and enqueues one job per order", async () => {
    const queue = makeQueue();
    const shopifyService = makeShopifyService();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    const order = makeOrder();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([order]);

    const before = new Date();
    const callback = captureCallback(queue, shopifyService, shopifyGraphQLService);
    await callback();
    const after = new Date();

    expect(shopifyService.getAccessToken).toHaveBeenCalledOnce();

    const [, filter] = shopifyGraphQLService.fetchOrders.mock.calls[0] as [string, string];
    const match = filter.match(/updated_at:>(.+)/);
    expect(match).not.toBeNull();
    const filterDate = new Date(match![1]);
    const expectedEarliest = new Date(before.getTime() - 24 * 60 * 60 * 1000 - 100);
    const expectedLatest = new Date(after.getTime() - 24 * 60 * 60 * 1000 + 100);
    expect(filterDate.getTime()).toBeGreaterThanOrEqual(expectedEarliest.getTime());
    expect(filterDate.getTime()).toBeLessThanOrEqual(expectedLatest.getTime());

    expect(queue.add).toHaveBeenCalledOnce();
    const [jobName, jobData] = queue.add.mock.calls[0] as [string, Record<string, unknown>];
    expect(jobName).toBe("sync-order");
    expect(jobData.type).toBe("sync-order");
    expect(jobData.source).toBe("scheduled_2am");
    expect(jobData.shopifyOrderId).toBe(order.id);
    expect(jobData.orderName).toBe(order.name);
    expect(jobData.shopifyUpdatedAt).toBe(order.updatedAt);
    expect(jobData.shopifyOrder).toEqual(order);
  });

  it("enqueues nothing when fetchOrders returns empty", async () => {
    const queue = makeQueue();
    const callback = captureCallback(queue, makeShopifyService(), makeShopifyGraphQLService());
    await callback();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("enqueues one job per order for multiple orders", async () => {
    const queue = makeQueue();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrders.mockResolvedValue([
      makeOrder({ id: "gid://shopify/Order/1001", name: "#WD1001" }),
      makeOrder({ id: "gid://shopify/Order/1002", name: "#WD1002" }),
      makeOrder({ id: "gid://shopify/Order/1003", name: "#WD1003" }),
    ]);
    const callback = captureCallback(queue, makeShopifyService(), shopifyGraphQLService);
    await callback();
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  it("does not throw when fetchOrders rejects", async () => {
    const queue = makeQueue();
    const shopifyGraphQLService = makeShopifyGraphQLService();
    shopifyGraphQLService.fetchOrders.mockRejectedValue(new Error("Shopify down"));
    const callback = captureCallback(queue, makeShopifyService(), shopifyGraphQLService);
    await expect(callback()).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("does not throw when getAccessToken rejects", async () => {
    const queue = makeQueue();
    const shopifyService = makeShopifyService();
    shopifyService.getAccessToken.mockRejectedValue(new Error("Auth failed"));
    const callback = captureCallback(queue, shopifyService, makeShopifyGraphQLService());
    await expect(callback()).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
