import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

import type { AppEnv } from "../config/env.js";
import * as schema from "./schema.js";

export function createDatabase(env: AppEnv) {
  const pool = mysql.createPool({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: 10,
    ssl: { rejectUnauthorized: false }
  });

  const db = drizzle(pool, { schema, mode: "default" });

  return {
    db,
    pool
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
