import { afterEach, describe, it, expect } from "vitest";

import { buildTestApp, makeOrderSyncQueue } from "./helpers/build-app.js";

describe("GET /api/shopify/orders/queue", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 503 when queue is not configured", async () => {
    ({ app } = await buildTestApp({ orderSyncQueue: null as any }));
    const res = await app.inject({ method: "GET", url: "/api/shopify/orders/queue" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("QUEUE_NOT_CONFIGURED");
  });

  it("returns queue counts and empty jobs when queue has no jobs", async () => {
    const orderSyncQueue = makeOrderSyncQueue();
    ({ app } = await buildTestApp({ orderSyncQueue }));

    const res = await app.inject({ method: "GET", url: "/api/shopify/orders/queue" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.queueName).toBe("shopify-order-sync");
    expect(body.lastRefreshedAt).toBeTruthy();
    expect(body.counts).toMatchObject({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 });
    expect(body.jobs).toEqual([]);
  });

  it("maps job fields to the expected shape", async () => {
    const orderSyncQueue = makeOrderSyncQueue();
    const mockJob = {
      id: "job-1",
      name: "sync-order",
      data: { type: "sync-order", source: "manual", shopifyOrderId: "gid://shopify/Order/1001", orderName: "#WD1001", shopifyUpdatedAt: "2026-06-06T01:00:00Z" },
      timestamp: new Date("2026-06-06T01:00:00Z").getTime(),
      processedOn: new Date("2026-06-06T01:00:05Z").getTime(),
      finishedOn: new Date("2026-06-06T01:00:06Z").getTime(),
      attemptsMade: 1,
      opts: { attempts: 3 },
      failedReason: null,
    };
    orderSyncQueue.getJobs.mockImplementation(async (states: string[]) =>
      states[0] === "completed" ? [mockJob] : []
    );
    ({ app } = await buildTestApp({ orderSyncQueue }));

    const res = await app.inject({ method: "GET", url: "/api/shopify/orders/queue" });

    expect(res.statusCode).toBe(200);
    const [job] = res.json().jobs;
    expect(job.id).toBe("job-1");
    expect(job.name).toBe("sync-order");
    expect(job.state).toBe("completed");
    expect(job.attemptsMade).toBe(1);
    expect(job.maxAttempts).toBe(3);
    expect(job.createdAt).toBe("2026-06-06T01:00:00.000Z");
    expect(job.processedAt).toBe("2026-06-06T01:00:05.000Z");
    expect(job.finishedAt).toBe("2026-06-06T01:00:06.000Z");
    expect(job.failedReason).toBeNull();
    expect(job.data.orderName).toBe("#WD1001");
  });

  it("includes failedReason for failed jobs", async () => {
    const orderSyncQueue = makeOrderSyncQueue();
    const mockJob = {
      id: "job-2",
      name: "sync-order",
      data: { type: "sync-order", source: "manual", shopifyOrderId: "gid://shopify/Order/1002", orderName: "#WD1002", shopifyUpdatedAt: "2026-06-06T01:00:00Z" },
      timestamp: new Date("2026-06-06T01:00:00Z").getTime(),
      processedOn: null,
      finishedOn: null,
      attemptsMade: 3,
      opts: { attempts: 3 },
      failedReason: "Shopify API timeout",
    };
    orderSyncQueue.getJobs.mockImplementation(async (states: string[]) =>
      states[0] === "failed" ? [mockJob] : []
    );
    ({ app } = await buildTestApp({ orderSyncQueue }));

    const res = await app.inject({ method: "GET", url: "/api/shopify/orders/queue" });
    const [job] = res.json().jobs;
    expect(job.state).toBe("failed");
    expect(job.failedReason).toBe("Shopify API timeout");
    expect(job.processedAt).toBeNull();
    expect(job.finishedAt).toBeNull();
  });
});
