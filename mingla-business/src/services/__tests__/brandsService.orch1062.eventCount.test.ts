/* eslint-disable import/first */
/**
 * ORCH-1062 — the account-page brand-card "N events" badge LIED: it counted ALL
 * non-deleted events including DRAFTS, so a brand whose hub showed zero events
 * still rendered e.g. "2 events" (verified live: brand "rrrr" — both events were
 * drafts). The hub events list only surfaces
 * status IN ('scheduled','live','ended','cancelled'); drafts are excluded.
 *
 * This test asserts `getEventCountsByBrandIds` (via getBrands) now applies that
 * exact status filter. Fails-on-revert: the old query only filtered
 * `deleted_at IS NULL` with no status filter, so the `.in("status", ...)`
 * assertion fails.
 */
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
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

import { getBrands, HUB_VISIBLE_EVENT_STATUSES } from "../brandsService";
// #1062 [biz-jest-residual-burndown] Wave 1 / B3c — shared chainable supabase mock.
import { createChainableQuery } from "./__helpers__/supabaseMock";
import type { BrandRow } from "../brandMapping";

const brandRow = (id: string, name: string): BrandRow =>
  ({
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
  }) as unknown as BrandRow;

interface AnyBuilder {
  select: jest.Mock;
  eq: jest.Mock;
  is: jest.Mock;
  in: jest.Mock;
  order: jest.Mock;
  not: jest.Mock;
}

const eventsBuilder = (
  data: { brand_id: string | null }[],
): AnyBuilder => {
  const b = {} as AnyBuilder;
  b.select = jest.fn(() => b);
  b.eq = jest.fn(() => b);
  b.in = jest.fn(() => b);
  b.not = jest.fn(() => b);
  b.order = jest.fn(() => b);
  // terminal: getEventCountsByBrandIds ends on .is("deleted_at", null)
  b.is = jest.fn(() => Promise.resolve({ data, error: null }));
  return b;
};

const ordersBuilder = (): AnyBuilder => {
  const b = {} as AnyBuilder;
  b.select = jest.fn(() => b);
  b.eq = jest.fn(() => b);
  b.is = jest.fn(() => b);
  b.in = jest.fn(() => b);
  b.order = jest.fn(() => b);
  // terminal: aggregateBrandStatsByBrandIds ends on .not(...)
  b.not = jest.fn(() => Promise.resolve({ data: [], error: null }));
  return b;
};

describe("ORCH-1062 — brand event-count badge excludes drafts (hub parity)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  test("getEventCountsByBrandIds filters events to hub-visible statuses only", async () => {
    const eventsQ = eventsBuilder([{ brand_id: "brand-1" }]);
    mockFrom.mockImplementation((table: unknown) => {
      // #1062 [biz-jest-residual-burndown] Wave 1 / B3c [TEST-MOD-APPROVED ORCH-1062] —
      // getBrands sources the list from brand_team_members (empty here) + the
      // META-ORCH-1232 H2 owner-union backstop from("brands"); route both to the shared
      // chainable mock (thenable, resolves the .select.eq.is chain the owner-union ends
      // on) so the brand surfaces via the owner-union. Event-count assertions unchanged.
      if (table === "brand_team_members") return createChainableQuery({ data: [] });
      if (table === "brands")
        return createChainableQuery({ data: [brandRow("brand-1", "One")] });
      if (table === "events") return eventsQ;
      if (table === "orders") return ordersBuilder();
      throw new Error(`unexpected table ${String(table)}`);
    });

    await getBrands("account-1");

    // The status filter is the fix: drafts are excluded.
    expect(eventsQ.in).toHaveBeenCalledWith("status", [
      "scheduled",
      "live",
      "ended",
      "cancelled",
    ]);
    expect(eventsQ.in).toHaveBeenCalledWith("status", HUB_VISIBLE_EVENT_STATUSES);
    // And it is still scoped + non-deleted (regression guard for the rest).
    expect(eventsQ.in).toHaveBeenCalledWith("brand_id", ["brand-1"]);
    expect(eventsQ.is).toHaveBeenCalledWith("deleted_at", null);
  });
});
