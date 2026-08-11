import "dotenv/config";
import fs from "fs";
import path from "path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import type Sql from "postgres";

import { loadEnv } from "../config/env.js";
import { createDatabase } from "./index.js";

/**
 * Seeds drizzle.__drizzle_migrations for a database whose schema was applied
 * outside Drizzle (e.g. the initial Supabase import via
 * docs/data/price_insight_supabase_schema.sql) so that migrate() treats the
 * matching migration file(s) as already applied instead of re-running their
 * DDL. Postgres port of the MySQL bootstrapMigrationTracking helper this
 * replaces — same approach (compute the same hash Drizzle computes, insert
 * one tracking row per journal entry), adapted to Postgres's default
 * migrations table location (schema "drizzle", not the public schema).
 */
async function bootstrapMigrationTracking(client: Sql.Sql, migrationsFolder: string) {
  await client`create schema if not exists "drizzle"`;
  await client`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;

  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf-8")
  );

  const { createHash } = await import("crypto");
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      "utf-8"
    );
    const hash = createHash("sha256").update(sql).digest("hex");
    await client`
      insert into "drizzle"."__drizzle_migrations" (hash, created_at)
      values (${hash}, ${entry.when})
    `;
  }
}

export async function runMigrations(migrationsFolder = "./drizzle-pg") {
  const env = loadEnv();
  const { db, pool } = createDatabase(env);

  try {
    await migrate(db, { migrationsFolder });
  } catch (err: unknown) {
    // 42P07 = duplicate_table, 42701 = duplicate_column — Postgres equivalents
    // of MySQL's ER_TABLE_EXISTS_ERROR/ER_DUP_FIELDNAME used by the migration
    // this replaced to detect "schema already applied outside Drizzle".
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "42P07" || code === "42701") {
      console.warn(
        "WARNING: Schema drift detected — DB schema is ahead of drizzle.__drizzle_migrations. " +
        "This usually means the schema was applied outside Drizzle (e.g. a direct SQL import). " +
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
