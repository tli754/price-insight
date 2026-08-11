import "dotenv/config";

import { defineConfig } from "drizzle-kit";

// out points at a fresh migration line for Postgres/Supabase. The old
// ./drizzle folder holds the MySQL migration history (0000-0006) and is left
// in place untouched as a historical record — it no longer applies once the
// app targets Postgres, per docs/data/price_insight_supabase_schema.sql
// ("Existing MySQL Drizzle migration history is intentionally excluded").
export default defineConfig({
  out: "./drizzle-pg",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
});
