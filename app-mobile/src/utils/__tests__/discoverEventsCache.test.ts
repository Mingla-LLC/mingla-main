// @ts-nocheck
// ORCH-0996 regression test — Discover cold-open latency.
// Deno-runnable (discoverEventsCache.ts has no RN deps), matching the sibling
// friendMenu.test.ts pattern. Fails-on-revert anchor for the two contract
// guarantees the orchestrator demanded:
//   (a) the INITIAL fetch fires IMMEDIATELY — it is NOT gated behind the
//       300ms debounce that the screen still applies to filter changes.
//   (b) a SECOND mount with the SAME city+filters serves the prior result
//       from the in-memory cache (paint-first) without a fresh blocking
//       network call before paint — AND a DIFFERENT filter set never reads
//       the prior set's cache slot (the ORCH-0839-A C-1 cross-filter
//       leakage must NOT come back).
import {
  assertEquals,
  assert,
  assertFalse,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  decideDiscoverFetchMode,
  buildDiscoverCacheKey,
  readDiscoverCache,
  writeDiscoverCache,
  isDiscoverCacheFresh,
  __resetDiscoverCacheForTests,
  DISCOVER_CACHE_TTL_MS,
  writeResolvedDiscoverCity,
  readResolvedDiscoverCity,
  readLastResolvedDiscoverCity,
  __resetResolvedDiscoverCityForTests,
} from "../discoverEventsCache.ts";

const baseSig = {
  cityName: "Raleigh",
  cityLat: 35.78,
  cityLng: -78.64,
  gpsLat: null,
  gpsLng: null,
  date: "any",
  segment: "music",
  genre: "all",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
};

// ── Contract (a): initial fetch is IMMEDIATE, not debounced ───────────────

Deno.test("ORCH-0996 (a) first usable query -> immediate (no 300ms debounce)", () => {
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: true, hasFiredInitial: false }),
    "immediate",
  );
});

Deno.test("ORCH-0996 (a) subsequent change -> debounced (300ms coalesce kept)", () => {
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: true, hasFiredInitial: true }),
    "debounced",
  );
});

Deno.test("ORCH-0996 (a) no city + no GPS -> skip", () => {
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: false, hasFiredInitial: false }),
    "skip",
  );
});

// ── Contract (b): second mount serves cache; no cross-filter leakage ──────

Deno.test("ORCH-0996 (b) second mount same signature reads cached result", () => {
  __resetDiscoverCacheForTests();
  const key = buildDiscoverCacheKey(baseSig);
  writeDiscoverCache(key, {
    nightOutCards: [{ id: "tm1" }],
    businessEvents: [{ eventId: "be1" }],
    tmError: null,
    fallbackActive: false,
  });

  // Re-deriving the key from the SAME signature (a fresh mount) hits the slot.
  const reKey = buildDiscoverCacheKey({ ...baseSig });
  const hit = readDiscoverCache(reKey);
  assert(hit !== null, "expected a cache hit on re-mount with same signature");
  assertEquals(hit.nightOutCards.length, 1);
  assertEquals(hit.businessEvents.length, 1);
  assert(isDiscoverCacheFresh(hit), "fresh write must be within TTL");
});

Deno.test("ORCH-0996 (b) DIFFERENT filter set never reads prior set (no C-1 leakage)", () => {
  __resetDiscoverCacheForTests();
  const musicKey = buildDiscoverCacheKey(baseSig);
  writeDiscoverCache(musicKey, {
    nightOutCards: [{ id: "music-only" }],
    businessEvents: [],
    tmError: null,
    fallbackActive: false,
  });

  // Change ONLY the segment — a distinct query. Must MISS, not leak music data.
  const sportsKey = buildDiscoverCacheKey({ ...baseSig, segment: "sports" });
  assert(musicKey !== sportsKey, "distinct filter sets must produce distinct keys");
  assertEquals(
    readDiscoverCache(sportsKey),
    null,
    "sports query must NOT read the music slot (C-1 cross-filter leakage)",
  );

  // Same for a deep facet (musicGenres) — every server facet is in the key.
  const facetKey = buildDiscoverCacheKey({ ...baseSig, musicGenres: ["afro"] });
  assert(musicKey !== facetKey, "musicGenres change must change the key");
  assertEquals(readDiscoverCache(facetKey), null);
});

Deno.test("ORCH-0996 (b) array pill ORDER does not change the key (set semantics)", () => {
  const k1 = buildDiscoverCacheKey({ ...baseSig, vibeTags: ["a", "b"] });
  const k2 = buildDiscoverCacheKey({ ...baseSig, vibeTags: ["b", "a"] });
  assertEquals(k1, k2, "pill selection order must not fragment the cache");
});

// ── REWORK 1 (c): resolved-city seed makes the events cache HIT on re-open ──
//
// QA proved the events cache alone could NOT deliver instant re-open: on a
// fresh remount `gpsDefaultCity` was null until the ~2-3s async reverseGeocode
// re-ran, so the events-cache signature had cityName=null and MISSED the prior
// city-keyed entry. The resolved-city cache fixes that: the prior session's
// reverse-geocode result is recorded; a fresh mount with the SAME coords reads
// it SYNCHRONOUSLY so the events-cache key reproduces the prior entry's key.

// Filters carried into the events-cache key — mirrors what the screen has at
// mount time (selectedCity is still null then, so effectiveCity == seed city).
const seedFilters = {
  date: "any",
  segment: "music",
  genre: "all",
  partyTypes: [] as string[],
  vibeTags: [] as string[],
  musicGenres: [] as string[],
};

// Reproduce DiscoverScreen's mount-time events-cache read from the seeded city.
function eventsKeyFromSeededCity(
  city: { name: string; lat: number; lng: number },
): string {
  return buildDiscoverCacheKey({
    cityName: city.name,
    cityLat: city.lat,
    cityLng: city.lng,
    gpsLat: city.lat,
    gpsLng: city.lng,
    ...seedFilters,
  });
}

Deno.test("ORCH-0996 REWORK 1 (c) prior-resolved coords seed city synchronously -> events cache HITS", () => {
  __resetDiscoverCacheForTests();
  __resetResolvedDiscoverCityForTests();

  // ── Prior session: Raleigh resolved for coords X, events fetched + cached
  //    under the Raleigh signature (with the GPS facets the screen used). ──
  const X = { lat: 35.7796, lng: -78.6382 };
  const raleigh = {
    name: "Raleigh",
    stateCode: "NC",
    countryCode: "US",
    lat: X.lat,
    lng: X.lng,
  };
  writeResolvedDiscoverCity(X.lat, X.lng, raleigh);
  const priorEventsKey = eventsKeyFromSeededCity(raleigh);
  writeDiscoverCache(priorEventsKey, {
    nightOutCards: [{ id: "tm-raleigh" }],
    businessEvents: [{ eventId: "biz-raleigh" }],
    tmError: null,
    fallbackActive: false,
  });

  // ── Fresh remount: gpsDefaultCity is null; the screen seeds it
  //    SYNCHRONOUSLY from the resolved-city cache BEFORE any async geocode. ──
  const seed = readLastResolvedDiscoverCity();
  assert(seed !== null, "fresh mount must synchronously seed the resolved city");
  assertEquals(seed.name, "Raleigh");

  // The events-cache key built from the seeded city reproduces the prior key,
  // so the events cache HITS on the very first render — instant paint.
  const remountEventsKey = eventsKeyFromSeededCity(seed);
  assertEquals(
    remountEventsKey,
    priorEventsKey,
    "seeded city must reproduce the prior events-cache key",
  );
  const hit = readDiscoverCache(remountEventsKey);
  assert(
    hit !== null,
    "events cache must HIT on remount via the resolved-city seed (no skeleton wait)",
  );
  assert(isDiscoverCacheFresh(hit), "seeded paint suppresses the skeleton when fresh");
  assertEquals(hit.nightOutCards.length, 1);
  assertEquals(hit.businessEvents.length, 1);
});

Deno.test("ORCH-0996 REWORK 1 (c) coords-matched read respects the ~110m bucket (moved user not mis-seeded)", () => {
  __resetResolvedDiscoverCityForTests();
  const raleigh = {
    name: "Raleigh",
    stateCode: "NC",
    countryCode: "US",
    lat: 35.7796,
    lng: -78.6382,
  };
  writeResolvedDiscoverCity(raleigh.lat, raleigh.lng, raleigh);

  // Same ~110m bucket -> coords-matched read returns the seed.
  assert(
    readResolvedDiscoverCity(35.7796, -78.6382) !== null,
    "identical coords must match the resolved-city bucket",
  );
  // A jitter under the 3-decimal bucket still matches.
  assert(
    readResolvedDiscoverCity(35.7798, -78.6381) !== null,
    "sub-110m jitter must still match the bucket",
  );
  // A different city (Durham, ~30km away) must NOT match -> async geocode
  // corrects the chip instead of showing the previous city.
  assertEquals(
    readResolvedDiscoverCity(35.994, -78.8986),
    null,
    "a moved user (different bucket) must not get the previous city seeded",
  );
});

Deno.test("ORCH-0996 (b) stale cache entry reports not-fresh past TTL", () => {
  __resetDiscoverCacheForTests();
  const key = buildDiscoverCacheKey(baseSig);
  writeDiscoverCache(key, {
    nightOutCards: [],
    businessEvents: [],
    tmError: null,
    fallbackActive: false,
  });
  const hit = readDiscoverCache(key);
  assert(hit !== null);
  // Just-written entry is fresh; an entry older than the TTL is not.
  assert(isDiscoverCacheFresh(hit, hit.storedAt + DISCOVER_CACHE_TTL_MS - 1));
  assertFalse(isDiscoverCacheFresh(hit, hit.storedAt + DISCOVER_CACHE_TTL_MS + 1));
});
