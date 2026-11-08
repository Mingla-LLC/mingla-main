/**
 * #4334 — the Google calls behind the address proxy (spec v2 §3, v1 §4.2).
 *
 * Every action calls Google; there is no other provider and no fallback
 * (Seth decision D7). Every upstream failure is loud: the client gets a coded
 * error, Sentry gets an event, and the api-health recorder gets a failed call.
 *
 * Docs:
 *   Autocomplete (New): https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 *   Place Details (New): https://developers.google.com/maps/documentation/places/web-service/place-details
 *   Geocoding:           https://developers.google.com/maps/documentation/geocoding/requests-geocoding
 *   Reverse geocoding:   https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding
 *   Session pricing:     https://developers.google.com/maps/documentation/places/web-service/session-pricing
 */

import { recordApiCall } from "../_shared/apiHealthLog.ts";
import { captureEdgeException } from "../_shared/sentryEdge.ts";
import {
  classifyGeocodingStatus,
  classifyPlacesHttpStatus,
  GOOGLE_GEOCODE_URL,
  GOOGLE_PLACES_BASE,
  googleFetch,
  type ProviderError,
} from "../_shared/placesGeocode.ts";
import { COUNTRY_NAME_TO_ISO, parseTrailingCountry } from "./countryNames.ts";
import {
  administrativeNames,
  cityOf,
  countryCodeOf,
  type GeocodingResult,
  geocodingResultToPlace,
  type GooglePlace,
  googlePlaceToDetails,
  normalizeName,
  type PlaceDetails,
  validLocation,
} from "./googleNormalize.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Google returns at most 5 autocomplete predictions (Seth decision D4). */
export const MAX_SUGGESTIONS = 5;

export const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId," +
  "suggestions.placePrediction.text.text," +
  "suggestions.placePrediction.structuredFormat," +
  "suggestions.placePrediction.types";

/** Place Details Essentials fields only (no displayName / googleMapsUri). */
export const DETAILS_FIELD_MASK =
  "id,formattedAddress,addressComponents,location,types,viewport";

/** Explorer place search keeps to areas (ORCH-1365 intent: no POI noise). */
export const PLACE_SEARCH_PRIMARY_TYPES = [
  "locality",
  "sublocality",
  "neighborhood",
  "administrative_area_level_1",
  "administrative_area_level_2",
];

/** Mapbox ids are base64 of "urn:..." — retired by #4334. */
export const RETIRED_MAPBOX_ID = /^dXJuOm/;

type Action =
  | "suggest"
  | "suggest_places"
  | "retrieve"
  | "reverse"
  | "forward"
  | "forward_hierarchy";

export interface SuggestionRow {
  placeId: string;
  displayName: string;
  fullAddress: string;
  provider: "google";
}

// ─── failure reporting ───────────────────────────────────────────────────────

/**
 * Report an upstream failure on every channel (spec v2 §3.2) and answer the
 * client with the coded error. `serviceKey` drives the api-health tile.
 */
export function upstreamFailure(params: {
  action: Action;
  serviceKey: "google_places" | "google_place_details" | "google_geocoding";
  error: ProviderError | { code: string; httpStatus: number };
  latencyMs: number;
  upstreamStatus: number | null;
  googleStatus: string | null;
  extraBody?: Record<string, unknown>;
}): Response {
  const { action, serviceKey, error, latencyMs, upstreamStatus, googleStatus } = params;
  captureEdgeException(
    new Error(`mapbox-geocode ${action} failed: ${error.code}`),
    {
      fn: "mapbox-geocode",
      tags: { issue: "4334", action, code: error.code },
      extra: { upstream_status: upstreamStatus, google_status: googleStatus },
    },
  );
  void recordApiCall(serviceKey, false, latencyMs, upstreamStatus ?? undefined, {
    code: error.code,
    text: googleStatus ?? (upstreamStatus !== null ? `http ${upstreamStatus}` : "network"),
  });
  console.warn(`[mapbox-geocode] ${action} failed: ${error.code}`);
  return jsonResponse({ error: error.code, ...(params.extraBody ?? {}) }, error.httpStatus);
}

// ─── proximity (Mapbox-era client contract "lng,lat") ────────────────────────

/**
 * The client sends proximity as "lng,lat" (Mapbox order, F-3). Google wants
 * latitude/longitude by name, so the two are swapped here. Malformed → null
 * (the bias is omitted, never guessed).
 */
export function proximityToCenter(
  proximity: string | undefined,
): { latitude: number; longitude: number } | null {
  if (typeof proximity !== "string") return null;
  const parts = proximity.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2) return null;
  const [lng, lat] = parts;
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

// ─── autocomplete ────────────────────────────────────────────────────────────

/**
 * Body for the business `suggest`: filter-free so venue names (POIs) resolve
 * (INV-3 / ORCH-1079 intent). Gate `i-address-suggest-no-type-filter.mjs`
 * forbids type and region filters in this builder.
 */
export function buildSuggestBody(params: {
  input: string;
  sessionToken: string;
  proximity?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    input: params.input,
    sessionToken: params.sessionToken,
    languageCode: "en",
    includeQueryPredictions: false,
  };
  const center = proximityToCenter(params.proximity);
  if (center) body.locationBias = { circle: { center, radius: 50000 } };
  return body;
}

/** Body for the Explorer `suggest_places`: areas only, optional country. */
export function buildPlaceSuggestBody(params: {
  input: string;
  sessionToken: string;
  regionCode?: string;
  proximity?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    input: params.input,
    sessionToken: params.sessionToken,
    languageCode: "en",
    includeQueryPredictions: false,
    includedPrimaryTypes: PLACE_SEARCH_PRIMARY_TYPES,
  };
  if (params.regionCode) {
    body.includedRegionCodes = [params.regionCode.toLowerCase()];
  }
  const center = proximityToCenter(params.proximity);
  if (center) body.locationBias = { circle: { center, radius: 50000 } };
  return body;
}

interface AutocompleteRaw {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

export function mapAutocompleteRows(data: AutocompleteRaw): SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  for (const s of data.suggestions ?? []) {
    const p = s.placePrediction;
    const placeId = p?.placeId;
    const main = p?.structuredFormat?.mainText?.text;
    if (!placeId || !main) continue;
    rows.push({
      placeId,
      displayName: main,
      fullAddress: p?.structuredFormat?.secondaryText?.text ?? p?.text?.text ?? main,
      provider: "google",
    });
  }
  return rows.slice(0, MAX_SUGGESTIONS);
}

async function autocompleteOnce(
  key: string,
  action: "suggest" | "suggest_places",
  body: Record<string, unknown>,
): Promise<{ rows: SuggestionRow[] } | { response: Response }> {
  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await googleFetch(`${GOOGLE_PLACES_BASE}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_places",
        error: { code: "suggest_exception", httpStatus: 502 },
        latencyMs: Date.now() - t0,
        upstreamStatus: null,
        googleStatus: null,
        extraBody: { suggestions: [] },
      }),
    };
  }
  if (!upstream.ok) {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_places",
        error: classifyPlacesHttpStatus(upstream.status),
        latencyMs: Date.now() - t0,
        upstreamStatus: upstream.status,
        googleStatus: await googleErrorStatus(upstream),
        extraBody: { suggestions: [] },
      }),
    };
  }
  let data: AutocompleteRaw;
  try {
    data = (await upstream.json()) as AutocompleteRaw;
  } catch {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_places",
        error: { code: "provider_unavailable", httpStatus: 502 },
        latencyMs: Date.now() - t0,
        upstreamStatus: upstream.status,
        googleStatus: "unreadable_body",
        extraBody: { suggestions: [] },
      }),
    };
  }
  void recordApiCall("google_places", true, Date.now() - t0, upstream.status);
  return { rows: mapAutocompleteRows(data) };
}

/** Places (New) error bodies are `{ error: { status: "PERMISSION_DENIED" } }`. */
async function googleErrorStatus(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as { error?: { status?: unknown } };
    return typeof body?.error?.status === "string" ? body.error.status : null;
  } catch {
    return null;
  }
}

/** Business address search (Host). Filter-free. */
export async function handleSuggest(
  key: string,
  query: string,
  sessionToken: string,
  proximity?: string,
): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return jsonResponse({ error: "query_too_short" }, 400);
  const result = await autocompleteOnce(
    key,
    "suggest",
    buildSuggestBody({ input: trimmed, sessionToken, proximity }),
  );
  if ("response" in result) return result.response;
  return jsonResponse({ suggestions: result.rows });
}

/**
 * Explorer place search. Keeps ORCH-1365: a trailing country word is stripped
 * and applied as a region filter ("lekki nigeria"), and when that biased call
 * comes back empty one retry runs with the full query and no region in the
 * same session ("atlanta georgia"). Errors on either call are loud (#4334: no
 * upstream failure maps to an empty list).
 */
export async function handleSuggestPlaces(
  key: string,
  rawQuery: string,
  sessionToken: string,
  proximity?: string,
): Promise<Response> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 3) return jsonResponse({ error: "query_too_short" }, 400);
  const parsed = parseTrailingCountry(trimmed);
  const query = parsed.query.length > 0 ? parsed.query : trimmed;
  const country = parsed.query.length > 0 ? parsed.country : undefined;

  const first = await autocompleteOnce(
    key,
    "suggest_places",
    buildPlaceSuggestBody({ input: query, sessionToken, regionCode: country, proximity }),
  );
  if ("response" in first) return first.response;
  if (country && first.rows.length === 0) {
    const fallback = await autocompleteOnce(
      key,
      "suggest_places",
      buildPlaceSuggestBody({ input: trimmed, sessionToken, proximity }),
    );
    if ("response" in fallback) return fallback.response;
    return jsonResponse({ suggestions: fallback.rows });
  }
  return jsonResponse({ suggestions: first.rows });
}

// ─── place details ───────────────────────────────────────────────────────────

/**
 * Host picks: Place Details (New) Essentials, same session token as the
 * suggest calls (the session ends here).
 */
export async function handleRetrieve(
  key: string,
  placeId: string,
  sessionToken: string,
): Promise<Response> {
  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await googleFetch(
      `${GOOGLE_PLACES_BASE}/places/${encodeURIComponent(placeId)}` +
        `?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=en`,
      {
        method: "GET",
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
      },
    );
  } catch {
    return upstreamFailure({
      action: "retrieve",
      serviceKey: "google_place_details",
      error: { code: "retrieve_exception", httpStatus: 502 },
      latencyMs: Date.now() - t0,
      upstreamStatus: null,
      googleStatus: null,
    });
  }
  if (upstream.status === 404) {
    void recordApiCall("google_place_details", true, Date.now() - t0, 404);
    return jsonResponse({ error: "no_location" }, 500);
  }
  if (!upstream.ok) {
    return upstreamFailure({
      action: "retrieve",
      serviceKey: "google_place_details",
      error: classifyPlacesHttpStatus(upstream.status),
      latencyMs: Date.now() - t0,
      upstreamStatus: upstream.status,
      googleStatus: await googleErrorStatus(upstream),
    });
  }
  let place: GooglePlace;
  try {
    place = (await upstream.json()) as GooglePlace;
  } catch {
    return upstreamFailure({
      action: "retrieve",
      serviceKey: "google_place_details",
      error: { code: "provider_unavailable", httpStatus: 502 },
      latencyMs: Date.now() - t0,
      upstreamStatus: upstream.status,
      googleStatus: "unreadable_body",
    });
  }
  void recordApiCall("google_place_details", true, Date.now() - t0, upstream.status);
  const details = googlePlaceToDetails(place, placeId);
  if ("error" in details) return jsonResponse({ error: details.error }, 500);
  return jsonResponse({ details });
}

// ─── geocoding (reverse / forward / by place id / hierarchy) ─────────────────

type GeocodeOutcome =
  | { results: GeocodingResult[] }
  | { response: Response };

/** One Geocoding call with the loud-failure contract. ZERO_RESULTS → []. */
export async function geocode(
  key: string,
  action: Action,
  params: Record<string, string>,
): Promise<GeocodeOutcome> {
  const qs = new URLSearchParams({ ...params, language: "en", key });
  const t0 = Date.now();
  const exceptionCode = `${action}_exception`;
  let upstream: Response;
  try {
    upstream = await googleFetch(`${GOOGLE_GEOCODE_URL}?${qs.toString()}`, {
      method: "GET",
    });
  } catch {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_geocoding",
        error: { code: exceptionCode, httpStatus: 502 },
        latencyMs: Date.now() - t0,
        upstreamStatus: null,
        googleStatus: null,
      }),
    };
  }
  if (!upstream.ok) {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_geocoding",
        error: classifyPlacesHttpStatus(upstream.status),
        latencyMs: Date.now() - t0,
        upstreamStatus: upstream.status,
        googleStatus: null,
      }),
    };
  }
  let data: { status?: unknown; results?: GeocodingResult[] };
  try {
    data = await upstream.json();
  } catch {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_geocoding",
        error: { code: "provider_unavailable", httpStatus: 502 },
        latencyMs: Date.now() - t0,
        upstreamStatus: upstream.status,
        googleStatus: "unreadable_body",
      }),
    };
  }
  const verdict = classifyGeocodingStatus(data.status);
  if (verdict.kind === "error") {
    return {
      response: upstreamFailure({
        action,
        serviceKey: "google_geocoding",
        error: verdict.error,
        latencyMs: Date.now() - t0,
        upstreamStatus: upstream.status,
        googleStatus: typeof data.status === "string" ? data.status : null,
      }),
    };
  }
  void recordApiCall("google_geocoding", true, Date.now() - t0, upstream.status);
  return { results: verdict.kind === "ok" ? (data.results ?? []) : [] };
}

function detailsResponse(
  result: GeocodingResult | undefined,
  fallbackId: string,
): Response {
  if (!result) return jsonResponse({ error: "no_location" }, 500);
  const details = googlePlaceToDetails(geocodingResultToPlace(result), fallbackId);
  if ("error" in details) return jsonResponse({ error: details.error }, 500);
  return jsonResponse({ details });
}

/**
 * Explorer picks (preference anchors, spec v2 A2): coordinates from the
 * Geocoding API by place id, under its per-end-user storage terms.
 */
export async function handleRetrieveByGeocoding(
  key: string,
  placeId: string,
): Promise<Response> {
  const out = await geocode(key, "retrieve", { place_id: placeId });
  if ("response" in out) return out.response;
  return detailsResponse(out.results[0], placeId);
}

const REVERSE_CITY_TYPES = [
  "locality",
  "postal_town",
  "sublocality",
  "sublocality_level_1",
  "administrative_area_level_2",
  "administrative_area_level_1",
];

/** First result with a country and a city-level component; never plus-code-only. */
export function pickReverseResult(
  results: GeocodingResult[],
): GeocodingResult | undefined {
  return results.find((r) => {
    const types = r.types ?? [];
    if (types.length === 1 && types[0] === "plus_code") return false;
    const comps = r.address_components ?? [];
    const hasCountry = comps.some((c) => (c.types ?? []).includes("country"));
    const hasCity = comps.some((c) =>
      (c.types ?? []).some((t) => REVERSE_CITY_TYPES.includes(t))
    );
    return hasCountry && hasCity;
  });
}

export async function handleReverse(
  key: string,
  latitude: number,
  longitude: number,
): Promise<Response> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return jsonResponse({ error: "coordinates_required" }, 400);
  }
  const out = await geocode(key, "reverse", { latlng: `${latitude},${longitude}` });
  if ("response" in out) return out.response;
  return detailsResponse(pickReverseResult(out.results), "");
}

/** Geocoding has no proximity; a ±0.5° box is a soft bias (v1 §4.2). */
export function proximityToBounds(proximity: string | undefined): string | null {
  const center = proximityToCenter(proximity);
  if (!center) return null;
  const { latitude: lat, longitude: lng } = center;
  const r = (n: number) => Number(n.toFixed(6));
  return `${r(lat - 0.5)},${r(lng - 0.5)}|${r(lat + 0.5)},${r(lng + 0.5)}`;
}

export async function handleForward(
  key: string,
  query: string,
  proximity?: string,
): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return jsonResponse({ error: "query_required" }, 400);
  const params: Record<string, string> = { address: trimmed };
  const bounds = proximityToBounds(proximity);
  if (bounds) params.bounds = bounds;
  const out = await geocode(key, "forward", params);
  if ("response" in out) return out.response;
  return detailsResponse(out.results[0], "");
}

// ─── forward_hierarchy (#1363: place, then city, then country) ───────────────

export function explicitCountryIso(query: string): string | null {
  const normalized = normalizeName(query);
  if (normalized.length === 0) return null;
  const tokens = normalized.split(" ");
  for (let count = Math.min(5, tokens.length); count >= 1; count -= 1) {
    const candidate = tokens.slice(tokens.length - count).join(" ");
    const iso = COUNTRY_NAME_TO_ISO[candidate];
    if (iso) return iso.toUpperCase();
  }
  const lastToken = query.trim().split(/[\s,]+/).at(-1)?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(lastToken) ? lastToken : null;
}

/** Comparison-only normalization (kept name for #1363 callers and tests). */
export const normalizeHierarchyName = normalizeName;

const STREET_DESIGNATORS = new Set([
  "avenue", "close", "court", "drive", "expressway", "highway", "lane", "road",
  "street", "way",
]);

function stripExplicitCountry(query: string, iso: string | null): string {
  if (iso === null) return query.trim();
  const pieces = query.split(",").map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length > 1 && explicitCountryIso(pieces.at(-1) ?? "") === iso) {
    return pieces.slice(0, -1).join(", ");
  }
  const tokens = query.trim().split(/\s+/);
  for (let count = Math.min(5, tokens.length); count >= 1; count -= 1) {
    if (explicitCountryIso(tokens.slice(-count).join(" ")) === iso) {
      return tokens.slice(0, -count).join(" ");
    }
  }
  return query.trim();
}

function isSafeLocalityCandidate(value: string): boolean {
  const normalized = normalizeName(value);
  if (normalized.length === 0 || /\d/.test(normalized)) return false;
  return !normalized.split(" ").every((word) => STREET_DESIGNATORS.has(word));
}

/** Only user-supplied suffixes become locality authority. */
export function deriveHierarchyLocalities(query: string): string[] {
  const countryIso = explicitCountryIso(query);
  const withoutCountry = stripExplicitCountry(query, countryIso);
  const commaParts = withoutCountry.split(",").map((p) => p.trim()).filter(Boolean);
  const candidates: string[] = [];
  if (commaParts.length > 1) {
    for (const part of commaParts.slice(1).reverse()) {
      if (isSafeLocalityCandidate(part)) candidates.push(part);
    }
  }
  const trailing = withoutCountry.trim().split(/\s+/).filter(Boolean);
  for (let count = 1; count <= Math.min(3, trailing.length); count += 1) {
    const candidate = trailing.slice(-count).join(" ");
    if (isSafeLocalityCandidate(candidate)) candidates.push(candidate);
  }
  return [...new Map(candidates.map((c) => [normalizeName(c), c])).values()];
}

export function hierarchyQueryContainsName(query: string, contextName: string): boolean {
  const q = normalizeName(query).split(" ").filter(Boolean);
  const c = normalizeName(contextName).split(" ").filter(Boolean);
  if (c.length === 0 || c.length > q.length) return false;
  return q.some((_, start) => c.every((token, offset) => q[start + offset] === token));
}

/** Saved context is authority only when the new query independently names it. */
export function savedHierarchyContextForQuery(
  query: string,
  savedContext: { city?: string | null; country_code?: string | null } | null | undefined,
): { city: string | null; countryIso: string | null } {
  const city = typeof savedContext?.city === "string" && savedContext.city.trim().length > 0
    ? savedContext.city.trim()
    : null;
  if (city === null || !hierarchyQueryContainsName(query, city)) {
    return { city: null, countryIso: null };
  }
  const countryIso = typeof savedContext?.country_code === "string" &&
      /^[a-z]{2}$/i.test(savedContext.country_code)
    ? savedContext.country_code.toUpperCase()
    : null;
  return { city, countryIso };
}

export const HIERARCHY_CITY_TYPES = new Set([
  "locality",
  "postal_town",
  "sublocality",
  "sublocality_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "neighborhood",
]);

export function hierarchyResultMatches(params: {
  result: GeocodingResult;
  localityCandidates: string[];
  requiredCountryIso: string | null;
  requireLocality: boolean;
  includeOwnName?: boolean;
}): boolean {
  const place = geocodingResultToPlace(params.result);
  if (validLocation(place.location) === null) return false;
  const comps = place.addressComponents ?? [];
  const cc = countryCodeOf(comps);
  if (params.requiredCountryIso !== null && cc !== params.requiredCountryIso.toUpperCase()) {
    return false;
  }
  if (!params.requireLocality) return true;
  const names = new Set(administrativeNames(comps));
  if (params.includeOwnName) {
    const own = comps[0]?.longText;
    if (typeof own === "string") names.add(normalizeName(own));
  }
  return params.localityCandidates.some((c) => names.has(normalizeName(c)));
}

export function resultToHierarchyDetails(
  result: GeocodingResult,
  matchLevel: "place" | "city" | "country",
): { lat: number; lng: number; city: string | null; region: string | null; countryCode: string | null } | null {
  const place = geocodingResultToPlace(result);
  const loc = validLocation(place.location);
  if (loc === null) return null;
  const comps = place.addressComponents ?? [];
  const admin1 = comps.find((c) => (c.types ?? []).includes("administrative_area_level_1"));
  let city: string | null = null;
  if (matchLevel !== "country") {
    city = cityOf(comps);
    if (city === null && matchLevel === "city") {
      const own = comps[0]?.longText;
      city = typeof own === "string" ? own : null;
    }
  }
  return {
    ...loc,
    city,
    region: typeof admin1?.longText === "string" ? admin1.longText : null,
    countryCode: countryCodeOf(comps),
  };
}

export async function handleForwardHierarchy(
  key: string,
  query: string,
  savedContext: { city?: string; country_code?: string } | undefined,
): Promise<Response> {
  const rawQuery = query.trim();
  if (rawQuery.length === 0) return jsonResponse({ details: null, reason: "needs_context" });
  const explicitIso = explicitCountryIso(rawQuery);
  const usableSaved = savedHierarchyContextForQuery(rawQuery, savedContext);
  const requiredIso = explicitIso ?? usableSaved.countryIso;
  const localities = deriveHierarchyLocalities(rawQuery);
  if (usableSaved.city !== null) localities.push(usableSaved.city);

  const withCountry = (p: Record<string, string>): Record<string, string> =>
    requiredIso ? { ...p, components: `country:${requiredIso}` } : p;

  const placeOut = await geocode(key, "forward_hierarchy", withCountry({ address: rawQuery }));
  if ("response" in placeOut) return placeOut.response;
  const acceptedPlace = localities.length > 0
    ? placeOut.results.find((result) =>
      hierarchyResultMatches({
        result,
        localityCandidates: localities,
        requiredCountryIso: requiredIso,
        requireLocality: true,
      })
    )
    : undefined;
  if (acceptedPlace) {
    const details = resultToHierarchyDetails(acceptedPlace, "place");
    if (details) return jsonResponse({ details, matchLevel: "place", matchedQuery: rawQuery });
  }

  for (const locality of localities) {
    const cityOut = await geocode(key, "forward_hierarchy", withCountry({ address: locality }));
    if ("response" in cityOut) return cityOut.response;
    const acceptedCity = cityOut.results.find((result) =>
      (result.types ?? []).some((t) => HIERARCHY_CITY_TYPES.has(t)) &&
      hierarchyResultMatches({
        result,
        localityCandidates: [locality],
        requiredCountryIso: requiredIso,
        requireLocality: true,
        includeOwnName: true,
      })
    );
    if (acceptedCity) {
      const details = resultToHierarchyDetails(acceptedCity, "city");
      if (details) return jsonResponse({ details, matchLevel: "city", matchedQuery: locality });
    }
  }

  if (requiredIso !== null) {
    const countryOut = await geocode(key, "forward_hierarchy", {
      components: `country:${requiredIso}`,
    });
    if ("response" in countryOut) return countryOut.response;
    const acceptedCountry = countryOut.results.find((result) =>
      (result.types ?? []).includes("country") &&
      hierarchyResultMatches({
        result,
        localityCandidates: [],
        requiredCountryIso: requiredIso,
        requireLocality: false,
      })
    );
    if (acceptedCountry) {
      const details = resultToHierarchyDetails(acceptedCountry, "country");
      if (details) {
        return jsonResponse({
          details: { ...details, city: null },
          matchLevel: "country",
          matchedQuery: requiredIso,
        });
      }
    }
  }
  return jsonResponse({ details: null, reason: "needs_context" });
}

export type { PlaceDetails };
