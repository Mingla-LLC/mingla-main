/**
 * ORCH-1076 Stream A regression — buyer-supply suppression (experience deep-link).
 *
 * Asserts the `bookable` flag computed by getPublicExperienceBySlug /
 * getPublicExperienceById:
 *   - PAID experience (online ticket, price>0) + brand CANNOT charge -> bookable:false
 *   - same PAID experience + brand CAN charge                        -> bookable:true (self-heal)
 *   - FREE experience                                                -> bookable:true
 *     (pg_brand_can_collect is NEVER consulted for free)
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

// #1062 [biz-jest-residual-burndown] Wave 2 / B2 [TEST-MOD-APPROVED ORCH-1062]:
// META-ORCH-1235 consolidated getPublicExperienceBySlug onto the single anon RPC
// `pg_public_experience_by_slug`, which returns the full payload INCLUDING a
// server-computed `bookable` flag (publicExperienceService.ts RPC-consolidation
// note, ~L505-513; mapRpcPayload surfaces `p.bookable` at L670). The client no
// longer runs resolveBookable for the by-slug deep link — it surfaces the
// server's decision verbatim. So the four buyer-supply resolveBookable scenarios
// (ORCH-1076) now live under the ById resolver below (which STILL owns that
// client-side logic via pg_brand_can_collect), and BySlug gets passthrough tests.
// [TEST-MOD-APPROVED #1919] The scenarios are unchanged; provider-neutral
// readiness replaces only the obsolete Stripe-only authority.

// Route .from by table for the ById resolver: events (with embedded brands) +
// ticket_types carry the scenario; experience_stops / event_dates / the theme
// view resolve empty.
const setupById = (tickets: Record<string, unknown>[]): void => {
  mockFrom.mockImplementation((...a: unknown[]) => {
    const table = a[0] as string;
    switch (table) {
      case "events":
        return builderFor({
          data: { ...eventRow(), brands: brandRow },
          error: null,
        });
      case "ticket_types":
        return builderFor({ data: tickets, error: null });
      case "experience_stops":
      case "event_dates":
      default:
        return builderFor({ data: [], error: null });
    }
  });
};

const routeRpc = (canCollect: boolean): void => {
  mockRpc.mockImplementation((...a: unknown[]) => {
    const fn = a[0] as string;
    if (fn === "pg_brand_can_collect") {
      return Promise.resolve({ data: canCollect, error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
};

// Full pg_public_experience_by_slug payload (RpcExpPayload shape). Only `bookable`
// varies per test — the client passes it straight through.
const rpcPayload = (bookable: boolean): Record<string, unknown> => ({
  id: "exp-1",
  brandId: "brand-1",
  brandSlug: "lantern-vine",
  experienceSlug: "wine-crawl",
  title: "Wine Crawl",
  description: null,
  status: "scheduled",
  visibility: "public",
  timezone: "America/New_York",
  currency: "USD",
  coverMediaUrl: null,
  coverMediaType: null,
  venueText: null,
  isRecurring: false,
  isMultiDate: false,
  recurrenceRules: null,
  intents: null,
  hideAddressUntilTicket: false,
  themeColorOverride: null,
  themeFontOverride: null,
  themeAnimationOverride: null,
  brand: {
    id: "brand-1",
    slug: "lantern-vine",
    name: "Lantern & Vine",
    bio: null,
    coverMediaUrl: null,
    coverMediaType: null,
    coverHue: null,
    verified: false,
    themeColor: null,
    themeFont: null,
    themeAnimation: null,
  },
  stops: [],
  ticket: null,
  dates: [],
  bookable,
});

const routeSlugRpc = (bookable: boolean): void => {
  mockRpc.mockImplementation((...a: unknown[]) => {
    const fn = a[0] as string;
    if (fn === "pg_public_experience_by_slug") {
      return Promise.resolve({ data: rpcPayload(bookable), error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
};

describe("META-ORCH-1235 — BySlug surfaces the RPC's server-computed bookable", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("surfaces bookable:false (server suppressed buyer-supply)", async () => {
    routeSlugRpc(false);
    const payload = await getPublicExperienceBySlug("lantern-vine", "wine-crawl");
    expect(payload).not.toBeNull();
    expect(payload?.experience.bookable).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith("pg_public_experience_by_slug", {
      p_brand_slug: "lantern-vine",
      p_experience_slug: "wine-crawl",
    });
  });

  test("surfaces bookable:true", async () => {
    routeSlugRpc(true);
    const payload = await getPublicExperienceBySlug("lantern-vine", "wine-crawl");
    expect(payload?.experience.bookable).toBe(true);
  });
});

describe("ORCH-1076 — experience deep-link bookable flag (ById resolver — client resolveBookable)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("PAID experience + brand CANNOT charge -> bookable:false", async () => {
    routeRpc(false);
    setupById([ttRow()]);
    const payload = await getPublicExperienceById("exp-1");
    expect(payload).not.toBeNull();
    expect(payload?.experience.bookable).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith("pg_brand_can_collect", {
      p_brand_id: "brand-1",
    });
  });

  test("PAID experience + brand CAN charge -> bookable:true (self-heal)", async () => {
    routeRpc(true);
    setupById([ttRow()]);
    const payload = await getPublicExperienceById("exp-1");
    expect(payload?.experience.bookable).toBe(true);
  });

  test("FREE experience -> bookable:true; pg_brand_can_collect NOT consulted", async () => {
    routeRpc(false);
    setupById([ttRow({ price_cents: 0, is_free: true })]);
    const payload = await getPublicExperienceById("exp-1");
    expect(payload?.experience.bookable).toBe(true);
    expect(mockRpc).not.toHaveBeenCalledWith(
      "pg_brand_can_collect",
      expect.anything(),
    );
  });

  test("in-person-only PAID -> bookable:true (never hits online 409)", async () => {
    routeRpc(false);
    setupById([ttRow({ available_online: false })]);
    const payload = await getPublicExperienceById("exp-1");
    expect(payload?.experience.bookable).toBe(true);
    expect(mockRpc).not.toHaveBeenCalledWith(
      "pg_brand_can_collect",
      expect.anything(),
    );
  });
});
