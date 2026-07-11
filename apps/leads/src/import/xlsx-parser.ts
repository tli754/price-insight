// Read a BuiltWith/Store-Leads `.xlsx` export into raw header-keyed rows.
//
// Deliberately kept dumb: it only turns the first worksheet into an array of
// `Record<header, cellValue>`. All mapping/normalisation lives in `row-mapper`.
// Dates arrive as Excel serial numbers (we do NOT set `cellDates`) — the mapper
// converts them via `excelSerialToDate`.

import { readFileSync } from "node:fs";

import * as XLSX from "xlsx";

/** One spreadsheet row, keyed by the header cell text. */
export type RawRow = Record<string, unknown>;

/** Parse an already-loaded workbook buffer into rows from its first sheet. */
export function parseWorkbookBuffer(buf: Buffer | Uint8Array): RawRow[] {
  const wb = XLSX.read(buf);
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  if (!ws) return [];
  // `raw: true` keeps numbers/serials as-is; `defval: null` guarantees every
  // header key is present (even for blank cells) so mapping is total.
  return XLSX.utils.sheet_to_json<RawRow>(ws, { raw: true, defval: null });
}

/** Read an `.xlsx` file from disk into raw rows. */
export function parseXlsx(filePath: string): RawRow[] {
  return parseWorkbookBuffer(readFileSync(filePath));
}
