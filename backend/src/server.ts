import "dotenv/config";

import { migrate } from "drizzle-orm/mysql2/migrator";

import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { createDatabase } from "./db/index.js";

const env = loadEnv();

const { db, pool } = createDatabase(env);
await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();

const app = await buildApp(env);

try {
  await app.listen({
    host: "0.0.0.0",
    port: env.PORT
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
