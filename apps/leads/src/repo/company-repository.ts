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

import { ObjectId, type Filter, type Sort, type WithId } from "mongodb";

import type {
  CompanyDoc,
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

/** Dashboard list query (already validated + defaulted at the route boundary). */
export interface ListQuery {
  status?: LifecycleStatus;
  platform?: string;
  country?: string;
  minScore?: number;
  sort: "score" | "company";
  order: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Page of full company documents plus the unpaginated total for the filter. */
export interface ListResult {
  items: WithId<CompanyDoc>[];
  total: number;
}

/**
 * Repository surface the importer + dashboard API depend on (injectable for
 * tests). Read/query methods back the Phase 1 leads dashboard.
 */
export interface CompanyRepository {
  upsertByDomain(input: UpsertInput): Promise<void>;
  /** Filtered/sorted/paginated companies + total. */
  list(query: ListQuery): Promise<ListResult>;
  /** Single company by Mongo `_id` hex string; null if missing/invalid id. */
  getById(id: string): Promise<WithId<CompanyDoc> | null>;
  /** Set lifecycle status; false if no company matched the id. */
  updateStatus(id: string, status: LifecycleStatus): Promise<boolean>;
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
  },

  async list(query: ListQuery): Promise<ListResult> {
    const filter: Filter<CompanyDoc> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.platform !== undefined) filter.platform = query.platform;
    if (query.country !== undefined) filter.country = query.country;
    if (query.minScore !== undefined) filter["score.overall"] = { $gte: query.minScore };

    // Default sort is score.overall desc: MongoDB sorts missing fields as the
    // lowest value, so unscored docs naturally sort last for a desc order.
    const field = query.sort === "company" ? "companyName" : "score.overall";
    const direction: 1 | -1 = query.order === "asc" ? 1 : -1;
    const sort: Sort = { [field]: direction };

    const coll = companies();
    const total = await coll.countDocuments(filter);
    const items = await coll
      .find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .toArray();

    return { items, total };
  },

  async getById(id: string): Promise<WithId<CompanyDoc> | null> {
    if (!ObjectId.isValid(id)) return null;
    return companies().findOne({ _id: new ObjectId(id) });
  },

  async updateStatus(id: string, status: LifecycleStatus): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await companies().updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
  }
};
