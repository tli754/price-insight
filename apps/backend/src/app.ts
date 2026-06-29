import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import OpenAI from "openai";

import type { AppEnv } from "./config/env.js";
import { createDatabase } from "./db/index.js";
import { AppError } from "./lib/app-error.js";
import { requireSession } from "./lib/require-session.js";
import analysisRoutes from "./routes/analysis.js";
import authRoutes from "./routes/auth.js";
import healthRoutes from "./routes/health.js";
import ordersRoutes from "./routes/orders.js";
import productRoutes from "./routes/products.js";
import reportRoutes from "./routes/reports.js";
import shopifyRoutes from "./routes/shopify.js";
import shopifyWebhookRoutes from "./routes/shopify-webhook.js";
import webhookRoutes from "./routes/dataforseo-webhook.js";
import internalCompetitorRoutes from "./routes/internal-competitor.js";
import { AiReportRepository } from "./services/ai-report-repository.js";
import { AiReportService } from "./services/ai-report-service.js";
import { CloudTasksOrderSyncClient } from "./services/cloud-tasks-client.js";
import { CloudTasksCompetitorClient } from "./services/cloud-tasks-competitor-client.js";
import { CompetitorAnalysisService } from "./services/competitor-analysis-service.js";
import { CompetitorRepository } from "./services/competitor-repository.js";
import { DataForSeoService } from "./services/dataforseo-service.js";
import { OrderRepository } from "./services/order-repository.js";
import { ProductRepository } from "./services/product-repository.js";
import { ShopifyGraphQLService } from "./services/shopify-graphql-service.js";
import { ShopifyService } from "./services/shopify-service.js";

export async function buildApp(env: AppEnv) {
  const app = Fastify({
    logger: true
  });

  const { db, pool } = createDatabase(env);

  const productRepository = new ProductRepository(db);
  const competitorRepository = new CompetitorRepository(db);
  const dataForSeo = new DataForSeoService(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD);
  const competitorAnalysisService = new CompetitorAnalysisService(dataForSeo, competitorRepository, env.OWN_STORE_NAME);

  const shopifyService = env.SHOPIFY_TOKEN_URL && env.SHOPIFY_PRODUCTS_URL && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
    ? new ShopifyService(env.SHOPIFY_TOKEN_URL, env.SHOPIFY_PRODUCTS_URL, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET, env.SHOPIFY_ORDERS_URL)
    : null;

  const shopifyGraphQLService = env.SHOPIFY_PRODUCTS_URL
    ? new ShopifyGraphQLService(env.SHOPIFY_PRODUCTS_URL)
    : null;

  const orderRepository = new OrderRepository(db);

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const aiReportRepository = new AiReportRepository(db);
  const aiReportService = new AiReportService(
    aiReportRepository,
    productRepository,
    competitorRepository,
    orderRepository,
    openai,
    env.OPENAI_MODEL
  );

  const cloudTasksClient =
    env.CLOUD_TASKS_PROJECT && env.CLOUD_TASKS_LOCATION && env.CLOUD_TASKS_QUEUE && env.ORDER_WORKER_URL && env.INTERNAL_OIDC_SERVICE_ACCOUNT
      ? new CloudTasksOrderSyncClient(
          env.CLOUD_TASKS_PROJECT,
          env.CLOUD_TASKS_LOCATION,
          env.CLOUD_TASKS_QUEUE,
          env.INTERNAL_OIDC_SERVICE_ACCOUNT
        )
      : null;

  const cloudTasksCompetitorClient =
    env.CLOUD_TASKS_PROJECT && env.CLOUD_TASKS_LOCATION && env.CLOUD_TASKS_QUEUE && env.INTERNAL_OIDC_SERVICE_ACCOUNT && env.BACKEND_CLOUD_RUN_URL
      ? new CloudTasksCompetitorClient(
          env.CLOUD_TASKS_PROJECT,
          env.CLOUD_TASKS_LOCATION,
          env.CLOUD_TASKS_QUEUE,
          env.INTERNAL_OIDC_SERVICE_ACCOUNT,
          env.BACKEND_CLOUD_RUN_URL
        )
      : null;

  app.decorate("env", env);

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(cookie);
  await app.register(jwt, { secret: env.SESSION_SECRET });

  app.decorate("productRepository", productRepository);
  app.decorate("competitorRepository", competitorRepository);
  app.decorate("competitorAnalysisService", competitorAnalysisService);
  app.decorate("dataForSeoService", dataForSeo);
  app.decorate("orderRepository", orderRepository);
  app.decorate("shopifyService", shopifyService);
  app.decorate("shopifyGraphQLService", shopifyGraphQLService);
  app.decorate("cloudTasksClient", cloudTasksClient);
  app.decorate("cloudTasksCompetitorClient", cloudTasksCompetitorClient);
  app.decorate("aiReportRepository", aiReportRepository);
  app.decorate("aiReportService", aiReportService);

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error instanceof Error && error.name === "ZodError") {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error."
      }
    });
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  await app.register(authRoutes);
  await app.register(healthRoutes, { prefix: "/api" });

  await app.register(async (protectedApi) => {
    protectedApi.addHook("preHandler", requireSession(protectedApi));
    await protectedApi.register(productRoutes, { prefix: "/api" });
    await protectedApi.register(ordersRoutes, { prefix: "/api" });
    await protectedApi.register(shopifyRoutes, { prefix: "/api" });
    await protectedApi.register(analysisRoutes, { prefix: "/api" });
    await protectedApi.register(reportRoutes, { prefix: "/api" });
  });

  await app.register(webhookRoutes);
  await app.register(internalCompetitorRoutes);
  await app.register(shopifyWebhookRoutes);

  return app;
}
