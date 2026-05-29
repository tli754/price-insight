import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.string().min(1),
  JINA_API_KEY: z.string().min(1),
  SERPAPI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  SHOPIFY_TOKEN_URL: z.string().url().optional(),
  SHOPIFY_PRODUCTS_URL: z.string().url().optional(),
  SHOPIFY_ORDERS_URL: z.string().url().optional(),
  SHOPIFY_CLIENT_ID: z.string().min(1).optional(),
  SHOPIFY_CLIENT_SECRET: z.string().min(1).optional(),
  SERPAPI_LOCATION: z.string().default("New Zealand"),
  SERPAPI_GL: z.string().default("nz"),
  SERPAPI_HL: z.string().default("en"),
  SERPAPI_GOOGLE_DOMAIN: z.string().default("google.co.nz"),
  SERPAPI_NUM_RESULTS: z.coerce.number().int().min(1).max(100).default(40),
  OWN_STORE_NAME: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  return envSchema.parse(process.env);
}
