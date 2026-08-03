// issue #1020 [city-browse-geo-fallback] — cache-key geo-fold contract (§8b).
//
// TESTER-owned. This is the fails-on-revert SENTINEL for the §6 cache-key fold in
// _cache.ts. The RPC now filters by a browsed center/radius, so the discover
// response-cache MUST key on that geo — otherwise two "Brussels" requests carrying
// DIFFERENT centers would cross-serve one radius-filtered deck (Constitution #13,
// exclusion consistency). Angle distinct from the implementor's edge-fn threading
// test (issue_1020_geo_threading.test.ts, which proves .rpc() forwarding).
//
//   C1  SAME cityName + two DIFFERENT centers ⇒ DIFFERENT keys. (Delete the `geo`
//       field from buildDiscoverCacheKey and this FAILS — both collapse to one key.)
//   C2  Identical inputs ⇒ IDENTICAL key (deterministic).
//   C3  A geo-bearing request keys DIFFERENTLY from the same city with NO geo, and
//       the no-geo key carries an explicit "geo":null slot (city-only unchanged).
//   C4  4-dp rounding: sub-~11 m jitter on lat/lng ⇒ SAME key (no cache thrash);
//       but a DIFFERENT radius (same center) ⇒ DIFFERENT key.
//
// Run with:
//   deno test --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_1020_cache_key_geo.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildDiscoverCacheKey } from "../_cache.ts";
import type { DiscoverCacheParams } from "../_cache.ts";

// Identical non-geo baseline for every case — only the geo fields vary.
const BASE: DiscoverCacheParams = {
  cityName: "Brussels",
  stateCode: null,
  countryCode: "BE",
  page: 1,
  size: 20,
  partyTypeSlugs: [],
  vibeTagSlugs: [],
  musicGenreSlugs: [],
  dateWindowUtc: null,
  timezone: "Europe/Brussels",
};

Deno.test("issue #1020 C1 — same city, two different centers ⇒ different keys (SENTINEL)", () => {
  const brussels = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: 50,
  });
  // Same cityName + all other inputs, but a materially different center
  // (London coords under a "Brussels" label — the exact cross-serve hazard §6 cites).
  const shifted = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 51.5074,
    fallbackLng: -0.1278,
    fallbackRadiusKm: 50,
  });
  assertNotEquals(
    brussels,
    shifted,
    "two different centers under the same cityName must key distinctly (geo fold reverted?)",
  );
});

Deno.test("issue #1020 C2 — identical inputs ⇒ identical key (deterministic)", () => {
  const a = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: 50,
  });
  const b = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: 50,
  });
  assertEquals(a, b, "identical inputs must produce identical keys");
});

Deno.test("issue #1020 C3 — geo request differs from no-geo; no-geo carries geo:null", () => {
  const withGeo = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: 50,
  });
  const noGeo = buildDiscoverCacheKey({ ...BASE });
  assertNotEquals(
    withGeo,
    noGeo,
    "a geo-filtered deck must not share a key with an unfiltered city-only deck",
  );
  // City-only requests keep an explicit empty geo slot.
  assert(
    noGeo.includes('"geo":null'),
    `city-only key must carry an explicit geo:null slot; got ${noGeo}`,
  );
  // A partial geo (missing radius) is treated as no geo (all-three guard).
  const partial = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: null,
  });
  assertEquals(
    partial,
    noGeo,
    "an incomplete geo triple must fold to geo:null (same as no geo)",
  );
});

Deno.test("issue #1020 C4 — sub-11m jitter ⇒ same key; different radius ⇒ different key", () => {
  const canonical = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: 50,
  });
  // Jitter below the 4th decimal place (~1e-5 deg ≈ <1.5 m) rounds away.
  const jittered = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.85032,
    fallbackLng: 4.35174,
    fallbackRadiusKm: 50,
  });
  assertEquals(
    jittered,
    canonical,
    "sub-11m jitter must round to the same key (no cache thrash)",
  );
  // Same center, different radius ⇒ a different filtered deck ⇒ different key.
  const widerRadius = buildDiscoverCacheKey({
    ...BASE,
    fallbackLat: 50.8503,
    fallbackLng: 4.3517,
    fallbackRadiusKm: 75,
  });
  assertNotEquals(
    widerRadius,
    canonical,
    "a different radius must key distinctly (different deck membership)",
  );
});
