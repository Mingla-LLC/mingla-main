/**
 * META-ORCH-1060 [Mapbox consumer migration] · §4.5 server-to-server helper
 *
 * Server-side Mapbox forward-geocode for the paired-view 4th location fallback
 * (personHeroCards.ts). personHeroCards runs with the SERVICE-ROLE admin client
 * and CANNOT call the `verify_jwt=true` mapbox-geocode edge fn the way the
 * client does (no end-user JWT). So this helper calls Mapbox directly
 * server-to-server, reading the SAME `MAPBOX_ACCESS_TOKEN` secret. This keeps
 * the token strictly server-side and avoids adding a service-auth bypass to the
 * JWT'd edge fn.
 *
 * ── Mapbox docs cited inline (COMMS-0003 — external-API params verified) ──
 *   Search Box `/forward` (single-call forward geocode; no session_token;
 *   per-request billing):
 *     https://docs.mapbox.com/api/search/search-box/
 *   Session billing reference (forward/reverse are per-request, NOT a session):
 *     https://docs.mapbox.com/api/search/search-box/#session-billing
 *   Geocoding API v6 fallback (structured context): https://docs.mapbox.com/api/search/geocoding/
 *
 * Caching (SPEC §4.6): module-scoped text→coords cache, bounded size + TTL, so
 * repeat paired-view resolves of the same city text hit at most one Mapbox call
 * per distinct text per TTL window. Edge-fn cold starts reset it — acceptable.
 */

// ORCH-1201 — Layer-C passive health observation (fire-and-forget, best-effort).
import { recordApiCall } from "./apiHealthLog.ts";

// https://docs.mapbox.com/api/search/search-box/
const MAPBOX_SEARCHBOX_BASE = "https://api.mapbox.com/search/searchbox/v1";

const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  coords: { lat: number; lng: number } | null;
  ts: number;
}

// Module-scoped cache (per warm edge-fn instance). Bounded by size + TTL.
const forwardCache = new Map<string, CacheEntry>();

function cacheGet(key: string): { hit: boolean; coords: { lat: number; lng: number } | null } {
  const entry = forwardCache.get(key);
  if (!entry) return { hit: false, coords: null };
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    forwardCache.delete(key);
    return { hit: false, coords: null };
  }
  return { hit: true, coords: entry.coords };
}

function cacheSet(key: string, coords: { lat: number; lng: number } | null): void {
  // Bounded LRU-ish eviction: drop the oldest entry when over capacity.
  if (forwardCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = [...forwardCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) forwardCache.delete(oldest[0]);
  }
  forwardCache.set(key, { coords, ts: Date.now() });
}

interface ForwardRawResponse {
  features?: Array<{
    geometry?: { coordinates?: [number, number] }; // [lng, lat]
  }>;
}

/**
 * Forward-geocode a free-text place (e.g. "Brooklyn, NY") to {lat,lng}.
 * Best-effort: returns null on empty text, missing token, network/HTTP error,
 * or no usable feature — the caller degrades gracefully (never fabricates a
 * location, Constitution #3). Caches the text→coords result (incl. null).
 */
export async function forwardGeocodeText(
  text: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) return null;

  const cacheKey = trimmed.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.coords;

  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";
  if (!token) {
    console.error("[mapboxGeocode] MAPBOX_ACCESS_TOKEN not configured");
    return null; // do NOT cache a token-missing miss
  }

  const url =
    `${MAPBOX_SEARCHBOX_BASE}/forward` +
    `?q=${encodeURIComponent(trimmed)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&limit=1`;

  let upstream: Response;
  const _t0 = Date.now();
  try {
    upstream = await fetch(url, { method: "GET" });
    // ORCH-1201-R2 Layer-C: tag a 429 so the Class-B reactive matcher can flag depletion.
    const mbErr = upstream.status === 429 ? { code: "429", text: "429 rate_limited" } : undefined;
    void recordApiCall("mapbox", upstream.ok, Date.now() - _t0, upstream.status, mbErr); // ORCH-1201 Layer-C
  } catch (e) {
    void recordApiCall("mapbox", false, Date.now() - _t0); // ORCH-1201 Layer-C (network error)
    console.warn("[mapboxGeocode] forward fetch error:", e);
    return null; // transient — do not cache
  }

  if (!upstream.ok) {
    console.warn("[mapboxGeocode] forward non-OK:", upstream.status);
    return null;
  }

  let data: ForwardRawResponse;
  try {
    data = (await upstream.json()) as ForwardRawResponse;
  } catch {
    return null;
  }

  const coords = data.features?.[0]?.geometry?.coordinates; // [lng, lat]
  if (
    !coords ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    cacheSet(cacheKey, null); // a real "no result" — cache the negative
    return null;
  }

  const result = { lat: coords[1], lng: coords[0] }; // GeoJSON is [lng, lat]
  cacheSet(cacheKey, result);
  return result;
}

/** Test-only: clear the module cache between unit tests. */
export function __clearForwardGeocodeCacheForTests(): void {
  forwardCache.clear();
}
