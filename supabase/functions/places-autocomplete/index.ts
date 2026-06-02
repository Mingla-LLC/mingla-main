/**
 * ORCH-0824 — Google Places autocomplete + place-details proxy.
 *
 * Replaces the client-direct Google Places call in
 * `mingla-business/src/services/googlePlacesService.ts` so the API key
 * stays server-side (never shipped in the client bundle). Uses the
 * existing `GOOGLE_MAPS_API_KEY` Supabase secret already provisioned for
 * other edge functions (admin-seed-places, backfill-place-photos, etc.).
 *
 * Single-function design with action discriminator to keep the deploy
 * footprint small:
 *
 *   POST body { action: "autocomplete", query: string }
 *     → { suggestions: PlaceSuggestion[] }
 *
 *   POST body { action: "details", placeId: string }
 *     → { details: PlaceDetails }
 *
 * Auth: verify_jwt = true (configured in supabase/config.toml). The
 * wizard flow that calls this proxy is already auth-gated in the client
 * — anonymous traffic is not a legitimate use case. Reduces abuse surface.
 *
 * Errors are returned as { error: "<code>" } with appropriate HTTP status:
 *   400  invalid_request | query_too_short | place_id_required
 *   500  google_maps_api_key_missing | google_places_<status> | no_locality
 *
 * The client (googlePlacesService.ts) maps these codes to user-friendly
 * toasts per the existing error contract.
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md §3.6
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_PLACES_NEW_BASE = "https://places.googleapis.com/v1";
const GOOGLE_PLACES_LEGACY_BASE = "https://maps.googleapis.com/maps/api/place";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AutocompleteRawResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string } };
    };
  }>;
}

interface PlaceDetailsRawResponse {
  id?: string;
  formattedAddress?: string;
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  location?: { latitude?: number; longitude?: number };
}

interface LegacyAutocompleteRawResponse {
  predictions?: Array<{
    place_id?: string;
    description?: string;
    structured_formatting?: { main_text?: string };
  }>;
  status?: string;
  error_message?: string;
}

interface LegacyPlaceDetailsRawResponse {
  result?: {
    place_id?: string;
    formatted_address?: string;
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
    geometry?: { location?: { lat?: number; lng?: number } };
  };
  status?: string;
  error_message?: string;
}

interface RequestBody {
  action?: "autocomplete" | "details";
  query?: string;
  placeId?: string;
}

function shouldFallbackToLegacy(status: number): boolean {
  return status === 403 || status === 404;
}

function legacyStatusToHttp(status: string | undefined): number {
  switch (status) {
    case "OK":
    case "ZERO_RESULTS":
      return 200;
    case "INVALID_REQUEST":
      return 400;
    case "REQUEST_DENIED":
      return 403;
    case "OVER_QUERY_LIMIT":
      return 429;
    default:
      return 502;
  }
}

function legacyErrorCode(status: string | undefined): string {
  return `google_places_legacy_${(status ?? "unknown").toLowerCase()}`;
}

async function handleLegacyAutocomplete(
  apiKey: string,
  query: string,
): Promise<Response> {
  const url = new URL(`${GOOGLE_PLACES_LEGACY_BASE}/autocomplete/json`);
  url.searchParams.set("input", query);
  url.searchParams.set("key", apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { method: "GET" });
  } catch (e) {
    console.error("[places-autocomplete] legacy autocomplete error:", e);
    return jsonResponse(
      { error: "autocomplete_exception", suggestions: [] },
      502,
    );
  }

  if (!upstream.ok) {
    console.warn(
      "[places-autocomplete] legacy autocomplete HTTP non-OK:",
      upstream.status,
    );
    return jsonResponse(
      {
        error: `google_places_legacy_http_${upstream.status}`,
        suggestions: [],
      },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as LegacyAutocompleteRawResponse;
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.warn(
      "[places-autocomplete] legacy autocomplete status:",
      data.status,
      data.error_message ?? "",
    );
    return jsonResponse(
      { error: legacyErrorCode(data.status), suggestions: [] },
      legacyStatusToHttp(data.status),
    );
  }

  const suggestions = (data.predictions ?? [])
    .map((pred) => {
      if (!pred.place_id || !pred.description) return null;
      return {
        placeId: pred.place_id,
        displayName: pred.structured_formatting?.main_text ?? pred.description,
        fullAddress: pred.description,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .slice(0, 5);

  return jsonResponse({ suggestions });
}

export async function handleAutocomplete(
  apiKey: string,
  query: string,
): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return jsonResponse({ error: "query_too_short" }, 400);
  }

  try {
    const upstream = await fetch(
      `${GOOGLE_PLACES_NEW_BASE}/places:autocomplete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify({ input: trimmed }),
      },
    );

    if (!upstream.ok) {
      console.warn(
        "[places-autocomplete] autocomplete non-OK:",
        upstream.status,
      );
      if (shouldFallbackToLegacy(upstream.status)) {
        return handleLegacyAutocomplete(apiKey, trimmed);
      }
      return jsonResponse(
        { error: `google_places_${upstream.status}`, suggestions: [] },
        upstream.status >= 500 ? 502 : upstream.status,
      );
    }

    const data = (await upstream.json()) as AutocompleteRawResponse;
    const suggestions = (data.suggestions ?? [])
      .map((s) => {
        const pred = s.placePrediction;
        if (!pred || !pred.placeId) return null;
        const text = pred.text?.text ?? "";
        const mainText = pred.structuredFormat?.mainText?.text ?? text;
        if (!text) return null;
        return {
          placeId: pred.placeId,
          displayName: mainText,
          fullAddress: text,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .slice(0, 5);

    return jsonResponse({ suggestions });
  } catch (e) {
    console.error("[places-autocomplete] autocomplete error:", e);
    return jsonResponse(
      { error: "autocomplete_exception", suggestions: [] },
      502,
    );
  }
}

function buildDetailsResponse(
  inputPlaceId: string,
  data: {
    placeId?: string;
    formattedAddress?: string;
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
    location?: { lat?: number; lng?: number };
  },
): Response {
  const components = data.addressComponents ?? [];

  const findByType = (
    typeName: string,
  ):
    | { longText: string | undefined; shortText: string | undefined }
    | undefined => {
    const hit = components.find((c) => (c.types ?? []).includes(typeName));
    if (!hit) return undefined;
    return { longText: hit.longText, shortText: hit.shortText };
  };

  // Locality extraction order: locality -> postal_town (UK Royal Mail) ->
  // administrative_area_level_2 (broader fallback). Honest 500 if none.
  const localityComp = findByType("locality") ??
    findByType("postal_town") ??
    findByType("administrative_area_level_2");

  if (!localityComp || !localityComp.longText) {
    return jsonResponse({ error: "no_locality" }, 500);
  }

  const regionComp = findByType("administrative_area_level_1");
  const countryComp = findByType("country");

  const loc = data.location;
  if (
    !loc ||
    typeof loc.lat !== "number" ||
    typeof loc.lng !== "number"
  ) {
    return jsonResponse({ error: "no_location" }, 500);
  }

  return jsonResponse({
    details: {
      placeId: data.placeId ?? inputPlaceId,
      formattedAddress: data.formattedAddress ?? localityComp.longText,
      city: localityComp.longText,
      region: regionComp?.shortText ?? null,
      countryCode: countryComp?.shortText ?? null,
      location: { lat: loc.lat, lng: loc.lng },
    },
  });
}

async function handleLegacyDetails(
  apiKey: string,
  placeId: string,
): Promise<Response> {
  const url = new URL(`${GOOGLE_PLACES_LEGACY_BASE}/details/json`);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "place_id,formatted_address,address_components,geometry",
  );
  url.searchParams.set("key", apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { method: "GET" });
  } catch (e) {
    console.error("[places-autocomplete] legacy details fetch error:", e);
    return jsonResponse({ error: "details_exception" }, 502);
  }

  if (!upstream.ok) {
    console.warn(
      "[places-autocomplete] legacy details HTTP non-OK:",
      upstream.status,
    );
    return jsonResponse(
      { error: `google_places_legacy_http_${upstream.status}` },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as LegacyPlaceDetailsRawResponse;
  if (data.status !== "OK") {
    console.warn(
      "[places-autocomplete] legacy details status:",
      data.status,
      data.error_message ?? "",
    );
    return jsonResponse(
      { error: legacyErrorCode(data.status) },
      legacyStatusToHttp(data.status),
    );
  }

  const result = data.result;
  if (!result) {
    return jsonResponse({ error: "places_proxy_empty_response" }, 502);
  }

  return buildDetailsResponse(placeId, {
    placeId: result.place_id,
    formattedAddress: result.formatted_address,
    addressComponents: (result.address_components ?? []).map((c) => ({
      longText: c.long_name,
      shortText: c.short_name,
      types: c.types,
    })),
    location: {
      lat: result.geometry?.location?.lat,
      lng: result.geometry?.location?.lng,
    },
  });
}

export async function handleDetails(
  apiKey: string,
  placeId: string,
): Promise<Response> {
  if (!placeId || placeId.trim().length === 0) {
    return jsonResponse({ error: "place_id_required" }, 400);
  }

  const trimmedPlaceId = placeId.trim();
  const url = `${GOOGLE_PLACES_NEW_BASE}/places/${
    encodeURIComponent(trimmedPlaceId)
  }`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,formattedAddress,addressComponents,location",
      },
    });
  } catch (e) {
    console.error("[places-autocomplete] details fetch error:", e);
    return jsonResponse({ error: "details_exception" }, 502);
  }

  if (!upstream.ok) {
    console.warn("[places-autocomplete] details non-OK:", upstream.status);
    if (shouldFallbackToLegacy(upstream.status)) {
      return handleLegacyDetails(apiKey, trimmedPlaceId);
    }
    return jsonResponse(
      { error: `google_places_${upstream.status}` },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const data = (await upstream.json()) as PlaceDetailsRawResponse;
  return buildDetailsResponse(trimmedPlaceId, {
    placeId: data.id,
    formattedAddress: data.formattedAddress,
    addressComponents: data.addressComponents,
    location: {
      lat: data.location?.latitude,
      lng: data.location?.longitude,
    },
  });
}

export async function handlePlacesAutocompleteRequest(
  req: Request,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!apiKey) {
    console.error("[places-autocomplete] GOOGLE_MAPS_API_KEY not configured");
    return jsonResponse({ error: "google_maps_api_key_missing" }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  switch (body.action) {
    case "autocomplete":
      return handleAutocomplete(apiKey, body.query ?? "");
    case "details":
      return handleDetails(apiKey, body.placeId ?? "");
    default:
      return jsonResponse({ error: "invalid_action" }, 400);
  }
}

if (import.meta.main) {
  serve(handlePlacesAutocompleteRequest);
}
