import type { WithId } from "mongodb";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { CompanyDoc, Contact } from "../db/collections.js";
import { lifecycleStatusSchema } from "../db/collections.js";
import { AppError } from "../lib/app-error.js";
import { runImport, type ImportSummary } from "../import/importer.js";
import { parseWorkbookBuffer } from "../import/xlsx-parser.js";

// Query params arrive as strings, so numbers are coerced. Unknown sort/order
// values and out-of-range page sizes fail Zod → 400 via the app error handler.
const listQuerySchema = z.object({
  status: lifecycleStatusSchema.optional(),
  platform: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  minScore: z.coerce.number().optional(),
  sort: z.enum(["score", "company"]).default("score"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});

const statusBodySchema = z.object({
  status: lifecycleStatusSchema
});

/** Compact row for the dashboard list — the pinned contract Agent E consumes. */
export interface LeadListItem {
  id: string;
  domain: string;
  companyName: string | null;
  platform: string;
  country: string | null;
  vertical: string | null;
  status: CompanyDoc["status"];
  scoreOverall: number | null;
  reasons: string[];
  primaryEmail: string | null;
}

/** Pick the best email contact: the primary flag first, else the first email. */
function primaryEmail(contacts: Contact[]): string | null {
  const emails = contacts.filter((c) => c.type === "email");
  const chosen = emails.find((c) => c.isPrimary) ?? emails[0];
  return chosen?.value ?? null;
}

function toListItem(doc: WithId<CompanyDoc>): LeadListItem {
  return {
    id: doc._id.toString(),
    domain: doc.domain,
    companyName: doc.companyName ?? null,
    platform: doc.platform,
    country: doc.country ?? null,
    vertical: doc.vertical ?? null,
    status: doc.status,
    scoreOverall: doc.score?.overall ?? null,
    reasons: doc.score?.reasons ?? [],
    primaryEmail: primaryEmail(doc.contacts)
  };
}

const leadsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/leads — filter/sort/paginate; default score.overall desc.
  fastify.get("/leads", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { items, total } = await fastify.companyRepository.list(query);
    return {
      items: items.map(toListItem),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  });

  // GET /api/leads/:id — the full company document (with `id`); 404 if missing.
  fastify.get("/leads/:id", async (request) => {
    const { id } = request.params as { id: string };
    const doc = await fastify.companyRepository.getById(id);
    if (!doc) {
      throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
    }
    const { _id, ...rest } = doc;
    return { id: _id.toString(), ...rest };
  });

  // PATCH /api/leads/:id/status — update lifecycle status; 400 invalid, 404 missing.
  fastify.patch("/leads/:id/status", async (request) => {
    const { id } = request.params as { id: string };
    const { status } = statusBodySchema.parse(request.body);
    const updated = await fastify.companyRepository.updateStatus(id, status);
    if (!updated) {
      throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
    }
    return { ok: true, status };
  });

  // POST /api/leads/import — upload an xlsx and run it through the same
  // parse/map/filter/score/upsert pipeline as `tsx src/cli.ts import`.
  fastify.post("/leads/import", async (request): Promise<ImportSummary> => {
    if (!request.isMultipart()) {
      throw new AppError(400, "INVALID_CONTENT_TYPE", "Expected a multipart/form-data upload.");
    }

    const data = await request.file();
    if (!data) {
      throw new AppError(400, "NO_FILE", "No file was uploaded.");
    }
    if (!data.filename.toLowerCase().endsWith(".xlsx")) {
      throw new AppError(400, "INVALID_FILE_TYPE", "Only .xlsx files are supported.");
    }

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      if (err instanceof fastify.multipartErrors.RequestFileTooLargeError) {
        throw new AppError(413, "FILE_TOO_LARGE", "File exceeds the 10MB upload limit.");
      }
      throw err;
    }

    let rows: ReturnType<typeof parseWorkbookBuffer>;
    try {
      rows = parseWorkbookBuffer(buffer);
    } catch {
      throw new AppError(400, "INVALID_XLSX", "Could not parse the uploaded file as an xlsx workbook.");
    }

    return runImport(data.filename, {
      repo: fastify.companyRepository,
      readRows: () => rows
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 3 (documented only — NOT implemented here): manual AI trigger.
  //   POST /api/leads/analyze { ids: string[] }
  // Enqueues the selected companies for OpenAI analysis. Per Tao's decision, AI
  // is manually triggered post-crawl — there is NO automatic score-gate. The
  // `AI_SCORE_THRESHOLD` config stays advisory (a ranking hint for the UI), not
  // a gate. Crawl (P2) and AI analysis (P3) land in later phases.
  // ---------------------------------------------------------------------------
};

export default leadsRoutes;
