import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { migrate } from "drizzle-orm/mysql2/migrator";
import type { Pool } from "mysql2/promise";

import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { createDatabase } from "./db/index.js";

/**
 * Seeds __drizzle_migrations with hashes for all existing migration files.
 * Called when the DB was pre-initialised without migration tracking so that
 * migrate() knows those files have already been applied.
 */
async function bootstrapMigrationTracking(pool: Pool, migrationsFolder: string) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);

  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf-8")
  );

  for (const entry of journal.entries) {
    const sql = fs.readFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      "utf-8"
    );
    const hash = crypto.createHash("sha256").update(sql).digest("hex");
    await pool.execute(
      "INSERT IGNORE INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)",
      [hash, entry.when]
    );
  }
}

const env = loadEnv();
const { db, pool } = createDatabase(env);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
} catch (err: any) {
  if (err?.code === "ER_TABLE_EXISTS_ERROR") {
    // DB was initialised before migration tracking was introduced — bootstrap it.
    await bootstrapMigrationTracking(pool, "./drizzle");
    await migrate(db, { migrationsFolder: "./drizzle" });
  } else {
    throw err;
  }
}

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
