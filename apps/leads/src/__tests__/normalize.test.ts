import { describe, expect, it } from "vitest";

import {
  excelSerialToDate,
  normalizeDomain,
  parseNumber,
  percentileFn,
  percentileRank,
  splitMultiValue
} from "../lib/normalize.js";

describe("parseNumber", () => {
  it("parses plain and messy numbers", () => {
    expect(parseNumber("84553")).toBe(84553);
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber(42)).toBe(42);
  });
  it("returns null for blanks/garbage", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
});

describe("splitMultiValue", () => {
  it("splits newline-separated emails and de-dupes case-insensitively", () => {
    expect(splitMultiValue("a@x.com\nB@X.com\na@x.com")).toEqual(["a@x.com", "B@X.com"]);
  });
  it("handles blanks", () => {
    expect(splitMultiValue("")).toEqual([]);
    expect(splitMultiValue(null)).toEqual([]);
  });
});

describe("excelSerialToDate", () => {
  it("converts a known serial (44197 = 2021-01-01)", () => {
    const d = excelSerialToDate(44197);
    expect(d?.toISOString().slice(0, 10)).toBe("2021-01-01");
  });
  it("rejects invalid", () => {
    expect(excelSerialToDate(0)).toBeNull();
    expect(excelSerialToDate("")).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("strips scheme/www/path", () => {
    expect(normalizeDomain("https://www.Karibou.co.nz/collections/x")).toBe("karibou.co.nz");
    expect(normalizeDomain("KARIBOU.CO.NZ.")).toBe("karibou.co.nz");
  });
  it("returns null for empty", () => {
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("percentileRank / percentileFn", () => {
  it("ranks within a set (midrank for ties)", () => {
    const sorted = [1, 2, 3, 4];
    expect(percentileRank(1, sorted)).toBeCloseTo(0.125, 5);
    expect(percentileRank(4, sorted)).toBeCloseTo(0.875, 5);
  });
  it("percentileFn ignores nulls in the population and for the query", () => {
    const fn = percentileFn([10, null, 20, 30]);
    expect(fn(null)).toBeNull();
    expect(fn(30)).toBeCloseTo(0.8333, 3);
  });
});
