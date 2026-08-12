import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema.js";

export type DbConnectionEnv = {
  DATABASE_URL: string;
};

export function createDatabase(env: DbConnectionEnv) {
  // prepare: false — Supabase's connection pooler runs in pgbouncer
  // transaction mode, which does not support prepared statements. SSL is
  // negotiated from the connection string itself (Supabase URLs include
  // sslmode=require), so no separate ssl option is set here.
  //
  // fetch_types: false — postgres.js runs an automatic startup query to
  // introspect custom Postgres types, which is known to desync the wire
  // protocol behind connection poolers like Supabase's Supavisor (surfaces
  // as "Unknown Message: <n>" errors). We don't use custom Postgres types
  // in the schema, so it's safe to skip. See porsager/postgres#1136.
  const client = postgres(env.DATABASE_URL, {
    prepare: false,
    fetch_types: false,
    max: 10
  });

  const db = drizzle(client, { schema });

  return {
    db,
    pool: client
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
