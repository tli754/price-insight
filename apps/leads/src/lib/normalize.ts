// Pure normalization helpers shared by the importer, filter, and scorer.

/** Parse a spreadsheet cell into a number, tolerating "$", commas, blanks. */
export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a multi-value cell (emails/phones/people are newline-separated in the
 * export; also tolerate ';' and ','). Trims, drops blanks, de-dupes
 * case-insensitively while preserving first-seen order.
 */
export function splitMultiValue(raw: unknown): string[] {
  if (raw == null) return [];
  const parts = String(raw)
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Convert an Excel/1900 serial date number to a UTC Date (null if invalid). */
export function excelSerialToDate(serial: unknown): Date | null {
  const n = parseNumber(serial);
  if (n == null || n <= 0) return null;
  // Excel's day 0 is 1899-12-30 (accounting for the 1900 leap-year bug).
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalize a domain/URL to a bare lowercased host (no scheme/www/path). */
export function normalizeDomain(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase();
  if (s === "") return null;
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split(/[/?#]/)[0]; // strip path/query/fragment
  s = s.replace(/\.+$/, ""); // trailing dots
  return s === "" ? null : s;
}

/**
 * Midrank percentile of `value` within `sorted` (ascending), in [0,1].
 * Uses (below + 0.5*equal)/n so ties land at their average rank.
 */
export function percentileRank(value: number, sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (below + 0.5 * equal) / n;
}

/** Build a percentile function from a set of (nullable) values. */
export function percentileFn(values: Array<number | null>): (v: number | null) => number | null {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  return (v: number | null) => (v == null ? null : percentileRank(v, sorted));
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
