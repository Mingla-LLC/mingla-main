/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 3
 *
 * mapbox-geocode — server-side Mapbox Search Box proxy for every business
 * address picker (experience stops, event venue, trip, brand, venue claim).
 * Keeps MAPBOX_ACCESS_TOKEN strictly server-side (never shipped in the client
 * bundle) via a single-function action-discriminated design + CORS +
 * verify_jwt=true + { error: "<code>" } contract.
 *
 * ORCH-1079 [Business-venue Google→Mapbox sweep] retired the legacy Google
 * `places-autocomplete` edge fn; ALL business address autocomplete now flows
 * through this Mapbox proxy. The normalized output shape remains a structural
 * superset of the old googlePlacesService.PlaceDetails so the client
 * MapboxAddressInput is a drop-in for the deleted AddressAutocompleteInput.
 *
 * ── API surface (action-discriminated) ──────────────────────────────────
 *   POST { action: "suggest",  query: string, session_token?: string }
 *     → { suggestions: [ { placeId, displayName, fullAddress } ] }   (≤5)
 *
 *   POST { action: "retrieve", mapbox_id: string, session_token?: string }
 *     → { details: {
 *           placeId, formattedAddress, city,
 *           region|null, regionCode|null, regionCodeFull|null,
 *           countryCode|null, location:{lat,lng}
 *       } }
 *
 *   POST { action: "reverse",  latitude: number, longitude: number }   (no session_token)
 *     → { details: { ...same shape as retrieve } }
 *
 *   POST { action: "forward",  query: string }                         (no session_token)
 *     → { details: { ...same shape as retrieve } }
 *
 * ── META-ORCH-1060 [Mapbox consumer migration] · keystone change ─────────
 *   ADDED (additive, no existing field removed):
 *     • `regionCode` (ISO 3166-2 subdivision, e.g. "NC") + `regionCodeFull`
 *       (e.g. "US-NC") to the `retrieve` (+ reverse/forward) `details`. These
 *       come from Mapbox's STRUCTURED `context.region.region_code` /
 *       `region_code_full` — the consumer Discover city picker reads these
 *       instead of parsing a display string (kills CityPickerSheet's
 *       parseStateCountry / split(",")[0] heuristics). Codes are STRUCTURED,
 *       NEVER parsed from a name string. Per SPEC §3.1 / INV-3.
 *     • `reverse` + `forward` actions for the consumer locale-currency,
 *       night-out, and useUserLocation-fallback paths (de-Nominatim'd).
 *
 * ── Mapbox docs cited inline (COMMS-0003 — external-API params verified) ──
 *   Search Box API (current recommended; legacy /geocoding/v5/mapbox.places is
 *   in maintenance):
 *     • GET /search/searchbox/v1/suggest
 *         https://docs.mapbox.com/api/search/search-box/#get-suggestions
 *         params: q, session_token, access_token, limit
 *         returns suggestions[] with { mapbox_id, name, full_address|place_formatted }
 *     • GET /search/searchbox/v1/retrieve/{mapbox_id}
 *         https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 *         returns GeoJSON features[0] with geometry.coordinates [lng,lat] and
 *         properties.{ full_address, place_formatted, context.{place,region,country,...} }
 *       The STRUCTURED region fields on properties.context.region are
 *       `name`, `region_code` (ISO 3166-2 subdivision part, e.g. "NC"), and
 *       `region_code_full` (e.g. "US-NC"); properties.context.country exposes
 *       `name`, `country_code` (ISO 3166-1 alpha-2), `country_code_alpha_3`;
 *       properties.context.place exposes the city `name`:
 *         https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 *         https://docs.mapbox.com/api/search/search-box/
 *     • GET /search/searchbox/v1/reverse?longitude=&latitude=&access_token=
 *       (reverse geocode; NO session_token; per-request billing) and
 *       GET /search/searchbox/v1/forward?q=&access_token= (single-call forward
 *       geocode; per-request billing):
 *         https://docs.mapbox.com/api/search/search-box/
 *       Geocoding API v6 fallback (structured context): https://docs.mapbox.com/api/search/geocoding/
 *     • Session billing — suggest+retrieve count as ONE session per session_token;
 *       reverse/forward are billed per-request (no session):
 *         https://docs.mapbox.com/api/search/search-box/#session-billing
 *
 * ── Defensive handling (MEDIUM-confidence point; SPEC §3.4) ──────────────
 *   Mapbox can omit context.place for non-address features (POIs, regions).
 *   retrieve REQUIRES a derivable city (context.place.name → locality → district)
 *   and geometry.coordinates; honest 500 (no_locality / no_location) otherwise,
 *   matching the Google PlaceDetails "city required" contract. region/countryCode
 *   are nullable (the PlaceDetails contract already allows null for both).
 *
 * NOTE: MAPBOX_ACCESS_TOKEN is a NEW Supabase secret — provision before deploy.
 *       The live call is verified post-deploy once the token lands; this fn is
 *       built against the documented Search Box shape and unit-tested with a
 *       documented-shape mock.
 *
 * Auth: verify_jwt = true (supabase/config.toml). The experience wizard that
 * calls this proxy is auth-gated; anonymous traffic is not a legitimate use.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// https://docs.mapbox.com/api/search/search-box/
const MAPBOX_SEARCHBOX_BASE = "https://api.mapbox.com/search/searchbox/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  action?: "suggest" | "retrieve" | "reverse" | "forward";
  query?: string;
  mapbox_id?: string;
  session_token?: string;
  latitude?: number;
  longitude?: number;
}

// ── Mapbox Search Box raw response shapes (docs §get-suggestions / §retrieve) ──

interface SuggestRawResponse {
  suggestions?: Array<{
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
  }>;
}

interface RetrieveContextEntry {
  name?: string;
  // ISO 3166-1 alpha-2 on context.country (e.g. "US").
  country_code?: string;
  // META-ORCH-1060 keystone: STRUCTURED ISO 3166-2 subdivision code on
  // context.region — `region_code` is the subdivision part (e.g. "NC"),
  // `region_code_full` is the prefixed form (e.g. "US-NC").
  // https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
  region_code?: string;
  region_code_full?: string;
}

interface MapboxFeature {
  geometry?: { coordinates?: [number, number] }; // [lng, lat]
  properties?: {
    mapbox_id?: string;
    full_address?: string;
    place_formatted?: string;
    context?: {
      place?: RetrieveContextEntry;
      locality?: RetrieveContextEntry;
      district?: RetrieveContextEntry;
      region?: RetrieveContextEntry;
      country?: RetrieveContextEntry;
    };
  };
}

interface RetrieveRawResponse {
  features?: MapboxFeature[];
}

/**
 * https://docs.mapbox.com/api/search/search-box/#get-suggestions
 * GET /search/searchbox/v1/suggest?q=&session_token=&access_token=&limit=5
 */
async function handleSuggest(
  token: string,
  query: string,
  sessionToken: string,
): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return jsonResponse({ error: "query_too_short" }, 400);
  }

  const url =
    `${MAPBOX_SEARCHBOX_BASE}/suggest` +
    `?q=${encodeURIComponent(trimmed)}` +
    `&session_token=${encodeURIComponent(sessionToken)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&limit=5`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (e) {
    console.error("[mapbox-geocode] suggest fetch error:", e);
    return jsonResponse({ error: "suggest_exception", suggestions: [] }, 502);
  }

  if (!upstream.ok) {
    console.warn("[mapbox-geocode] suggest non-OK:", upstream.status);
    return jsonResponse(
      { error: `mapbox_${upstream.status}`, suggestions: [] },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as SuggestRawResponse;
  const suggestions = (data.suggestions ?? [])
    .map((s) => {
      if (!s.mapbox_id || !s.name) return null;
      return {
        placeId: s.mapbox_id,
        displayName: s.name,
        fullAddress: s.full_address ?? s.place_formatted ?? s.name,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .slice(0, 5);

  return jsonResponse({ suggestions });
}

type PlaceDetails = {
  placeId: string;
  formattedAddress: string;
  city: string;
  region: string | null;
  regionCode: string | null;
  regionCodeFull: string | null;
  countryCode: string | null;
  location: { lat: number; lng: number };
};

/**
 * Normalize a Mapbox Search Box GeoJSON feature into the shared PlaceDetails
 * shape. Returns an honest error code (no_location / no_locality) when the
 * feature lacks coordinates or a derivable city. Shared by retrieve / reverse /
 * forward so every action returns byte-identical structured fields.
 *
 * META-ORCH-1060 keystone: regionCode / regionCodeFull come ONLY from the
 * STRUCTURED context.region.region_code(_full) — never parsed from a name.
 * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 */
export function featureToDetails(
  feature: MapboxFeature,
  fallbackPlaceId: string,
): PlaceDetails | { error: string } {
  const coords = feature?.geometry?.coordinates; // [lng, lat]
  if (
    !coords ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    return { error: "no_location" };
  }

  const props = feature?.properties ?? {};
  const ctx = props.context ?? {};

  // City: context.place.name → locality.name → district.name → region.name.
  // ORCH-1079 §3.D.1 — a POI feature whose Mapbox context lacks place/locality/
  // district (e.g. a remote venue) previously returned `no_locality` → HTTP 500
  // and the user's real pick failed loudly. Add ctx.region.name as a last-resort
  // human-readable locality so the pick resolves instead of 500ing. Additive:
  // the new branch only fires when the prior three are all null; PlaceDetails.city
  // stays non-null (Google contract preserved). region_code derivation below is
  // unaffected (it reads structured region.region_code, not this display name).
  // https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
  const city =
    ctx.place?.name ??
    ctx.locality?.name ??
    ctx.district?.name ??
    ctx.region?.name ??
    null;
  if (!city) {
    return { error: "no_locality" };
  }

  const region = ctx.region?.name ?? null;
  // STRUCTURED codes — never derived from a display string (INV-3).
  const regionCode = ctx.region?.region_code
    ? ctx.region.region_code.toUpperCase()
    : null;
  const regionCodeFull = ctx.region?.region_code_full
    ? ctx.region.region_code_full.toUpperCase()
    : null;
  const countryCode = ctx.country?.country_code
    ? ctx.country.country_code.toUpperCase()
    : null;

  return {
    placeId: props.mapbox_id ?? fallbackPlaceId,
    formattedAddress: props.full_address ?? props.place_formatted ?? city,
    city,
    region,
    regionCode,
    regionCodeFull,
    countryCode,
    location: { lat: coords[1], lng: coords[0] }, // GeoJSON is [lng, lat]
  };
}

/**
 * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 * GET /search/searchbox/v1/retrieve/{mapbox_id}?session_token=&access_token=
 */
async function handleRetrieve(
  token: string,
  mapboxId: string,
  sessionToken: string,
): Promise<Response> {
  if (!mapboxId || mapboxId.trim().length === 0) {
    return jsonResponse({ error: "mapbox_id_required" }, 400);
  }

  const url =
    `${MAPBOX_SEARCHBOX_BASE}/retrieve/${encodeURIComponent(mapboxId)}` +
    `?session_token=${encodeURIComponent(sessionToken)}` +
    `&access_token=${encodeURIComponent(token)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (e) {
    console.error("[mapbox-geocode] retrieve fetch error:", e);
    return jsonResponse({ error: "retrieve_exception" }, 502);
  }

  if (!upstream.ok) {
    console.warn("[mapbox-geocode] retrieve non-OK:", upstream.status);
    return jsonResponse(
      { error: `mapbox_${upstream.status}` },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as RetrieveRawResponse;
  const feature = (data.features ?? [])[0];
  if (!feature) {
    return jsonResponse({ error: "no_location" }, 500);
  }

  const details = featureToDetails(feature, mapboxId);
  if ("error" in details) {
    return jsonResponse({ error: details.error }, 500);
  }
  return jsonResponse({ details });
}

/**
 * https://docs.mapbox.com/api/search/search-box/ (reverse)
 * GET /search/searchbox/v1/reverse?longitude=&latitude=&access_token=
 * No session_token — per-request billing (session billing reference:
 * https://docs.mapbox.com/api/search/search-box/#session-billing).
 */
async function handleReverse(
  token: string,
  latitude: number,
  longitude: number,
): Promise<Response> {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude)
  ) {
    return jsonResponse({ error: "coordinates_required" }, 400);
  }

  const url =
    `${MAPBOX_SEARCHBOX_BASE}/reverse` +
    `?longitude=${encodeURIComponent(String(longitude))}` +
    `&latitude=${encodeURIComponent(String(latitude))}` +
    `&access_token=${encodeURIComponent(token)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (e) {
    console.error("[mapbox-geocode] reverse fetch error:", e);
    return jsonResponse({ error: "reverse_exception" }, 502);
  }

  if (!upstream.ok) {
    console.warn("[mapbox-geocode] reverse non-OK:", upstream.status);
    return jsonResponse(
      { error: `mapbox_${upstream.status}` },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as RetrieveRawResponse;
  const feature = (data.features ?? [])[0];
  if (!feature) {
    return jsonResponse({ error: "no_location" }, 500);
  }

  const details = featureToDetails(feature, "");
  if ("error" in details) {
    return jsonResponse({ error: details.error }, 500);
  }
  return jsonResponse({ details });
}

/**
 * https://docs.mapbox.com/api/search/search-box/ (forward)
 * GET /search/searchbox/v1/forward?q=&access_token=
 * Single-call forward geocode — no session_token, per-request billing.
 */
async function handleForward(token: string, query: string): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return jsonResponse({ error: "query_required" }, 400);
  }

  const url =
    `${MAPBOX_SEARCHBOX_BASE}/forward` +
    `?q=${encodeURIComponent(trimmed)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&limit=1`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (e) {
    console.error("[mapbox-geocode] forward fetch error:", e);
    return jsonResponse({ error: "forward_exception" }, 502);
  }

  if (!upstream.ok) {
    console.warn("[mapbox-geocode] forward non-OK:", upstream.status);
    return jsonResponse(
      { error: `mapbox_${upstream.status}` },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as RetrieveRawResponse;
  const feature = (data.features ?? [])[0];
  if (!feature) {
    return jsonResponse({ error: "no_location" }, 500);
  }

  const details = featureToDetails(feature, "");
  if ("error" in details) {
    return jsonResponse({ error: details.error }, 500);
  }
  return jsonResponse({ details });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";
  if (!token) {
    console.error("[mapbox-geocode] MAPBOX_ACCESS_TOKEN not configured");
    return jsonResponse({ error: "mapbox_access_token_missing" }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // Client generates one UUID per autocomplete session, reused across the
  // suggest→retrieve pair (Mapbox session billing). Fallback keeps the fn
  // resilient if the client omits it.
  const sessionToken =
    typeof body.session_token === "string" && body.session_token.length > 0
      ? body.session_token
      : crypto.randomUUID();

  switch (body.action) {
    case "suggest":
      return handleSuggest(token, body.query ?? "", sessionToken);
    case "retrieve":
      return handleRetrieve(token, body.mapbox_id ?? "", sessionToken);
    case "reverse":
      return handleReverse(
        token,
        typeof body.latitude === "number" ? body.latitude : NaN,
        typeof body.longitude === "number" ? body.longitude : NaN,
      );
    case "forward":
      return handleForward(token, body.query ?? "");
    default:
      return jsonResponse({ error: "invalid_request" }, 400);
  }
}

if (import.meta.main) {
  serve(handler);
}
