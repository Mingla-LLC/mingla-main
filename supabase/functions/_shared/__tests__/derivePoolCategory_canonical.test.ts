// ORCH-0700 Phase 3B — Unit test enforcing I-CATEGORY-SLUG-CANONICAL invariant.
//
// Asserts that every slug derivePoolCategory can return is a member of the
// canonical 10-slug taxonomy defined by DISPLAY_TO_SLUG in categoryPlaceTypes.ts.
//
// This is the third regression gate (alongside the SQL helper's self-verify
// probes and the matview's post-refresh assertion). If a future change to
// derivePoolCategory.ts introduces a slug that doesn't match DISPLAY_TO_SLUG,
// this test fails immediately at deno test time.
//
// Run: deno test supabase/functions/_shared/__tests__/derivePoolCategory_canonical.test.ts

import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { derivePoolCategory, ALL_DERIVED_CATEGORY_SLUGS, googleTypesForCategory } from "../derivePoolCategory.ts";
import { DISPLAY_TO_SLUG } from "../categoryPlaceTypes.ts";

Deno.test("I-CATEGORY-SLUG-CANONICAL: every derivePoolCategory output is a canonical slug", () => {
  const canonical = new Set(Object.values(DISPLAY_TO_SLUG));
  for (const slug of ALL_DERIVED_CATEGORY_SLUGS) {
    assertEquals(
      canonical.has(slug),
      true,
      `derivePoolCategory exposes slug "${slug}" which is NOT in DISPLAY_TO_SLUG canonical set. ` +
      `Canonical set: [${Array.from(canonical).join(", ")}]. ` +
      `Add the slug to DISPLAY_TO_SLUG OR remove it from derivePoolCategory.ts ORDERED_BUCKETS.`,
    );
  }
});

Deno.test("derivePoolCategory: movie_theater → movies_theatre (combined canonical slug)", () => {
  assertStrictEquals(derivePoolCategory("movie_theater", null), "movies_theatre");
});

Deno.test("derivePoolCategory: performing_arts_theater → movies_theatre", () => {
  assertStrictEquals(derivePoolCategory("performing_arts_theater", null), "movies_theatre");
});

Deno.test("derivePoolCategory: italian_restaurant → brunch_lunch_casual (combined canonical slug)", () => {
  assertStrictEquals(derivePoolCategory("italian_restaurant", null), "brunch_lunch_casual");
});

Deno.test("derivePoolCategory: american_restaurant → brunch_lunch_casual", () => {
  assertStrictEquals(derivePoolCategory("american_restaurant", null), "brunch_lunch_casual");
});

Deno.test("derivePoolCategory: fine_dining_restaurant → upscale_fine_dining", () => {
  assertStrictEquals(derivePoolCategory("fine_dining_restaurant", null), "upscale_fine_dining");
});

Deno.test("derivePoolCategory: grocery_store → groceries (separate from flowers)", () => {
  assertStrictEquals(derivePoolCategory("grocery_store", null), "groceries");
});

Deno.test("derivePoolCategory: supermarket → groceries", () => {
  assertStrictEquals(derivePoolCategory("supermarket", null), "groceries");
});

Deno.test("derivePoolCategory: florist → flowers (florist-only, no grocery absorption)", () => {
  assertStrictEquals(derivePoolCategory("florist", null), "flowers");
});

Deno.test("derivePoolCategory: park → nature", () => {
  assertStrictEquals(derivePoolCategory("park", null), "nature");
});

Deno.test("derivePoolCategory: cafe → icebreakers", () => {
  assertStrictEquals(derivePoolCategory("cafe", null), "icebreakers");
});

Deno.test("derivePoolCategory: bar → drinks_and_music", () => {
  assertStrictEquals(derivePoolCategory("bar", null), "drinks_and_music");
});

Deno.test("derivePoolCategory: art_studio → creative_arts", () => {
  assertStrictEquals(derivePoolCategory("art_studio", null), "creative_arts");
});

Deno.test("derivePoolCategory: amusement_park → play", () => {
  assertStrictEquals(derivePoolCategory("amusement_park", null), "play");
});

Deno.test("derivePoolCategory: unknown type → null (Constitution #9: no fabrication)", () => {
  assertStrictEquals(derivePoolCategory("xyz_unknown", null), null);
});

Deno.test("derivePoolCategory: types[] fallback when primary is null", () => {
  assertStrictEquals(
    derivePoolCategory(null, ["unknown_x", "movie_theater"]),
    "movies_theatre",
  );
});

Deno.test("derivePoolCategory: all-null inputs → null", () => {
  assertStrictEquals(derivePoolCategory(null, null), null);
});

Deno.test("googleTypesForCategory: groceries returns [grocery_store, supermarket]", () => {
  const types = googleTypesForCategory("groceries");
  assertEquals(types.sort(), ["grocery_store", "supermarket"]);
});

Deno.test("googleTypesForCategory: flowers returns [florist] only (no grocery types)", () => {
  const types = googleTypesForCategory("flowers");
  assertEquals(types, ["florist"]);
});

Deno.test("googleTypesForCategory: unknown slug returns []", () => {
  assertEquals(googleTypesForCategory("nonexistent_slug"), []);
});

Deno.test("ALL_DERIVED_CATEGORY_SLUGS: contains exactly 10 canonical slugs", () => {
  assertStrictEquals(ALL_DERIVED_CATEGORY_SLUGS.length, 10);
  const expected = [
    "nature", "icebreakers", "drinks_and_music", "movies_theatre",
    "brunch_lunch_casual", "upscale_fine_dining", "creative_arts", "play",
    "groceries", "flowers",
  ];
  // Order matters per first-write-wins semantics
  assertEquals([...ALL_DERIVED_CATEGORY_SLUGS], expected);
});
