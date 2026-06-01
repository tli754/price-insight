import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { migrate } from "drizzle-orm/mysql2/migrator";
import type { Pool } from "mysql2/promise";

import { loadEnv } from "../config/env.js";
import { createDatabase } from "./index.js";

/**
 * Seeds __drizzle_migrations for databases that were initialised before
 * migration tracking was introduced. Computes hashes the same way
 * drizzle-orm does so that migrate() treats all existing files as applied.
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

export async function runMigrations(migrationsFolder = "./drizzle") {
  const env = loadEnv();
  const { db, pool } = createDatabase(env);

  try {
    await migrate(db, { migrationsFolder });
  } catch (err: unknown) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "ER_TABLE_EXISTS_ERROR" || code === "ER_DUP_FIELDNAME") {
      console.warn(
        "WARNING: Schema drift detected — DB schema is ahead of __drizzle_migrations. " +
        "This usually means db:push was run directly. " +
        "Bootstrapping migration tracking and skipping already-applied migrations."
      );
      await bootstrapMigrationTracking(pool, migrationsFolder);
      await migrate(db, { migrationsFolder });
    } else {
      throw err;
    }
  } finally {
    await pool.end();
  }
}

// Run directly when executed as a script
const isMain = process.argv[1]?.endsWith("run-migrations.js") ||
               process.argv[1]?.endsWith("run-migrations.ts");

if (isMain) {
  runMigrations()
    .then(() => {
      console.log("Migrations complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
