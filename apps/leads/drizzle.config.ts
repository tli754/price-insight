import "dotenv/config";

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "mysql",
  dbCredentials: {
    // Dedicated Leads database — separate from price-insight's DATABASE_URL.
    url: process.env.LEADS_DATABASE_URL ?? ""
  }
});
