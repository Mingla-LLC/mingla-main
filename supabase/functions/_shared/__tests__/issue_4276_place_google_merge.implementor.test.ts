// Issue #4276 S3 and U5: Google updates are a merge, and coverage counts every row.
//
// MINGLA-INVARIANT: I-4276-GOOGLE-NULL-NEVER-OVERWRITES | issue #4276 | A value Google did not return never replaces a stored place value, on any seed or refresh update path
//
// FAILS-ON-REVERT: restoring the field-by-field `.update({ name: row.name, ... })`
// in admin-seed-places, or the direct `.update({` in admin-refresh-places, fails the
// source checks. Removing a rule from placeGoogleMerge.ts fails its unit check.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adminEditsByGooglePlaceId,
  buildSeedMergeUpdate,
  COVERAGE_PAGE_SIZE,
  type CoverageRow,
  loadAllCoverageRows,
  mergeGoogleUpdate,
  SEED_MERGE_COLUMNS,
} from "../placeGoogleMerge.ts";

// Everything the final check (bouncer.ts) reads from Google data.
const FINAL_CHECK_FIELDS = [
  "name", "lat", "lng", "types", "business_status", "website", "opening_hours",
  "photos", "review_count", "rating",
];

function fullRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    google_place_id: "gp1",
    name: "Google name",
    lat: 12.5,
    lng: -3.5,
    types: ["cafe"],
    business_status: "OPERATIONAL",
    website: "https://example.test",
    opening_hours: { periods: [] },
    photos: [{ name: "p" }],
    review_count: 12,
    rating: 4.2,
    price_tier: "chill",
    price_tiers: ["chill"],
    raw_google_data: {
      displayName: { text: "Google name" },
      location: { latitude: 12.5, longitude: -3.5 },
      userRatingCount: 12,
    },
    last_detail_refresh: "2026-11-05T00:00:00Z",
    ...overrides,
  };
}

Deno.test("nothing the final check reads can be nulled by a partial Google answer", () => {
  const partial = {
    google_place_id: "gp1",
    name: "Unknown",
    lat: 0,
    lng: 0,
    types: [],
    business_status: null,
    website: null,
    opening_hours: null,
    photos: [],
    review_count: 0,
    rating: null,
    raw_google_data: { id: "gp1" },
    last_detail_refresh: "2026-11-05T00:00:00Z",
  };
  const update = buildSeedMergeUpdate(partial, []);
  for (const field of FINAL_CHECK_FIELDS) {
    assert(!(field in update), `${field} would have been overwritten`);
  }
  assertEquals(update.last_detail_refresh, "2026-11-05T00:00:00Z");
  assertEquals(update.refresh_failures, 0);
});

Deno.test("real answers are written, including false and zero", () => {
  const update = buildSeedMergeUpdate(
    fullRow({ serves_dinner: false, review_count: 0, raw_google_data: { userRatingCount: 0, displayName: { text: "n" }, location: {} } }),
    [],
  );
  assertEquals(update.serves_dinner, false);
  assertEquals(update.review_count, 0);
  assertEquals(update.website, "https://example.test");
  assertEquals(update.name, "Google name");
});

Deno.test("an admin-edited name and tiers survive; other fields still update", () => {
  const seed = buildSeedMergeUpdate(fullRow(), ["name"]);
  assert(!("name" in seed), "a re-seed must not overwrite an edited name");
  assertEquals(seed.website, "https://example.test");

  const refresh = mergeGoogleUpdate(
    { name: "Google", price_tier: "comfy", price_tiers: ["comfy"], website: "https://w.test" },
    ["name", "price_tiers"],
  );
  assertEquals(refresh, { website: "https://w.test" });
});

Deno.test("a seed update can never reach a sole-writer column", () => {
  for (const column of SEED_MERGE_COLUMNS as readonly string[]) {
    assert(
      !/^(is_servable|bouncer_|passes_pre_photo|pre_photo_|photo_aesthetic|photo_collage|ai_signal_scores|stored_photo)/.test(column),
      `${column} is owned by another writer`,
    );
  }
  const update = buildSeedMergeUpdate(
    fullRow({ is_servable: true, photo_collage_url: "x", ai_signal_scores: {} }),
    [],
  );
  for (const column of ["is_servable", "photo_collage_url", "ai_signal_scores"]) {
    assert(!(column in update));
  }
});

Deno.test("admin markers index by google place id", () => {
  const map = adminEditsByGooglePlaceId([
    { google_place_id: "a", edited_fields: ["name"] },
    { google_place_id: "b", edited_fields: null },
  ]);
  assertEquals(map.get("a"), ["name"]);
  assertEquals(map.get("b"), []);
  assertEquals(adminEditsByGooglePlaceId(null).size, 0);
});

Deno.test("coverage counts every row, past any cap, including a server cap below the page size", async () => {
  const total = 23_456;
  for (const serverCap of [COVERAGE_PAGE_SIZE, 700]) {
    const rows = await loadAllCoverageRows((afterId) => {
      const start = afterId === null ? 0 : Number(afterId) + 1;
      const page: CoverageRow[] = [];
      for (let i = start; i < Math.min(start + serverCap, total); i++) {
        page.push({ id: String(i), primary_type: "cafe", types: null });
      }
      return Promise.resolve(page);
    });
    assertEquals(rows.length, total);
    assertEquals(new Set(rows.map((r) => r.id)).size, total);
  }
});

Deno.test("every Google update path goes through the merge", () => {
  const seed = Deno.readTextFileSync(new URL("../../admin-seed-places/index.ts", import.meta.url));
  assertEquals(
    seed.match(/\.update\(buildSeedMergeUpdate\(row, adminEdits\.get\(row\.google_place_id\)\)\)/g)?.length,
    2,
    "both the run and the retry path must merge",
  );
  assertEquals(seed.includes("name: row.name,"), false, "a field-by-field re-seed update is back");
  assertEquals(seed.includes(".limit(10000)"), false, "coverage_check is truncating again");

  const refresh = Deno.readTextFileSync(new URL("../../admin-refresh-places/index.ts", import.meta.url));
  assert(refresh.includes("const merged = mergeGoogleUpdate({"));
  assert(refresh.includes(".update(merged)"));
  assertEquals(refresh.includes("name: displayName?.text ?? undefined,\n        address"), true);
  assertEquals(/\.update\(\{\s*name: displayName/.test(refresh), false, "refresh bypasses the merge");
  assertEquals(refresh.includes("userRatingCount as number) ?? 0"), false, "refresh zeroes review_count");
});
