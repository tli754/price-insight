import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

import type { AppEnv } from "../config/env.js";
import * as schema from "./schema.js";

export function createDatabase(env: AppEnv) {
  const pool = mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: 10
  });

  const db = drizzle(pool, { schema, mode: "default" });

  return {
    db,
    pool
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
