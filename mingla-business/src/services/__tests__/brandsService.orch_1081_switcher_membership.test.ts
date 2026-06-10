// ORCH-1081 — TESTER adversarial regression. Different angle from the SQL-source
// migration test under supabase/migrations/__tests__/. That test proves the
// trigger + RPC source is well-formed; this test attacks the OPPOSITE end of
// the pipeline — the client query that surfaces brands in the partner's
// switcher — and adversarially proves that a revert to the original
// owner-only filter would FAIL.
//
// Specifically asserts:
//   (1) getBrands hits `brand_team_members`, NOT `brands.account_id`.
//       A revert to `.from("brands").eq("account_id", uid)` would silently
//       drop every non-owner membership and break the partner economics
//       model (partners earn 0.15% on brands they admin AFTER handing off
//       ownership — without switcher access they can't create the events
//       that earn the split).
//   (2) The query embeds `brands` as `!inner` and filters `brand.deleted_at`
//       so soft-deleted brands NEVER leak into the switcher.
//   (3) `removed_at IS NULL` is enforced on the membership row so demoted /
//       removed teammates lose switcher access immediately.
//   (4) De-duplicates by `brand.id` so a user with two roles on one brand
//       only sees the brand once (first encountered wins).
//   (5) Role mapping collapses the 6-value DB enum into the legacy 2-value
//       UI `BrandRole` ("owner" | "admin") so the rest of the brand UI keeps
//       working.
//
// fails-on-revert: with brandsService.ts reverted to the pre-`5f43c4be7`
// version that filters `.from("brands").eq("account_id", uid)`, assertion (1)
// FAILS because mockFrom's first call is "brands" not "brand_team_members".
// See ORCH-1081 close banner for the hash.
//
// Run: cd mingla-business && \
//   npx jest src/services/__tests__/brandsService.orch_1081_switcher_membership.test.ts

/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { getBrands } from "../brandsService";
import type { BrandRow } from "../brandMapping";

const brand = (id: string, name: string, createdAt: string): BrandRow => ({
  id,
  account_id: "owner-x",
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
  created_at: createdAt,
  updated_at: createdAt,
  deleted_at: null,
});

// Mock the brand_team_members nested-select query. supabase-js returns a
// thenable builder; we capture the .select/.eq/.is calls so the test can
// assert the right filters were applied.
type EmbeddedRow = { role: string; brand: BrandRow };

interface MembershipBuilder {
  selectArg: string | null;
  eqCalls: Array<[string, unknown]>;
  isCalls: Array<[string, unknown]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eq: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  is: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then: any;
}

function membershipsQuery(rows: EmbeddedRow[]): MembershipBuilder {
  const builder: MembershipBuilder = {
    selectArg: null,
    eqCalls: [],
    isCalls: [],
    select: undefined,
    eq: undefined,
    is: undefined,
    then: undefined,
  };
  builder.select = jest.fn((arg: unknown) => {
    builder.selectArg = arg as string;
    return builder;
  });
  builder.eq = jest.fn((col: unknown, val: unknown) => {
    builder.eqCalls.push([col as string, val]);
    return builder;
  });
  builder.is = jest.fn((col: unknown, val: unknown) => {
    builder.isCalls.push([col as string, val]);
    return builder;
  });
  builder.then = (cb: (r: { data: EmbeddedRow[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(cb);
  return builder;
}

// Empty events + orders mocks (the brandsService also calls those tables for
// stats; we don't care about their data for this regression, just that they
// don't throw).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eventsEmpty = (): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  b.select = jest.fn(() => b);
  b.in = jest.fn(() => b);
  b.is = jest.fn(() => Promise.resolve({ data: [], error: null }));
  return b;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ordersEmpty = (): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  b.select = jest.fn(() => b);
  b.in = jest.fn(() => b);
  b.not = jest.fn(() => Promise.resolve({ data: [], error: null }));
  return b;
};

function setupMocks(membRows: EmbeddedRow[]): MembershipBuilder {
  const memb = membershipsQuery(membRows);
  mockFrom.mockImplementation((...args: unknown[]) => {
    const table = args[0] as string;
    if (table === "brand_team_members") return memb;
    if (table === "events") return eventsEmpty();
    if (table === "orders") return ordersEmpty();
    throw new Error(`unexpected table ${table}`);
  });
  return memb;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe("ORCH-1081 — partner switcher sources from brand_team_members", () => {
  test("(1) getBrands hits brand_team_members, NOT brands.account_id", async () => {
    const memb = setupMocks([
      { role: "brand_admin", brand: brand("b1", "The Onus", "2026-06-10T00:00:00Z") },
      { role: "brand_owner", brand: brand("b2", "Owned", "2026-06-09T00:00:00Z") },
    ]);

    const result = await getBrands("partner-uid");

    // Smoking gun: was "brands" called as the data source? A revert would
    // call from("brands"), not from("brand_team_members").
    const tablesQueried = mockFrom.mock.calls.map((c) => c[0]);
    expect(tablesQueried).toContain("brand_team_members");
    expect(tablesQueried).not.toContain("brands");
    expect(memb.eqCalls).toContainEqual(["user_id", "partner-uid"]);
    // Sorted newest-first by created_at.
    expect(result.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("(2) excludes soft-deleted brands via embedded !inner filter", async () => {
    const memb = setupMocks([]);
    await getBrands("u");
    expect(memb.selectArg).toContain("!inner");
    expect(memb.isCalls).toContainEqual(["brand.deleted_at", null]);
  });

  test("(3) excludes removed memberships (removed_at IS NULL)", async () => {
    const memb = setupMocks([]);
    await getBrands("u");
    expect(memb.isCalls).toContainEqual(["removed_at", null]);
  });

  test("(4) de-duplicates by brand.id when one user has multiple roles", async () => {
    const same = brand("b1", "Shared", "2026-06-10T00:00:00Z");
    setupMocks([
      { role: "brand_owner", brand: same },
      { role: "event_manager", brand: same }, // duplicate
    ]);
    const result = await getBrands("u");
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("owner"); // first encountered wins
  });

  test("(5) collapses 6-value DB enum to UI BrandRole owner|admin", async () => {
    setupMocks([
      { role: "brand_admin", brand: brand("b1", "AdminBrand", "2026-06-04T00:00:00Z") },
      { role: "event_manager", brand: brand("b2", "EvBrand", "2026-06-03T00:00:00Z") },
      { role: "scanner", brand: brand("b3", "ScannerBrand", "2026-06-02T00:00:00Z") },
      { role: "brand_owner", brand: brand("b4", "OwnerBrand", "2026-06-01T00:00:00Z") },
    ]);
    const result = await getBrands("u");
    const roleByName = Object.fromEntries(
      result.map((b) => [b.displayName, b.role]),
    );
    // brand_owner is the ONLY mapping to "owner"; every other DB role maps to
    // "admin" so the existing owner-only gates still work.
    expect(roleByName.OwnerBrand).toBe("owner");
    expect(roleByName.AdminBrand).toBe("admin");
    expect(roleByName.EvBrand).toBe("admin");
    expect(roleByName.ScannerBrand).toBe("admin");
  });
});
