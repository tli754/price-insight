import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseWorkbookBuffer } from "../import/xlsx-parser.js";

/** Build an in-memory .xlsx buffer from an array-of-arrays. */
function xlsxBuffer(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseWorkbookBuffer", () => {
  it("reads header-keyed rows from the first sheet, keeping numbers raw", () => {
    const buf = xlsxBuffer([
      ["Root Domain", "SKU", "Company"],
      ["a.com", 42, "Acme"]
    ]);
    const rows = parseWorkbookBuffer(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ "Root Domain": "a.com", SKU: 42, Company: "Acme" });
    expect(typeof rows[0].SKU).toBe("number");
  });

  it("fills blank cells with null so every header key is present", () => {
    const buf = xlsxBuffer([
      ["Root Domain", "Emails"],
      ["a.com", null]
    ]);
    const rows = parseWorkbookBuffer(buf);
    expect(rows[0]).toHaveProperty("Emails", null);
  });

  it("returns an empty array for a header-only sheet", () => {
    const buf = xlsxBuffer([["Root Domain", "SKU"]]);
    expect(parseWorkbookBuffer(buf)).toEqual([]);
  });
});
