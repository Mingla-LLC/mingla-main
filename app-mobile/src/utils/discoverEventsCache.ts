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
