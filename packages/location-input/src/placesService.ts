/**
 * @mingla/location-input · placesService
 *
 * Address search, place details and geocoding for every address and city
 * picker in the Host and Explorer apps. All calls go through ONE Supabase edge
 * function (Google Maps Platform behind it since #4334), so the Google key stays
 * server-side. Each app injects its own `supabase.functions.invoke`.
 *
 * The function keeps its deployed name for installed clients; that name lives
 * in exactly one constant, ADDRESS_PROXY_FN.
 *
 *   suggest / suggest_places → { suggestions } (≤5)
 *   retrieve                 → { details }  (Host: Place Details in the session;
 *                                            Explorer anchors: lookup "geocoding")
 *   reverse / forward        → { details }
 *   forward_hierarchy        → { details, matchLevel, matchedQuery } | needs_context
 *
 * Loud failures (#4334, Seth decision D7; history trap #338): search returns
 * `{ ok: false, code }` on ANY failure so the field can show "unavailable",
 * never "No matches". The other calls throw PlacesServiceError with the proxy's
 * error code read from the response body.
 */

/** The deployed edge function name, kept for installed clients. */
export const ADDRESS_PROXY_FN = "mapbox-geocode";

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  displayName: string;
  fullAddress: string;
  provider?: "google";
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  /** Locality (city) — required; the proxy answers no_locality without one. */
  city: string;
  /** Region display name (e.g. "England", "North Carolina") — nullable. */
  region: string | null;
  /** ISO 3166-2 subdivision code (e.g. "NC", "LA", "ENG") or null — never parsed from a name. */
  regionCode: string | null;
  /** Prefixed subdivision (e.g. "US-NC") or null. */
  regionCodeFull: string | null;
  /** ISO 3166-1 alpha-2 (e.g. "GB", "US") — nullable. */
  countryCode: string | null;
  location: { lat: number; lng: number };
  /**
   * Issue #1629 — how precise the coordinate is, in the proxy's normalized
   * vocabulary (poi, address, street, postcode, neighborhood, place, district,
   * region, country). Absent → approximate.
   */
  featureType?: string | null;
  provider?: "google";
}

export interface SavedLocationContext {
  city?: string | null;
  countryCode?: string | null;
}

export interface HierarchicalPlaceDetails {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  countryCode: string | null;
}

export type HierarchicalForwardResult =
  | {
      details: HierarchicalPlaceDetails;
      matchLevel: "place" | "city" | "country";
      matchedQuery: string;
    }
  | { details: null; reason: "needs_context" };

/** The injected edge-fn invoker — each app passes its own supabase.functions.invoke. */
export type InvokeFn = (
  fn: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: any; error: { message?: string; context?: unknown } | null }>;

/** Optional ranking bias: proximity as "longitude,latitude" (client contract). */
export interface LocationBias {
  proximity?: string;
}

/** Search outcome: rows, or the reason search is unavailable. */
export type AutocompleteResult =
  | { ok: true; rows: PlaceAutocompleteSuggestion[] }
  | { ok: false; code: string };

/** A failed place-details / geocoding call, carrying the proxy's error code. */
export class PlacesServiceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PlacesServiceError";
    this.code = code;
  }
}

const MIN_QUERY_LENGTH = 3;

/**
 * One session token (UUID v4) per autocomplete session, shared by every
 * suggest call and the retrieve that ends the session.
 */
export function newPlacesSessionToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * The proxy's error code. supabase-js turns every non-2xx into an error whose
 * `message` is generic; the code is in the response body (`error.context`).
 */
export async function errorCodeFromInvokeError(
  error: { message?: string; context?: unknown } | null | undefined,
): Promise<string> {
  const context = error?.context as
    | { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } }
    | undefined;
  const readJson = context?.json;
  if (context && typeof readJson === "function") {
    try {
      const body = (await (typeof context.clone === "function"
        ? context.clone().json()
        : readJson.call(context))) as { error?: unknown } | null;
      if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
    } catch {
      // an unreadable body is reported as "network" below
    }
  }
  return "network";
}

async function suggest(
  action: "suggest" | "suggest_places",
  query: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<AutocompleteResult> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return { ok: true, rows: [] };
  try {
    const { data, error } = await deps.invoke(ADDRESS_PROXY_FN, {
      body: {
        action,
        query: q,
        session_token: sessionToken,
        ...(bias?.proximity ? { proximity: bias.proximity } : {}),
      },
    });
    if (error) return { ok: false, code: await errorCodeFromInvokeError(error) };
    if (!data || !Array.isArray(data.suggestions)) {
      return { ok: false, code: "provider_unavailable" };
    }
    return { ok: true, rows: data.suggestions as PlaceAutocompleteSuggestion[] };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Host address search: filter-free, so venue names resolve. */
export function autocompleteAddress(
  query: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<AutocompleteResult> {
  return suggest("suggest", query, sessionToken, deps, bias);
}

/** Explorer place search: areas only; a trailing country is handled server-side. */
export function autocompletePlaces(
  query: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<AutocompleteResult> {
  return suggest("suggest_places", query, sessionToken, deps, bias);
}

async function detailsCall(
  body: Record<string, unknown>,
  deps: { invoke: InvokeFn },
): Promise<PlaceDetails> {
  let result: Awaited<ReturnType<InvokeFn>>;
  try {
    result = await deps.invoke(ADDRESS_PROXY_FN, { body });
  } catch {
    throw new PlacesServiceError("network");
  }
  if (result.error) throw new PlacesServiceError(await errorCodeFromInvokeError(result.error));
  if (!result.data || !result.data.details) throw new PlacesServiceError("empty_response");
  return result.data.details as PlaceDetails;
}

/**
 * Details for a picked suggestion. Host pickers end the autocomplete session
 * here (Place Details). Explorer anchors pass `lookup: "geocoding"` so the
 * coordinates come from the Geocoding API (spec v2 A2). THROWS
 * PlacesServiceError (e.g. provider_id_retired for a pre-#4334 id).
 */
export function retrievePlace(
  placeId: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  options: { lookup?: "geocoding" } = {},
): Promise<PlaceDetails> {
  if (!placeId) return Promise.reject(new PlacesServiceError("place_id_required"));
  return detailsCall(
    {
      action: "retrieve",
      place_id: placeId,
      session_token: sessionToken,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    },
    deps,
  );
}

/** Coordinates → PlaceDetails (English; D1 city rule). THROWS on failure. */
export function reverseGeocode(
  latitude: number,
  longitude: number,
  deps: { invoke: InvokeFn },
): Promise<PlaceDetails> {
  return detailsCall({ action: "reverse", latitude, longitude }, deps);
}

/** Free text → PlaceDetails (with its placeId). THROWS on failure. */
export function forwardGeocode(
  query: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<PlaceDetails> {
  const q = query.trim();
  if (q.length === 0) return Promise.reject(new PlacesServiceError("query_required"));
  return detailsCall(
    { action: "forward", query: q, ...(bias?.proximity ? { proximity: bias.proximity } : {}) },
    deps,
  );
}

/**
 * Issue #1363 — context-validated place → city → country resolution. A
 * needs_context answer is data; provider/transport failures throw.
 */
export async function forwardHierarchy(
  query: string,
  savedContext: SavedLocationContext,
  deps: { invoke: InvokeFn },
): Promise<HierarchicalForwardResult> {
  if (query.trim().length === 0) return { details: null, reason: "needs_context" };
  let result: Awaited<ReturnType<InvokeFn>>;
  try {
    result = await deps.invoke(ADDRESS_PROXY_FN, {
      body: {
        action: "forward_hierarchy",
        query: query.trim(),
        saved_context: {
          ...(savedContext.city?.trim() ? { city: savedContext.city.trim() } : {}),
          ...(savedContext.countryCode?.trim()
            ? { country_code: savedContext.countryCode.trim().toUpperCase() }
            : {}),
        },
      },
    });
  } catch {
    throw new PlacesServiceError("network");
  }
  const { data, error } = result;
  if (error) throw new PlacesServiceError(await errorCodeFromInvokeError(error));
  if (data?.details === null && data?.reason === "needs_context") {
    return { details: null, reason: "needs_context" };
  }
  if (
    !data?.details ||
    !["place", "city", "country"].includes(data.matchLevel) ||
    typeof data.matchedQuery !== "string"
  ) {
    throw new PlacesServiceError("empty_response");
  }
  return data as HierarchicalForwardResult;
}

/**
 * Issue #1629 — coordinate precision from the normalized feature type.
 * `address` and `poi` are a real point for that entity → exact; everything
 * else (street, area, region, country, unknown, missing) → approximate.
 * Over-claiming precision is fabricated data (Constitution rule 9).
 */
const EXACT_FEATURE_TYPES: ReadonlySet<string> = new Set(["address", "poi"]);

export function precisionFromPlaceDetails(
  details: Pick<PlaceDetails, "featureType"> | null | undefined,
): "exact" | "approximate" {
  const ft = details?.featureType;
  if (typeof ft !== "string") return "approximate";
  return EXACT_FEATURE_TYPES.has(ft.trim().toLowerCase()) ? "exact" : "approximate";
}

/**
 * Client error reporting for search outages (spec v2 §4.2): at most one report
 * per code per window, so a dead API does not flood Sentry.
 */
export function createThrottledReporter(
  report: (code: string) => void,
  windowMs = 60_000,
  now: () => number = () => Date.now(),
): (code: string) => void {
  const last = new Map<string, number>();
  return (code: string) => {
    const t = now();
    const prev = last.get(code);
    if (prev !== undefined && t - prev < windowMs) return;
    last.set(code, t);
    report(code);
  };
}
