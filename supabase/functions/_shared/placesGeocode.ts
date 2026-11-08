/**
 * #4334 — Google Maps Platform helpers shared by the address proxy, the
 * server-side forward geocode (paired view, ad-plan, admin campaigns) and the
 * coordinate refresh job. Replaces the Mapbox helper this file superseded.
 *
 * Every Google failure is LOUD (Seth decision D7, history trap H1 / #338):
 * the Geocoding API answers HTTP 200 with `status: REQUEST_DENIED`,
 * `OVER_QUERY_LIMIT`, `OVER_DAILY_LIMIT`, `INVALID_REQUEST` or `UNKNOWN_ERROR`,
 * and each of those is a failure, never an empty result.
 *
 * Docs:
 *   Geocoding statuses: https://developers.google.com/maps/documentation/geocoding/requests-geocoding#StatusCodes
 *   Places (New) errors: https://developers.google.com/maps/documentation/places/web-service/reference/rest
 *
 * The key is the existing server secret GOOGLE_MAPS_API_KEY. It is never
 * logged and never put in an error body.
 */

import { recordApiCall } from "./apiHealthLog.ts";

export const GOOGLE_PLACES_BASE = "https://places.googleapis.com/v1";
export const GOOGLE_GEOCODE_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
export const GOOGLE_TIMEOUT_MS = 6000;

export type ProviderErrorCode =
  | "provider_denied"
  | "provider_quota"
  | "provider_invalid_request"
  | "provider_unavailable";

export interface ProviderError {
  code: ProviderErrorCode;
  /** HTTP status the proxy answers the client with. */
  httpStatus: number;
}

export function googleApiKey(): string {
  return Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
}

/** Places API (New) non-2xx → the proxy error contract (spec v1 §4.2). */
export function classifyPlacesHttpStatus(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return { code: "provider_denied", httpStatus: 502 };
  }
  if (status === 429) return { code: "provider_quota", httpStatus: 503 };
  if (status === 400) {
    return { code: "provider_invalid_request", httpStatus: 400 };
  }
  return { code: "provider_unavailable", httpStatus: 502 };
}

export type GeocodingVerdict =
  | { kind: "ok" }
  | { kind: "zero_results" }
  | { kind: "error"; error: ProviderError };

/** Geocoding body `status` → verdict. Anything but OK / ZERO_RESULTS fails. */
export function classifyGeocodingStatus(status: unknown): GeocodingVerdict {
  switch (status) {
    case "OK":
      return { kind: "ok" };
    case "ZERO_RESULTS":
      return { kind: "zero_results" };
    case "REQUEST_DENIED":
      return { kind: "error", error: { code: "provider_denied", httpStatus: 502 } };
    case "OVER_QUERY_LIMIT":
    case "OVER_DAILY_LIMIT":
      return { kind: "error", error: { code: "provider_quota", httpStatus: 503 } };
    case "INVALID_REQUEST":
      return {
        kind: "error",
        error: { code: "provider_invalid_request", httpStatus: 400 },
      };
    default:
      return {
        kind: "error",
        error: { code: "provider_unavailable", httpStatus: 502 },
      };
  }
}

/** fetch with the 6 s Google timeout. Throws on network error or timeout. */
export function googleFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
}

// ─── Server-side forward geocode (paired view, ad-plan, admin campaigns) ─────

const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h, well inside Google's 30-day limit

interface CacheEntry {
  coords: { lat: number; lng: number } | null;
  ts: number;
}

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
  if (forwardCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = [...forwardCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) forwardCache.delete(oldest[0]);
  }
  forwardCache.set(key, { coords, ts: Date.now() });
}

/** #4238 r8 P2-4: a lookup that failed is not the same as "no such place". */
export type ForwardGeocodeLookup =
  | { status: "found"; lat: number; lng: number }
  | { status: "not_found" }
  | { status: "failed" };

/** Forward-geocode free text to {lat,lng}; null for "not found" or "failed". */
export async function forwardGeocodeText(
  text: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const result = await forwardGeocodeLookup(text);
  return result.status === "found" ? { lat: result.lat, lng: result.lng } : null;
}

/**
 * Google Geocoding `address=<text>&language=en`. "not_found" only for
 * ZERO_RESULTS or a result without a usable location (cached); "failed" for a
 * missing key, a network error or timeout, a non-200, an unreadable body or any
 * other Geocoding status (never cached).
 */
export async function forwardGeocodeLookup(
  text: string | null | undefined,
): Promise<ForwardGeocodeLookup> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) return { status: "not_found" };

  const cacheKey = trimmed.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached.hit) {
    return cached.coords
      ? { status: "found", lat: cached.coords.lat, lng: cached.coords.lng }
      : { status: "not_found" };
  }

  const key = googleApiKey();
  if (!key) {
    console.error("[placesGeocode] GOOGLE_MAPS_API_KEY not configured");
    return { status: "failed" };
  }

  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(trimmed)}` +
    `&language=en&key=${encodeURIComponent(key)}`;

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await googleFetch(url, { method: "GET" });
  } catch (e) {
    void recordApiCall("google_geocoding", false, Date.now() - t0, undefined, {
      code: "network",
      text: String(e).slice(0, 200),
    });
    console.warn("[placesGeocode] forward fetch error");
    return { status: "failed" };
  }

  if (!upstream.ok) {
    const err = classifyPlacesHttpStatus(upstream.status);
    void recordApiCall("google_geocoding", false, Date.now() - t0, upstream.status, {
      code: err.code,
      text: `http ${upstream.status}`,
    });
    return { status: "failed" };
  }

  let data: { status?: unknown; results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }> };
  try {
    data = await upstream.json();
  } catch {
    void recordApiCall("google_geocoding", false, Date.now() - t0, upstream.status, {
      code: "unreadable_body",
    });
    return { status: "failed" };
  }

  const verdict = classifyGeocodingStatus(data.status);
  if (verdict.kind === "error") {
    void recordApiCall("google_geocoding", false, Date.now() - t0, upstream.status, {
      code: verdict.error.code,
      text: String(data.status),
    });
    return { status: "failed" };
  }
  void recordApiCall("google_geocoding", true, Date.now() - t0, upstream.status);

  const loc = verdict.kind === "ok" ? data.results?.[0]?.geometry?.location : undefined;
  const lat = loc?.lat;
  const lng = loc?.lng;
  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng)
  ) {
    cacheSet(cacheKey, null);
    return { status: "not_found" };
  }
  const result = { lat, lng };
  cacheSet(cacheKey, result);
  return { status: "found", ...result };
}

/** Test-only: clear the module cache between unit tests. */
export function __clearForwardGeocodeCacheForTests(): void {
  forwardCache.clear();
}
