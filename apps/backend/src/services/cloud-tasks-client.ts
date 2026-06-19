import { CloudTasksClient } from "@google-cloud/tasks";

import type { SyncOrderPayload } from "../lib/sync-order-payload.js";

/**
 * Creates Cloud Tasks targeting order-worker's /internal/sync-order, each
 * carrying an OIDC token so order-worker can verify the caller. The target
 * base URL is a per-call argument rather than fixed at construction — the
 * backend always targets order-worker's URL (a static env var), but
 * order-worker's own scheduled-discovery handler targets itself, derived
 * from the incoming request (avoids order-worker referencing its own
 * Terraform-computed .uri, which would be a self-reference cycle).
 *
 * Task-level dedup (BullMQ's jobId) is intentionally not replicated —
 * replaced by the BullMQ Queue.add(...) call; the real idempotency guard is
 * the getShopifyOrderUpdatedAt staleness check in the order-worker handler.
 */
export class CloudTasksOrderSyncClient {
  private readonly client: CloudTasksClient;
  private readonly parent: string;
  private readonly serviceAccountEmail: string;

  constructor(project: string, location: string, queue: string, serviceAccountEmail: string) {
    this.client = new CloudTasksClient();
    this.parent = this.client.queuePath(project, location, queue);
    this.serviceAccountEmail = serviceAccountEmail;
  }

  async enqueueSyncOrder(targetBaseUrl: string, payload: SyncOrderPayload): Promise<void> {
    await this.client.createTask({
      parent: this.parent,
      task: {
        httpRequest: {
          httpMethod: "POST",
          url: `${targetBaseUrl}/internal/sync-order`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
          oidcToken: {
            serviceAccountEmail: this.serviceAccountEmail,
            audience: targetBaseUrl,
          },
        },
      },
    });
  }
}
