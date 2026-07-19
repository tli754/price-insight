// Zod-validated environment loader for the leads service.
//
// NOTE: this lives at `src/env.ts` (NOT `src/config/env.ts`) because `src/config.ts`
// already exists as a file — a sibling `config/` directory would clash with it.

import { config } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Shared with price-insight so one pi-session login works across both domains.
  SESSION_SECRET: z.string().min(32),
  // MongoDB Atlas connection string (leads is Mongo-only).
  MONGODB_URI: z.string().min(1)
});

export type LeadsEnv = z.infer<typeof envSchema>;

/**
 * Load and validate environment variables. Reads a local `.env` (via dotenv)
 * then parses `process.env` against the schema, throwing on invalid config.
 */
export function loadEnv(): LeadsEnv {
  config();
  return envSchema.parse(process.env);
}
