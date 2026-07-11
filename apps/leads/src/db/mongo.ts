// Native MongoDB driver connection for the leads service.
//
// Lazy singleton: nothing connects at import time. The first `connect()`/`getDb()`
// call opens a pooled client; subsequent calls reuse it. `close()` tears it down
// (useful for scripts and test teardown).

import { MongoClient, type Db } from "mongodb";

import { loadEnv } from "../env.js";

let client: MongoClient | null = null;
let db: Db | null = null;
let connecting: Promise<Db> | null = null;

/**
 * Open (or reuse) the shared MongoClient and return its default database.
 * The database name is taken from the `MONGODB_URI` path. Concurrent callers
 * share a single in-flight connection promise.
 */
export async function connect(): Promise<Db> {
  if (db) return db;
  if (connecting) return connecting;

  const { MONGODB_URI } = loadEnv();

  connecting = (async () => {
    const c = new MongoClient(MONGODB_URI);
    await c.connect();
    client = c;
    db = c.db();
    return db;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

/**
 * Return the connected database. Throws if `connect()` has not completed yet —
 * callers that cannot guarantee ordering should `await connect()` instead.
 */
export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB not connected — call connect() first.");
  }
  return db;
}

/** Close the shared client and reset the singleton state. */
export async function close(): Promise<void> {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
  connecting = null;
}
