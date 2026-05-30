import { describe, it, expect, vi, afterEach } from "vitest";

import { DataForSeoService } from "../services/dataforseo-service.js";

const LOGIN = "test-login";
const PASSWORD = "test-password";

function makeService() {
  return new DataForSeoService(LOGIN, PASSWORD);
}

// ── Response builders ─────────────────────────────────────────────────────────

function makeTaskPostResponse(taskId = "task-001", statusCode = 20100) {
  return {
    tasks: [{ id: taskId, status_code: statusCode, status_message: "Task Created." }]
  };
}

function makeShoppingGetResponse(items: object[], statusCode = 20000) {
  return {
    tasks: [
      {
        id: "task-001",
        status_code: statusCode,
        result: [{ items }]
      }
    ]
  };
}

function makeShoppingItem(overrides: object = {}) {
  return {
    type: "google_shopping_serp",
    product_id: "prod-001",
    seller: "Store NZ",
    title: "Moka Pot",
    price: 79.99,
    currency: "NZD",
    old_price: 99.99,
    product_images: ["https://img.example.com/moka.jpg"],
    product_rating: { value: 4.5, votes_count: 120 },
    tags: ["SALE"],
    ...overrides
  };
}

function makeProductInfoGetResponse(sellers: object[], statusCode = 20000) {
  return {
    tasks: [
      {
        id: "task-002",
        status_code: statusCode,
        result: [
          {
            items: [
              {
                type: "product_info_element",
                product_id: "prod-001",
                title: "Moka Pot",
                images: ["https://img.example.com/moka.jpg"],
                sellers
              }
            ]
          }
        ]
      }
    ]
  };
}

function makeSeller(overrides: object = {}) {
  return {
    type: "product_seller",
    title: "Merchant NZ",
    url: "https://merchant.co.nz/moka-pot",
    seller_rating: { value: 4.2, votes_count: 55 },
    seller_review_count: 55,
    price: {
      current: 75.0,
      regular: 99.0,
      currency: "NZD",
      displayed_price: "$75.00"
    },
    delivery_info: {
      delivery_message: "Delivery $6.99",
      delivery_price: { current: 6.99 }
    },
    product_availability: "in_stock",
    ...overrides
  };
}

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(handler: (url: string, init?: RequestInit) => object) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = input.toString();
    const body = handler(url, init as RequestInit | undefined);
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

// ── createShoppingTask ────────────────────────────────────────────────────────

describe("DataForSeoService.createShoppingTask()", () => {
  it("returns the task ID from the POST response", async () => {
    mockFetch(() => makeTaskPostResponse("shopping-task-123"));
    const svc = makeService();
    const taskId = await svc.createShoppingTask("moka pot");
    expect(taskId).toBe("shopping-task-123");
  });

  it("sends Basic Auth header", async () => {
    const spy = mockFetch(() => makeTaskPostResponse("t1"));
    await makeService().createShoppingTask("moka pot");
    const [, init] = spy.mock.calls[0];
    const authHeader = (init as RequestInit).headers as Record<string, string>;
    expect(authHeader["Authorization"]).toMatch(/^Basic /);
  });

  it("includes correct request body fields", async () => {
    const spy = mockFetch(() => makeTaskPostResponse("t1"));
    await makeService().createShoppingTask("french press");
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toMatchObject({
      keyword: "french press",
      language_code: "en",
      location_code: 2554,
      price_min: 5
    });
  });

  it("throws DATAFORSEO_FAILED when POST returns non-OK HTTP status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("bad", { status: 500 }));
    await expect(makeService().createShoppingTask("moka")).rejects.toMatchObject({
      code: "DATAFORSEO_FAILED"
    });
  });

  it("throws DATAFORSEO_FAILED when no task ID in response", async () => {
    mockFetch(() => ({ tasks: [{ id: null, status_code: 20100 }] }));
    await expect(makeService().createShoppingTask("moka")).rejects.toMatchObject({
      code: "DATAFORSEO_FAILED"
    });
  });
});

// ── getShoppingCandidates ─────────────────────────────────────────────────────

describe("DataForSeoService.getShoppingCandidates()", () => {
  it("returns candidates from a ready response", async () => {
    mockFetch(() => makeShoppingGetResponse([makeShoppingItem()]));
    const svc = makeService();
    const candidates = await svc.getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].productId).toBe("prod-001");
    expect(candidates[0].seller).toBe("Store NZ");
    expect(candidates[0].price).toBe(79.99);
  });

  it("maps shopping item fields onto candidates", async () => {
    mockFetch(() => makeShoppingGetResponse([makeShoppingItem()]));
    const [c] = await makeService().getShoppingCandidates("task-001");
    expect(c.title).toBe("Moka Pot");
    expect(c.currency).toBe("NZD");
    expect(c.oldPrice).toBe(99.99);
    expect(c.thumbnail).toBe("https://img.example.com/moka.jpg");
    expect(c.rating).toBe(4.5);
    expect(c.reviewCount).toBe(120);
    expect(c.tag).toBe("SALE");
  });

  it("skips items with type !== google_shopping_serp", async () => {
    mockFetch(() =>
      makeShoppingGetResponse([
        makeShoppingItem({ type: "google_shopping_carousel" }),
        makeShoppingItem({ product_id: "prod-002" })
      ])
    );
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].productId).toBe("prod-002");
  });

  it("skips items with null product_id", async () => {
    mockFetch(() => makeShoppingGetResponse([makeShoppingItem({ product_id: null })]));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });

  it("skips items with null seller", async () => {
    mockFetch(() => makeShoppingGetResponse([makeShoppingItem({ seller: null })]));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });

  it("skips items with null price", async () => {
    mockFetch(() => makeShoppingGetResponse([makeShoppingItem({ price: null })]));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });

  it("skips items with currency !== NZD", async () => {
    mockFetch(() => makeShoppingGetResponse([makeShoppingItem({ currency: "AUD" })]));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });

  it("deduplicates by product_id:seller:title composite key", async () => {
    mockFetch(() =>
      makeShoppingGetResponse([makeShoppingItem(), makeShoppingItem(), makeShoppingItem({ product_id: "prod-002" })])
    );
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(2);
  });

  it("caps candidates at 20", async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      makeShoppingItem({ product_id: `prod-${i}` })
    );
    mockFetch(() => makeShoppingGetResponse(items));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(20);
  });

  it("retries when task status is 20100 (in queue)", async () => {
    let callCount = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      callCount++;
      const body = callCount === 1
        ? makeShoppingGetResponse([], 20100)
        : makeShoppingGetResponse([makeShoppingItem()]);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.useFakeTimers();
    const promise = makeService().getShoppingCandidates("task-001");
    await vi.runAllTimersAsync();
    const candidates = await promise;
    vi.useRealTimers();
    expect(callCount).toBe(2);
    expect(candidates).toHaveLength(1);
  });

  it("retries when task status is 40602 (task in queue)", async () => {
    let callCount = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      callCount++;
      const body = callCount === 1
        ? makeShoppingGetResponse([], 40602)
        : makeShoppingGetResponse([makeShoppingItem()]);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.useFakeTimers();
    const promise = makeService().getShoppingCandidates("task-001");
    await vi.runAllTimersAsync();
    const candidates = await promise;
    vi.useRealTimers();
    expect(callCount).toBe(2);
    expect(candidates).toHaveLength(1);
  });

  it("returns empty array when status is not 20000 or 20100", async () => {
    mockFetch(() => makeShoppingGetResponse([], 40400));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });

  it("returns empty array when items is null", async () => {
    mockFetch(() => ({
      tasks: [{ id: "t", status_code: 20000, result: [{ items: null }] }]
    }));
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });
});

// ── createProductInfoTask ─────────────────────────────────────────────────────

describe("DataForSeoService.createProductInfoTask()", () => {
  it("returns the task ID", async () => {
    mockFetch(() => makeTaskPostResponse("info-task-456"));
    const taskId = await makeService().createProductInfoTask("prod-001");
    expect(taskId).toBe("info-task-456");
  });

  it("sends the correct product_id in request body", async () => {
    const spy = mockFetch(() => makeTaskPostResponse("t"));
    await makeService().createProductInfoTask("pid-999");
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0].product_id).toBe("pid-999");
  });
});

// ── getProductInfoResults ─────────────────────────────────────────────────────

const CANDIDATE = {
  productId: "prod-001",
  seller: "Store NZ",
  title: "Moka Pot",
  price: 79.99,
  currency: "NZD",
  oldPrice: null,
  thumbnail: "https://img.example.com/moka.jpg",
  rating: null,
  reviewCount: null,
  tag: null
};

describe("DataForSeoService.getProductInfoResults()", () => {
  it("maps seller fields onto CompetitorResult", async () => {
    mockFetch(() => makeProductInfoGetResponse([makeSeller()]));
    const [result] = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(result.source).toBe("Merchant NZ");
    expect(result.link).toBe("https://merchant.co.nz/moka-pot");
    expect(result.extractedPrice).toBe(75.0);
    expect(result.rawPrice).toBe("$75.00");
    expect(result.extractedOldPrice).toBe(99.0);
    expect(result.currency).toBe("NZD");
    expect(result.rating).toBe(4.2);
    expect(result.reviewCount).toBe(55);
    expect(result.shippingRaw).toBe("Delivery $6.99");
    expect(result.shippingExtracted).toBe(6.99);
  });

  it("inherits title, externalId, thumbnail from product info item", async () => {
    mockFetch(() => makeProductInfoGetResponse([makeSeller()]));
    const [result] = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(result.title).toBe("Moka Pot");
    expect(result.externalId).toBe("prod-001");
    expect(result.thumbnail).toBe("https://img.example.com/moka.jpg");
  });

  it("derives country from seller URL", async () => {
    mockFetch(() => makeProductInfoGetResponse([makeSeller()]));
    const [result] = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(result.country).toBe("NZ");
  });

  it("sets fixed null fields", async () => {
    mockFetch(() => makeProductInfoGetResponse([makeSeller()]));
    const [result] = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(result.googlePosition).toBeNull();
    expect(result.totalRaw).toBeNull();
    expect(result.totalExtracted).toBeNull();
    expect(result.sourceIcon).toBeNull();
    expect(result.tag).toBeNull();
  });

  it("drops sellers missing title", async () => {
    mockFetch(() => makeProductInfoGetResponse([makeSeller({ title: null })]));
    const results = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(results).toHaveLength(0);
  });

  it("drops sellers missing url", async () => {
    mockFetch(() => makeProductInfoGetResponse([makeSeller({ url: null })]));
    const results = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(results).toHaveLength(0);
  });

  it("drops sellers with null price.current", async () => {
    mockFetch(() =>
      makeProductInfoGetResponse([makeSeller({ price: { current: null, regular: null, currency: "NZD", displayed_price: null } })])
    );
    const results = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(results).toHaveLength(0);
  });

  it("drops sellers with currency !== NZD", async () => {
    mockFetch(() =>
      makeProductInfoGetResponse([makeSeller({ price: { current: 75, regular: null, currency: "AUD", displayed_price: "$75.00" } })])
    );
    const results = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(results).toHaveLength(0);
  });

  it("returns results from multiple valid sellers", async () => {
    mockFetch(() =>
      makeProductInfoGetResponse([
        makeSeller({ title: "Store A", url: "https://storea.co.nz/p" }),
        makeSeller({ title: "Store B", url: "https://storeb.co.nz/p" })
      ])
    );
    const results = await makeService().getProductInfoResults("task-002", CANDIDATE);
    expect(results).toHaveLength(2);
  });

  it("returns empty array when task times out", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(makeProductInfoGetResponse([], 20100)), { status: 200 })
    );
    vi.useFakeTimers();
    const promise = makeService().getProductInfoResults("task-002", CANDIDATE);
    await vi.runAllTimersAsync();
    const results = await promise;
    vi.useRealTimers();
    expect(results).toHaveLength(0);
  });
});

// ── searchShoppingPrices ──────────────────────────────────────────────────────

describe("DataForSeoService.searchShoppingPrices()", () => {
  it("returns CompetitorResults from end-to-end flow", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("products/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
      if (url.includes("products/task_get")) return new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem()])), { status: 200 });
      if (url.includes("product_info/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("i-task")), { status: 200 });
      if (url.includes("product_info/task_get")) return new Response(JSON.stringify(makeProductInfoGetResponse([makeSeller()])), { status: 200 });
      return new Response("{}", { status: 200 });
    });

    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].extractedPrice).toBe(75.0);
    expect(results[0].currency).toBe("NZD");
  });

  it("returns empty array when Shopping task yields no candidates", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("products/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
      if (url.includes("products/task_get")) return new Response(JSON.stringify(makeShoppingGetResponse([])), { status: 200 });
      return new Response("{}", { status: 200 });
    });

    const results = await makeService().searchShoppingPrices("no results query");
    expect(results).toHaveLength(0);
  });

  it("continues when one Product Info task fails", async () => {
    let callCount = 0;
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("products/task_post")) {
        return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
      }
      if (url.includes("products/task_get")) {
        return new Response(
          JSON.stringify(makeShoppingGetResponse([
            makeShoppingItem({ product_id: "p1" }),
            makeShoppingItem({ product_id: "p2" })
          ])),
          { status: 200 }
        );
      }
      if (url.includes("product_info/task_post")) {
        callCount++;
        if (callCount === 1) return new Response("error", { status: 500 });
        return new Response(JSON.stringify(makeTaskPostResponse("i-task")), { status: 200 });
      }
      if (url.includes("product_info/task_get")) {
        return new Response(JSON.stringify(makeProductInfoGetResponse([makeSeller()])), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const results = await makeService().searchShoppingPrices("moka pot");
    // First candidate failed, second succeeded — should still get results
    expect(results.length).toBeGreaterThan(0);
  });
});
