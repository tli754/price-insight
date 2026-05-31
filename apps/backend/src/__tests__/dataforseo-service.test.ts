import { describe, it, expect, vi, afterEach } from "vitest";

import { DataForSeoService } from "../services/dataforseo-service.js";

const LOGIN = "test-login";
const PASSWORD = "test-password";

function makeService() {
  return new DataForSeoService(LOGIN, PASSWORD);
}

// ── Response builders ─────────────────────────────────────────────────────────

function makeTaskPostResponse(taskId = "task-001") {
  return {
    tasks: [{ id: taskId, status_code: 20100, status_message: "Task Created." }]
  };
}

function makeShoppingGetResponse(items: object[], statusCode = 20000) {
  return {
    tasks: [{ status_code: statusCode, result: [{ items }] }]
  };
}

function makePendingResponse(statusCode = 40601) {
  return { tasks: [{ status_code: statusCode, result: null }] };
}

function makeShoppingItem(overrides: object = {}) {
  return {
    type: "google_shopping_serp",
    rank_absolute: 1,
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
        status_code: statusCode,
        result: [
          {
            items: [
              {
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
    title: "Merchant NZ",
    url: "https://merchant.co.nz/moka-pot",
    seller_rating: { value: 4.2, votes_count: 55 },
    seller_review_count: null,
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
    ...overrides
  };
}

// Full flow mock: handles all 4 endpoint types using direct task_get polling
function mockFullFlow(shoppingItems: object[] = [makeShoppingItem()], sellers: object[] = [makeSeller()]) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = input.toString();
    if (url.includes("products/task_post"))
      return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
    if (url.includes("products/task_get"))
      return new Response(JSON.stringify(makeShoppingGetResponse(shoppingItems)), { status: 200 });
    if (url.includes("product_info/task_post"))
      return new Response(JSON.stringify(makeTaskPostResponse("i-task")), { status: 200 });
    if (url.includes("product_info/task_get"))
      return new Response(JSON.stringify(makeProductInfoGetResponse(sellers)), { status: 200 });
    return new Response("{}", { status: 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

// ── createShoppingTask ────────────────────────────────────────────────────────

describe("DataForSeoService.createShoppingTask()", () => {
  it("returns the task ID from the POST response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(makeTaskPostResponse("shopping-task-123")), { status: 200 }));
    const taskId = await makeService().createShoppingTask("moka pot");
    expect(taskId).toBe("shopping-task-123");
  });

  it("sends Basic Auth header", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(makeTaskPostResponse("t1")), { status: 200 }));
    await makeService().createShoppingTask("moka pot");
    const [, init] = spy.mock.calls[0];
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
  });

  it("includes correct request body fields", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(makeTaskPostResponse("t1")), { status: 200 }));
    await makeService().createShoppingTask("french press");
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toMatchObject({ keyword: "french press", language_code: "en", location_code: 2554, price_min: 5 });
  });

  it("throws DATAFORSEO_FAILED on non-OK HTTP status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("bad", { status: 500 }));
    await expect(makeService().createShoppingTask("moka")).rejects.toMatchObject({ code: "DATAFORSEO_FAILED" });
  });

  it("throws DATAFORSEO_FAILED when no task ID in response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ tasks: [{ id: null }] }), { status: 200 }));
    await expect(makeService().createShoppingTask("moka")).rejects.toMatchObject({ code: "DATAFORSEO_FAILED" });
  });
});

// ── getShoppingCandidates ─────────────────────────────────────────────────────

describe("DataForSeoService.getShoppingCandidates()", () => {
  it("returns candidates from a ready task_get response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem()])), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].productId).toBe("prod-001");
    expect(candidates[0].price).toBe(79.99);
  });

  it("polls task_get until status 20000", async () => {
    let callCount = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      callCount++;
      const body = callCount < 2
        ? makePendingResponse()
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

  it("returns empty array when task_get never returns 20000", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(makePendingResponse()), { status: 200 })
    );
    vi.useFakeTimers();
    const promise = makeService().getShoppingCandidates("task-001");
    await vi.runAllTimersAsync();
    const candidates = await promise;
    vi.useRealTimers();
    expect(candidates).toHaveLength(0);
  });

  it("returns empty array on unexpected (non-pending) status code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tasks: [{ status_code: 40501, result: null }] }), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("task-001");
    expect(candidates).toHaveLength(0);
  });

  it("maps rank_absolute to googlePosition", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem({ rank_absolute: 5 })])), { status: 200 })
    );
    const [c] = await makeService().getShoppingCandidates("t");
    expect(c.googlePosition).toBe(5);
  });

  it("maps tag from tags[0]", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem({ tags: ["SALE"] })])), { status: 200 })
    );
    const [c] = await makeService().getShoppingCandidates("t");
    expect(c.tag).toBe("SALE");
  });

  it("skips items with type !== google_shopping_serp", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([
        makeShoppingItem({ type: "google_shopping_carousel" }),
        makeShoppingItem({ product_id: "prod-002" })
      ])), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("t");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].productId).toBe("prod-002");
  });

  it("skips items with null product_id", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem({ product_id: null })])), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("t");
    expect(candidates).toHaveLength(0);
  });

  it("skips items with currency !== NZD", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem({ currency: "AUD" })])), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("t");
    expect(candidates).toHaveLength(0);
  });

  it("deduplicates by product_id:seller:title key", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse([
        makeShoppingItem(), makeShoppingItem(), makeShoppingItem({ product_id: "prod-002" })
      ])), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("t");
    expect(candidates).toHaveLength(2);
  });

  it("caps candidates at 40", async () => {
    const items = Array.from({ length: 45 }, (_, i) => makeShoppingItem({ product_id: `prod-${i}` }));
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(makeShoppingGetResponse(items)), { status: 200 })
    );
    const candidates = await makeService().getShoppingCandidates("t");
    expect(candidates).toHaveLength(40);
  });
});

// ── createProductInfoTask ─────────────────────────────────────────────────────

describe("DataForSeoService.createProductInfoTask()", () => {
  it("returns the task ID", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(makeTaskPostResponse("info-task-456")), { status: 200 }));
    const taskId = await makeService().createProductInfoTask("prod-001");
    expect(taskId).toBe("info-task-456");
  });

  it("sends the correct product_id in request body", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(makeTaskPostResponse("t")), { status: 200 }));
    await makeService().createProductInfoTask("pid-999");
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0].product_id).toBe("pid-999");
  });
});

// ── searchShoppingPrices ──────────────────────────────────────────────────────

describe("DataForSeoService.searchShoppingPrices()", () => {
  it("returns CompetitorResults from end-to-end flow", async () => {
    mockFullFlow();
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].extractedPrice).toBe(75.0);
    expect(results[0].currency).toBe("NZD");
  });

  it("maps seller fields correctly onto CompetitorResult", async () => {
    mockFullFlow();
    const [result] = await makeService().searchShoppingPrices("moka pot");
    expect(result.source).toBe("Merchant NZ");
    expect(result.link).toBe("https://merchant.co.nz/moka-pot");
    expect(result.rawPrice).toBe("$75.00");
    expect(result.extractedOldPrice).toBe(99.0);
    expect(result.rating).toBe(4.2);
    expect(result.reviewCount).toBe(55);
    expect(result.shippingRaw).toBe("Delivery $6.99");
    expect(result.shippingExtracted).toBe(6.99);
    expect(result.country).toBe("NZ");
  });

  it("reads seller_review_count from top-level field", async () => {
    mockFullFlow(undefined, [makeSeller({ seller_review_count: 42 })]);
    const [result] = await makeService().searchShoppingPrices("moka pot");
    expect(result.reviewCount).toBe(42);
  });

  it("carries tag from shopping candidate to CompetitorResult", async () => {
    mockFullFlow([makeShoppingItem({ tags: ["SALE"] })]);
    const [result] = await makeService().searchShoppingPrices("moka pot");
    expect(result.tag).toBe("SALE");
  });

  it("carries googlePosition from shopping candidate to CompetitorResult", async () => {
    mockFullFlow([makeShoppingItem({ rank_absolute: 3 })]);
    const [result] = await makeService().searchShoppingPrices("moka pot");
    expect(result.googlePosition).toBe(3);
  });

  it("drops sellers with currency !== NZD", async () => {
    mockFullFlow(undefined, [makeSeller({ price: { current: 75, regular: null, currency: "AUD", displayed_price: "$75.00" } })]);
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results).toHaveLength(0);
  });

  it("drops sellers missing title", async () => {
    mockFullFlow(undefined, [makeSeller({ title: null })]);
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results).toHaveLength(0);
  });

  it("drops sellers missing url", async () => {
    mockFullFlow(undefined, [makeSeller({ url: null })]);
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results).toHaveLength(0);
  });

  it("drops sellers with null price.current", async () => {
    mockFullFlow(undefined, [makeSeller({ price: { current: null, regular: null, currency: "NZD", displayed_price: null } })]);
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results).toHaveLength(0);
  });

  it("returns empty array when Shopping task yields no candidates", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("products/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
      if (url.includes("products/task_get")) return new Response(JSON.stringify(makeShoppingGetResponse([])), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const results = await makeService().searchShoppingPrices("no results");
    expect(results).toHaveLength(0);
  });

  it("continues when one Product Info task_post fails", async () => {
    let infoPostCount = 0;
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("products/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
      if (url.includes("products/task_get")) return new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem({ product_id: "p1" }), makeShoppingItem({ product_id: "p2" })])), { status: 200 });
      if (url.includes("product_info/task_post")) {
        infoPostCount++;
        if (infoPostCount === 1) return new Response("error", { status: 500 });
        return new Response(JSON.stringify(makeTaskPostResponse("i-task")), { status: 200 });
      }
      if (url.includes("product_info/task_get")) return new Response(JSON.stringify(makeProductInfoGetResponse([makeSeller()])), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results.length).toBeGreaterThan(0);
  });

  it("skips candidate when product_info task_get times out", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("products/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("s-task")), { status: 200 });
      if (url.includes("products/task_get")) return new Response(JSON.stringify(makeShoppingGetResponse([makeShoppingItem()])), { status: 200 });
      if (url.includes("product_info/task_post")) return new Response(JSON.stringify(makeTaskPostResponse("i-task")), { status: 200 });
      if (url.includes("product_info/task_get")) return new Response(JSON.stringify(makePendingResponse()), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    vi.useFakeTimers();
    const promise = makeService().searchShoppingPrices("moka pot");
    await vi.runAllTimersAsync();
    const results = await promise;
    vi.useRealTimers();
    expect(results).toHaveLength(0);
  });

  it("returns multiple results from multiple valid sellers", async () => {
    mockFullFlow(undefined, [
      makeSeller({ title: "Store A", url: "https://storea.co.nz/p" }),
      makeSeller({ title: "Store B", url: "https://storeb.co.nz/p" })
    ]);
    const results = await makeService().searchShoppingPrices("moka pot");
    expect(results).toHaveLength(2);
  });
});
