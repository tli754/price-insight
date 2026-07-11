import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

import * as schema from "./schema.js";

export type DbConnectionEnv = {
  MYSQL_HOST: string;
  MYSQL_PORT: number;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
  MYSQL_DATABASE: string;
};

export function createDatabase(env: DbConnectionEnv) {
  const isSocket = env.MYSQL_HOST.startsWith("/cloudsql/");

  const pool = mysql.createPool(
    isSocket
      ? {
          socketPath: env.MYSQL_HOST,
          user: env.MYSQL_USER,
          password: env.MYSQL_PASSWORD,
          database: env.MYSQL_DATABASE,
          connectionLimit: 10
        }
      : {
          host: env.MYSQL_HOST,
          port: env.MYSQL_PORT,
          user: env.MYSQL_USER,
          password: env.MYSQL_PASSWORD,
          database: env.MYSQL_DATABASE,
          connectionLimit: 10,
          ssl: { rejectUnauthorized: false }
        }
  );

  const db = drizzle(pool, { schema, mode: "default" });

  return {
    db,
    pool
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
