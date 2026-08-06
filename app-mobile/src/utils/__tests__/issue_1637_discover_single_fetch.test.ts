// @ts-nocheck
// #1637 [discover-single-fetch] — IMPLEMENTOR happy-path regression suite.
//
// THE BUG. On a cold launch with no saved city — 44 of 53 live users —
// DiscoverScreen ran TWO sequential fetches against TWO endpoints:
//
//   fetch #1  fires the moment GPS resolves. `effectiveCity` is still null (the
//             reverse-geocode of those same coordinates has not returned), so it
//             took the `else` branch, which hard-set `setBusinessEvents([])` and
//             called the Ticketmaster-ONLY endpoint. Structurally incapable of
//             containing a single Mingla event.
//   fetch #2  fires ~300ms after the geocode names the city, hits the merged
//             endpoint, and commits a SECOND deck over the one already painted.
//
// Two separable defects fell out of that. LATENESS: Ticketmaster was gated on
// strictly LESS than Mingla (GPS alone, vs GPS + a geocode round trip + a
// debounce), so Mingla could never be first. RESHUFFLE: the second commit
// inserted N business cards at the HEAD of a wrapping 2-column grid, so every
// painted card moved — and an odd N flipped every card between columns.
//
// WHAT THIS SUITE PROVES, and how it is not a replica of the screen. The
// decisions the screen makes are now PURE and EXPORTED
// (`resolveDiscoverQueryAnchor`, `buildDiscoverSignatureForAnchor`,
// `hasUsableDiscoverQuery`, `decideDiscoverFetchMode`, `buildDiscoverDeckOrder`),
// and contracts C-1..C-5 below read the REAL DiscoverScreen.tsx source to prove
// the screen delegates to exactly those and retains no second path. So the
// timeline replayed in T-1..T-4 is the screen's own decision function, not a
// model of it.
//
// FAILS-ON-REVERT: delete the `coords` branch from `resolveDiscoverQueryAnchor`
// (discoverEventsCache.ts) → T-1/T-2/T-3 fail (a cold mount issues ZERO
// fetches). Restore the `NightOutExperiencesService.search(` call or the
// `setBusinessEvents([])` line in DiscoverScreen.tsx → C-2/C-3 fail.
//
// Deno-runnable: discoverEventsCache.ts and discoverDeckOrder.ts have zero RN
// dependencies, matching the sibling ORCH-0996 suites.
//
// Run with:
//   deno test --allow-read \
//     app-mobile/src/utils/__tests__/issue_1637_discover_single_fetch.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDiscoverCacheKey,
  buildDiscoverSignatureForAnchor,
  decideDiscoverFetchMode,
  hasUsableDiscoverQuery,
  resolveDiscoverQueryAnchor,
  snapDiscoverQueryCoord,
  RESOLVED_CITY_COORD_PRECISION,
  // #1637 follow-up — value-identity for the anchor, and the one shared reading
  // of the saved `discover_city_*` preference.
  discoverQueryAnchorKey,
  discoverCityFromPreferences,
  sameDiscoverAnchorCity,
} from "../discoverEventsCache.ts";
import {
  buildDiscoverDeckOrder,
  discoverDeckIdentity,
} from "../discoverDeckOrder.ts";

const FILTERS = {
  date: "any",
  segment: "music",
  genre: "all",
  partyTypes: [] as string[],
  vibeTags: [] as string[],
  musicGenres: [] as string[],
};

/** Raleigh, to 7 decimals — the shape a real GPS fix arrives in. */
const GPS = { lat: 35.7795897, lng: -78.6381787 };
/** What the reverse-geocode eventually names those coordinates. */
const GEOCODED_CITY = {
  name: "Raleigh",
  stateCode: "NC",
  countryCode: "US",
  lat: GPS.lat,
  lng: GPS.lng,
};

/**
 * Replay of DiscoverScreen's mount timeline through the SAME pure functions the
 * screen calls, counting how many times the fetch effect would actually fire.
 *
 * The screen's fetch effect fires when `fetchNightOutEvents`'s identity changes,
 * and that callback's dependency list is exactly (queryAnchor + the six filter
 * facets) — pinned by contract C-4 below. So "a fetch fires" is precisely "the
 * query signature changed while the query was usable", which is what this
 * counts. Each step names what the real screen state is at that instant.
 */
function replayMount(
  steps: Array<{
    label: string;
    selectedCity: { name: string; lat: number; lng: number } | null;
    gpsLat: number | null;
    gpsLng: number | null;
    prefsSettled: boolean;
  }>,
): Array<{ label: string; mode: string; key: string }> {
  const fired: Array<{ label: string; mode: string; key: string }> = [];
  let hasFiredInitial = false;
  let lastKey: string | null = null;

  for (const step of steps) {
    const anchor = resolveDiscoverQueryAnchor({
      selectedCity: step.selectedCity,
      gpsLat: step.gpsLat,
      gpsLng: step.gpsLng,
    });
    const key = buildDiscoverCacheKey(
      buildDiscoverSignatureForAnchor(anchor, FILTERS),
    );
    const hasUsableQuery = step.prefsSettled && hasUsableDiscoverQuery(anchor);
    const mode = decideDiscoverFetchMode({ hasUsableQuery, hasFiredInitial });
    if (mode === "skip") continue;
    // React only re-runs the effect when a dependency's identity changed. An
    // unchanged query key means an unchanged callback identity means no re-run.
    if (key === lastKey) continue;
    lastKey = key;
    hasFiredInitial = true;
    fired.push({ label: step.label, mode, key });
  }
  return fired;
}

// ── T-1 ────────────────────────────────────────────────────────────────────
// The headline contract: a cold mount with NO saved city issues exactly ONE
// fetch, it is immediate, and it is coords-anchored — which is what makes it
// carry both supplies (the merged endpoint fans out to the business RPC and
// Ticketmaster in one Promise.all; server contract proved in
// supabase/functions/discover-merged-events/__tests__/issue_1637_coords_anchor.test.ts).

Deno.test("#1637 T-1 cold mount, no saved city: EXACTLY ONE fetch, immediate, coords-anchored", () => {
  const fired = replayMount([
    // T0 — nothing resolved. Module caches are empty on a cold process.
    { label: "mount", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: false },
    // T0+ — the preferences read returns with NO discover_city_*.
    { label: "prefs-empty", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: true },
    // T1 — GPS resolves. THIS is the only fetch.
    { label: "gps", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
    // T2 — the reverse-geocode names the city. Before #1637 this was fetch #2.
    { label: "geocode", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
  ]);

  assertEquals(
    fired.length,
    1,
    `cold mount must issue exactly ONE fetch; got ${fired.length}: ${
      fired.map((f) => f.label).join(", ")
    }`,
  );
  assertEquals(fired[0].label, "gps");
  assertEquals(
    fired[0].mode,
    "immediate",
    "the one fetch must be the ORCH-0996 immediate path, never the 300ms debounce",
  );

  const anchor = resolveDiscoverQueryAnchor({
    selectedCity: null,
    gpsLat: GPS.lat,
    gpsLng: GPS.lng,
  });
  assertEquals(
    anchor.kind,
    "coords",
    "with no saved city the anchor MUST be coordinates — a city anchor here is the two-phase bug",
  );
});

// ── T-2 ────────────────────────────────────────────────────────────────────
// The reverse-geocode is a LABEL. It must not touch the query identity at all.

Deno.test("#1637 T-2 the reverse-geocoded city does not change the query identity", () => {
  const beforeGeocode = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({
        selectedCity: null,
        gpsLat: GPS.lat,
        gpsLng: GPS.lng,
      }),
      FILTERS,
    ),
  );

  // The geocode lands. In the screen it sets `gpsDefaultCity` — the chip label.
  // `resolveDiscoverQueryAnchor` takes `selectedCity` ONLY, so there is no
  // parameter through which the geocode result can reach the query. This is the
  // structural statement of the fix.
  const afterGeocode = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({
        selectedCity: null, // gpsDefaultCity = Raleigh is NOT passed here
        gpsLat: GPS.lat,
        gpsLng: GPS.lng,
      }),
      FILTERS,
    ),
  );

  assertEquals(
    afterGeocode,
    beforeGeocode,
    "naming the user's city must not re-key the query — that re-key WAS the second fetch",
  );

  // And prove the counterfactual is genuinely different, so the assertion above
  // is not passing because both sides are trivially equal.
  const ifGeocodeHadAnchored = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({
        selectedCity: GEOCODED_CITY,
        gpsLat: GPS.lat,
        gpsLng: GPS.lng,
      }),
      FILTERS,
    ),
  );
  assertNotEquals(
    ifGeocodeHadAnchored,
    beforeGeocode,
    "sanity: a city anchor IS a different query — which is exactly why the geocode must not produce one",
  );
});

// ── T-3 ────────────────────────────────────────────────────────────────────
// Nothing that has painted may move. With one commit the ordered id list is
// decided once; the pre-fix two-commit sequence is replayed as the oracle so
// this test cannot pass vacuously.

Deno.test("#1637 T-3 the ordered deck id list is decided ONCE and never re-orders after paint", () => {
  const tm = [
    { id: "tm-a", localDate: "2026-08-07" },
    { id: "tm-b", localDate: "2026-08-08" },
    { id: "tm-c", localDate: "2026-08-09" },
  ];
  const biz = [{ eventId: "be-1" }]; // odd N — the column-flipping case

  // AFTER #1637: the cold mount fires once, so the deck is committed once from
  // one response carrying both sources.
  const fired = replayMount([
    { label: "mount", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: false },
    { label: "prefs-empty", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: true },
    { label: "gps", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
    { label: "geocode", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
  ]);
  assertEquals(fired.length, 1, "single commit is the precondition for a stable deck");

  const painted = discoverDeckIdentity(buildDiscoverDeckOrder(biz, tm));
  const settled = discoverDeckIdentity(buildDiscoverDeckOrder(biz, tm));
  assertEquals(
    settled,
    painted,
    "with one commit the ordered id list at paint and at settle are the same list",
  );
  assertEquals(painted, ["business:be-1", "tm:tm-a", "tm:tm-b", "tm:tm-c"]);

  // ORACLE — the pre-#1637 two-commit sequence, so the assertion above is
  // provably non-vacuous. Commit 1 was Ticketmaster-only with businessEvents
  // forced to []; commit 2 prepended the business block.
  const oldFirstPaint = discoverDeckIdentity(buildDiscoverDeckOrder([], tm));
  const oldSecondPaint = discoverDeckIdentity(buildDiscoverDeckOrder(biz, tm));
  assertNotEquals(
    oldSecondPaint.slice(0, oldFirstPaint.length),
    oldFirstPaint,
    "oracle: the old two-commit sequence DID move painted cards — if this ever stops being true the test above proves nothing",
  );
  assertEquals(
    oldFirstPaint[0],
    "tm:tm-a",
    "oracle: the old first paint led with Ticketmaster (Seth's report)",
  );
  assertEquals(
    oldSecondPaint[0],
    "business:be-1",
    "oracle: the old second paint displaced it — every painted card moved down one slot",
  );
});

// ── T-4 ────────────────────────────────────────────────────────────────────
// A user WITH a saved city: still one fetch, and a later GPS fix must not mint a
// second one (in city mode the request body ignores device coordinates, so a
// refetch there would have been byte-identical churn).

Deno.test("#1637 T-4 saved-city user: one fetch, and a later GPS fix does not re-key it", () => {
  const savedCity = { name: "Lagos", lat: 6.5244, lng: 3.3792 };
  const fired = replayMount([
    { label: "mount", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: false },
    // The preferences read lands first (a ~100-300ms local read vs a 1-3s GPS
    // acquisition) and supplies the anchor.
    { label: "prefs-city", selectedCity: savedCity, gpsLat: null, gpsLng: null, prefsSettled: true },
    // GPS resolves afterwards. City mode ignores device coords entirely.
    { label: "gps-later", selectedCity: savedCity, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
    { label: "geocode", selectedCity: savedCity, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
  ]);
  assertEquals(
    fired.length,
    1,
    `a saved-city user must also issue exactly ONE fetch; got ${
      fired.map((f) => f.label).join(", ")
    }`,
  );
  assertEquals(fired[0].label, "prefs-city");

  // The gps facets are null in a city-anchored signature — that is the
  // mechanism, not a coincidence.
  const sig = buildDiscoverSignatureForAnchor(
    resolveDiscoverQueryAnchor({
      selectedCity: savedCity,
      gpsLat: GPS.lat,
      gpsLng: GPS.lng,
    }),
    FILTERS,
  );
  assertEquals(sig.gpsLat, null);
  assertEquals(sig.gpsLng, null);
  assertEquals(sig.cityName, "Lagos");
});

// ── T-5 ────────────────────────────────────────────────────────────────────
// Coordinate snapping: kills float jitter (which would otherwise mint one cache
// row per request on both the client and the server's L2 layer) without moving
// the search anchor far enough to change a displayed distance.

Deno.test("#1637 T-5 device coords snap to the ~110m bucket — jitter cannot fragment the cache", () => {
  assertEquals(RESOLVED_CITY_COORD_PRECISION, 3);
  assertEquals(snapDiscoverQueryCoord(35.7795897), 35.78);
  assertEquals(snapDiscoverQueryCoord(null), null);
  assertEquals(snapDiscoverQueryCoord(undefined), null);
  assertEquals(snapDiscoverQueryCoord(Number.NaN), null);

  // Two launches from the same spot with different GPS fixes → ONE key.
  const k1 = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: 35.7795897, gpsLng: -78.6381787 }),
      FILTERS,
    ),
  );
  const k2 = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: 35.7804412, gpsLng: -78.6377001 }),
      FILTERS,
    ),
  );
  assertEquals(k1, k2, "sub-110m jitter must not fragment the query identity");

  // A genuine move to another city still keys differently — the ORCH-0996
  // ADV-2 guarantee, restated for the coords anchor.
  const durham = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: 35.994, gpsLng: -78.8986 }),
      FILTERS,
    ),
  );
  assertNotEquals(durham, k1, "a moved user must never be served the previous location's slot");
});

// ── T-6 ────────────────────────────────────────────────────────────────────
// The ORCH-0996 C-1 cross-filter isolation must survive the anchor rewrite: a
// filter change still re-keys, under BOTH anchors.

Deno.test("#1637 T-6 cross-filter cache-key isolation (ORCH-0839-A C-1) holds under both anchors", () => {
  for (
    const anchorArgs of [
      { selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng },
      { selectedCity: GEOCODED_CITY, gpsLat: GPS.lat, gpsLng: GPS.lng },
    ]
  ) {
    const anchor = resolveDiscoverQueryAnchor(anchorArgs);
    const base = buildDiscoverCacheKey(
      buildDiscoverSignatureForAnchor(anchor, FILTERS),
    );
    const variants = [
      { ...FILTERS, segment: "sports" },
      { ...FILTERS, genre: "rock" },
      { ...FILTERS, date: "tonight" },
      { ...FILTERS, partyTypes: ["date_night"] },
      { ...FILTERS, vibeTags: ["chill"] },
      { ...FILTERS, musicGenres: ["afro"] },
    ];
    for (const v of variants) {
      assertNotEquals(
        buildDiscoverCacheKey(buildDiscoverSignatureForAnchor(anchor, v)),
        base,
        `anchor=${anchor.kind}: every server facet must still re-key (C-1 leakage guard)`,
      );
    }
    // Pill ORDER is still set semantics, not sequence semantics.
    assertEquals(
      buildDiscoverCacheKey(
        buildDiscoverSignatureForAnchor(anchor, { ...FILTERS, vibeTags: ["a", "b"] }),
      ),
      buildDiscoverCacheKey(
        buildDiscoverSignatureForAnchor(anchor, { ...FILTERS, vibeTags: ["b", "a"] }),
      ),
    );
  }
});

// ── T-7 ────────────────────────────────────────────────────────────────────
// A city anchor and a coords anchor at the SAME place must never share a slot —
// they are different server queries (city-name match vs ST_DWithin radius).

Deno.test("#1637 T-7 city and coords anchors at the same place key distinctly", () => {
  const coordsKey = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng }),
      FILTERS,
    ),
  );
  const cityKey = buildDiscoverCacheKey(
    buildDiscoverSignatureForAnchor(
      resolveDiscoverQueryAnchor({ selectedCity: GEOCODED_CITY, gpsLat: GPS.lat, gpsLng: GPS.lng }),
      FILTERS,
    ),
  );
  assertNotEquals(coordsKey, cityKey);
});

// ── T-8 ────────────────────────────────────────────────────────────────────
// Degenerate anchors must be "none", never a half-formed query.

Deno.test("#1637 T-8 a blank or half-formed anchor resolves to none (skip), never a partial fetch", () => {
  const cases = [
    { selectedCity: null, gpsLat: null, gpsLng: null },
    { selectedCity: null, gpsLat: GPS.lat, gpsLng: null },
    { selectedCity: null, gpsLat: null, gpsLng: GPS.lng },
    { selectedCity: { name: "   ", lat: 1, lng: 2 }, gpsLat: null, gpsLng: null },
    { selectedCity: { name: "X", lat: Number.NaN, lng: 2 }, gpsLat: null, gpsLng: null },
  ];
  for (const c of cases) {
    const anchor = resolveDiscoverQueryAnchor(c);
    assertEquals(anchor.kind, "none", JSON.stringify(c));
    assertEquals(hasUsableDiscoverQuery(anchor), false);
    assertEquals(
      decideDiscoverFetchMode({
        hasUsableQuery: hasUsableDiscoverQuery(anchor),
        hasFiredInitial: false,
      }),
      "skip",
    );
  }
  // A named city with NO coords is still not an anchor here: the merged request
  // needs a lat/lng pair for the geo fallback, and a city with unusable coords
  // would produce a request the server cannot serve.
  assertEquals(
    resolveDiscoverQueryAnchor({
      selectedCity: { name: "Raleigh", lat: 35.78, lng: -78.64 },
      gpsLat: null,
      gpsLng: null,
    }).kind,
    "city",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// SOURCE CONTRACTS — these read the REAL screen/service source, so the pure
// functions above are provably the ones the app runs.
// ───────────────────────────────────────────────────────────────────────────

const HERE = new URL(".", import.meta.url).pathname;
const read = (rel: string): string => Deno.readTextFileSync(HERE + rel);

/**
 * Comments stripped (the `[^:]` guard keeps `https://` intact), then all
 * whitespace removed. Every negative assertion below runs over THIS, never raw
 * source — otherwise a protective comment that merely NAMES the removed code
 * (and this file's subjects are all named in protective comments, deliberately)
 * would fail the gate, and the obvious "fix" would be to delete the explanation
 * that stops the bug coming back.
 */
const denseCode = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");

const SCREEN_REL = "../../components/DiscoverScreen.tsx";
const SERVICE_REL = "../../services/nightOutExperiencesService.ts";

Deno.test("#1637 C-0 the scan is not vacuous", () => {
  const screen = read(SCREEN_REL);
  const service = read(SERVICE_REL);
  assert(screen.length > 50_000, `DiscoverScreen.tsx read back only ${screen.length} chars`);
  assert(service.length > 2_000, `nightOutExperiencesService.ts read back only ${service.length} chars`);
});

Deno.test("#1637 C-1 the query anchor is fed selectedCity, NEVER the reverse-geocoded city", () => {
  const screen = read(SCREEN_REL);
  const call = screen.match(/resolveDiscoverQueryAnchor\(\{[\s\S]{0,400}?\}\)/g);
  assert(call !== null && call.length >= 1, "expected at least one resolveDiscoverQueryAnchor call site");
  for (const site of call) {
    assert(
      !/selectedCity\s*:\s*[^,\n]*(effectiveCity|gpsDefaultCity)/.test(site),
      "resolveDiscoverQueryAnchor must never be handed effectiveCity/gpsDefaultCity — that is #1637 verbatim:\n" + site,
    );
  }
  // And the live call site passes the bare `selectedCity` state.
  assert(
    /resolveDiscoverQueryAnchor\(\{\s*\n\s*selectedCity,/.test(screen),
    "expected the live anchor call to pass `selectedCity` (shorthand) directly",
  );
});

Deno.test("#1637 C-2 DiscoverScreen has NO Ticketmaster-only fetch path left", () => {
  const dense = denseCode(read(SCREEN_REL));
  assert(
    !dense.includes("NightOutExperiencesService.search("),
    "DiscoverScreen must not call the Ticketmaster-only `search()` — it is the branch that produced a first deck with zero Mingla events",
  );
  assert(
    dense.includes("NightOutExperiencesService.searchMerged("),
    "DiscoverScreen must call searchMerged — vacuity guard for the assertion above",
  );
  assertEquals(
    (dense.match(/NightOutExperiencesService\.searchMerged\(/g) ?? []).length,
    1,
    "exactly ONE fetch call site: two would be two commits and therefore a reshuffle",
  );
});

Deno.test("#1637 C-3 the `setBusinessEvents([])` hard-empty is gone", () => {
  const dense = denseCode(read(SCREEN_REL));
  assert(
    !dense.includes("setBusinessEvents([])"),
    "`setBusinessEvents([])` blanked Mingla supply before every cold-launch first paint; it must not come back",
  );
  assert(
    dense.includes("setBusinessEvents(bizItems)"),
    "vacuity guard: the real business-events commit must still be present",
  );
});

Deno.test("#1637 C-4 the fetch callback's dependency list IS the query identity", () => {
  const screen = read(SCREEN_REL);
  // The dependency array closing `fetchNightOutEvents`'s useCallback.
  const deps = screen.match(
    /const fetchNightOutEvents = useCallback\([\s\S]*?\n    \[([\s\S]*?)\n    \],\n  \);/,
  );
  assert(deps !== null, "could not locate fetchNightOutEvents' dependency array");
  // Comments inside the array explain WHY effectiveCity and the raw coords were
  // removed, so the identifier checks below must read code only.
  const body = deps[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert(/\bqueryAnchor,/.test(body), "queryAnchor must be a dependency (it is the query identity)");
  assert(
    !/effectiveCity/.test(body),
    "effectiveCity must NOT be a dependency — it folds in the reverse-geocoded chip city (#1637)",
  );
  assert(
    !/nightOutGpsLat|nightOutGpsLng/.test(body),
    "raw device coords must NOT be dependencies — they re-fire a city-anchored query whose body is byte-identical",
  );
  for (const facet of ["date", "segment", "genre", "partyTypes", "vibeTags", "musicGenres"]) {
    assert(
      new RegExp(`selectedFilters\\.${facet},`).test(body),
      `selectedFilters.${facet} must stay a dependency (stale-closure guard, ORCH-0824 QA F-1)`,
    );
  }
});

Deno.test("#1637 C-7 the anchor memo is keyed on the anchor's VALUE, not on its inputs", () => {
  const dense = denseCode(read(SCREEN_REL));
  assert(
    dense.includes("constsnappedGpsLat=snapDiscoverQueryCoord(nightOutGpsLat)"),
    "the raw fix must be snapped before it reaches the anchor",
  );
  assert(
    dense.includes("constsnappedGpsLng=snapDiscoverQueryCoord(nightOutGpsLng)"),
  );
  // WHY THIS ASSERTION CHANGED (#1637 follow-up). It previously pinned the deps
  // to `[selectedCity,snappedGpsLat,snappedGpsLng]` — the SNAPPED INPUTS. That
  // is one bug narrower than it needs to be. Snapping stops a 7-decimal jitter
  // from re-keying the anchor, but a genuine ~110m move still changes
  // `snappedGpsLat` — and in CITY mode `resolveDiscoverQueryAnchor` DISCARDS the
  // coords entirely, so the memo handed React a new object describing a
  // byte-identical query and the fetch effect re-fired. Caught on the physical
  // Samsung SM-A725F: a third city-anchored `searchMerged` for "Raleigh", 6.8s
  // after the second, caused by nothing but the device refining its position.
  // The memo now keys on `queryAnchorKey`, which is computed FROM the resolved
  // anchor, so "same query" and "same identity" are the same statement.
  assert(
    dense.includes("constqueryAnchorKey=discoverQueryAnchorKey("),
    "the screen must derive the anchor's value-identity key",
  );
  assert(
    dense.includes("gpsLat:snappedGpsLat,gpsLng:snappedGpsLng,}),[queryAnchorKey],"),
    "the useMemo deps must be the anchor's VALUE key — keying on the inputs re-fires a city-anchored query that discards those very inputs",
  );
  assert(
    !dense.includes("}),[selectedCity,snappedGpsLat,snappedGpsLng],"),
    "the input-keyed dependency array must not come back — it is the third-fetch defect",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// #1637 FOLLOW-UP — what the first fix did NOT fix, found by instrumented
// capture on the physical Samsung SM-A725F rather than by reading the code.
//
// The first fix gated the initial fetch on `prefsSettled` so a saved
// `discover_city_*` preference could not land AFTER the deck painted. The gate
// was correct; its premise was not. The comment above it described
// `PreferencesService.getUserPreferences` as "a ~100-300ms local table lookup".
// It is an uncached PostgREST round trip. Measured on device, signed in, during
// a cold launch already issuing discover-cards + six curated-experience calls:
//
//   T+0ms      prefs read START
//   T+1500ms   gate OPENED BY THE CAP — the read is still in flight
//   T+1643ms   searchMerged #1  anchor: coords    <-- wrong anchor, PAINTED
//   T+3774ms   prefs read DONE  city=Raleigh
//   T+4278ms   searchMerged #2  anchor: city      <-- the deck re-commits
//   T+11032ms  searchMerged #3  anchor: city      <-- C-7's defect, GPS refine
//
// So for the 9-of-54 signed-in users with a saved city — 17%, the operator
// among them — the reported symptom survived the fix intact.
//
// WHY THE ORIGINAL SUITE PASSED ANYWAY, which is the more important lesson:
// `replayMount` takes `prefsSettled` as an INPUT. It replays the timeline the
// design intends, and can therefore never observe the cap winning the race it
// was meant to lose. T-9 below replays the timeline the DEVICE produced.
// ───────────────────────────────────────────────────────────────────────────

Deno.test("#1637 T-9 a saved-city user gets ONE city-anchored fetch even when the row lands after the cap", () => {
  const SAVED = { name: "Raleigh", lat: 35.779557, lng: -78.638148 };
  // The mirror read is local I/O; the row is the network. Both resolve to the
  // same city — the normal case for a returning user.
  const mirrored = discoverCityFromPreferences({
    discover_city_name: SAVED.name,
    discover_city_state_code: "NC",
    discover_city_country_code: "US",
    discover_city_lat: SAVED.lat,
    discover_city_lng: SAVED.lng,
  });
  assert(mirrored !== null, "the mirror must yield a usable anchor city");

  const fired = replayMount([
    // Mount: nothing known yet. The gate is shut, so nothing may fire.
    { label: "mount", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: false },
    // GPS lands BEFORE either preference read returns — the real cold-launch
    // order, and what used to be fetch #1 on coordinates.
    { label: "gps", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: false },
    // The LOCAL MIRROR resolves in ~10-50ms and seeds the anchor, then opens
    // the gate itself. This is the change: the anchor is right BEFORE the
    // first fetch, not 2.6s after it.
    { label: "mirror", selectedCity: mirrored, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
    // The authoritative row lands 3.8s later and CONFIRMS the seed. Because
    // `sameDiscoverAnchorCity` says they agree, the screen does not re-anchor,
    // so this step presents an unchanged anchor.
    { label: "row", selectedCity: mirrored, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
    // The device refines its position by more than the ~110m snap bucket. In
    // city mode this must change nothing (C-7's defect).
    { label: "gps-refine", selectedCity: mirrored, gpsLat: 35.791, gpsLng: -78.739, prefsSettled: true },
  ]);

  assertEquals(
    fired.map((f) => f.label),
    ["mirror"],
    "exactly ONE fetch, and it is the mirror-seeded one — the device measured three before this fix",
  );
  assert(
    fired[0].key.includes("Raleigh"),
    "the one fetch must be anchored on the SAVED city, not on coordinates",
  );
});

Deno.test("#1637 T-10 the cap losing the race is what the ORIGINAL fix shipped — non-vacuity oracle", () => {
  const SAVED = { name: "Raleigh", lat: 35.779557, lng: -78.638148 };
  // Replay of the pre-follow-up behaviour: no mirror, so the 1.5s cap opens the
  // gate while the row is still in flight, and the row re-anchors afterwards.
  // If this does NOT produce two fetches, T-9 proves nothing.
  const fired = replayMount([
    { label: "mount", selectedCity: null, gpsLat: null, gpsLng: null, prefsSettled: false },
    { label: "gps", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: false },
    { label: "cap-opens-gate", selectedCity: null, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
    { label: "row-lands-late", selectedCity: SAVED, gpsLat: GPS.lat, gpsLng: GPS.lng, prefsSettled: true },
  ]);
  assertEquals(
    fired.map((f) => f.label),
    ["cap-opens-gate", "row-lands-late"],
    "the shipped-first-fix timeline must still reproduce TWO fetches, or T-9's single fetch is vacuous",
  );
  assert(
    !fired[0].key.includes("Raleigh") && fired[1].key.includes("Raleigh"),
    "and the anchor must genuinely flip coords -> city, which is the deck re-commit the user sees",
  );
});

Deno.test("#1637 T-11 a city anchor's identity key ignores GPS; a coords anchor's tracks it", () => {
  const city = { name: "Raleigh", lat: 35.779557, lng: -78.638148 };
  const keyA = discoverQueryAnchorKey(
    resolveDiscoverQueryAnchor({ selectedCity: city, gpsLat: 35.779, gpsLng: -78.638 }),
  );
  const keyB = discoverQueryAnchorKey(
    resolveDiscoverQueryAnchor({ selectedCity: city, gpsLat: 35.791, gpsLng: -78.739 }),
  );
  assertEquals(keyA, keyB, "a GPS move must not change a city-anchored query's identity");

  const coordsA = discoverQueryAnchorKey(
    resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: 35.779, gpsLng: -78.638 }),
  );
  const coordsB = discoverQueryAnchorKey(
    resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: 35.791, gpsLng: -78.739 }),
  );
  assertNotEquals(coordsA, coordsB, "a real move MUST re-key a coords-anchored query");
  assertNotEquals(coordsA, keyA, "coords and city anchors must never collide");
  assertEquals(
    discoverQueryAnchorKey(resolveDiscoverQueryAnchor({ selectedCity: null, gpsLat: null, gpsLng: null })),
    "none",
  );
});

Deno.test("#1637 T-12 the saved-preference reading rejects every unusable row", () => {
  const full = {
    discover_city_name: "Raleigh",
    discover_city_state_code: "NC",
    discover_city_country_code: "US",
    discover_city_lat: 35.779557,
    discover_city_lng: -78.638148,
  };
  const ok = discoverCityFromPreferences(full);
  assertEquals(ok, {
    name: "Raleigh",
    stateCode: "NC",
    countryCode: "US",
    lat: 35.779557,
    lng: -78.638148,
  });
  assertEquals(discoverCityFromPreferences(null), null);
  assertEquals(discoverCityFromPreferences({ ...full, discover_city_name: null }), null);
  assertEquals(discoverCityFromPreferences({ ...full, discover_city_name: "  " }), null);
  assertEquals(discoverCityFromPreferences({ ...full, discover_city_lat: null }), null);
  assertEquals(discoverCityFromPreferences({ ...full, discover_city_lng: undefined }), null);
  assertEquals(discoverCityFromPreferences({ ...full, discover_city_lat: Number.NaN }), null);
  // State/country are optional labels, not part of the anchor's usability.
  assertEquals(
    discoverCityFromPreferences({ ...full, discover_city_state_code: null })?.name,
    "Raleigh",
  );
});

Deno.test("#1637 T-13 reconciliation re-anchors on a real change and on nothing else", () => {
  const a = { name: "Raleigh", lat: 35.779557, lng: -78.638148 };
  assert(sameDiscoverAnchorCity(a, { ...a }), "a confirming row must be a no-op");
  assert(sameDiscoverAnchorCity(null, null), "no saved city on either read is agreement, not a change");
  assert(!sameDiscoverAnchorCity(null, a), "a city appearing where there was none IS a change");
  assert(!sameDiscoverAnchorCity(a, null), "a city being cleared IS a change");
  assert(
    !sameDiscoverAnchorCity(a, { ...a, name: "Durham" }),
    "the user changing city on another device must re-anchor",
  );
  assert(
    !sameDiscoverAnchorCity(a, { ...a, lat: 35.9 }),
    "same name, different coordinates is a different query",
  );
});

Deno.test("#1637 C-8 the prefs effect reads the LOCAL MIRROR before the network row", () => {
  const dense = denseCode(read(SCREEN_REL));
  const mirror = dense.indexOf("offlineService.getOfflineUserPreferences()");
  const row = dense.indexOf("PreferencesService.getUserPreferences(userId)");
  assert(mirror !== -1, "the AsyncStorage mirror must be read — it is what beats the 1.5s cap");
  assert(row !== -1, "vacuity guard: the authoritative row must still be read");
  assert(
    mirror < row,
    "the mirror must be read FIRST; behind the network row it cannot open the gate in time",
  );
  assert(
    dense.includes("setSelectedCity(mirrored);setPrefsSettled(true);"),
    "a mirrored city must seed the anchor AND open the gate, without waiting on the network",
  );
});

Deno.test("#1637 C-9 the authoritative row re-anchors only when it disagrees with the seed", () => {
  const dense = denseCode(read(SCREEN_REL));
  assert(
    dense.includes("if(!sameDiscoverAnchorCity(seeded,authoritative)){setSelectedCity(authoritative);}"),
    "an unguarded setSelectedCity here re-commits the deck on every launch — it is the second fetch, restored",
  );
  assert(
    dense.includes("offlineService.cacheUserPreferences(prefs)"),
    "the mirror must be refreshed from the authoritative row, or it goes stale and stops helping",
  );
});

Deno.test("#1637 C-5 the grid renders ONE ordered deck, not two adjacent blocks", () => {
  const dense = denseCode(read(SCREEN_REL));
  assert(
    dense.includes("constdiscoverDeck=useMemo(()=>buildDiscoverDeckOrder(businessEvents,filteredNightOutCards)"),
    "the deck order must come from buildDiscoverDeckOrder over both arrays",
  );
  assert(
    dense.includes("{discoverDeck.map("),
    "the grid must render the single ordered deck",
  );
  assert(
    !dense.includes("{businessEvents.map((be)=>("),
    "the separate business block must be gone — its adjacency was the displacement mechanism",
  );
  assert(
    !dense.includes("{filteredNightOutCards.map((card)=>("),
    "the separate Ticketmaster block must be gone",
  );
});

Deno.test("#1637 C-6 searchMerged accepts a coords-only anchor", () => {
  const dense = denseCode(read(SERVICE_REL));
  assert(
    !dense.includes('if(!input.city||!input.city.name){'),
    "the hard city.name requirement must be gone — it was the client-side half of the city gate",
  );
  assert(
    dense.includes("if(!cityName&&!hasCoords){"),
    "searchMerged must accept EITHER a city name OR the coordinate triple",
  );
  assert(
    !dense.includes("staticasyncsearch("),
    "the Ticketmaster-only `search()` entry point must stay deleted (Constitution #8)",
  );
});
