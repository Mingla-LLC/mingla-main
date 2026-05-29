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
