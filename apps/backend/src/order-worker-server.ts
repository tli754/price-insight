/**
 * Minimal entrypoint for the order-worker Cloud Run service — same image as
 * the backend, but a narrower process: only DB + Shopify GraphQL + Cloud
 * Tasks, no OpenAI/DataForSEO/auth/session wiring, since order-worker's
 * Terraform secret grants are scoped to just MySQL and Shopify env vars
 * (least privilege). cloud-run.tf overrides this service's container
 * command/args to run this file instead of the default dist/server.js.
 */
import "dotenv/config";

import Fastify from "fastify";
import { z } from "zod";

import { AppError } from "./lib/app-error.js";
import internalSyncRoutes from "./routes/internal-sync.js";
import { CloudTasksOrderSyncClient } from "./services/cloud-tasks-client.js";
import { createDatabase } from "./db/index.js";
import { OrderRepository } from "./services/order-repository.js";
import { ShopifyGraphQLService } from "./services/shopify-graphql-service.js";
import { ShopifyService } from "./services/shopify-service.js";

const orderWorkerEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.string().min(1),
  SHOPIFY_TOKEN_URL: z.string().url().optional(),
  SHOPIFY_PRODUCTS_URL: z.string().url().optional(),
  SHOPIFY_ORDERS_URL: z.string().url().optional(),
  SHOPIFY_CLIENT_ID: z.string().min(1).optional(),
  SHOPIFY_CLIENT_SECRET: z.string().min(1).optional(),
  CLOUD_TASKS_PROJECT: z.string().min(1),
  CLOUD_TASKS_LOCATION: z.string().min(1),
  CLOUD_TASKS_QUEUE: z.string().min(1),
  INTERNAL_OIDC_SERVICE_ACCOUNT: z.string().min(1),
});

const env = orderWorkerEnvSchema.parse(process.env);

const { db, pool } = createDatabase(env);
const orderRepository = new OrderRepository(db);

const shopifyService =
  env.SHOPIFY_TOKEN_URL && env.SHOPIFY_PRODUCTS_URL && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
    ? new ShopifyService(env.SHOPIFY_TOKEN_URL, env.SHOPIFY_PRODUCTS_URL, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET, env.SHOPIFY_ORDERS_URL)
    : null;

const shopifyGraphQLService = env.SHOPIFY_PRODUCTS_URL ? new ShopifyGraphQLService(env.SHOPIFY_PRODUCTS_URL) : null;

const cloudTasksClient = new CloudTasksOrderSyncClient(
  env.CLOUD_TASKS_PROJECT,
  env.CLOUD_TASKS_LOCATION,
  env.CLOUD_TASKS_QUEUE,
  env.INTERNAL_OIDC_SERVICE_ACCOUNT
);

const app = Fastify({ logger: true });

app.setErrorHandler((error: unknown, request, reply) => {
  request.log.error(error);
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  return reply.status(500).send({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error." } });
});

app.addHook("onClose", async () => {
  await pool.end();
});

await app.register(internalSyncRoutes, {
  orderRepository,
  shopifyService,
  shopifyGraphQLService,
  cloudTasksClient,
  internalOidcServiceAccount: env.INTERNAL_OIDC_SERVICE_ACCOUNT,
});

try {
  await app.listen({ host: "0.0.0.0", port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
