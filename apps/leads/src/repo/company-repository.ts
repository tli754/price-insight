// Idempotent persistence for company documents, keyed on `domain`.
//
// Re-importing the same file (or an updated export) must converge, never
// duplicate. The upsert:
//   - $set: signals, contacts (rebuilt+deduped each run), company fields, score,
//     filterReason, updatedAt.
//   - $setOnInsert: createdAt AND status — so a re-import never downgrades a
//     human-advanced lifecycle (e.g. `contacted`) back to `scored`/`rejected`.
//     The very first insert still lands the correct `scored`/`rejected` status.
//   - sources: a provenance entry is appended only when no entry with the same
//     (source, sourceFile) exists yet — so re-runs add no duplicate source rows.
//   - scoreHistory: append-only (one entry per scored run) — audit trail.

import type {
  CompanyScore,
  CompanySignals,
  CompanySource,
  Contact,
  LifecycleStatus,
  ScoreHistoryEntry
} from "../db/collections.js";
import { companies } from "../db/collections.js";

/** Fields written on every import (via $set) for a company. */
export interface UpsertFields {
  companyName?: string;
  platform: string;
  country?: string;
  vertical?: string;
  employeeCount?: number;
  productCount?: number;
  signals: CompanySignals;
  contacts: Contact[];
  score?: CompanyScore;
  filterReason: string | null;
}

export interface UpsertInput {
  domain: string;
  /** Insert-time-only lifecycle status ("scored" | "rejected"). */
  status: LifecycleStatus;
  fields: UpsertFields;
  source: CompanySource;
  /** Present only for scored leads — appended to scoreHistory. */
  scoreEntry?: ScoreHistoryEntry;
}

/** Repository surface the importer depends on (injectable for tests). */
export interface CompanyRepository {
  upsertByDomain(input: UpsertInput): Promise<void>;
}

/** MongoDB-backed implementation (requires a completed `connect()`). */
export const companyRepository: CompanyRepository = {
  async upsertByDomain(input: UpsertInput): Promise<void> {
    const now = new Date();
    const { fields } = input;

    // Build $set with only defined optional fields (never $set undefined → null).
    const set: Record<string, unknown> = {
      platform: fields.platform,
      signals: fields.signals,
      contacts: fields.contacts,
      filterReason: fields.filterReason,
      updatedAt: now
    };
    if (fields.companyName !== undefined) set.companyName = fields.companyName;
    if (fields.country !== undefined) set.country = fields.country;
    if (fields.vertical !== undefined) set.vertical = fields.vertical;
    if (fields.employeeCount !== undefined) set.employeeCount = fields.employeeCount;
    if (fields.productCount !== undefined) set.productCount = fields.productCount;
    if (fields.score !== undefined) set.score = fields.score;

    const update: Record<string, unknown> = {
      $set: set,
      $setOnInsert: {
        domain: input.domain,
        createdAt: now,
        status: input.status
      }
    };
    if (input.scoreEntry) {
      update.$push = { scoreHistory: input.scoreEntry };
    }

    await companies().updateOne({ domain: input.domain }, update, { upsert: true });

    // Append the provenance entry only if this (source, sourceFile) is not present.
    await companies().updateOne(
      {
        domain: input.domain,
        sources: {
          $not: {
            $elemMatch: {
              source: input.source.source,
              sourceFile: input.source.sourceFile ?? null
            }
          }
        }
      },
      { $push: { sources: input.source } }
    );
  }
};
