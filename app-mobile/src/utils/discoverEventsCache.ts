/**
 * discoverEventsCache — ORCH-0996 [Discover cold-open latency].
 *
 * A tightly-scoped, MODULE-LEVEL, IN-MEMORY cache for the merged-Discover
 * fetch result. Its only job is to let a re-open of the Discover tab paint
 * INSTANTLY from the last result for the exact same query, then revalidate
 * in the background.
 *
 * ── Why this is NOT the cache ORCH-0839-A deleted ───────────────────────
 * ORCH-0839-A (F-4 / C-1) removed an *AsyncStorage* cache whose key was
 * under-specified and whose hit-predicate short-circuited the fetch, which
 * leaked one filter set's results into another ("cross-filter leakage").
 * This cache is different in three load-bearing ways that make C-1
 * structurally impossible to recur:
 *
 *   1. The key is the EXACT, FULL query signature — every facet the server
 *      reads (city identity + segment + genre + date + partyTypes +
 *      vibeTags + musicGenres). Two distinct filter sets can never collide
 *      on a key, so one set's data can never be served for another.
 *   2. It is in-memory only (process-lifetime). Nothing is persisted to
 *      AsyncStorage, so there is no stale-on-disk surface across launches.
 *   3. It NEVER short-circuits the network. The fetch ALWAYS runs and
 *      ALWAYS overwrites. The cache is a paint-first hint, not an authority;
 *      the server (TM cache table + edge-fn in-memory cache, 2h TTL) stays
 *      authoritative.
 *
 * Invariant: I-PROPOSED-DISCOVER-INMEM-CACHE-FULL-SIGNATURE (ORCH-0996).
 * Does not reintroduce the removed identifiers (NightOutCache /
 * loadNightOutCache / saveNightOutCache / clearNightOutCache /
 * nightOutCacheKey) — the ORCH-0839-A CI gate stays green.
 */

/** Soft freshness window for a paint-first hint. */
export const DISCOVER_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

/**
 * The exact set of inputs that change what the merged endpoint returns.
 * MUST stay in lockstep with the `fetchNightOutEvents` request body +
 * the fetch dependency array in DiscoverScreen.tsx — if a new facet is
 * added to the server query, it MUST be added here too, or the cache
 * could serve a result computed under a different facet.
 */
export interface DiscoverCacheSignature {
  cityName: string | null;
  cityLat: number | null;
  cityLng: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  date: string;
  segment: string;
  genre: string;
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
}

/** Opaque cache entry — the two card arrays + side-state the screen renders. */
export interface DiscoverCacheEntry<TNightOut, TBusiness> {
  nightOutCards: TNightOut[];
  businessEvents: TBusiness[];
  tmError: string | null;
  fallbackActive: boolean;
  storedAt: number;
}

/**
 * Build a stable string key from the full signature. Arrays are sorted so
 * pill-selection ORDER never produces a different key for the same SET
 * (the server treats these as sets), and `|` / `,` separators keep facets
 * unambiguous.
 */
export function buildDiscoverCacheKey(sig: DiscoverCacheSignature): string {
  const arr = (a: string[]): string => [...a].sort().join(",");
  return [
    sig.cityName ?? "",
    sig.cityLat ?? "",
    sig.cityLng ?? "",
    sig.gpsLat ?? "",
    sig.gpsLng ?? "",
    sig.date,
    sig.segment,
    sig.genre,
    arr(sig.partyTypes),
    arr(sig.vibeTags),
    arr(sig.musicGenres),
  ].join("|");
}

// Generic store; the screen pins the concrete card types at the call site.
const store = new Map<string, DiscoverCacheEntry<unknown, unknown>>();

export function readDiscoverCache<TNightOut, TBusiness>(
  key: string,
): DiscoverCacheEntry<TNightOut, TBusiness> | null {
  const hit = store.get(key);
  if (!hit) return null;
  return hit as DiscoverCacheEntry<TNightOut, TBusiness>;
}

/** True when the entry is within the soft TTL (caller may still revalidate). */
export function isDiscoverCacheFresh(
  entry: DiscoverCacheEntry<unknown, unknown>,
  now: number = Date.now(),
): boolean {
  return now - entry.storedAt < DISCOVER_CACHE_TTL_MS;
}

export function writeDiscoverCache<TNightOut, TBusiness>(
  key: string,
  value: Omit<DiscoverCacheEntry<TNightOut, TBusiness>, "storedAt">,
): void {
  store.set(key, { ...value, storedAt: Date.now() });
}

/** Test-only reset so unit tests start from a clean module state. */
export function __resetDiscoverCacheForTests(): void {
  store.clear();
}

/**
 * ORCH-0996 — pure decision for how a fetch trigger should fire.
 *
 *   • "immediate"  — the FIRST usable query: fire the network now, NO 300ms
 *                    debounce (kills the cold-open latency the ORCH targets).
 *   • "debounced"  — any subsequent filter/city/GPS change: wrap in the 300ms
 *                    coalescing debounce so rapid pill taps don't thrash.
 *   • "skip"       — no usable query yet (no city AND no GPS): do nothing.
 *
 * Extracted as a pure function so the initial-vs-debounce contract is
 * regression-testable WITHOUT mounting the whole RN screen. The component's
 * fetch-trigger effect delegates to this; if a future edit re-wraps the first
 * fetch in a timeout, this returns "immediate" but the screen would debounce
 * → the test catches the divergence.
 */
export type DiscoverFetchMode = "immediate" | "debounced" | "skip";

export function decideDiscoverFetchMode(args: {
  hasUsableQuery: boolean;
  hasFiredInitial: boolean;
}): DiscoverFetchMode {
  if (!args.hasUsableQuery) return "skip";
  return args.hasFiredInitial ? "debounced" : "immediate";
}

/* ────────────────────────────────────────────────────────────────────────
 * ORCH-0996 REWORK 1 — resolved-city seed for instant re-open.
 *
 * QA proved the events cache alone does NOT deliver "re-open paints
 * instantly": DiscoverScreen remounts fresh on every tab return (active-tab
 * architecture), so `gpsDefaultCity` is null until the async
 * GPS→reverseGeocode chain re-runs (~2-3s). On the first post-remount render
 * `effectiveCity` is null → the events-cache signature has cityName=null and
 * MISSES the prior city-keyed entry. The expensive UNCACHED step is the CITY
 * RESOLUTION, not the events fetch.
 *
 * Fix: a tiny module-level (process-lifetime, in-memory) cache of the last
 * reverse-geocoded Discover city — its coords AND the resolved city object.
 * DiscoverScreen seeds `gpsDefaultCity` + `deviceGps*` SYNCHRONOUSLY from this
 * on mount (lazy useState initializer) so `effectiveCity` and the gps facets
 * are non-null on the very FIRST render → the events-cache key reproduces the
 * prior entry's key → instant paint. The async reverseGeocode + the network
 * fetch ALWAYS still run and overwrite (authoritative) — identical
 * paint-first, never-short-circuit discipline as the events cache, preserving
 * the ORCH-0839-A leakage guard.
 *
 * Keyed by GPS coords rounded to 3 decimals (~110m) so a user who has
 * physically moved to a different city does not get the previous city seeded;
 * coords-agnostic `readLastResolvedDiscoverCity()` returns the most-recent
 * snapshot for the bootstrap render where the device coords are not yet known
 * (the coords-matched read then corrects it once coords resolve, and the
 * authoritative reverseGeocode overwrites regardless).
 * ──────────────────────────────────────────────────────────────────────── */

/** Coordinate rounding precision for the resolved-city cache key (~110m). */
export const RESOLVED_CITY_COORD_PRECISION = 3;

/** Minimal city shape the seed needs — matches DiscoverCity structurally. */
export interface ResolvedDiscoverCity {
  name: string;
  stateCode: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
}

interface ResolvedCitySnapshot {
  coordKey: string;
  city: ResolvedDiscoverCity;
}

function resolvedCityCoordKey(lat: number, lng: number): string {
  return `${lat.toFixed(RESOLVED_CITY_COORD_PRECISION)},${lng.toFixed(
    RESOLVED_CITY_COORD_PRECISION,
  )}`;
}

// Most-recent resolved Discover city, process-lifetime. NOT persisted to disk
// (no AsyncStorage), so there is no stale-on-launch surface — exactly like the
// events cache above.
let lastResolvedCity: ResolvedCitySnapshot | null = null;

/** Record the reverse-geocode result so the next mount can seed synchronously. */
export function writeResolvedDiscoverCity(
  lat: number,
  lng: number,
  city: ResolvedDiscoverCity,
): void {
  lastResolvedCity = { coordKey: resolvedCityCoordKey(lat, lng), city };
}

/**
 * Coords-matched read: returns the resolved city ONLY if the supplied coords
 * round to the same ~110m bucket as the last resolution. Used once device
 * coords are known, so a user who moved cities is not seeded the old city.
 */
export function readResolvedDiscoverCity(
  lat: number,
  lng: number,
): ResolvedDiscoverCity | null {
  if (!lastResolvedCity) return null;
  return lastResolvedCity.coordKey === resolvedCityCoordKey(lat, lng)
    ? lastResolvedCity.city
    : null;
}

/**
 * Coords-agnostic read: the most-recent resolved city, for the bootstrap
 * remount render where device coords are not yet available. The async
 * reverseGeocode overwrites authoritatively, so a slightly-moved user still
 * gets corrected within the same session — this is a paint-first hint only.
 */
export function readLastResolvedDiscoverCity(): ResolvedDiscoverCity | null {
  return lastResolvedCity?.city ?? null;
}

/** Test-only reset. */
export function __resetResolvedDiscoverCityForTests(): void {
  lastResolvedCity = null;
}

/* ────────────────────────────────────────────────────────────────────────
 * #1637 [discover-single-fetch] — THE QUERY ANCHOR.
 *
 * THE BUG THIS REPLACES. Discover used to derive its data query from
 * `effectiveCity = selectedCity ?? gpsDefaultCity`, where `gpsDefaultCity` is
 * the REVERSE-GEOCODED chip label. On a cold launch with no saved city — 44 of
 * 53 live users — that produced two fetches against two different endpoints:
 *
 *   1. GPS resolves      → effectiveCity is still null → the TM-ONLY endpoint,
 *                          with `setBusinessEvents([])` hard-coded. Structurally
 *                          incapable of carrying a single Mingla event.
 *   2. geocode resolves  → effectiveCity becomes non-null → a SECOND, 300ms-
 *                          debounced fetch to the merged endpoint.
 *
 * Ticketmaster was therefore gated on STRICTLY LESS than Mingla (GPS alone vs
 * GPS + a reverse-geocode round trip + a debounce), so Mingla could never
 * arrive first — and the second commit re-ordered a deck the user was already
 * reading.
 *
 * THE RULE NOW, and it is the whole fix: the reverse-geocoded city is a LABEL.
 * It never enters the query. The query is anchored on exactly one of
 *
 *   • an EXPLICIT city  — picked in CityPickerSheet or restored from the user's
 *     saved `discover_city_*` preference. A deliberate user choice; a deck
 *     change here is expected and wanted.
 *   • the DEVICE COORDS — everything else. The merged endpoint accepts
 *     coordinates (it already threaded fallbackLat/Lng/RadiusKm into both the
 *     business RPC's ST_DWithin predicate and Ticketmaster), so one fetch
 *     carries BOTH supplies from the first millisecond GPS is available.
 *
 * Consequences that make the reshuffle structurally impossible on cold launch:
 *   • the geocode landing changes NOTHING in this anchor → no second fetch;
 *   • device-GPS jitter cannot re-key a city-anchored query (coords are dropped
 *     entirely when a city anchor is present);
 *   • one fetch ⇒ one commit ⇒ the ordered card list is decided once.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Minimal city shape the query anchor needs. Structurally matches
 * DiscoverScreen's `DiscoverCity`.
 */
export interface DiscoverAnchorCity {
  name: string;
  lat: number;
  lng: number;
}

export type DiscoverQueryAnchor =
  | { kind: "city"; cityName: string; cityLat: number; cityLng: number }
  | { kind: "coords"; gpsLat: number; gpsLng: number }
  | { kind: "none" };

/**
 * Snap a raw device coordinate to the same ~110m bucket the resolved-city cache
 * uses, so the query identity is stable across launches.
 *
 * WHY THIS EXISTS. A GPS fix carries 7+ decimals and never repeats. Feeding it
 * raw into the query would mint a brand-new client cache key AND a brand-new
 * `discover_merged_events_cache` row on every single request — the merged
 * endpoint's key already folds the geo center in (issue #1020), so an unsnapped
 * coordinate fragments that cache to exactly one row per request and the L2
 * layer stops being a cache at all.
 *
 * 3 decimals (~110m) is deliberately the SAME bucket as
 * RESOLVED_CITY_COORD_PRECISION, and deliberately NOT coarser: Discover renders
 * Ticketmaster distances to one decimal of a kilometre, and a coarser snap would
 * visibly move the search anchor away from the user (Constitution #9 — nothing
 * displayed may be fabricated).
 */
export function snapDiscoverQueryCoord(
  value: number | null | undefined,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(RESOLVED_CITY_COORD_PRECISION));
}

/**
 * Resolve the ONE anchor the Discover data query runs against.
 *
 * `selectedCity` is the EXPLICIT city only (CityPickerSheet / saved
 * preference). The reverse-geocoded `gpsDefaultCity` is deliberately NOT a
 * parameter — passing it would reintroduce #1637 — and the CI gate
 * `app-mobile/src/utils/__tests__/issue_1637_discover_single_fetch.test.ts`
 * (contract C-1) fails the build if DiscoverScreen ever feeds it here.
 */
export function resolveDiscoverQueryAnchor(args: {
  selectedCity: DiscoverAnchorCity | null;
  gpsLat: number | null;
  gpsLng: number | null;
}): DiscoverQueryAnchor {
  const city = args.selectedCity;
  if (
    city &&
    typeof city.name === "string" &&
    city.name.trim().length > 0 &&
    Number.isFinite(city.lat) &&
    Number.isFinite(city.lng)
  ) {
    return {
      kind: "city",
      cityName: city.name,
      cityLat: city.lat,
      cityLng: city.lng,
    };
  }
  const lat = snapDiscoverQueryCoord(args.gpsLat);
  const lng = snapDiscoverQueryCoord(args.gpsLng);
  if (lat !== null && lng !== null) {
    return { kind: "coords", gpsLat: lat, gpsLng: lng };
  }
  return { kind: "none" };
}

/** True when the anchor can produce a real request. Feeds `hasUsableQuery`. */
export function hasUsableDiscoverQuery(anchor: DiscoverQueryAnchor): boolean {
  return anchor.kind !== "none";
}

/**
 * The anchor's VALUE identity, as a string.
 *
 * WHY THIS EXISTS (#1637 follow-up, found by instrumented device capture on the
 * Samsung SM-A725F). `resolveDiscoverQueryAnchor` is pure and correctly drops
 * GPS when a city anchor is present — but DiscoverScreen memoised it on its
 * INPUTS (`[selectedCity, snappedGpsLat, snappedGpsLng]`). In city mode a GPS
 * snap that the anchor deliberately ignores still changed the memo's deps, so
 * React handed the fetch effect a NEW OBJECT describing an IDENTICAL query, and
 * the effect fired a debounced refetch. Device capture, city-anchored on
 * "Raleigh": a third `searchMerged` 6.8s after the second, same anchor, same
 * body. Memoising on this key instead makes "same query ⇒ same identity" true
 * at the React layer, not just at the value layer.
 */
export function discoverQueryAnchorKey(anchor: DiscoverQueryAnchor): string {
  switch (anchor.kind) {
    case "city":
      return `city:${anchor.cityName}:${anchor.cityLat}:${anchor.cityLng}`;
    case "coords":
      return `coords:${anchor.gpsLat}:${anchor.gpsLng}`;
    default:
      return "none";
  }
}

/**
 * The saved `discover_city_*` preference, as an anchor city — or null.
 *
 * Pure, and shared by BOTH reads of that preference (the fast local mirror and
 * the authoritative network row) so the two can never disagree about what
 * counts as a usable saved city.
 */
export function discoverCityFromPreferences(
  prefs: {
    discover_city_name?: string | null;
    discover_city_state_code?: string | null;
    discover_city_country_code?: string | null;
    discover_city_lat?: number | null;
    discover_city_lng?: number | null;
  } | null,
): {
  name: string;
  stateCode: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
} | null {
  if (!prefs) return null;
  const name = prefs.discover_city_name;
  const lat = prefs.discover_city_lat;
  const lng = prefs.discover_city_lng;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  return {
    name,
    stateCode: prefs.discover_city_state_code ?? null,
    countryCode: prefs.discover_city_country_code ?? null,
    lat,
    lng,
  };
}

/**
 * Do two saved-city reads describe the same anchor?
 *
 * Used to decide whether the authoritative network row may re-anchor a query
 * the local mirror already anchored. When they agree — the overwhelmingly
 * common case — the authoritative read must change NOTHING, or it re-introduces
 * the very second fetch #1637 exists to remove.
 */
export function sameDiscoverAnchorCity(
  a: DiscoverAnchorCity | null,
  b: DiscoverAnchorCity | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.lat === b.lat && a.lng === b.lng;
}

/**
 * Build the full cache signature from the anchor + the active filters.
 *
 * Note the two `null` slots per branch: a city-anchored query carries NO gps
 * facets (so a later GPS fix cannot re-key it and force a refetch whose request
 * body would be byte-identical), and a coords-anchored query carries NO city
 * facets (so the reverse-geocode landing cannot re-key it either). That
 * mutual exclusion is the reshuffle fix expressed as a cache key.
 */
export function buildDiscoverSignatureForAnchor(
  anchor: DiscoverQueryAnchor,
  filters: {
    date: string;
    segment: string;
    genre: string;
    partyTypes: string[];
    vibeTags: string[];
    musicGenres: string[];
  },
): DiscoverCacheSignature {
  return {
    cityName: anchor.kind === "city" ? anchor.cityName : null,
    cityLat: anchor.kind === "city" ? anchor.cityLat : null,
    cityLng: anchor.kind === "city" ? anchor.cityLng : null,
    gpsLat: anchor.kind === "coords" ? anchor.gpsLat : null,
    gpsLng: anchor.kind === "coords" ? anchor.gpsLng : null,
    date: filters.date,
    segment: filters.segment,
    genre: filters.genre,
    partyTypes: filters.partyTypes,
    vibeTags: filters.vibeTags,
    musicGenres: filters.musicGenres,
  };
}
