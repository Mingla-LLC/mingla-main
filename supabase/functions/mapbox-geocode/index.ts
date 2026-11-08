/**
 * Address proxy. The function name is kept for installed clients; the
 * provider is Google (#4334). Every app calls it through the single constant
 * `ADDRESS_PROXY_FN` in packages/location-input/src/placesService.ts.
 *
 * Actions (POST, verify_jwt = true):
 *   suggest            { query, session_token?, proximity? }      → { suggestions } (≤5)
 *   suggest_places     { query, session_token?, proximity? }      → { suggestions } (≤5)
 *   retrieve           { place_id | mapbox_id, session_token?, lookup? } → { details }
 *   reverse            { latitude, longitude }                    → { details }
 *   forward            { query, proximity? }                      → { details }
 *   forward_hierarchy  { query, saved_context? }                  → { details, matchLevel, matchedQuery }
 *                                                                    | { details: null, reason: "needs_context" }
 *
 * Error contract (spec v1 §4.2, v2 §3.2): `{ error: <code> }` with
 *   provider_denied 502 · provider_quota 503 · provider_invalid_request 400 ·
 *   provider_unavailable 502 · <action>_exception 502 · no_location 500 ·
 *   no_locality 500 · provider_id_retired 410 · rate_limited 429 ·
 *   auth_required 401 · query_too_short / query_required / coordinates_required /
 *   place_id_required / invalid_json / invalid_request 400 · method_not_allowed 405 ·
 *   provider_key_missing 500.
 *
 * Invariant I-4334-RETIRED-IDS-FAIL-LOUD: a Mapbox-era id (base64 "urn:",
 * prefix dXJuOm) is answered 410 provider_id_retired with a Sentry event and
 * no upstream call (supabase/functions/mapbox-geocode/__tests__/issue_4334_proxy_contract.test.ts).
 * Invariant I-4334-PROVIDER-ERRORS-ARE-LOUD: no upstream failure becomes an
 * empty result (same test file).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { captureEdgeException } from "../_shared/sentryEdge.ts";
import { googleApiKey } from "../_shared/placesGeocode.ts";
import {
  corsHeaders,
  handleForward,
  handleForwardHierarchy,
  handleRetrieve,
  handleRetrieveByGeocoding,
  handleReverse,
  handleSuggest,
  handleSuggestPlaces,
  jsonResponse,
  RETIRED_MAPBOX_ID,
} from "./google.ts";

export { featureTypeToPrecision, googlePlaceToDetails } from "./googleNormalize.ts";

interface RequestBody {
  action?: string;
  query?: string;
  place_id?: string;
  /** Legacy alias sent by installed clients. */
  mapbox_id?: string;
  session_token?: string;
  /** "geocoding" → coordinates via the Geocoding API (Explorer anchors, A2). */
  lookup?: string;
  latitude?: number;
  longitude?: number;
  /** "lng,lat" (client contract kept from the Mapbox era). */
  proximity?: string;
  /** Ignored: Google returns at most 5 (D4). Accepted so old clients don't 400. */
  limit?: number;
  saved_context?: { city?: string; country_code?: string };
}

// ─── rate limit (F-8): 120 requests per user per 60 s, every action ──────────

export const RATE_LIMIT_MAX = 120;
export const RATE_LIMIT_WINDOW_MS = 60_000;
const rateWindows = new Map<string, number[]>();

export function checkRateLimit(sub: string, now = Date.now()): boolean {
  const recent = (rateWindows.get(sub) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    rateWindows.set(sub, recent);
    return false;
  }
  recent.push(now);
  rateWindows.set(sub, recent);
  return true;
}

/** Test-only: reset the in-memory windows. */
export function __resetRateLimitForTests(): void {
  rateWindows.clear();
}

/**
 * The JWT `sub`. verify_jwt = true has already verified the token at the
 * gateway, so the payload is decoded, not re-verified.
 */
export function jwtSubject(authorization: string | null): string | null {
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(payload.length / 4) * 4,
      "=",
    ));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const sub = jwtSubject(req.headers.get("authorization"));
  if (sub === null) return jsonResponse({ error: "auth_required" }, 401);
  if (!checkRateLimit(sub)) return jsonResponse({ error: "rate_limited" }, 429);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const key = googleApiKey();
  if (!key) {
    captureEdgeException(new Error("GOOGLE_MAPS_API_KEY not configured"), {
      fn: "mapbox-geocode",
      tags: { issue: "4334", code: "provider_key_missing" },
    });
    return jsonResponse({ error: "provider_key_missing" }, 500);
  }

  // One token per autocomplete session, shared by the suggests and the
  // details call that ends it. Minted here when the client omits it.
  const sessionToken =
    typeof body.session_token === "string" && body.session_token.length > 0
      ? body.session_token
      : crypto.randomUUID();
  const proximity = typeof body.proximity === "string" && body.proximity.length > 0
    ? body.proximity
    : undefined;

  switch (body.action) {
    case "suggest":
      return handleSuggest(key, body.query ?? "", sessionToken, proximity);
    case "suggest_places":
      return handleSuggestPlaces(key, body.query ?? "", sessionToken, proximity);
    case "retrieve": {
      const placeId = (typeof body.place_id === "string" && body.place_id.trim()) ||
        (typeof body.mapbox_id === "string" && body.mapbox_id.trim()) || "";
      if (placeId.length === 0) return jsonResponse({ error: "place_id_required" }, 400);
      if (RETIRED_MAPBOX_ID.test(placeId)) {
        captureEdgeException(new Error("retired Mapbox place id retrieved"), {
          fn: "mapbox-geocode",
          tags: { issue: "4334", code: "provider_id_retired" },
        });
        return jsonResponse({ error: "provider_id_retired" }, 410);
      }
      return body.lookup === "geocoding"
        ? handleRetrieveByGeocoding(key, placeId)
        : handleRetrieve(key, placeId, sessionToken);
    }
    case "reverse":
      return handleReverse(
        key,
        typeof body.latitude === "number" ? body.latitude : NaN,
        typeof body.longitude === "number" ? body.longitude : NaN,
      );
    case "forward":
      return handleForward(key, body.query ?? "", proximity);
    case "forward_hierarchy":
      return handleForwardHierarchy(key, body.query ?? "", body.saved_context);
    default:
      return jsonResponse({ error: "invalid_request" }, 400);
  }
}

if (import.meta.main) {
  serve(handler);
}
