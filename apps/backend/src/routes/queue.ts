import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";

const STATES = ["waiting", "active", "failed", "delayed", "completed"] as const;

const queueRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/shopify/orders/queue", async () => {
    if (!fastify.orderSyncQueue) {
      throw new AppError(503, "QUEUE_NOT_CONFIGURED", "Order sync queue is not available.");
    }

    const queue = fastify.orderSyncQueue;

    const [counts, waiting, active, failed, delayed, completed] = await Promise.all([
      queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused"),
      queue.getJobs(["waiting"], 0, 50),
      queue.getJobs(["active"], 0, 50),
      queue.getJobs(["failed"], 0, 50),
      queue.getJobs(["delayed"], 0, 50),
      queue.getJobs(["completed"], 0, 50),
    ]);

    const buckets = [
      { state: "waiting", jobs: waiting },
      { state: "active", jobs: active },
      { state: "failed", jobs: failed },
      { state: "delayed", jobs: delayed },
      { state: "completed", jobs: completed },
    ] as const;

    const jobs = buckets.flatMap(({ state, jobs: bucket }) =>
      bucket.map((job) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        state,
        attemptsMade: job.attemptsMade,
        maxAttempts: (job.opts.attempts as number | undefined) ?? 1,
        createdAt: new Date(job.timestamp).toISOString(),
        processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        failedReason: job.failedReason ?? null,
      }))
    );

    return {
      queueName: "shopify-order-sync",
      lastRefreshedAt: new Date().toISOString(),
      counts,
      jobs,
    };
  });

  fastify.post("/shopify/orders/queue/clean", async () => {
    if (!fastify.orderSyncQueue) {
      throw new AppError(503, "QUEUE_NOT_CONFIGURED", "Order sync queue is not available.");
    }

    const queue = fastify.orderSyncQueue;
    const [completed, failed, delayed] = await Promise.all([
      queue.clean(0, 10000, "completed"),
      queue.clean(0, 10000, "failed"),
      queue.clean(0, 10000, "delayed"),
    ]);

    return {
      removed: {
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      },
    };
  });
};

export default queueRoutes;
