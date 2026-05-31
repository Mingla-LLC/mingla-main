/**
 * META-ORCH-1009 Sub-E — regression tests for venue slug availability.
 *
 * B5: checkVenueSlugAvailable must only report "taken" for a LIVE brand owned by
 *     someone else — not soft-deleted rows, and not the caller's own brand.
 * B3: suggestVenueSlugs derives numbered candidates and returns only the
 *     available ones.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() }, rpc: jest.fn() },
}));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

import { supabase } from "../supabase";
import {
  checkVenueSlugAvailable,
  suggestVenueSlugs,
} from "../brandsService";

/**
 * Mocks the `from('brands').select(...).eq('slug', s).is('deleted_at', null)`
 * chain. The terminal `.is()` resolves to { data, error }. `rowsBySlug` maps a
 * slug → the rows the query returns for that slug.
 */
function mockBrandsBySlug(
  rowsBySlug: Record<string, { id: string; account_id: string }[]>,
): void {
  (supabase.from as jest.Mock).mockImplementation(() => {
    let slugArg = "";
    const chain = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        slugArg = val;
        return chain;
      },
      is: () =>
        Promise.resolve({ data: rowsBySlug[slugArg] ?? [], error: null }),
    };
    return chain;
  });
}

describe("checkVenueSlugAvailable (B5)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is AVAILABLE when no live brand holds the slug", async () => {
    mockBrandsBySlug({});
    await expect(checkVenueSlugAvailable("freshvenue")).resolves.toBe(true);
  });

  it("is TAKEN when another account's live brand holds the slug", async () => {
    mockBrandsBySlug({ taken: [{ id: "b1", account_id: "other-acct" }] });
    await expect(
      checkVenueSlugAvailable("taken", "my-acct"),
    ).resolves.toBe(false);
  });

  it("is AVAILABLE when only the caller's OWN brand holds the slug (no false-taken on retry)", async () => {
    mockBrandsBySlug({ mine: [{ id: "b1", account_id: "my-acct" }] });
    await expect(
      checkVenueSlugAvailable("mine", "my-acct"),
    ).resolves.toBe(true);
  });

  it("returns false for an empty slug", async () => {
    mockBrandsBySlug({});
    await expect(checkVenueSlugAvailable("   ")).resolves.toBe(false);
  });
});

describe("suggestVenueSlugs (B3)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the kebab root first when available", async () => {
    mockBrandsBySlug({});
    const picks = await suggestVenueSlugs("My Cool Venue");
    expect(picks[0]).toBe("mycoolvenue");
  });

  it("skips the taken root and offers numbered fallbacks", async () => {
    mockBrandsBySlug({
      mycoolvenue: [{ id: "b1", account_id: "other" }],
    });
    const picks = await suggestVenueSlugs("My Cool Venue", 2);
    expect(picks).not.toContain("mycoolvenue");
    expect(picks).toContain("mycoolvenue1");
  });
});
