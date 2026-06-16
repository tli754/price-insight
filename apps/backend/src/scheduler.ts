import { schedule, type ScheduledTask } from "node-cron";

import { getLast24Hours } from "./lib/nz-date-range.js";
import type { OrderSyncJobData, SyncOrderJobData } from "./services/order-sync-queue.js";
import type { ShopifyGraphQLService } from "./services/shopify-graphql-service.js";
import type { ShopifyService } from "./services/shopify-service.js";
import type { Queue } from "bullmq";

/**
 * Starts the 2:00 AM NZST scheduled order discovery using node-cron.
 * 14:00 UTC = 2:00 AM NZST (UTC+12). In NZDT (UTC+13, Oct–Apr) this fires at 3:00 AM NZT.
 * Fetches orders updated in the last 24 hours and enqueues one sync-order job per order.
 * Returns the ScheduledTask so the caller can stop it on shutdown.
 */
export function setupScheduler(
  queue: Queue<OrderSyncJobData>,
  shopifyService: ShopifyService,
  shopifyGraphQLService: ShopifyGraphQLService
): ScheduledTask {
  return schedule("0 14 * * *", async () => {
    try {
      const from = getLast24Hours();
      const filter = `updated_at:>${from.toISOString()}`;
      const accessToken = await shopifyService.getAccessToken();
      const orders = await shopifyGraphQLService.fetchOrders(accessToken, filter);

      for (const order of orders) {
        const jobData: SyncOrderJobData = {
          type: "sync-order",
          source: "scheduled_2am",
          shopifyOrderId: order.id,
          orderName: order.name,
          shopifyUpdatedAt: order.updatedAt,
          shopifyOrder: order,
        };
        await queue.add("sync-order", jobData);
      }

      console.info(`[scheduler] Scheduled discovery complete: ${orders.length} orders enqueued.`);
    } catch (err) {
      console.error("[scheduler] Scheduled discovery failed:", err);
    }
  });
}
