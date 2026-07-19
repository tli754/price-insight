import { describe, expect, it } from "vitest";

import { mapRow } from "../import/row-mapper.js";
import type { RawRow } from "../import/xlsx-parser.js";

const NOW = new Date("2026-07-12T00:00:00Z");

// A full, realistic row mirroring the 42-column Store-Leads export.
function fullRow(overrides: RawRow = {}): RawRow {
  return {
    "Root Domain": "karibou.co.nz",
    "Location on Site": "karibou.co.nz",
    "Primary Domain": "karibou.co.nz",
    "Technology Spend": 3634,
    "Sales Revenue": 84553,
    Social: 16300,
    Employees: null,
    SKU: 109,
    Company: "Karibou Kids",
    Vertical: "Style And Fashion",
    Tranco: null,
    "Page Rank": 29221352,
    Majestic: null,
    Umbrella: null,
    Telephones: null,
    Emails: "contact@karibou.co.nz\r\nsupport@karibou.co.nz",
    X: null,
    Twitter: null,
    Facebook: "facebook.com/mykaribou",
    LinkedIn: null,
    People: "Alyssa Karibou - Founder",
    "Verified Profiles": null,
    City: "Swanson",
    State: "AUK",
    Zip: 816,
    Country: "nz",
    "First Detected": 42731,
    "Last Found": 46212,
    "First Indexed": 46000,
    "Last Indexed": 46300,
    "eCommerce Platform": "Shopify\r\nShopify Hong Kong Dollar",
    "CMS Platform": null,
    "CRM Platform": null,
    "Marketing Automation Platform": "Klaviyo\r\nSimprosys",
    "Payment Platforms": "Afterpay\r\nApple Pay",
    "CRuX Rank": "Top 50m",
    "Cloudflare Rank": null,
    Agency: null,
    "Hosting Provider": "Shopify Hosted",
    AI: null,
    Exclusion: null,
    Compliance: null,
    ...overrides
  };
}

describe("mapRow — company fields", () => {
  it("maps and normalises core company fields", () => {
    const { companyFields } = mapRow(fullRow(), "file.xlsx", NOW);
    expect(companyFields.domain).toBe("karibou.co.nz");
    expect(companyFields.companyName).toBe("Karibou Kids");
    expect(companyFields.vertical).toBe("Style And Fashion");
    expect(companyFields.productCount).toBe(109);
    expect(companyFields.country).toBe("NZ"); // uppercased
    expect(companyFields.employeeCount).toBeUndefined(); // null cell omitted
  });

  it("takes the first line of a multi-line platform, lowercased", () => {
    const { companyFields } = mapRow(fullRow(), "file.xlsx", NOW);
    expect(companyFields.platform).toBe("shopify");
  });

  it("defaults platform to 'unknown' when blank", () => {
    const { companyFields } = mapRow(fullRow({ "eCommerce Platform": null }), "file.xlsx", NOW);
    expect(companyFields.platform).toBe("unknown");
  });

  it("returns null domain for a blank Root Domain", () => {
    const { companyFields, hardFilterInput } = mapRow(fullRow({ "Root Domain": "  " }), "f.xlsx", NOW);
    expect(companyFields.domain).toBeNull();
    expect(hardFilterInput.domain).toBeNull();
  });

  it("rejects non-domain-shaped garbage Root Domains (→ null → no_domain)", () => {
    const garbage = mapRow(
      fullRow({ "Root Domain": "compliance notice: pii is removed for eu" }),
      "f.xlsx",
      NOW
    );
    expect(garbage.companyFields.domain).toBeNull();
    expect(garbage.hardFilterInput.domain).toBeNull();

    // A dotless bare label is not a hostname either.
    expect(mapRow(fullRow({ "Root Domain": "localhost" }), "f.xlsx", NOW).companyFields.domain).toBeNull();

    // A normal value still maps (and is lowercased / stripped).
    expect(mapRow(fullRow({ "Root Domain": "Karibou.co.nz" }), "f.xlsx", NOW).companyFields.domain).toBe(
      "karibou.co.nz"
    );
  });
});

describe("mapRow — signals", () => {
  it("parses numbers, strings, dates and has* flags", () => {
    const { signals } = mapRow(fullRow(), "file.xlsx", NOW);
    expect(signals.salesRevenue).toBe(84553);
    expect(signals.technologySpend).toBe(3634);
    expect(signals.pageRank).toBe(29221352); // large page rank stays numeric
    expect(signals.socialFollowers).toBe(16300);
    expect(signals.cruxRank).toBe("Top 50m");
    expect(signals.marketingAutomation).toBe("Klaviyo\r\nSimprosys");
    expect(signals.hasMarketingAutomation).toBe(true);
    expect(signals.hasCrm).toBe(false);
    expect(signals.hasAi).toBe(false);
    // Excel serial → UTC date
    expect(signals.lastIndexed?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("omits numeric/date signals when cells are null (no NaN/invalid dates)", () => {
    const { signals, scoreInput } = mapRow(
      fullRow({
        "Sales Revenue": null,
        "Technology Spend": null,
        SKU: null,
        "Page Rank": null,
        Social: null,
        "First Detected": "not-a-date",
        "Last Found": null,
        "Last Indexed": null
      }),
      "file.xlsx",
      NOW
    );
    expect(signals.salesRevenue).toBeUndefined();
    expect(signals.firstDetected).toBeUndefined(); // non-numeric date → omitted
    expect(scoreInput.lastActivityAt).toBeNull();
    expect(scoreInput.prominenceRank).toBeNull();
  });
});

describe("mapRow — scoreInput.lastActivityAt", () => {
  it("is the later of Last Found and Last Indexed", () => {
    const { scoreInput } = mapRow(fullRow(), "file.xlsx", NOW);
    // Last Found 46212 (2026-07-09), Last Indexed 46300 (2026-10-05) → max
    expect(scoreInput.lastActivityAt?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("falls back to whichever date is present", () => {
    const { scoreInput } = mapRow(fullRow({ "Last Indexed": null }), "file.xlsx", NOW);
    expect(scoreInput.lastActivityAt?.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });
});

describe("mapRow — contacts", () => {
  it("splits emails, marks the first primary, and dedupes by (type,value)", () => {
    const { contacts, scoreInput } = mapRow(
      fullRow({ Emails: "a@x.com\r\nB@X.com\r\na@x.com" }),
      "file.xlsx",
      NOW
    );
    const emails = contacts.filter((c) => c.type === "email");
    expect(emails.map((c) => c.value)).toEqual(["a@x.com", "B@X.com"]); // deduped case-insensitively
    expect(emails[0].isPrimary).toBe(true);
    expect(emails[1].isPrimary).toBe(false);
    expect(scoreInput.hasEmail).toBe(true);
  });

  it("maps social columns with a network label and people to person", () => {
    const { contacts, scoreInput } = mapRow(fullRow(), "file.xlsx", NOW);
    const social = contacts.find((c) => c.type === "social");
    expect(social).toMatchObject({ type: "social", value: "facebook.com/mykaribou", label: "Facebook" });
    expect(contacts.some((c) => c.type === "person" && c.value === "Alyssa Karibou - Founder")).toBe(true);
    expect(scoreInput.hasNamedPerson).toBe(true);
    expect(scoreInput.hasPhone).toBe(false);
  });
});

describe("mapRow — source & hard-filter/score inputs", () => {
  it("attaches provenance and gate/score inputs", () => {
    const raw = fullRow();
    const { source, hardFilterInput, scoreInput } = mapRow(raw, "auckland.xlsx", NOW);
    expect(source).toMatchObject({ source: "store-leads", sourceFile: "auckland.xlsx", importedAt: NOW });
    expect(source.raw).toBe(raw);
    expect(hardFilterInput).toEqual({
      domain: "karibou.co.nz",
      country: "NZ",
      platform: "shopify",
      salesRevenue: 84553,
      productCount: 109
    });
    expect(scoreInput.prominenceRank).toBe(29221352); // Page Rank, not Tranco
  });
});
