import Fastify from "fastify";
import OpenAI from "openai";

import type { AppEnv } from "./config/env.js";
import { createRedisConnection } from "./config/redis.js";
import { createDatabase } from "./db/index.js";
import { AppError } from "./lib/app-error.js";
import analysisRoutes from "./routes/analysis.js";
import healthRoutes from "./routes/health.js";
import ordersRoutes from "./routes/orders.js";
import productRoutes from "./routes/products.js";
import queueRoutes from "./routes/queue.js";
import reportRoutes from "./routes/reports.js";
import shopifyRoutes from "./routes/shopify.js";
import webhookRoutes from "./routes/webhook.js";
import { setupScheduler } from "./scheduler.js";
import { AiReportRepository } from "./services/ai-report-repository.js";
import { AiReportService } from "./services/ai-report-service.js";
import { CompetitorAnalysisService } from "./services/competitor-analysis-service.js";
import { CompetitorRepository } from "./services/competitor-repository.js";
import { DataForSeoService } from "./services/dataforseo-service.js";
import { OrderRepository } from "./services/order-repository.js";
import { createOrderSyncQueue } from "./services/order-sync-queue.js";
import { ProductRepository } from "./services/product-repository.js";
import { ShopifyGraphQLService } from "./services/shopify-graphql-service.js";
import { ShopifyService } from "./services/shopify-service.js";
import { createOrderSyncWorker } from "./workers/order-sync-worker.js";

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

  const redis = createRedisConnection(env);
  const orderSyncQueue = createOrderSyncQueue(redis);
  const orderSyncWorker = createOrderSyncWorker(
    orderRepository,
    orderSyncQueue,
    shopifyService,
    shopifyGraphQLService,
    redis
  );

  if (shopifyService && shopifyGraphQLService) {
    await setupScheduler(orderSyncQueue);
  }

  app.decorate("env", env);
  app.decorate("productRepository", productRepository);
  app.decorate("competitorRepository", competitorRepository);
  app.decorate("competitorAnalysisService", competitorAnalysisService);
  app.decorate("dataForSeoService", dataForSeo);
  app.decorate("orderRepository", orderRepository);
  app.decorate("shopifyService", shopifyService);
  app.decorate("shopifyGraphQLService", shopifyGraphQLService);
  app.decorate("orderSyncQueue", orderSyncQueue);
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
    await orderSyncWorker.close();
    await orderSyncQueue.close();
    await redis.quit();
    await pool.end();
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(productRoutes, { prefix: "/api" });
  await app.register(ordersRoutes, { prefix: "/api" });
  await app.register(shopifyRoutes, { prefix: "/api" });
  await app.register(queueRoutes, { prefix: "/api" });
  await app.register(analysisRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(webhookRoutes);

  return app;
}
