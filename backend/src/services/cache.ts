import RedisModule from "ioredis";

import type { AppEnv } from "../config/env.js";

export type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  connect(): Promise<void>;
  quit(): Promise<unknown>;
  ping(): Promise<string>;
};

const RedisCtor = RedisModule as unknown as new (options: {
  host: string;
  port: number;
  password?: string;
  db: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
}) => RedisClient;

export function createRedis(env: AppEnv) {
  return new RedisCtor({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
}

export async function getJson<T>(redis: RedisClient, key: string): Promise<T | null> {
  const value = await redis.get(key);
  return value ? (JSON.parse(value) as T) : null;
}

export async function setJson(redis: RedisClient, key: string, value: unknown, ttlSeconds: number) {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}
