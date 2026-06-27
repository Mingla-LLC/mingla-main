/* eslint-disable import/first */
// META-ORCH-1232 — service-layer guards: C1 (getBrand temp-id miss), H2
// (getBrands owner union), H3 (auth-warm empty not cached as authed-empty).
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockGetSession = jest.fn() as jest.MockedFunction<
  (...args: unknown[]) => Promise<{
    data: { session: { user: { id: string } } | null };
    error: null;
  }>
>;

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

// appsFlyerService transitively imports react-native — stub it for Node tests.
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import {
  getBrand,
  getBrands,
  BrandsAuthSessionNotAttachedError,
} from "../brandsService";
import type { BrandRow } from "../brandMapping";

const UUID_OWNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

// brand_team_members embedded read: .select().eq().is("removed_at").is("brand.deleted_at")
// resolves on the SECOND .is() (two filter calls before the awaited terminal).
const membershipQuery = (result: {
  data: { role: string; brand: BrandRow }[];
  error: Error | null;
}) => {
  const builder: Record<string, unknown> = {};
  let isCalls = 0;
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.is = jest.fn(() => {
    isCalls += 1;
    return isCalls >= 2 ? Promise.resolve(result) : builder;
  });
  return builder;
};

// brands owner read: .select("*").eq("account_id").is("deleted_at", null) resolves.
const ownedBrandsQuery = (result: { data: BrandRow[]; error: Error | null }) => {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.is = jest.fn(() => Promise.resolve(result));
  return builder;
};

// generic count/agg query: chainable, resolves to {data,count,error}.
const passthroughQuery = (
  result: { data: unknown[]; count?: number; error: Error | null } = {
    data: [],
    error: null,
  },
) => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "gt", "not", "order"]) {
    builder[m] = jest.fn(() => builder);
  }
  // Make it thenable so an awaited terminal chain resolves.
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
};

const setSessionAttached = (): void => {
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: "account-1" } } },
    error: null,
  });
};

beforeEach(() => {
  mockFrom.mockReset();
  mockGetSession.mockReset();
});

describe("getBrands — META-ORCH-1232 H3 (auth-warm session-attached gate)", () => {
  test("throws BrandsAuthSessionNotAttachedError when no session is attached (renders LOADING, not authed-empty)", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getBrands("account-1")).rejects.toBeInstanceOf(
      BrandsAuthSessionNotAttachedError,
    );
    // The list reads must NEVER fire before the session is confirmed.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("proceeds when a session IS attached", async () => {
    setSessionAttached();
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brand_team_members") {
        return membershipQuery({ data: [], error: null });
      }
      if (table === "brands") return ownedBrandsQuery({ data: [], error: null });
      return passthroughQuery();
    });
    await expect(getBrands("account-1")).resolves.toEqual([]);
  });
});

describe("getBrands — META-ORCH-1232 H2 (owner union backstop)", () => {
  test("surfaces a directly-owned brand even when the membership row is absent (trigger lag)", async () => {
    setSessionAttached();
    const owned = brandRow(UUID_OWNED, "Owned Brand");
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brand_team_members") {
        // membership read returns NOTHING (owner trigger lagged)
        return membershipQuery({ data: [], error: null });
      }
      if (table === "brands") {
        return ownedBrandsQuery({ data: [owned], error: null });
      }
      // events / orders aggregation
      return passthroughQuery({ data: [], count: 0, error: null });
    });

    const brands = await getBrands("account-1");
    expect(brands).toHaveLength(1);
    expect(brands[0].id).toBe(UUID_OWNED);
    expect(brands[0].role).toBe("owner");
  });

  test("de-dupes a brand present in BOTH the membership read and the owner read", async () => {
    setSessionAttached();
    const owned = brandRow(UUID_OWNED, "Owned Brand");
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brand_team_members") {
        return membershipQuery({
          data: [{ role: "brand_owner", brand: owned }],
          error: null,
        });
      }
      if (table === "brands") {
        return ownedBrandsQuery({ data: [owned], error: null });
      }
      return passthroughQuery({ data: [], count: 0, error: null });
    });

    const brands = await getBrands("account-1");
    // appears exactly once
    expect(brands.filter((b) => b.id === UUID_OWNED)).toHaveLength(1);
  });
});

describe("getBrand — META-ORCH-1232 C1 (temp-id miss, no 22P02)", () => {
  test("returns null for a `_temp_` id WITHOUT issuing a query", async () => {
    await expect(getBrand("_temp_mqvjiyi1")).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("returns null for any non-uuid id without a query", async () => {
    await expect(getBrand("brand-a")).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
