/**
 * META-ORCH-1009 Sub-E — regression tests for venue slug availability.
 *
 * ROOT-CAUSE FIX (2026-05-31): the slug is the brand's GLOBALLY-UNIQUE public URL
 * and the venue-create flow always INSERTs a new brand, so a slug held by ANY
 * live brand — including one the caller owns — is NOT available for a new venue.
 * The earlier "own-account exemption" caused a false-NEGATIVE (auto-selecting a
 * slug the caller already used → unique-violation at submit). These tests now
 * assert the correct global-uniqueness behavior.
 * B3: suggestVenueSlugs derives numbered candidates and returns only available.
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
 * Mocks the `from('brands').select(...).eq('slug', s).is('deleted_at', null)
 * .limit(1)` chain. Both `.is()` (older callers) and the terminal `.limit()`
 * (checkVenueSlugAvailable) are thenable so either shape resolves to
 * { data, error }. `rowsBySlug` maps a slug → rows the query returns.
 */
function mockBrandsBySlug(
  rowsBySlug: Record<string, { id: string; account_id: string }[]>,
): void {
  (supabase.from as jest.Mock).mockImplementation(() => {
    let slugArg = "";
    // A PromiseLike chain: every builder method returns the same object, and the
    // object is awaitable (resolves to { data, error }). This handles BOTH
    // `.is()`-terminal (older callers) and `.is().limit()`-terminal
    // (checkVenueSlugAvailable) without caring where the await happens.
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        slugArg = val;
        return chain;
      },
      is: () => chain,
      limit: () => chain,
      then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rowsBySlug[slugArg] ?? [], error: null }).then(
          onFulfilled,
        ),
    };
    return chain;
  });
}

describe("checkVenueSlugAvailable (B5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it("is TAKEN even when the caller's OWN brand holds the slug (global uniqueness — venue-create always INSERTs a new brand, so reusing your own slug collides)", async () => {
    mockBrandsBySlug({ mine: [{ id: "b1", account_id: "my-acct" }] });
    await expect(
      checkVenueSlugAvailable("mine", "my-acct"),
    ).resolves.toBe(false);
  });

  it("returns false for an empty slug", async () => {
    mockBrandsBySlug({});
    await expect(checkVenueSlugAvailable("   ")).resolves.toBe(false);
  });
});

describe("suggestVenueSlugs (B3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
