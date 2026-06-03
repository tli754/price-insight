import Fastify from "fastify";

import type { AppEnv } from "./config/env.js";
import { createDatabase } from "./db/index.js";
import { AppError } from "./lib/app-error.js";
import analysisRoutes from "./routes/analysis.js";
import healthRoutes from "./routes/health.js";
import ordersRoutes from "./routes/orders.js";
import productRoutes from "./routes/products.js";
import { CompetitorAnalysisService } from "./services/competitor-analysis-service.js";
import { CompetitorRepository } from "./services/competitor-repository.js";
import { DataForSeoService } from "./services/dataforseo-service.js";
import { OrderRepository } from "./services/order-repository.js";
import { ProductRepository } from "./services/product-repository.js";
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

  const orderRepository = new OrderRepository(db);

  app.decorate("env", env);
  app.decorate("productRepository", productRepository);
  app.decorate("competitorRepository", competitorRepository);
  app.decorate("competitorAnalysisService", competitorAnalysisService);
  app.decorate("orderRepository", orderRepository);
  app.decorate("shopifyService", shopifyService);

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

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(productRoutes, { prefix: "/api" });
  await app.register(ordersRoutes, { prefix: "/api" });
  await app.register(analysisRoutes, { prefix: "/api" });

  return app;
}
