import type { Queue } from "bullmq";

import type { DiscoverOrdersJobData, OrderSyncJobData } from "./services/order-sync-queue.js";

/**
 * Registers the 2:00 AM NZST scheduled discovery job as a BullMQ repeatable.
 * 14:00 UTC = 2:00 AM NZST (UTC+12). In NZDT (UTC+13, Oct–Apr) this fires at
 * 3:00 AM NZT — acceptable for MVP.
 * BullMQ deduplicates by name + pattern, so calling this on every startup is safe.
 */
export async function setupScheduler(queue: Queue<OrderSyncJobData>): Promise<void> {
  const payload: DiscoverOrdersJobData = { type: "discover-orders", source: "scheduled_2am" };
  await queue.add("scheduled-discovery", payload, {
    repeat: { pattern: "0 14 * * *" },
    jobId: "scheduled-2am-discovery",
  });
}
