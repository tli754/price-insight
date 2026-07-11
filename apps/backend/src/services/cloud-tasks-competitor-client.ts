import { CloudTasksClient } from "@google-cloud/tasks";

import type { CompetitorTaskPayload } from "../lib/competitor-task-payload.js";

export class CloudTasksCompetitorClient {
  private readonly client: CloudTasksClient;
  private readonly parent: string;
  private readonly serviceAccountEmail: string;
  private readonly targetBaseUrl: string;

  constructor(
    project: string,
    location: string,
    queue: string,
    serviceAccountEmail: string,
    targetBaseUrl: string
  ) {
    this.client = new CloudTasksClient();
    this.parent = this.client.queuePath(project, location, queue);
    this.serviceAccountEmail = serviceAccountEmail;
    this.targetBaseUrl = targetBaseUrl;
  }

  async enqueue(payload: CompetitorTaskPayload): Promise<void> {
    const path =
      payload.type === "process-shopping-pingback"
        ? "/internal/process-shopping-pingback"
        : "/internal/process-product-info-pingback";

    await this.client.createTask({
      parent: this.parent,
      task: {
        httpRequest: {
          httpMethod: "POST",
          url: `${this.targetBaseUrl}${path}`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
          oidcToken: {
            serviceAccountEmail: this.serviceAccountEmail,
            audience: this.targetBaseUrl,
          },
        },
      },
    });
  }
}
