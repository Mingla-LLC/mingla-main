/**
 * META-ORCH-1009 Sub-E — resolveAvailableVenueSlug guarantee.
 *
 * Operator asked: "are you 100% sure the slug will always choose an available
 * slug?" This locks the guarantee — the submit-time resolver NEVER returns a
 * taken slug while availability checks succeed; it advances numeric suffixes and
 * falls back to a timestamp so it can never run out.
 *
 * We mock at the supabase layer (the same pattern as brandsService.test.ts) so
 * the in-module call to checkVenueSlugAvailable executes for real against a
 * controllable "taken slugs" set.
 */

const takenSlugs = new Set<string>();
let throwOnQuery = false;

// supabase.from("brands").select(...).eq("slug", x).is("deleted_at", null)
// resolves to { data: rows, error }. checkVenueSlugAvailable treats a non-empty
// row set (not owned by caller) as taken.
jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, slug: string) => ({
          is: () => {
            if (throwOnQuery) {
              return Promise.resolve({ data: null, error: new Error("offline") });
            }
            const rows = takenSlugs.has(slug)
              ? [{ id: "x", account_id: "someone-else" }]
              : [];
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
    }),
  },
}));

jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

import { resolveAvailableVenueSlug } from "../brandsService";

describe("resolveAvailableVenueSlug — always returns an available slug", () => {
  beforeEach(() => {
    takenSlugs.clear();
    throwOnQuery = false;
  });

  it("honors the preferred slug when it is available", async () => {
    const out = await resolveAvailableVenueSlug("Lumen Wine Bar", "lumenwinebar", "acct");
    expect(out).toBe("lumenwinebar");
    expect(takenSlugs.has(out)).toBe(false);
  });

  it("advances past a TAKEN root to the first available suffix", async () => {
    takenSlugs.add("lumenwinebar");
    takenSlugs.add("lumenwinebar1");
    const out = await resolveAvailableVenueSlug("Lumen Wine Bar", "lumenwinebar", "acct");
    expect(out).toBe("lumenwinebar2");
    expect(takenSlugs.has(out)).toBe(false);
  });

  it("never returns a taken slug even when root..root50 are all taken", async () => {
    takenSlugs.add("lumenwinebar");
    for (let i = 1; i <= 50; i++) takenSlugs.add(`lumenwinebar${i}`);
    const out = await resolveAvailableVenueSlug("Lumen Wine Bar", "lumenwinebar", "acct");
    expect(takenSlugs.has(out)).toBe(false);
    expect(out.startsWith("lumenwinebar")).toBe(true);
    // Must be the timestamp fallback, not a plain numbered form.
    expect(/^lumenwinebar([0-9]{1,2})?$/.test(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(32);
  });

  it("truncates so the slug never exceeds 32 chars", async () => {
    const out = await resolveAvailableVenueSlug("a".repeat(60), null, "acct");
    expect(out.length).toBeLessThanOrEqual(32);
  });

  it("throws when the name yields an empty root", async () => {
    await expect(
      resolveAvailableVenueSlug("!!!", null, "acct"),
    ).rejects.toThrow(/required/i);
  });
});
