/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 3
 *
 * mapbox-geocode — server-side Mapbox Search Box proxy for the experience
 * stops builder's address picker. Keeps MAPBOX_ACCESS_TOKEN strictly
 * server-side (never shipped in the client bundle), mirroring the
 * places-autocomplete (Google) edge fn's single-function action-discriminated
 * design + CORS + verify_jwt=true + { error: "<code>" } contract.
 *
 * Coexists with places-autocomplete: EVENTS keep Google; EXPERIENCES use
 * Mapbox (operator-locked provider). The normalized output shape is a
 * structural drop-in for googlePlacesService.PlaceDetails so the client
 * MapboxAddressInput is a drop-in for AddressAutocompleteInput.
 *
 * ── API surface (action-discriminated) ──────────────────────────────────
 *   POST { action: "suggest",  query: string, session_token?: string }
 *     → { suggestions: [ { placeId, displayName, fullAddress } ] }   (≤5)
 *
 *   POST { action: "retrieve", mapbox_id: string, session_token?: string }
 *     → { details: {
 *           placeId, formattedAddress, city,
 *           region|null, countryCode|null, location:{lat,lng}
 *       } }
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
 *     • Session billing — suggest+retrieve count as ONE session per session_token:
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
  action?: "suggest" | "retrieve";
  query?: string;
  mapbox_id?: string;
  session_token?: string;
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
  country_code?: string;
}

interface RetrieveRawResponse {
  features?: Array<{
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
  }>;
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

  const coords = feature.geometry?.coordinates; // [lng, lat]
  if (
    !coords ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    return jsonResponse({ error: "no_location" }, 500);
  }

  const props = feature.properties ?? {};
  const ctx = props.context ?? {};

  // City: context.place.name → locality.name → district.name. Honest 500 if none
  // (matches the Google PlaceDetails "city required; throws if not derivable" contract).
  const city =
    ctx.place?.name ?? ctx.locality?.name ?? ctx.district?.name ?? null;
  if (!city) {
    return jsonResponse({ error: "no_locality" }, 500);
  }

  const region = ctx.region?.name ?? null;
  const countryCode = ctx.country?.country_code
    ? ctx.country.country_code.toUpperCase()
    : null;

  return jsonResponse({
    details: {
      placeId: props.mapbox_id ?? mapboxId,
      formattedAddress: props.full_address ?? props.place_formatted ?? city,
      city,
      region,
      countryCode,
      location: { lat: coords[1], lng: coords[0] }, // GeoJSON is [lng, lat]
    },
  });
}

serve(async (req: Request): Promise<Response> => {
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
    default:
      return jsonResponse({ error: "invalid_request" }, 400);
  }
});
