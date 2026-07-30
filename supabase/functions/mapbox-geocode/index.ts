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
// ORCH-1365 [location-search-relevance] — trailing-country parser for the
// CONSUMER place-search action ONLY. NEVER used by the business `suggest` path.
import {
  COUNTRY_NAME_TO_ISO,
  parseTrailingCountry,
} from "./countryNames.ts";

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
  // ORCH-1365 — `suggest_places` is an ADDITIVE consumer place-search action
  // (place-type filter + trailing-country strip + `country` ISO bias, NO
  // proximity for the Preferences field). The business `suggest` action is
  // UNCHANGED and byte-identical (INV-3 / ORCH-1079).
  action?:
    | "suggest"
    | "suggest_places"
    | "retrieve"
    | "reverse"
    | "forward"
    | "forward_hierarchy";
  query?: string;
  mapbox_id?: string;
  session_token?: string;
  latitude?: number;
  longitude?: number;
  // ── ORCH-1361 [location-suggestions] · ADDITIVE (backward-compatible) ──────
  // Optional Mapbox Search Box RANKING BIAS for suggest/forward. When ANY is
  // omitted the emitted upstream URL is BYTE-IDENTICAL to the pre-1361 request
  // (the no-regression contract, SC-6) — Mapbox otherwise defaults proximity to
  // the caller IP (the Supabase edge datacenter), which mis-ranks results (a
  // Nigerian "lekki" resolved to a London POI). Consumer callers thread the
  // user's device proximity so results RANK to the user; business pickers omit
  // it and are unchanged. retrieve/reverse ignore these.
  //
  // FILTER-FREE by design (INV-3 / ORCH-1079 gate
  // `i-mapbox-suggest-no-types-filter.mjs`): this shared suggest handler ALSO
  // serves BUSINESS venue-name search, which must return POIs, so NO `types`
  // filter is ever added here. `country` is likewise omitted — a `country`
  // filter would over-restrict an "explore anywhere" field (someone in Lagos
  // typing "london" must still get London). `proximity` biases ranking WITHOUT
  // excluding any result, which is the actual fix.
  // Doc-verified formats (https://docs.mapbox.com/api/search/search-box/):
  //   proximity "longitude,latitude" (or "ip"); limit ≤ 10.
  proximity?: string;
  limit?: number;
  saved_context?: {
    city?: string;
    country_code?: string;
  };
}

/**
 * ORCH-1361 — optional Mapbox RANKING bias, threaded from the consumer's device
 * into suggest/forward. All fields optional; an empty object yields a
 * byte-identical upstream URL (SC-6 no-regression contract). NO `types`/`country`
 * FILTER — the shared suggest handler must stay filter-free so BUSINESS
 * venue-name search still returns POIs (INV-3 / ORCH-1079). Only `proximity`
 * (rank-only bias) + `limit` (pagination).
 */
export interface SearchOpts {
  proximity?: string;
  limit?: number;
}

/**
 * ORCH-1361 — clamp the suggest `limit` to Mapbox's documented [1,10] range.
 * An omitted/undefined limit resolves to the pre-1361 default of 5 (so the
 * business pickers + CityPicker stay byte-identical); the consumer Preferences
 * list opts into 8. https://docs.mapbox.com/api/search/search-box/
 */
export function clampSuggestLimit(limit: number | undefined): number {
  const n = typeof limit === "number" && Number.isFinite(limit)
    ? Math.trunc(limit)
    : 5;
  return Math.min(Math.max(n, 1), 10);
}

/**
 * ORCH-1361 — build the Search Box `/suggest` URL. The `proximity` rank bias is
 * appended ONLY when present and non-empty; `limit` resolves to `opts.limit ?? 5`
 * (clamped). NO `types`/`country` filter — the suggest handler stays filter-free
 * so business venue-name search still returns POIs (INV-3 / ORCH-1079). With an
 * empty `opts` the string is byte-identical to the pre-1361 builder:
 * `?q&session_token&access_token&limit=5` (SC-6).
 */
export function buildSuggestUrl(
  base: string,
  token: string,
  trimmedQuery: string,
  sessionToken: string,
  opts: SearchOpts = {},
): string {
  let url =
    `${base}/suggest` +
    `?q=${encodeURIComponent(trimmedQuery)}` +
    `&session_token=${encodeURIComponent(sessionToken)}` +
    `&access_token=${encodeURIComponent(token)}`;
  // Rank-only bias — proximity does NOT exclude any result (INV-3 / ORCH-1079).
  if (opts.proximity) url += `&proximity=${encodeURIComponent(opts.proximity)}`;
  url += `&limit=${clampSuggestLimit(opts.limit)}`;
  return url;
}

// ─── ORCH-1365 [location-search-relevance] — CONSUMER place-search ONLY ───────
// This block is the DELIBERATE code-level wall between the business venue-name
// search (`suggest`/`buildSuggestUrl`, filter-free, POIs resolve — INV-3 /
// ORCH-1079) and the consumer place search. The place types filter + `country`
// bias live HERE and NOWHERE in the business builder. `handleSuggest` (business)
// NEVER calls `buildPlaceSuggestUrl`. The scoped ORCH-1079 gate
// (`i-mapbox-suggest-no-types-filter.mjs`) enforces exactly this separation.

/**
 * ORCH-1365 — place-type filter for consumer place search. Drops POIs
 * (restaurants/apartments named "Lekki") so the real PLACE surfaces
 * (runtime-proven, evidence probe B). Doc-verified `types` values
 * (https://docs.mapbox.com/api/search/search-box/#get-suggestions): comma list.
 */
export const PLACE_SUGGEST_TYPES = "place,locality,neighborhood,region,district";

/** ORCH-1365 — options for the consumer place builder. `country` is a Mapbox
 *  ISO 3166-1 alpha-2 bias (DERIVED server-side from the trailing-country strip,
 *  never client-trusted). `proximity` stays optional/forward-compatible but the
 *  Preferences field sends none. */
export interface PlaceSearchOpts {
  proximity?: string;
  limit?: number;
  country?: string;
}

/**
 * ORCH-1365 — build the Search Box `/suggest` URL for CONSUMER place search.
 * Sibling to `buildSuggestUrl`, kept SEPARATE so the ORCH-1079 gate can prove the
 * business builder is filter-free. Appends `q`, `session_token`, `access_token`
 * (same as `buildSuggestUrl`), then ALWAYS `&types=${PLACE_SUGGEST_TYPES}`, then
 * `&country=${opts.country}` ONLY when a non-empty ISO code is present, then a
 * (forward-compat, Preferences-omitted) `&proximity=`, then `&limit=` (clamped).
 * https://docs.mapbox.com/api/search/search-box/#get-suggestions
 */
export function buildPlaceSuggestUrl(
  base: string,
  token: string,
  trimmedQuery: string,
  sessionToken: string,
  opts: PlaceSearchOpts = {},
): string {
  let url =
    `${base}/suggest` +
    `?q=${encodeURIComponent(trimmedQuery)}` +
    `&session_token=${encodeURIComponent(sessionToken)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&types=${PLACE_SUGGEST_TYPES}`;
  // country = ISO alpha-2 bias, derived from the trailing-country strip. Only
  // appended when non-empty (a bare/unrecognized query yields no country).
  if (opts.country) url += `&country=${encodeURIComponent(opts.country)}`;
  // proximity stays supported for forward-compat; the Preferences field omits it
  // (OQ-4 — device proximity buries a place the user is NOT at; evidence §3).
  if (opts.proximity) url += `&proximity=${encodeURIComponent(opts.proximity)}`;
  url += `&limit=${clampSuggestLimit(opts.limit)}`;
  return url;
}

/**
 * ORCH-1361 — build the Search Box `/forward` URL. The `proximity` rank bias is
 * appended ONLY when present; `limit` stays 1 (forward is single-result). NO
 * `types`/`country` filter (INV-3 / ORCH-1079). Empty `opts` → byte-identical to
 * the pre-1361 builder: `?q&access_token&limit=1` (SC-6).
 */
export function buildForwardUrl(
  base: string,
  token: string,
  trimmedQuery: string,
  opts: SearchOpts = {},
): string {
  let url =
    `${base}/forward` +
    `?q=${encodeURIComponent(trimmedQuery)}` +
    `&access_token=${encodeURIComponent(token)}`;
  // Rank-only bias — proximity does NOT exclude any result (INV-3 / ORCH-1079).
  if (opts.proximity) url += `&proximity=${encodeURIComponent(opts.proximity)}`;
  url += `&limit=1`;
  return url;
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

export interface MapboxFeature {
  geometry?: { coordinates?: [number, number] }; // [lng, lat]
  properties?: {
    mapbox_id?: string;
    name?: string;
    feature_type?: string;
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
  opts: SearchOpts = {},
): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return jsonResponse({ error: "query_too_short" }, 400);
  }

  // ORCH-1361 — additive proximity rank bias + limit (default 5 →
  // byte-identical when omitted). URL built via the pure, unit-tested builder.
  const url = buildSuggestUrl(
    MAPBOX_SEARCHBOX_BASE,
    token,
    trimmed,
    sessionToken,
    opts,
  );

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
  // ORCH-1361 — cap to the SAME effective limit sent upstream (default 5 →
  // byte-identical to the pre-1361 `.slice(0, 5)`; consumer opts into 8) so the
  // requested row count actually reaches the caller instead of a hardcoded 5.
  const effectiveLimit = clampSuggestLimit(opts.limit);
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
    .slice(0, effectiveLimit);

  return jsonResponse({ suggestions });
}

/**
 * ORCH-1365 [location-search-relevance] — CONSUMER place search.
 * https://docs.mapbox.com/api/search/search-box/#get-suggestions
 *
 * Distinct from `handleSuggest` (business venue-name search) in exactly three
 * ways, ALL isolated to this handler + `buildPlaceSuggestUrl`:
 *   1. `types=place,locality,neighborhood,region,district` → drops POI noise so
 *      the real PLACE surfaces (evidence probe B).
 *   2. a recognized TRAILING COUNTRY token is stripped from `q` and re-applied as
 *      a Mapbox `country` ISO bias — the fix for "lekki nigeria" (probe G/N; a
 *      country filter WITHOUT stripping does not work — probe J).
 *   3. NO proximity for the Preferences field (OQ-4) — a "search a place you are
 *      NOT at" field must not bias to the device (evidence §3).
 * Normalization + error contract are IDENTICAL to `handleSuggest`.
 *
 * ── ORCH-1365-INC-1 [ambiguous country / US-state collision] · SPEC §12.3 ─────
 *   4. ZERO-RESULT FALLBACK. `parseTrailingCountry` is a blunt English
 *      country-name map, so a US-state name that is also a country ("atlanta
 *      georgia" → country=ge, Georgia the COUNTRY) over-strips and the biased
 *      first call returns EMPTY (Atlanta is not in Georgia the country —
 *      evidence R1-a). The strip is NOT modified (the tester's ADV-A1 rows stay
 *      green); it is RECOVERED here: iff a `country` was applied AND the biased
 *      call is HTTP-ok with zero mapped suggestions, retry ONCE with the FULL
 *      original query (no strip, no country), REUSING the session_token (Mapbox
 *      bills one session → no new billing surface). Keeping "georgia" in the
 *      fallback query ranks Atlanta-GA #1 (evidence R1-b) and self-corrects any
 *      "<place> <country-word>" where the place is not in that country. The
 *      common paths ("lekki nigeria" non-empty, single tokens, non-stripped
 *      queries, and the genuine "tbilisi georgia" country intent) make EXACTLY
 *      one upstream call (the biased call is non-empty → no fallback).
 */
async function handleSuggestPlaces(
  token: string,
  rawQuery: string,
  sessionToken: string,
  opts: SearchOpts = {},
): Promise<Response> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 3) {
    return jsonResponse({ error: "query_too_short" }, 400);
  }

  // Strip a recognized trailing country name → { query, country }. The parser
  // guards single-token + bare-country queries (never returns an empty query).
  const parsed = parseTrailingCountry(trimmed);
  // OQ-3 defensive fallback — if a strip somehow left an empty query, search the
  // un-stripped text (a bare country name still resolves the country/region).
  const query = parsed.query.length > 0 ? parsed.query : trimmed;
  const country = parsed.query.length > 0 ? parsed.country : undefined;

  // Biased first call — strip + `country` ISO bias (today's behavior, unchanged).
  const first = await placeSuggestOnce(token, query, sessionToken, {
    ...opts,
    country,
  });
  // Non-OK upstream (network/5xx) → return today's error contract UNCHANGED. Do
  // NOT mask a transport error as an empty fallback (SPEC §12.4). This preserves
  // the existing suggest_exception / mapbox_<status> contract.
  if ("errorResponse" in first) return first.errorResponse;

  // ORCH-1365-INC-1 zero-result fallback (SPEC §12.3). Fires IFF a `country` was
  // applied (a strip happened) AND the biased call returned HTTP-ok with zero
  // mapped suggestions (over-strip / place-not-in-country). Retry ONCE with the
  // FULL `trimmed` original query, no strip + no country, reusing the same
  // session_token. `{ ...opts, country: undefined }` keeps limit/proximity and
  // still routes through `buildPlaceSuggestUrl` (types filter stays applied →
  // POIs still dropped).
  if (country && first.suggestions.length === 0) {
    const fb = await placeSuggestOnce(token, trimmed, sessionToken, {
      ...opts,
      country: undefined,
    });
    // A fallback that itself errors or empties → terminal { suggestions: [] }
    // (HTTP 200) — the same "no results" state as an empty biased call today. Do
    // NOT surface a fresh 5xx from the retry (SPEC §12.4).
    return jsonResponse({
      suggestions: "errorResponse" in fb ? [] : fb.suggestions,
    });
  }

  return jsonResponse({ suggestions: first.suggestions });
}

/**
 * ORCH-1365-INC-1 (SPEC §12.3) — ONE consumer place `/suggest` round-trip:
 * build URL (via `buildPlaceSuggestUrl` → types filter + optional country bias)
 * → fetch → check `upstream.ok` → parse JSON → map to
 * `{ placeId, displayName, fullAddress }` → slice to the effective limit. A pure
 * refactor of the previous `handleSuggestPlaces` body — behavior of the biased
 * call is unchanged. Returns `{ suggestions }` on HTTP-ok, or `{ errorResponse }`
 * (the exact `suggest_exception` / `mapbox_<status>` Response the handler used to
 * return inline) so the caller can decide whether to fall back. Defined AFTER
 * `handleSuggestPlaces` so the `buildPlaceSuggestUrl` call site stays on the
 * consumer side of the isolation wall (never inside `handleSuggest`).
 */
async function placeSuggestOnce(
  token: string,
  query: string,
  sessionToken: string,
  opts: PlaceSearchOpts = {},
): Promise<
  | {
    suggestions: Array<
      { placeId: string; displayName: string; fullAddress: string }
    >;
  }
  | { errorResponse: Response }
> {
  const url = buildPlaceSuggestUrl(
    MAPBOX_SEARCHBOX_BASE,
    token,
    query,
    sessionToken,
    opts,
  );

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (e) {
    console.error("[mapbox-geocode] suggest_places fetch error:", e);
    return {
      errorResponse: jsonResponse(
        { error: "suggest_exception", suggestions: [] },
        502,
      ),
    };
  }

  if (!upstream.ok) {
    console.warn("[mapbox-geocode] suggest_places non-OK:", upstream.status);
    return {
      errorResponse: jsonResponse(
        { error: `mapbox_${upstream.status}`, suggestions: [] },
        upstream.status >= 500 ? 502 : upstream.status,
      ),
    };
  }

  const data = (await upstream.json()) as SuggestRawResponse;
  const effectiveLimit = clampSuggestLimit(opts.limit);
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
    .slice(0, effectiveLimit);

  return { suggestions };
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
async function handleForward(
  token: string,
  query: string,
  opts: SearchOpts = {},
): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return jsonResponse({ error: "query_required" }, 400);
  }

  // ORCH-1361 — additive proximity rank bias; limit stays 1. URL built via the
  // pure, unit-tested builder (byte-identical when opts empty).
  const url = buildForwardUrl(MAPBOX_SEARCHBOX_BASE, token, trimmed, opts);

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

type HierarchyMatchLevel = "place" | "city" | "country";
type HierarchyDetails = {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  countryCode: string | null;
};

const HIERARCHY_ADMIN_TYPES =
  "place,city,locality,district,neighborhood";
const STREET_DESIGNATORS = new Set([
  "avenue",
  "close",
  "court",
  "drive",
  "expressway",
  "highway",
  "lane",
  "road",
  "street",
  "way",
]);

/** Comparison-only normalization. The caller's original label is never changed. */
export function normalizeHierarchyName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function explicitCountryIso(query: string): string | null {
  const normalized = normalizeHierarchyName(query);
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
  const normalized = normalizeHierarchyName(value);
  if (normalized.length === 0 || /\d/.test(normalized)) return false;
  const words = normalized.split(" ");
  return !words.every((word) => STREET_DESIGNATORS.has(word));
}

/** Only user-supplied suffixes become locality authority. */
export function deriveHierarchyLocalities(query: string): string[] {
  const countryIso = explicitCountryIso(query);
  const withoutCountry = stripExplicitCountry(query, countryIso);
  const commaParts = withoutCountry
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidates: string[] = [];
  if (commaParts.length > 1) {
    for (const part of commaParts.slice(1).reverse()) {
      if (isSafeLocalityCandidate(part)) candidates.push(part);
    }
  }
  const trailingTokens = withoutCountry.trim().split(/\s+/).filter(Boolean);
  for (let count = 1; count <= Math.min(3, trailingTokens.length); count += 1) {
    const candidate = trailingTokens.slice(-count).join(" ");
    if (isSafeLocalityCandidate(candidate)) candidates.push(candidate);
  }
  return [...new Map(
    candidates.map((candidate) => [normalizeHierarchyName(candidate), candidate]),
  ).values()];
}

function featureCoordinates(
  feature: MapboxFeature,
): { lat: number; lng: number } | null {
  const coords = feature.geometry?.coordinates;
  const lng = coords?.[0];
  const lat = coords?.[1];
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return { lat, lng };
}

function featureCountryCode(feature: MapboxFeature): string | null {
  const code = feature.properties?.context?.country?.country_code;
  return typeof code === "string" && /^[a-z]{2}$/i.test(code)
    ? code.toUpperCase()
    : null;
}

function featureAdministrativeNames(feature: MapboxFeature): string[] {
  const context = feature.properties?.context;
  return [
    context?.place?.name,
    context?.locality?.name,
    context?.district?.name,
    context?.region?.name,
  ]
    .filter((name): name is string => typeof name === "string")
    .map(normalizeHierarchyName)
    .filter(Boolean);
}

const HIERARCHY_CITY_FEATURE_TYPES = new Set([
  "place",
  "city",
  "locality",
  "district",
]);

export function featureToHierarchyDetails(
  feature: MapboxFeature,
  matchLevel: HierarchyMatchLevel,
): HierarchyDetails | null {
  const coords = featureCoordinates(feature);
  if (coords === null) return null;
  const context = feature.properties?.context;
  const featureName =
    typeof feature.properties?.name === "string"
      ? feature.properties.name
      : null;
  const featureType = normalizeHierarchyName(
    feature.properties?.feature_type ?? "",
  );
  const featureOwnsCity =
    matchLevel === "city" || HIERARCHY_CITY_FEATURE_TYPES.has(featureType);
  const city =
    matchLevel === "country"
      ? null
      : context?.place?.name ??
        context?.locality?.name ??
        context?.district?.name ??
        (featureOwnsCity ? featureName : null);
  return {
    ...coords,
    city: city ?? null,
    region: context?.region?.name ?? null,
    countryCode: featureCountryCode(feature),
  };
}

/** Saved context is authority only when the new query independently names it. */
export function hierarchyQueryContainsName(
  query: string,
  contextName: string,
): boolean {
  const queryTokens = normalizeHierarchyName(query).split(" ").filter(Boolean);
  const contextTokens = normalizeHierarchyName(contextName)
    .split(" ")
    .filter(Boolean);
  if (contextTokens.length === 0 || contextTokens.length > queryTokens.length) {
    return false;
  }
  return queryTokens.some((_, start) =>
    contextTokens.every((token, offset) => queryTokens[start + offset] === token)
  );
}

export function savedHierarchyContextForQuery(
  query: string,
  savedContext:
    | { city?: string | null; country_code?: string | null }
    | null
    | undefined,
): { city: string | null; countryIso: string | null } {
  const city =
    typeof savedContext?.city === "string" && savedContext.city.trim().length > 0
      ? savedContext.city.trim()
      : null;
  if (city === null || !hierarchyQueryContainsName(query, city)) {
    return { city: null, countryIso: null };
  }
  const countryIso =
    typeof savedContext?.country_code === "string" &&
      /^[a-z]{2}$/i.test(savedContext.country_code)
      ? savedContext.country_code.toUpperCase()
      : null;
  return { city, countryIso };
}

export function hierarchyFeatureMatches(params: {
  feature: MapboxFeature;
  localityCandidates: string[];
  requiredCountryIso: string | null;
  requireLocality: boolean;
  includeFeatureName?: boolean;
}): boolean {
  const {
    feature,
    localityCandidates,
    requiredCountryIso,
    requireLocality,
    includeFeatureName = false,
  } = params;
  if (featureCoordinates(feature) === null) return false;
  const countryCode = featureCountryCode(feature);
  if (
    requiredCountryIso !== null &&
    countryCode !== requiredCountryIso.toUpperCase()
  ) {
    return false;
  }
  if (!requireLocality) return true;
  const adminNames = new Set(featureAdministrativeNames(feature));
  if (includeFeatureName && typeof feature.properties?.name === "string") {
    adminNames.add(normalizeHierarchyName(feature.properties.name));
  }
  return localityCandidates.some((candidate) =>
    adminNames.has(normalizeHierarchyName(candidate))
  );
}

export function buildHierarchyForwardUrl(params: {
  base: string;
  token: string;
  query: string;
  types?: string;
  countryIso?: string | null;
}): string {
  let url =
    `${params.base}/forward?q=${encodeURIComponent(params.query.trim())}` +
    `&access_token=${encodeURIComponent(params.token)}`;
  if (params.types) url += `&types=${encodeURIComponent(params.types)}`;
  if (params.countryIso) {
    url += `&country=${encodeURIComponent(params.countryIso.toLowerCase())}`;
  }
  return `${url}&limit=10`;
}

async function fetchHierarchyFeatures(
  url: string,
): Promise<MapboxFeature[] | Response> {
  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (error) {
    console.error("[mapbox-geocode] forward_hierarchy fetch error:", error);
    return jsonResponse({ error: "forward_hierarchy_exception" }, 502);
  }
  if (!upstream.ok) {
    return jsonResponse(
      { error: `mapbox_${upstream.status}` },
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }
  const data = (await upstream.json()) as RetrieveRawResponse;
  return data.features ?? [];
}

async function handleForwardHierarchy(
  token: string,
  query: string,
  savedContext: RequestBody["saved_context"],
): Promise<Response> {
  const rawQuery = query.trim();
  if (rawQuery.length === 0) {
    return jsonResponse({ details: null, reason: "needs_context" });
  }
  const explicitIso = explicitCountryIso(rawQuery);
  const usableSavedContext = savedHierarchyContextForQuery(
    rawQuery,
    savedContext,
  );
  const requiredIso = explicitIso ?? usableSavedContext.countryIso;
  const localities = deriveHierarchyLocalities(rawQuery);
  if (usableSavedContext.city !== null) {
    localities.push(usableSavedContext.city);
  }

  const placeResult = await fetchHierarchyFeatures(
    buildHierarchyForwardUrl({
      base: MAPBOX_SEARCHBOX_BASE,
      token,
      query: rawQuery,
      countryIso: requiredIso,
    }),
  );
  if (placeResult instanceof Response) return placeResult;
  const acceptedPlace = localities.length > 0
    ? placeResult.find((feature) =>
      hierarchyFeatureMatches({
        feature,
        localityCandidates: localities,
        requiredCountryIso: requiredIso,
        requireLocality: true,
      })
    )
    : undefined;
  if (acceptedPlace) {
    const details = featureToHierarchyDetails(acceptedPlace, "place");
    if (details !== null) {
      return jsonResponse({
        details,
        matchLevel: "place",
        matchedQuery: rawQuery,
      });
    }
  }

  for (const locality of localities) {
    const cityResult = await fetchHierarchyFeatures(
      buildHierarchyForwardUrl({
        base: MAPBOX_SEARCHBOX_BASE,
        token,
        query: locality,
        types: HIERARCHY_ADMIN_TYPES,
        countryIso: requiredIso,
      }),
    );
    if (cityResult instanceof Response) return cityResult;
    const acceptedCity = cityResult.find((feature) =>
      hierarchyFeatureMatches({
        feature,
        localityCandidates: [locality],
        requiredCountryIso: requiredIso,
        requireLocality: true,
        includeFeatureName: true,
      })
    );
    if (acceptedCity) {
      const details = featureToHierarchyDetails(acceptedCity, "city");
      if (details !== null) {
        return jsonResponse({
          details,
          matchLevel: "city",
          matchedQuery: locality,
        });
      }
    }
  }

  const acceptedCityCountry = requiredIso;
  if (acceptedCityCountry !== null) {
    const countryResult = await fetchHierarchyFeatures(
      buildHierarchyForwardUrl({
        base: MAPBOX_SEARCHBOX_BASE,
        token,
        query: acceptedCityCountry,
        types: "country",
        countryIso: acceptedCityCountry,
      }),
    );
    if (countryResult instanceof Response) return countryResult;
    const acceptedCountry = countryResult.find((feature) =>
      hierarchyFeatureMatches({
        feature,
        localityCandidates: [],
        requiredCountryIso: acceptedCityCountry,
        requireLocality: false,
      })
    );
    if (acceptedCountry) {
      const details = featureToHierarchyDetails(acceptedCountry, "country");
      if (details !== null) {
        return jsonResponse({
          details: { ...details, city: null },
          matchLevel: "country",
          matchedQuery: acceptedCityCountry,
        });
      }
    }
  }
  return jsonResponse({ details: null, reason: "needs_context" });
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

  // ORCH-1361 — collect the ADDITIVE rank bias (suggest/forward only). Each is
  // threaded only when it's a non-empty value of the right type; anything omitted
  // stays undefined → the URL builders skip it → byte-identical request (SC-6).
  // NO `types`/`country` filter — the suggest handler stays filter-free so
  // business venue-name search still returns POIs (INV-3 / ORCH-1079).
  // retrieve/reverse never read these.
  const searchOpts: SearchOpts = {
    proximity:
      typeof body.proximity === "string" && body.proximity.length > 0
        ? body.proximity
        : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };

  switch (body.action) {
    case "suggest":
      return handleSuggest(token, body.query ?? "", sessionToken, searchOpts);
    case "suggest_places":
      // ORCH-1365 — consumer place search (types filter + trailing-country strip
      // + country bias, no proximity). Business `suggest` above is untouched.
      return handleSuggestPlaces(
        token,
        body.query ?? "",
        sessionToken,
        searchOpts,
      );
    case "retrieve":
      return handleRetrieve(token, body.mapbox_id ?? "", sessionToken);
    case "reverse":
      return handleReverse(
        token,
        typeof body.latitude === "number" ? body.latitude : NaN,
        typeof body.longitude === "number" ? body.longitude : NaN,
      );
    case "forward":
      return handleForward(token, body.query ?? "", searchOpts);
    case "forward_hierarchy":
      return handleForwardHierarchy(
        token,
        body.query ?? "",
        body.saved_context,
      );
    default:
      return jsonResponse({ error: "invalid_request" }, 400);
  }
}

if (import.meta.main) {
  serve(handler);
}
