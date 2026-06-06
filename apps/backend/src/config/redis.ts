import { Redis as IORedis } from "ioredis";

import type { AppEnv } from "./env.js";

export function createRedisConnection(env: AppEnv): IORedis {
  return new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null, // required by BullMQ
  });
}
