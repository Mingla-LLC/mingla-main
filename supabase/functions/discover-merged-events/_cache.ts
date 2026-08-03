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
  cityName: string;
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
}

export function buildDiscoverCacheKey(p: DiscoverCacheParams): string {
  const normalized = {
    city: p.cityName.trim().toLowerCase(),
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
