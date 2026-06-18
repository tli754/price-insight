import { Redis as IORedis } from "ioredis";

import type { AppEnv } from "./env.js";

interface RedisErrorLogger {
  warn(obj: { err: unknown }, msg: string): void;
}

export function createRedisConnection(env: AppEnv, logger: RedisErrorLogger): IORedis {
  const redis = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null, // required by BullMQ
  });

  // ioredis is an EventEmitter — an unhandled 'error' event crashes the
  // process. Redis is intentionally not provisioned on Cloud Run yet, so
  // background reconnect attempts must log instead of taking the app down.
  redis.on("error", (err) => {
    logger.warn({ err }, "Redis connection error — order-sync queue/cron degraded");
  });

  return redis;
}
