import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import OpenAI from "openai";

import type { AppEnv } from "./config/env.js";
import { createRedisConnection } from "./config/redis.js";
import { createDatabase } from "./db/index.js";
import { AppError } from "./lib/app-error.js";
import analysisRoutes from "./routes/analysis.js";
import authRoutes from "./routes/auth.js";
import healthRoutes from "./routes/health.js";
import ordersRoutes from "./routes/orders.js";
import productRoutes from "./routes/products.js";
import queueRoutes from "./routes/queue.js";
import reportRoutes from "./routes/reports.js";
import shopifyRoutes from "./routes/shopify.js";
import shopifyWebhookRoutes from "./routes/shopify-webhook.js";
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

  const redis = createRedisConnection(env, app.log);
  const orderSyncQueue = createOrderSyncQueue(redis);
  const orderSyncWorker = createOrderSyncWorker(
    orderRepository,
    shopifyService,
    shopifyGraphQLService,
    redis
  );

  let cronTask: import("node-cron").ScheduledTask | null = null;
  if (shopifyService && shopifyGraphQLService) {
    try {
      // Remove stale BullMQ repeatable from prior deployments before starting the direct cron.
      // Bounded by a timeout — ioredis is configured with maxRetriesPerRequest: null (required by
      // BullMQ), so this call hangs forever instead of rejecting when Redis is unreachable, which
      // would otherwise stop the app from ever reaching app.listen().
      await Promise.race([
        orderSyncQueue.removeRepeatable("scheduled-discovery", { pattern: "0 14 * * *" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Redis startup timeout")), 5000))
      ]);
      cronTask = setupScheduler(orderSyncQueue, shopifyService, shopifyGraphQLService);
    } catch (err) {
      app.log.warn({ err }, "Redis unavailable at startup — order-sync queue/cron disabled");
    }
  }

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
    cronTask?.stop();
    await orderSyncWorker.close();
    await orderSyncQueue.close();
    await redis.quit();
    await pool.end();
  });

  await app.register(authRoutes);
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(productRoutes, { prefix: "/api" });
  await app.register(ordersRoutes, { prefix: "/api" });
  await app.register(shopifyRoutes, { prefix: "/api" });
  await app.register(queueRoutes, { prefix: "/api" });
  await app.register(analysisRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(webhookRoutes);
  await app.register(shopifyWebhookRoutes);

  return app;
}
