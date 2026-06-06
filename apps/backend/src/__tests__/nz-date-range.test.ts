import { describe, it, expect } from "vitest";

import { getTodayNZRange, getLast36Hours } from "../lib/nz-date-range.js";

describe("getTodayNZRange()", () => {
  it("returns from < to", () => {
    const { from, to } = getTodayNZRange();
    expect(from.getTime()).toBeLessThan(to.getTime());
  });

  it("range spans exactly 24 hours minus 1ms", () => {
    const { from, to } = getTodayNZRange();
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("from is midnight in Pacific/Auckland timezone", () => {
    const { from } = getTodayNZRange();
    const nzMidnight = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Auckland",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).format(from);
    expect(nzMidnight).toBe("00:00:00");
  });

  it("to is 23:59:59 in Pacific/Auckland timezone", () => {
    const { to } = getTodayNZRange();
    const nzEnd = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Auckland",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).format(to);
    expect(nzEnd).toBe("23:59:59");
  });

  it("from and to fall on the same NZ calendar date", () => {
    const { from, to } = getTodayNZRange();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" });
    expect(fmt.format(from)).toBe(fmt.format(to));
  });
});

describe("getLast36Hours()", () => {
  it("returns a date 36 hours before the reference", () => {
    const now = new Date("2026-06-06T14:00:00Z");
    const result = getLast36Hours(now);
    expect(result.toISOString()).toBe("2026-06-05T02:00:00.000Z");
  });
});
