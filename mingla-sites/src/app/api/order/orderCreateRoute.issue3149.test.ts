/*
 * #3149 — THE ROUTE, RUN. Not read.
 *
 * `serverPricedOrder.issue2830.test.ts` reads this file as text, and that is
 * how a shape that never existed on the wire survived five rounds of green
 * tests. So this one imports the real handler, hands it a real Request, and
 * stubs only the two things a test genuinely cannot have: the published
 * artifact and Mingla's own edge function.
 *
 * The three endings `venue-order-create` can give a create are each exercised
 * here, end to end, plus the two things this route exists to guarantee — that
 * the venue comes from the artifact and that no price is ever forwarded.
 *
 * fails-on-revert verified at b8050c655 — with `api/order/route.ts` restored to
 * origin/main, the refusal-name test and all six attribution tests fail. The
 * pass-through tests keep passing, which is correct: that half already worked
 * and these pin that #3149 did not break it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, loadPublication, normalizePublicHost, runtimeConfig, signedCorePost } = vi
  .hoisted(() => ({
    headers: vi.fn(),
    loadPublication: vi.fn(),
    normalizePublicHost: vi.fn(),
    runtimeConfig: vi.fn(),
    signedCorePost: vi.fn(),
  }));

vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../lib/publication", () => ({ loadPublication, normalizePublicHost }));
vi.mock("../../../lib/config", () => ({ runtimeConfig }));
vi.mock("../../../lib/coreGateway", () => ({ signedCorePost }));

import { POST } from "./route";

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const VENUE_ID = "55555555-6666-4777-8888-999999999999";
const ORDER_ID = "99999999-8888-4777-8666-555555555555";
const ITEM_A = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const ITEM_B = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const TOKEN = "T".repeat(43);

let coreReply: { ok: boolean; status: number; body: unknown };
let forwarded: Record<string, unknown>[] = [];

const post = (body: unknown) =>
  POST(
    new Request("https://gogi.sites.usemingla.com/api/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const createBody = (over: Record<string, unknown> = {}) => ({
  mode: "create",
  lines: [{ menuItemId: ITEM_A, quantity: 2 }],
  buyer: { name: "Ada Nwosu", email: "ada@example.com", phone: "+2348012345678" },
  idempotencyKey: "sites:11111111-2222-4333-8444-555555555555",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  forwarded = [];
  coreReply = { ok: true, status: 200, body: { kind: "preview", totalCents: 1700000 } };
  headers.mockResolvedValue(new Headers({ host: "gogi.sites.usemingla.com" }));
  normalizePublicHost.mockImplementation((value: string | null) => value ?? "");
  loadPublication.mockResolvedValue({
    artifact: {
      site_id: SITE_ID,
      pages: [{ blocks: [{ type: "menu_board", venue_id: VENUE_ID }] }],
    },
  });
  runtimeConfig.mockReturnValue({ coreBaseUrl: "https://core.invalid" });
  signedCorePost.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    forwarded.push(JSON.parse(String(init?.body)));
    return {
      ok: coreReply.ok,
      status: coreReply.status,
      json: async () => coreReply.body,
    };
  }) as unknown as typeof globalThis.fetch;
});

describe("#3149 the route hands the basket to the venue-order rail", () => {
  it("forwards a create with the buyer, the key, and the venue from the ARTIFACT", async () => {
    coreReply = {
      ok: true,
      status: 200,
      body: { kind: "free_completed", orderId: ORDER_ID, buyerStatusToken: "bst" },
    };
    // A caller naming somebody else's kitchen is ignored, not honoured.
    const response = await post(createBody({ venueId: "11111111-1111-4111-8111-111111111111" }));
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].venueId).toBe(VENUE_ID);
    expect(forwarded[0].mode).toBe("create");
    expect(forwarded[0].surface).toBe("web");
    expect(forwarded[0].src).toBe("mingla_sites");
    expect(forwarded[0].buyer).toEqual({
      name: "Ada Nwosu",
      email: "ada@example.com",
      phone: "+2348012345678",
    });
    expect(forwarded[0].idempotencyKey).toBe("sites:11111111-2222-4333-8444-555555555555");
  });

  it("passes free_completed through unchanged", async () => {
    coreReply = {
      ok: true,
      status: 200,
      body: {
        kind: "free_completed",
        orderId: ORDER_ID,
        buyerStatusToken: "bst-value",
        totalCents: 0,
        currency: "NGN",
      },
    };
    const response = await post(createBody());
    expect(await response.json()).toEqual(coreReply.body);
  });

  it("passes requires_paystack_redirect through unchanged", async () => {
    coreReply = {
      ok: true,
      status: 200,
      body: {
        kind: "requires_paystack_redirect",
        orderId: ORDER_ID,
        authorizationUrl: "https://checkout.paystack.com/abcdef123456",
        currency: "NGN",
      },
    };
    const response = await post(createBody());
    const seen = await response.json() as Record<string, unknown>;
    expect(seen.kind).toBe("requires_paystack_redirect");
    expect(seen.authorizationUrl).toBe("https://checkout.paystack.com/abcdef123456");
  });

  it("passes already_created through, so a replay is never a second order", async () => {
    coreReply = {
      ok: true,
      status: 200,
      body: {
        kind: "already_created",
        orderId: ORDER_ID,
        totalCents: 1700000,
        currency: "NGN",
        paymentStatus: "pending",
      },
    };
    const response = await post(createBody());
    expect(await response.json()).toEqual(coreReply.body);
    expect(forwarded).toHaveLength(1);
  });

  it("strips a price a tampered browser tries to smuggle in", async () => {
    await post(createBody({
      lines: [
        { menuItemId: ITEM_A, quantity: 1, unitPriceCents: 1, lineTotalCents: 1 },
        { menuItemId: ITEM_B, quantity: 3 },
      ],
      totalCents: 1,
      currency: "USD",
    }));
    const sent = forwarded[0];
    expect(sent).not.toHaveProperty("totalCents");
    expect(sent).not.toHaveProperty("currency");
    for (const line of sent.lines as Record<string, unknown>[]) {
      expect(Object.keys(line).sort()).toEqual(["menuItemId", "modifierIds", "notes", "quantity"]);
    }
    expect((sent.lines as Record<string, unknown>[]).map((line) => line.quantity)).toEqual([1, 3]);
  });

  it("keeps a refusal's own name instead of calling everything unavailable", async () => {
    coreReply = { ok: false, status: 429, body: { error: "too_many_orders", message: "..." } };
    const response = await post(createBody());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "too_many_orders" });
  });

  it("does not pass a refusal's prose or an unrecognised code through", async () => {
    coreReply = { ok: false, status: 500, body: { error: { nested: "surprise" } } };
    const response = await post(createBody());
    expect(await response.json()).toEqual({ ok: false, error: "ordering_unavailable" });
  });

  it("refuses to order when the published site names no venue", async () => {
    loadPublication.mockResolvedValue({
      artifact: { site_id: SITE_ID, pages: [{ blocks: [{ type: "gallery" }] }] },
    });
    const response = await post(createBody());
    expect(response.status).toBe(409);
    expect(forwarded).toHaveLength(0);
  });
});

describe("#3149 the site is credited for the sale it produced", () => {
  it("spends the attribution touch on the order Mingla just wrote", async () => {
    coreReply = {
      ok: true,
      status: 200,
      body: { kind: "requires_paystack_redirect", orderId: ORDER_ID, authorizationUrl: "https://checkout.paystack.com/x" },
    };
    await post(createBody({ siteAttributionToken: TOKEN }));
    expect(signedCorePost).toHaveBeenCalledTimes(1);
    expect(signedCorePost).toHaveBeenCalledWith({
      edgeFunction: "brand-site-attribution",
      path: `/internal/v1/sites/${SITE_ID}/attribution/consume`,
      siteId: SITE_ID,
      body: { action: "consume", site_id: SITE_ID, token: TOKEN, order_id: ORDER_ID },
    });
  });

  it("never forwards the token to the order rail — it is spent here", async () => {
    coreReply = { ok: true, status: 200, body: { kind: "free_completed", orderId: ORDER_ID } };
    await post(createBody({ siteAttributionToken: TOKEN }));
    expect(forwarded[0]).not.toHaveProperty("siteAttributionToken");
  });

  it("binds nothing when the order was refused", async () => {
    coreReply = { ok: false, status: 429, body: { error: "too_many_orders" } };
    await post(createBody({ siteAttributionToken: TOKEN }));
    expect(signedCorePost).not.toHaveBeenCalled();
  });

  it("binds nothing for a preview, which creates no order", async () => {
    coreReply = { ok: true, status: 200, body: { kind: "preview", totalCents: 1700000 } };
    await post({ mode: "preview", lines: [{ menuItemId: ITEM_A, quantity: 1 }], siteAttributionToken: TOKEN });
    expect(signedCorePost).not.toHaveBeenCalled();
  });

  it("ignores a token that is not the shape /api/attribution mints", async () => {
    coreReply = { ok: true, status: 200, body: { kind: "free_completed", orderId: ORDER_ID } };
    await post(createBody({ siteAttributionToken: "../../etc/passwd" }));
    expect(signedCorePost).not.toHaveBeenCalled();
  });

  it("a binding failure never changes the answer the guest gets", async () => {
    signedCorePost.mockRejectedValue(new Error("SITE_SCOPE_MISMATCH"));
    coreReply = {
      ok: true,
      status: 200,
      body: { kind: "free_completed", orderId: ORDER_ID, buyerStatusToken: "bst" },
    };
    const response = await post(createBody({ siteAttributionToken: TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(coreReply.body);
  });
});
