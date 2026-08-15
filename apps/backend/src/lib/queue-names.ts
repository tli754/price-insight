// pgmq queue names — must match the queues already created in Supabase
// (see docs/decisions/0002-pgmq-order-sync-competitor-queue-migration.md).
export const SHOPIFY_ORDERS_QUEUE = "shopify_orders";
export const DATAFORSEO_COMPETITORS_QUEUE = "dataforseo_competitors";

// Visibility timeout (seconds) — long enough to cover one Shopify GraphQL
// fetch + DB upsert, or one DataForSEO task_get + DB upsert, comfortably.
export const QUEUE_VISIBILITY_SECONDS = 300;

// A message failing this many drains in a row gets pgmq.archive()'d instead
// of retried again — see ADR 0002.
export const QUEUE_ARCHIVE_AFTER_READ_COUNT = 5;
