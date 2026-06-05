/**
 * ORCH-1076 Stream A regression — buyer-supply suppression (experience deep-link).
 *
 * Asserts the `bookable` flag computed by getPublicExperienceBySlug /
 * getPublicExperienceById:
 *   - PAID experience (online ticket, price>0) + brand CANNOT charge -> bookable:false
 *   - same PAID experience + brand CAN charge                        -> bookable:true (self-heal)
 *   - FREE experience                                                -> bookable:true
 *     (pg_brand_can_charge is NEVER consulted for free)
 *   - in-person-only PAID                                            -> bookable:true
 *
 * The experience page (/exp/[brandSlug]/[experienceSlug].tsx) renders the
 * "Booking unavailable right now" banner in place of the checkout flow exactly
 * when experience.bookable === false.
 *
 * Fails-on-revert: if resolveBookable / ticketsArePaidOnline are removed (so
 * bookable hard-codes true), the not-ready PAID case returns true and the first
 * expectation fails.
 *
 * publicExperienceService imports only `supabase` + a TYPE from draftEventStore
 * (erased by ts-jest), so this test has no @mingla/* workspace dependency.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  getPublicExperienceBySlug,
  getPublicExperienceById,
} from "../publicExperienceService";

const brandRow = {
  id: "brand-1",
  slug: "lantern-vine",
  name: "Lantern & Vine",
  description: null,
  cover_media_url: null,
};

const eventRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "exp-1",
  brand_id: "brand-1",
  slug: "wine-crawl",
  title: "Wine Crawl",
  description: "A real experience.",
  status: "scheduled",
  visibility: "public",
  timezone: "America/New_York",
  cover_media_url: null,
  cover_media_type: null,
  theme: {},
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  ...patch,
});

const ttRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "tt-1",
  name: "Standard",
  price_cents: 7000,
  currency: "USD",
  quantity_total: null,
  is_unlimited: true,
  is_free: false,
  display_order: 0,
  available_online: true,
  ...patch,
});

// builder for .from(table) supporting maybeSingle (brands/events) and order
// (sidecar selects). `result` is the terminal payload.
const builderFor = (result: { data: unknown; error: unknown }) => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in"]) {
    builder[m] = jest.fn(() => builder);
  }
  builder.order = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  return builder;
};

// Route .from by table; sidecars: experience_stops -> [], ticket_types -> tickets,
// event_dates -> []. brands + events resolve via maybeSingle.
const setupFrom = (tickets: Record<string, unknown>[]): void => {
  mockFrom.mockImplementation((...a: unknown[]) => {
    const table = a[0] as string;
    switch (table) {
      case "brands":
        return builderFor({ data: brandRow, error: null });
      case "events":
        return builderFor({ data: eventRow(), error: null });
      case "ticket_types":
        return builderFor({ data: tickets, error: null });
      case "experience_stops":
      case "event_dates":
      default:
        return builderFor({ data: [], error: null });
    }
  });
};

const routeRpc = (canCharge: boolean): void => {
  mockRpc.mockImplementation((...a: unknown[]) => {
    const fn = a[0] as string;
    if (fn === "pg_brand_can_charge") {
      return Promise.resolve({ data: canCharge, error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
};

describe("ORCH-1076 — experience deep-link bookable flag (BySlug)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("PAID experience + brand CANNOT charge -> bookable:false", async () => {
    routeRpc(false);
    setupFrom([ttRow()]);
    const payload = await getPublicExperienceBySlug("lantern-vine", "wine-crawl");
    expect(payload).not.toBeNull();
    expect(payload?.experience.bookable).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith("pg_brand_can_charge", {
      p_brand_id: "brand-1",
    });
  });

  test("PAID experience + brand CAN charge -> bookable:true (self-heal)", async () => {
    routeRpc(true);
    setupFrom([ttRow()]);
    const payload = await getPublicExperienceBySlug("lantern-vine", "wine-crawl");
    expect(payload?.experience.bookable).toBe(true);
  });

  test("FREE experience -> bookable:true; pg_brand_can_charge NOT consulted", async () => {
    routeRpc(false);
    setupFrom([ttRow({ price_cents: 0, is_free: true })]);
    const payload = await getPublicExperienceBySlug("lantern-vine", "wine-crawl");
    expect(payload?.experience.bookable).toBe(true);
    expect(mockRpc).not.toHaveBeenCalledWith(
      "pg_brand_can_charge",
      expect.anything(),
    );
  });

  test("in-person-only PAID -> bookable:true (never hits online 409)", async () => {
    routeRpc(false);
    setupFrom([ttRow({ available_online: false })]);
    const payload = await getPublicExperienceBySlug("lantern-vine", "wine-crawl");
    expect(payload?.experience.bookable).toBe(true);
    expect(mockRpc).not.toHaveBeenCalledWith(
      "pg_brand_can_charge",
      expect.anything(),
    );
  });
});

describe("ORCH-1076 — experience deep-link bookable flag (ById)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("PAID + not-ready via id resolver -> bookable:false", async () => {
    routeRpc(false);
    mockFrom.mockImplementation((...a: unknown[]) => {
      const table = a[0] as string;
      if (table === "events") {
        return builderFor({
          data: { ...eventRow(), brands: brandRow },
          error: null,
        });
      }
      if (table === "ticket_types") {
        return builderFor({ data: [ttRow()], error: null });
      }
      return builderFor({ data: [], error: null });
    });
    const payload = await getPublicExperienceById("exp-1");
    expect(payload?.experience.bookable).toBe(false);
  });
});
