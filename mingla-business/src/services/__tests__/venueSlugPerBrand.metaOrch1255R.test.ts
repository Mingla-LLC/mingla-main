/**
 * META-ORCH-1255(R) — venue slug availability is keyed to
 * `venue_listings UNIQUE (brand_id, slug)`, NOT the brands table.
 *
 * Tester round-2 P1 (runtime-proven): creating a second venue with the SAME
 * name inside one brand showed "Available — auto-selected" (the checker queried
 * `brands`, which has no such slug) and then "This URL slug is taken" when the
 * DB's venue_listings unique backstop rejected the insert — a contradictory
 * loop with no escape. Post-1255 the venue-slug truth is
 * `venue_listings (brand_id, slug)`: a duplicate WITHIN one brand is taken;
 * the same slug under a DIFFERENT brand is available (public route
 * /b/{brandSlug}/v/{venueSlug}, D-2).
 *
 * These tests prove, at the query layer:
 *   1. same-brand collision  → taken, and the resolver advances to `…1`;
 *   2. different-brand same slug → available (per-brand scoping);
 *   3. the query target is `venue_listings` scoped by brand_id — the brands
 *      table is NEVER consulted;
 *   4. (source pin) the step-2 preview renders the D-2 route
 *      `/b/{brandSlug}/v/{venueSlug}`, not the pre-1255 `/b/{venueSlug}`.
 */

import { readFileSync } from "fs";
import { join } from "path";

// ---- controllable supabase mock ------------------------------------------
// Records every `.from(table)` call plus each `.eq(col, val)` on its chain so
// the tests can assert BOTH behavior (taken/available) and the query target.
interface RecordedQuery {
  table: string;
  eqs: Array<[string, string]>;
}
const recordedQueries: RecordedQuery[] = [];
// Truth set keyed `${brandId}::${slug}` — one row exists iff that BRAND holds
// that venue slug (mirrors venue_listings_brand_slug_uniq).
const takenByBrand = new Set<string>();

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => {
      const rec: RecordedQuery = { table, eqs: [] };
      recordedQueries.push(rec);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: string) => {
          rec.eqs.push([col, val]);
          return chain;
        },
        is: () => chain,
        limit: () => chain,
        then: (onFulfilled: (v: unknown) => unknown) => {
          const brand = rec.eqs.find(([c]) => c === "brand_id")?.[1] ?? "";
          const slug = rec.eqs.find(([c]) => c === "slug")?.[1] ?? "";
          const rows =
            rec.table === "venue_listings" && takenByBrand.has(`${brand}::${slug}`)
              ? [{ id: "venue-row" }]
              : [];
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
        },
      };
      return chain;
    },
  },
}));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

import {
  checkVenueSlugAvailable,
  resolveAvailableVenueSlug,
  suggestVenueSlugs,
} from "../brandsService";

describe("META-ORCH-1255(R) — per-brand venue slug availability", () => {
  beforeEach(() => {
    recordedQueries.length = 0;
    takenByBrand.clear();
  });

  it("SAME brand + same slug → TAKEN (the round-2 P1 collision)", async () => {
    takenByBrand.add("brand-a::joescafe");
    await expect(checkVenueSlugAvailable("joescafe", "brand-a")).resolves.toBe(
      false,
    );
  });

  it("DIFFERENT brand + same slug → AVAILABLE (per-brand scoping, D-2 route)", async () => {
    takenByBrand.add("brand-a::joescafe");
    await expect(checkVenueSlugAvailable("joescafe", "brand-b")).resolves.toBe(
      true,
    );
  });

  it("resolver advances a same-brand duplicate name to the next suffix", async () => {
    takenByBrand.add("brand-a::joescafe");
    const out = await resolveAvailableVenueSlug("Joes Cafe", "joescafe", "brand-a");
    expect(out).toBe("joescafe1");
  });

  it("resolver keeps the preferred slug when only ANOTHER brand holds it", async () => {
    takenByBrand.add("brand-a::joescafe");
    const out = await resolveAvailableVenueSlug("Joes Cafe", "joescafe", "brand-b");
    expect(out).toBe("joescafe");
  });

  it("suggestions skip the slug taken within the brand and offer the numbered fallback", async () => {
    takenByBrand.add("brand-a::joescafe");
    const picks = await suggestVenueSlugs("Joes Cafe", 2, "brand-a");
    expect(picks).not.toContain("joescafe");
    expect(picks).toContain("joescafe1");
  });

  it("every availability query targets venue_listings scoped by brand_id — the brands table is NEVER consulted", async () => {
    takenByBrand.add("brand-a::joescafe");
    await checkVenueSlugAvailable("joescafe", "brand-a");
    await resolveAvailableVenueSlug("Joes Cafe", "joescafe", "brand-a");
    await suggestVenueSlugs("Joes Cafe", 2, "brand-a");

    expect(recordedQueries.length).toBeGreaterThan(0);
    for (const q of recordedQueries) {
      expect(q.table).toBe("venue_listings");
      expect(q.eqs).toEqual(
        expect.arrayContaining([
          ["brand_id", "brand-a"],
          expect.arrayContaining(["slug"]),
        ]),
      );
    }
    const tables = recordedQueries.map((q) => q.table);
    expect(tables).not.toContain("brands");
  });
});

describe("META-ORCH-1255(R) — step-2 preview renders the D-2 venue route (source pin, P2-R2-1)", () => {
  const src = readFileSync(
    join(__dirname, "..", "..", "components", "venue", "VenueStep2NameSlug.tsx"),
    "utf8",
  );

  it("interpolates the brand slug segment `${brandSlug}/v/` into the preview URL", () => {
    expect(src).toContain("${brandSlug}/v/");
  });

  it("declares the brandSlug prop that carries the current brand's slug", () => {
    expect(src).toMatch(/brandSlug\?:\s*string\s*\|\s*null/);
  });

  it("no longer renders the bare pre-1255 `/b/{venueSlug}` shape (the /b/ prefix is immediately followed by the brand segment)", () => {
    // The literal prefix must be followed by the brandSlug interpolation line,
    // never directly by the venue slug Text node.
    const prefixIdx = src.indexOf("business.usemingla.com/b/");
    expect(prefixIdx).toBeGreaterThan(-1);
    const after = src.slice(prefixIdx, prefixIdx + 300);
    expect(after).toContain("${brandSlug}/v/");
  });
});
