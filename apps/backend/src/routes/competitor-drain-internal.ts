import type { FastifyPluginAsync } from "fastify";

import { drainQueue } from "../lib/queue-drain.js";
import { DATAFORSEO_COMPETITORS_QUEUE, QUEUE_ARCHIVE_AFTER_READ_COUNT, QUEUE_VISIBILITY_SECONDS } from "../lib/queue-names.js";
import { verifyOidcToken } from "../lib/verify-oidc.js";
import type { CompetitorTaskPayload } from "../lib/competitor-task-payload.js";
import { processCompetitorTaskMessage } from "../services/competitor-drain-service.js";

/**
 * Scheduled entrypoint for the daily dataforseo_competitors drain — the
 * Cloud Scheduler target that replaces internal-competitor.ts's Cloud
 * Tasks-pushed handlers (see ADR 0002). No discovery stage here — this
 * queue is purely webhook-fed (routes/dataforseo-webhook.ts), so it's
 * drain-only, unlike shopify_orders' scheduled route.
 */
const competitorDrainInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request, reply) => {
    if (!fastify.env.INTERNAL_OIDC_SERVICE_ACCOUNT) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "OIDC not configured." } });
    }
    const verified = await verifyOidcToken(
      request.headers.authorization,
      fastify.env.INTERNAL_OIDC_SERVICE_ACCOUNT,
      fastify.env.BACKEND_CLOUD_RUN_URL ?? fastify.env.WEBHOOK_HOST
    );
    if (!verified) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or missing OIDC token." } });
    }
  });

  fastify.post("/internal/competitor-drain-run", async (request, reply) => {
    const deps = {
      dataForSeoService: fastify.dataForSeoService,
      competitorRepository: fastify.competitorRepository,
      productRepository: fastify.productRepository,
      ownStoreName: fastify.env.OWN_STORE_NAME,
      webhookHost: fastify.env.WEBHOOK_HOST,
      dataForSeoWebhookSecret: fastify.env.DATAFORSEO_WEBHOOK_SECRET,
    };

    const result = await drainQueue<CompetitorTaskPayload>({
      pgmq: fastify.pgmqClient,
      queueName: DATAFORSEO_COMPETITORS_QUEUE,
      visibilitySeconds: QUEUE_VISIBILITY_SECONDS,
      archiveAfterReadCount: QUEUE_ARCHIVE_AFTER_READ_COUNT,
      processMessage: (message) => processCompetitorTaskMessage(deps, message),
      logger: request.log,
    });

    return reply.status(200).send({ ok: true, ...result });
  });
};

export default competitorDrainInternalRoutes;
