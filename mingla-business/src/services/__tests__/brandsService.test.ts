/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    // #1062 [biz-jest-residual-burndown] Wave 1 / B3c [TEST-MOD-APPROVED ORCH-1062] —
    // getBrands precheck-reads supabase.auth.getSession() (META-ORCH-1232/1235) and
    // throws without a session, so the mock needs `auth`. Sourced from the shared
    // supabaseMock (defaults signed-in). Plumbing only.
    auth: require("./__helpers__/supabaseMock").createSupabaseAuthMock(),
  },
}));

// appsFlyerService transitively imports react-native — stub it for Node tests.
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import {
  aggregateBrandStatsByBrandIds,
  getBrands,
} from "../brandsService";
// #1062 [biz-jest-residual-burndown] Wave 1 / B3c — shared chainable supabase mock.
import { createChainableQuery } from "./__helpers__/supabaseMock";
import type { BrandRow } from "../brandMapping";

const brandRow = (id: string, name: string): BrandRow => ({
  id,
  account_id: "account-1",
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  description: null,
  profile_photo_url: null,
  contact_email: null,
  contact_phone: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: true,
  tax_settings: {},
  default_currency: "GBP",
  stripe_connect_id: null,
  stripe_payouts_enabled: false,
  stripe_charges_enabled: false,
  address: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: null,
  profile_photo_type: null,
  created_at: "2026-05-09T00:00:00.000Z",
  updated_at: "2026-05-09T00:00:00.000Z",
  deleted_at: null,
});

// #1062 [biz-jest-residual-burndown] Wave 1 / B3c [TEST-MOD-APPROVED ORCH-1062] —
// getBrands sources the brand list from brand_team_members (empty in these cases) +
// the META-ORCH-1232 H2 owner-union backstop from("brands"), whose chain ends on
// `.is("deleted_at", null)` (NOT `.order`). Use the shared chainable mock so the
// owner-union read resolves the brands regardless of the terminal method. No test
// asserts spies on this query; the event/order-query spies below are unchanged.
const brandsQuery = (result: { data: BrandRow[]; error: Error | null }) =>
  createChainableQuery(result);

const eventsQuery = (
  result: { data: { brand_id: string | null }[]; error: Error | null },
) => {
  const builder = {
    select: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
};

interface OrderStatsFixture {
  total_cents: number | null;
  currency: string | null;
  payment_status: string | null;
  refunded_amount_cents: number | null;
  /** ORCH-0816 — optional so existing fixtures don't need a value. */
  created_at?: string | null;
  events: { brand_id: string | null } | null;
  order_line_items: { quantity: number | null }[] | null;
}

const ordersQuery = (
  result: { data: OrderStatsFixture[]; error: Error | null },
) => {
  const builder = {
    select: jest.fn(() => builder),
    in: jest.fn(() => builder),
    not: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
};

beforeEach(() => {
  mockFrom.mockReset();
});

describe("getBrands", () => {
  test("attaches accurate non-deleted event counts to each brand", async () => {
    const brandListQuery = brandsQuery({
      data: [brandRow("brand-1", "One"), brandRow("brand-2", "Two")],
      error: null,
    });
    const eventCountQuery = eventsQuery({
      data: [
        { brand_id: "brand-1" },
        { brand_id: "brand-1" },
        { brand_id: "brand-2" },
      ],
      error: null,
    });
    const orderStatsQuery = ordersQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: unknown) => {
      // #1062 Wave 1 / B3c — getBrands reads brand_team_members (empty here) before the
      // owner-union from("brands"); route it so it does not throw. Plumbing only.
      if (table === "brand_team_members") return createChainableQuery({ data: [] });
      if (table === "brands") return brandListQuery;
      if (table === "events") return eventCountQuery;
      if (table === "orders") return orderStatsQuery;
      throw new Error(`unexpected table ${String(table)}`);
    });

    const brands = await getBrands("account-1");

    expect(brands.map((brand) => [brand.id, brand.stats.events])).toEqual([
      ["brand-1", 2],
      ["brand-2", 1],
    ]);
    expect(eventCountQuery.select).toHaveBeenCalledWith("brand_id");
    expect(eventCountQuery.in).toHaveBeenCalledWith("brand_id", [
      "brand-1",
      "brand-2",
    ]);
    expect(eventCountQuery.is).toHaveBeenCalledWith("deleted_at", null);
  });

  test("attaches real attendees + GMV from confirmed orders in default currency", async () => {
    const brandListQuery = brandsQuery({
      data: [brandRow("brand-1", "One")],
      error: null,
    });
    const eventCountQuery = eventsQuery({
      data: [{ brand_id: "brand-1" }],
      error: null,
    });
    const orderStatsQuery = ordersQuery({
      data: [
        // paid: 2 + 3 attendees, £50 + £75
        {
          total_cents: 5000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: "brand-1" },
          order_line_items: [{ quantity: 2 }],
        },
        {
          total_cents: 7500,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: "brand-1" },
          order_line_items: [{ quantity: 1 }, { quantity: 2 }],
        },
        // partial_refund: still counted, net is total - refunded
        {
          total_cents: 4000,
          currency: "GBP",
          payment_status: "partial_refund",
          refunded_amount_cents: 1000,
          events: { brand_id: "brand-1" },
          order_line_items: [{ quantity: 1 }],
        },
        // mixed currency: dropped from GMV (brand default is GBP)
        {
          total_cents: 9999,
          currency: "USD",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: "brand-1" },
          order_line_items: [{ quantity: 1 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation((table: unknown) => {
      // #1062 Wave 1 / B3c — getBrands reads brand_team_members (empty here) before the
      // owner-union from("brands"); route it so it does not throw. Plumbing only.
      if (table === "brand_team_members") return createChainableQuery({ data: [] });
      if (table === "brands") return brandListQuery;
      if (table === "events") return eventCountQuery;
      if (table === "orders") return orderStatsQuery;
      throw new Error(`unexpected table ${String(table)}`);
    });

    const brands = await getBrands("account-1");
    expect(brands).toHaveLength(1);
    // Attendees: 2 + 3 + 1 + 1 = 7 (USD order still adds attendees, just not GMV)
    expect(brands[0].stats.attendees).toBe(7);
    // GMV in GBP: (5000 + 7500 + (4000 - 1000)) / 100 = 155
    expect(brands[0].stats.rev).toBe(155);
    expect(orderStatsQuery.in).toHaveBeenCalledWith("events.brand_id", [
      "brand-1",
    ]);
    expect(orderStatsQuery.not).toHaveBeenCalledWith(
      "payment_status",
      "in",
      "(failed,cancelled,refunded)",
    );
  });

  test("does not query event counts when the account has no brands", async () => {
    const brandListQuery = brandsQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: unknown) => {
      // #1062 Wave 1 / B3c — route brand_team_members (empty) before the owner-union
      // from("brands"). Plumbing only.
      if (table === "brand_team_members") return createChainableQuery({ data: [] });
      if (table === "brands") return brandListQuery;
      throw new Error(`unexpected table ${String(table)}`);
    });

    await expect(getBrands("account-1")).resolves.toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

describe("aggregateBrandStatsByBrandIds", () => {
  test("returns zeroed buckets without querying when brandIds is empty", async () => {
    const result = await aggregateBrandStatsByBrandIds([]);
    expect(result.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("buckets attendees per brand across multiple brands", async () => {
    const orderStatsQuery = ordersQuery({
      data: [
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 3 }],
        },
        {
          total_cents: 2000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: "brand-B" },
          order_line_items: [{ quantity: 5 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "orders") return orderStatsQuery;
      throw new Error(`unexpected table ${String(table)}`);
    });
    const result = await aggregateBrandStatsByBrandIds(["brand-A", "brand-B"]);
    expect(result.get("brand-A")?.attendees).toBe(3);
    expect(result.get("brand-B")?.attendees).toBe(5);
  });

  test("skips rows with null brand_id or unknown brandIds", async () => {
    const orderStatsQuery = ordersQuery({
      data: [
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: null },
          order_line_items: [{ quantity: 99 }],
        },
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          events: { brand_id: "unrelated-brand" },
          order_line_items: [{ quantity: 99 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation(() => orderStatsQuery);
    const result = await aggregateBrandStatsByBrandIds(["brand-A"]);
    expect(result.get("brand-A")?.attendees).toBe(0);
    expect(result.get("brand-A")?.revByCurrencyCents.size).toBe(0);
  });
});

// ORCH-0816 — windowed last-7-day GMV alongside lifetime totals.
describe("aggregateBrandStatsByBrandIds — ORCH-0816 7-day window", () => {
  const nowIso = (offsetMs: number): string =>
    new Date(Date.now() - offsetMs).toISOString();

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  test("splits lifetime and 7-day buckets by created_at", async () => {
    const orderStatsQuery = ordersQuery({
      data: [
        // 1 day old — counts toward both lifetime and 7-day
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          created_at: nowIso(1 * ONE_DAY_MS),
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
        // 6 days old — counts toward both lifetime and 7-day
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          created_at: nowIso(6 * ONE_DAY_MS),
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
        // 30 days old — counts toward lifetime only
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          created_at: nowIso(30 * ONE_DAY_MS),
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation(() => orderStatsQuery);
    const result = await aggregateBrandStatsByBrandIds(["brand-A"]);
    const bucket = result.get("brand-A");
    expect(bucket).toBeDefined();
    // Lifetime: 3 orders × 1000 cents = 3000
    expect(bucket?.revByCurrencyCents.get("GBP")).toBe(3000);
    // 7-day: 2 orders × 1000 cents = 2000 (the 30-day-old order is excluded)
    expect(bucket?.rev7dByCurrencyCents.get("GBP")).toBe(2000);
  });

  test("nets refunded_amount_cents in both windows", async () => {
    const orderStatsQuery = ordersQuery({
      data: [
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "partial_refund",
          refunded_amount_cents: 300,
          created_at: nowIso(2 * ONE_DAY_MS),
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation(() => orderStatsQuery);
    const result = await aggregateBrandStatsByBrandIds(["brand-A"]);
    const bucket = result.get("brand-A");
    expect(bucket?.revByCurrencyCents.get("GBP")).toBe(700);
    expect(bucket?.rev7dByCurrencyCents.get("GBP")).toBe(700);
  });

  test("excludes rows with null created_at from 7-day window, keeps in lifetime", async () => {
    const orderStatsQuery = ordersQuery({
      data: [
        {
          total_cents: 5000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          created_at: null,
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation(() => orderStatsQuery);
    const result = await aggregateBrandStatsByBrandIds(["brand-A"]);
    const bucket = result.get("brand-A");
    expect(bucket?.revByCurrencyCents.get("GBP")).toBe(5000);
    expect(bucket?.rev7dByCurrencyCents.has("GBP")).toBe(false);
  });

  test("keeps currency buckets isolated across windows", async () => {
    const orderStatsQuery = ordersQuery({
      data: [
        {
          total_cents: 1000,
          currency: "GBP",
          payment_status: "paid",
          refunded_amount_cents: 0,
          created_at: nowIso(2 * ONE_DAY_MS),
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
        {
          total_cents: 9999,
          currency: "USD",
          payment_status: "paid",
          refunded_amount_cents: 0,
          created_at: nowIso(2 * ONE_DAY_MS),
          events: { brand_id: "brand-A" },
          order_line_items: [{ quantity: 1 }],
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation(() => orderStatsQuery);
    const result = await aggregateBrandStatsByBrandIds(["brand-A"]);
    const bucket = result.get("brand-A");
    expect(bucket?.rev7dByCurrencyCents.get("GBP")).toBe(1000);
    expect(bucket?.rev7dByCurrencyCents.get("USD")).toBe(9999);
  });
});
