// Index setup for the leads MongoDB collections. Idempotent: createIndex is a
// no-op when the index already exists with the same spec/options.

import type { Db } from "mongodb";

import { COLLECTIONS } from "./collections.js";

/**
 * Ensure all indexes the pipeline/dashboard relies on. Safe to run repeatedly
 * (e.g. on startup or from a setup script).
 *
 * companies:
 *   - unique on `domain` (dedupe key)
 *   - `status`, `platform`, `country`  (dashboard filters)
 *   - `score.overall` descending        (default sort — highest first)
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const companies = db.collection(COLLECTIONS.companies);

  await companies.createIndex({ domain: 1 }, { unique: true, name: "companies_domain_unique" });
  await companies.createIndex({ status: 1 }, { name: "companies_status_idx" });
  await companies.createIndex({ "score.overall": -1 }, { name: "companies_score_overall_idx" });
  await companies.createIndex({ platform: 1 }, { name: "companies_platform_idx" });
  await companies.createIndex({ country: 1 }, { name: "companies_country_idx" });
}
