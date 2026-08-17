/**
 * ORCH-426 G1 — short-TTL response cache for discover-merged-events.
 * Absorbs thundering-herd on identical city/page/filter queries under load.
 */

export const DISCOVER_CACHE_TTL_MS = Number(
  Deno.env.get("DISCOVER_MERGED_CACHE_TTL_MS") ?? "120000",
);

export const DISCOVER_STALE_TTL_MS = Number(
  Deno.env.get("DISCOVER_MERGED_STALE_MS") ?? "600000",
);

export interface DiscoverCacheParams {
  /**
   * #1637 — null for a coords-anchored request (a cold consumer launch, before
   * any reverse-geocode). The `geo` slot below then carries the whole anchor.
   */
  cityName: string | null;
  stateCode?: string | null;
  countryCode?: string | null;
  page: number;
  size: number;
  partyTypeSlugs: string[];
  vibeTagSlugs: string[];
  musicGenreSlugs: string[];
  dateWindowUtc: { startUtc: string; endUtc: string } | null;
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
  timezone: string;
  // issue #1020 — browsed metro geo center/radius. Folded into the cache key so
  // two same-name requests with different centers/radii key distinctly.
  fallbackLat?: number | null;
  fallbackLng?: number | null;
  fallbackRadiusKm?: number | null;
  /**
   * issue #2009 (BINDING SPEC AMENDMENT 3A, Defect 2) — the discovery
   * generation slot, produced by `discoveryGenerationSlot()` below.
   *
   * `pg_discover_business_events` filters `e.visibility = 'public'` at source,
   * so an Unlisted row leaves the QUERY immediately — but this function serves
   * from an L1 memory cache, an L2 DB cache and a cross-isolate build lock, all
   * keyed by this key, under stale-while-revalidate. Without a generation in
   * the key a Public -> Unlisted flip kept being served for up to
   * DISCOVER_CACHE_TTL_MS fresh (120s) and DISCOVER_STALE_TTL_MS stale (600s).
   *
   * Every real standard-event visibility transition increments
   * `event_discovery_generation` in the SAME transaction as the row write, so a
   * flip mints a brand-new key here and the pre-change response can never be
   * served from any of the three layers.
   */
  discoveryGeneration?: string;
}

/**
 * issue #2009 — turn a raw `event_discovery_generation` read into the cache-key
 * slot, FAIL CLOSED.
 *
 * A valid positive integer generation produces a shared, stable slot — that is
 * what makes the cache a cache. Anything else (RPC error, null, NaN, a
 * non-integer, a non-positive value) means the generation COULD NOT BE READ,
 * and the amendment is explicit that such a request must not be served a cached
 * entry keyed on a stale or absent generation. It therefore gets a per-call
 * unique slot: the key it mints cannot collide with any entry that exists or
 * will ever exist, so L1, L2 and the build lock all miss and the response is
 * built fresh. Availability is preserved; a stale-privacy read is not possible.
 */
export function discoveryGenerationSlot(raw: unknown): string {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return `g${value}`;
  }
  return `unavailable:${crypto.randomUUID()}`;
}

export function buildDiscoverCacheKey(p: DiscoverCacheParams): string {
  const normalized = {
    // issue #2009 — the visibility epoch. FIRST slot so a generation change is
    // visible at the head of every key. `null` only ever occurs for a caller
    // that supplied no generation at all; the edge handler always supplies one
    // via discoveryGenerationSlot(), and the #2009 strict-grep gate fails if
    // that threading is removed.
    gen: p.discoveryGeneration ?? null,
    // #1637 — null (not "") for a coords-anchored request, so a coords key can
    // never collide with a city key and JSON.stringify keeps the slot explicit.
    // The client snaps device coordinates to ~110m before they arrive here, so
    // the 4-dp rounding below is a float-jitter guard, not the deduplicator —
    // without the client-side snap a 7-decimal GPS fix would mint one cache row
    // per request and the L2 layer would stop being a cache.
    city: p.cityName === null ? null : p.cityName.trim().toLowerCase(),
    state: p.stateCode ?? null,
    country: p.countryCode ?? null,
    page: p.page,
    size: p.size,
    party: [...p.partyTypeSlugs].sort(),
    vibe: [...p.vibeTagSlugs].sort(),
    music: [...p.musicGenreSlugs].sort(),
    dw: p.dateWindowUtc,
    segment: p.segmentSlug ?? null,
    genres: [...(p.genreSlugs ?? [])].sort(),
    lse: p.localStartEndDateTime ?? null,
    kw: [...(p.keywords ?? [])].sort(),
    sort: p.sort ?? null,
    tz: p.timezone,
    // issue #1020 — geo center/radius folded in (Constitution #13). Round lat/lng
    // to 4 dp (~11 m) to prevent float-jitter cache thrash; null when absent so
    // city-only requests keep their prior key shape's geo slot empty.
    geo: (p.fallbackLat != null && p.fallbackLng != null &&
        p.fallbackRadiusKm != null)
      ? {
        lat: Number(p.fallbackLat.toFixed(4)),
        lng: Number(p.fallbackLng.toFixed(4)),
        r: p.fallbackRadiusKm,
      }
      : null,
  };
  return `discover:${JSON.stringify(normalized)}`;
}

export function discoverCacheExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + DISCOVER_CACHE_TTL_MS).toISOString();
}

export function discoverStaleExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + DISCOVER_STALE_TTL_MS).toISOString();
}
