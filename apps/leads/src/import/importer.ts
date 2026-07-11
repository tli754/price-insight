// Offline import orchestrator: xlsx → map → hard-filter → batch-score passers →
// idempotent upsert. Pure of transport concerns (the CLI wires env/DB/close).
//
// Flow:
//   1. parse the workbook into raw rows
//   2. mapRow each (pure) → MappedLead
//   3. hardFilter each — rejects get status "rejected" + filterReason, no score
//   4. scoreDataset over ALL passers together (relative percentile context)
//   5. upsert every persistable lead via the repository (idempotent on domain)
//
// Rows with no domain cannot be keyed/persisted (domain is the unique key): they
// are counted as rejected (reason "no_domain") but skipped for the DB write.

import { basename } from "node:path";

import { WEIGHTS } from "../config.js";
import type { CompanyScore, ScoreHistoryEntry } from "../db/collections.js";
import { hardFilter } from "../filter/hard-filter.js";
import { scoreDataset } from "../score/score.js";
import type { HardFilterInput, HardFilterResult, ScoreInput, ScoreResult } from "../domain/types.js";
import { companyRepository, type CompanyRepository } from "../repo/company-repository.js";
import { mapRow, type MappedLead } from "./row-mapper.js";
import { parseXlsx, type RawRow } from "./xlsx-parser.js";

/** Summary returned to the CLI (and, later, the Step-5 HTTP layer). */
export interface ImportSummary {
  total: number;
  rejected: number;
  scored: number;
  /** rejection-reason → count (only rejected rows). */
  byReason: Record<string, number>;
}

/** Injectable dependencies (all defaulted; overridden in tests). */
export interface ImportDeps {
  repo: CompanyRepository;
  readRows: (filePath: string) => RawRow[];
  filter: (input: HardFilterInput) => HardFilterResult;
  score: (inputs: ScoreInput[], weights?: typeof WEIGHTS, now?: Date) => ScoreResult[];
  now: Date;
}

interface EvaluatedLead {
  lead: MappedLead;
  passed: boolean;
  reason: string | null;
}

export async function runImport(
  filePath: string,
  deps: Partial<ImportDeps> = {}
): Promise<ImportSummary> {
  const repo = deps.repo ?? companyRepository;
  const readRows = deps.readRows ?? parseXlsx;
  const filter = deps.filter ?? hardFilter;
  const score = deps.score ?? scoreDataset;
  const now = deps.now ?? new Date();
  const sourceFile = basename(filePath);

  const rows = readRows(filePath);
  const leads = rows.map((raw) => mapRow(raw, sourceFile, now));

  // Hard-filter with default config (enterprise ceilings stay disabled).
  const evaluated: EvaluatedLead[] = leads.map((lead) => {
    const { pass, reason } = filter(lead.hardFilterInput);
    return { lead, passed: pass, reason };
  });

  // Score ALL passers together so percentile context is peer-relative.
  const passers = evaluated.filter((e) => e.passed);
  const scoreResults = score(
    passers.map((e) => e.lead.scoreInput),
    WEIGHTS,
    now
  );
  const scoreByLead = new Map<MappedLead, ScoreResult>();
  passers.forEach((e, i) => scoreByLead.set(e.lead, scoreResults[i]));

  const summary: ImportSummary = { total: leads.length, rejected: 0, scored: 0, byReason: {} };

  for (const { lead, passed, reason } of evaluated) {
    if (!passed) {
      summary.rejected += 1;
      const key = reason ?? "unknown";
      summary.byReason[key] = (summary.byReason[key] ?? 0) + 1;
    }

    const { domain } = lead.companyFields;
    if (!domain) continue; // cannot persist a domain-less row (unique key)

    if (!passed) {
      await repo.upsertByDomain({
        domain,
        status: "rejected",
        fields: {
          ...companyFieldsForUpsert(lead),
          score: undefined,
          filterReason: reason
        },
        source: lead.source
      });
      continue;
    }

    const result = scoreByLead.get(lead)!;
    const scoredAt = now;
    const weights: Record<string, number> = { ...WEIGHTS };
    const scoreDoc: CompanyScore = {
      overall: result.overall,
      components: result.components,
      reasons: result.reasons,
      weights,
      scoredAt
    };
    const scoreEntry: ScoreHistoryEntry = {
      overall: result.overall,
      components: result.components,
      reasons: result.reasons,
      weights,
      createdAt: scoredAt
    };

    summary.scored += 1;
    await repo.upsertByDomain({
      domain,
      status: "scored",
      fields: {
        ...companyFieldsForUpsert(lead),
        score: scoreDoc,
        filterReason: null
      },
      source: lead.source,
      scoreEntry
    });
  }

  return summary;
}

/** Company/signal/contact fields common to both scored and rejected upserts. */
function companyFieldsForUpsert(lead: MappedLead) {
  const { companyFields, signals, contacts } = lead;
  const fields: {
    companyName?: string;
    platform: string;
    country?: string;
    vertical?: string;
    employeeCount?: number;
    productCount?: number;
    signals: typeof signals;
    contacts: typeof contacts;
  } = {
    platform: companyFields.platform,
    signals,
    contacts
  };
  if (companyFields.companyName !== undefined) fields.companyName = companyFields.companyName;
  if (companyFields.country !== undefined) fields.country = companyFields.country;
  if (companyFields.vertical !== undefined) fields.vertical = companyFields.vertical;
  if (companyFields.employeeCount !== undefined) fields.employeeCount = companyFields.employeeCount;
  if (companyFields.productCount !== undefined) fields.productCount = companyFields.productCount;
  return fields;
}
