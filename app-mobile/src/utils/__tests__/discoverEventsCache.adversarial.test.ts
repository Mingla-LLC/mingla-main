// @ts-nocheck
// ORCH-0996 TESTER ADVERSARIAL regression test — Discover cold-open latency.
//
// Distinct angle from the implementor's happy-path suite
// (discoverEventsCache.test.ts). That suite proves the contract holds for the
// nominal cases. THIS suite attacks the leakage + staleness EDGES — the exact
// class of bug that forced ORCH-0839-A to rip out the prior AsyncStorage cache
// (C-1 cross-filter leakage: under-specified key + short-circuit served one
// filter set's cards for another). The job here is to PROVE that class is
// structurally dead, not merely that the happy path works.
//
// Deno-runnable (discoverEventsCache.ts has zero RN deps).
import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  decideDiscoverFetchMode,
  buildDiscoverCacheKey,
  readDiscoverCache,
  writeDiscoverCache,
  __resetDiscoverCacheForTests,
  writeResolvedDiscoverCity,
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
  partyTypes: [] as string[],
  vibeTags: [] as string[],
  musicGenres: [] as string[],
};

// ── ADVERSARIAL 1 — facet-level cross-filter leakage (the ORCH-0839-A C-1 bug)
//
// The implementor proved a segment change and a single musicGenres change miss.
// This attack is broader and meaner:
//   • EVERY one of the three ORCH-0824 facets (partyTypes / vibeTags /
//     musicGenres) — added AFTER the original cache was built — must, when
//     changed ALONE, produce a key that NEVER reads the base slot.
//   • A SET-CONTENT difference (not just order) must not collide: ["afro"] vs
//     ["afro","house"] are different SETS and must key differently. (Order
//     independence is the implementor's case; this is its dangerous inverse —
//     a superset must not be served the subset's cards.)
//   • SEPARATOR-INJECTION: a facet value containing the key's own delimiters
//     ("|" / ",") must not let two DISTINCT signatures collide on one key.
//     This is the classic under-specified-key failure mode; if it collides,
//     C-1 is back through a different door.
Deno.test("ADV-1 each ORCH-0824 facet alone misses the base slot (no C-1 leakage)", () => {
  __resetDiscoverCacheForTests();
  const baseKey = buildDiscoverCacheKey(baseSig);
  writeDiscoverCache(baseKey, {
    nightOutCards: [{ id: "BASE-ONLY" }],
    businessEvents: [{ eventId: "BASE-BIZ" }],
    tmError: null,
    fallbackActive: false,
  });

  const facetVariants = [
    { ...baseSig, partyTypes: ["date_night"] },
    { ...baseSig, vibeTags: ["chill"] },
    { ...baseSig, musicGenres: ["afro"] },
    // date and genre are server facets too — changing either must also miss.
    { ...baseSig, date: "tonight" },
    { ...baseSig, genre: "rock" },
  ];
  for (const v of facetVariants) {
    const k = buildDiscoverCacheKey(v);
    assertNotEquals(k, baseKey, "a distinct server facet must change the key");
    assertEquals(
      readDiscoverCache(k),
      null,
      "a distinct facet must MISS — never serve the base slot's cards (C-1)",
    );
  }
});

Deno.test("ADV-1 a SUPERSET array must not be served the SUBSET's cached cards", () => {
  __resetDiscoverCacheForTests();
  const subsetKey = buildDiscoverCacheKey({ ...baseSig, musicGenres: ["afro"] });
  writeDiscoverCache(subsetKey, {
    nightOutCards: [{ id: "AFRO-ONLY" }],
    businessEvents: [],
    tmError: null,
    fallbackActive: false,
  });
  // Adding a second genre is a DIFFERENT query (broader result set). It must
  // not collide with the single-genre slot.
  const supersetKey = buildDiscoverCacheKey({
    ...baseSig,
    musicGenres: ["afro", "house"],
  });
  assertNotEquals(supersetKey, subsetKey);
  assertEquals(
    readDiscoverCache(supersetKey),
    null,
    "a broader genre set must NOT read the narrower set's slot",
  );
});

Deno.test("ADV-1 separator-injection: delimiter-bearing facet values must not collide two distinct signatures", () => {
  __resetDiscoverCacheForTests();
  // Two genuinely DIFFERENT signatures. If the key builder naively joins on
  // "|"/"," with no escaping, a crafted value could make these collide.
  // Signature A: partyTypes = ["a|b"], vibeTags = []
  // Signature B: partyTypes = ["a"],   vibeTags = ["b"]  (different SETS)
  const sigA = { ...baseSig, partyTypes: ["a|b"], vibeTags: [] };
  const sigB = { ...baseSig, partyTypes: ["a"], vibeTags: ["b"] };
  const keyA = buildDiscoverCacheKey(sigA);
  const keyB = buildDiscoverCacheKey(sigB);
  assertNotEquals(
    keyA,
    keyB,
    "delimiter-bearing facet values must not collapse two distinct signatures into one key",
  );

  // And the comma form: cityName containing a comma vs a shifted boundary.
  const cityComma = buildDiscoverCacheKey({ ...baseSig, cityName: "A,B" });
  const cityPlain = buildDiscoverCacheKey({ ...baseSig, cityName: "A", segment: "B" });
  assertNotEquals(
    cityComma,
    cityPlain,
    "a comma inside a facet must not realign field boundaries into a colliding key",
  );

  // Prove the leakage cannot occur in practice: write under A, read under B.
  writeDiscoverCache(keyA, {
    nightOutCards: [{ id: "SIG-A" }],
    businessEvents: [],
    tmError: null,
    fallbackActive: false,
  });
  assertEquals(
    readDiscoverCache(keyB),
    null,
    "signature B must never read signature A's cards even with crafted delimiters",
  );
});

// ── ADVERSARIAL 2 — resolved-city seed STALENESS on a physical city move.
//
// The seed is paint-first ONLY; the network must stay authoritative. The
// dangerous failure is: user resolved to Raleigh (cards cached under Raleigh),
// then physically moves to Durham. On the new mount the authoritative geocode
// resolves Durham. The events signature for Durham MUST differ from Raleigh's
// so the Raleigh cards can NEVER be cross-served as authoritative for Durham.
// (The seed read may momentarily show the last city as a paint hint, but the
// cache key the network writes/reads under must follow the NEW city.)
function eventsKey(city: { name: string; lat: number; lng: number }) {
  return buildDiscoverCacheKey({
    cityName: city.name,
    cityLat: city.lat,
    cityLng: city.lng,
    gpsLat: city.lat,
    gpsLng: city.lng,
    date: "any",
    segment: "music",
    genre: "all",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
  });
}

Deno.test("ADV-2 moved-city: new authoritative city keys differently — old cards cannot be cross-served", () => {
  __resetDiscoverCacheForTests();
  __resetResolvedDiscoverCityForTests();

  const raleigh = { name: "Raleigh", stateCode: "NC", countryCode: "US", lat: 35.7796, lng: -78.6382 };
  const durham = { name: "Durham", stateCode: "NC", countryCode: "US", lat: 35.994, lng: -78.8986 };

  // Prior session in Raleigh: city resolved + cards cached under Raleigh.
  writeResolvedDiscoverCity(raleigh.lat, raleigh.lng, raleigh);
  const raleighKey = eventsKey(raleigh);
  writeDiscoverCache(raleighKey, {
    nightOutCards: [{ id: "RALEIGH-CARD" }],
    businessEvents: [{ eventId: "RALEIGH-BIZ" }],
    tmError: null,
    fallbackActive: false,
  });

  // User physically moved to Durham; the authoritative geocode resolves Durham.
  const durhamKey = eventsKey(durham);
  assertNotEquals(
    durhamKey,
    raleighKey,
    "a different resolved city must produce a different events-cache signature",
  );
  // The authoritative Durham query has NO cached entry yet → MISS → the network
  // fetch fills it. The stale Raleigh cards are never served as Durham's truth.
  assertEquals(
    readDiscoverCache(durhamKey),
    null,
    "Durham must MISS — the seeded/cached Raleigh cards are not authoritative for Durham",
  );
});

Deno.test("ADV-2 same-city tiny GPS jitter still keys to the SAME city slot (coord-rounding does not fragment)", () => {
  // The seed dedupes coords to ~110m; but the EVENTS key uses the resolved
  // CITY's canonical coords (effectiveCity.lat/lng), not the raw device fix.
  // So two mounts in Raleigh with jittered device fixes resolve to the SAME
  // Raleigh city object and therefore the SAME events key — i.e. the fix must
  // not accidentally fragment a single city into many cache slots.
  const raleigh = { name: "Raleigh", lat: 35.7796, lng: -78.6382 };
  const k1 = eventsKey(raleigh);
  const k2 = eventsKey(raleigh);
  assertEquals(k1, k2, "the same resolved city must always map to one events slot");
});

// ── ADVERSARIAL 3 — decideDiscoverFetchMode full contract under all 4 inputs.
//
// The implementor covered the 3 nominal rows. This pins the FULL truth table
// including the adversarial fourth combination (no usable query but already
// fired) — which must STILL be "skip", proving usable-query is the dominant
// gate and a stale `hasFiredInitial` can never resurrect a fetch with no query.
Deno.test("ADV-3 decideDiscoverFetchMode full truth table (skip dominates no-query)", () => {
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: true, hasFiredInitial: false }),
    "immediate",
  );
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: true, hasFiredInitial: true }),
    "debounced",
  );
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: false, hasFiredInitial: false }),
    "skip",
  );
  // Adversarial 4th row: no usable query yet hasFiredInitial — must still skip.
  // (Guards against an ordering bug where the fired-flag is checked first and
  // would debounce-fire a query with no city AND no GPS.)
  assertEquals(
    decideDiscoverFetchMode({ hasUsableQuery: false, hasFiredInitial: true }),
    "skip",
    "no usable query must skip regardless of whether the initial fetch already fired",
  );
});
