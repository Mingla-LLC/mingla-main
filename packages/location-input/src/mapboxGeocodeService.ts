/**
 * @mingla/location-input · mapboxGeocodeService
 *
 * Shared Mapbox Search Box autocomplete + retrieve (+ reverse/forward) for the
 * address/city picker, consumed by BOTH mingla-business (experience stops) and
 * app-mobile (consumer discover/preferences/onboarding). Extracted from
 * mingla-business/src/services/mapboxGeocodeService.ts per META-ORCH-1060 §3.2.
 *
 * All calls proxy through the `mapbox-geocode` Supabase edge fn so the
 * MAPBOX_ACCESS_TOKEN stays server-side. Each app has its OWN supabase
 * singleton, so the caller INJECTS `invoke` (its `supabase.functions.invoke`).
 *
 * Edge fn contract (single endpoint, action discriminator):
 *   invoke("mapbox-geocode", { body: { action: "suggest",  query, session_token } })
 *     → { suggestions: PlaceAutocompleteSuggestion[] } | { error }
 *   invoke("mapbox-geocode", { body: { action: "retrieve", mapbox_id, session_token } })
 *     → { details: PlaceDetails } | { error }
 *   invoke("mapbox-geocode", { body: { action: "reverse",  latitude, longitude } })
 *     → { details: PlaceDetails } | { error }
 *   invoke("mapbox-geocode", { body: { action: "forward",  query } })
 *     → { details: PlaceDetails } | { error }
 *
 * Session token: one client-generated UUID per autocomplete session, reused
 * across the suggest→retrieve pair (Mapbox bills the pair as ONE session —
 * https://docs.mapbox.com/api/search/search-box/#session-billing). reverse +
 * forward are per-request (no session token).
 *
 * Error contract:
 *   - autocompleteMapbox() returns [] on failure (silent type-ahead fallback).
 *   - retrieveMapboxPlace() / reverse / forward THROW on failure, preserving the
 *     edge fn's error code (mapbox_access_token_missing | no_locality |
 *     no_location | coordinates_required | mapbox_<status>) so callers can map
 *     to user-friendly copy.
 */

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  displayName: string;
  fullAddress: string;
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  /** Locality (city) — required; the edge fn 500s if not derivable. */
  city: string;
  /** Region display name (e.g. "England", "North Carolina") — nullable. */
  region: string | null;
  /**
   * META-ORCH-1060: ISO 3166-2 subdivision code (e.g. "NC") — STRUCTURED from
   * Mapbox context.region.region_code, NEVER parsed from a display string.
   * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
   */
  regionCode: string | null;
  /** META-ORCH-1060: prefixed subdivision (e.g. "US-NC") — STRUCTURED. */
  regionCodeFull: string | null;
  /** ISO 3166-1 alpha-2 (e.g. "GB", "US") — nullable. */
  countryCode: string | null;
  location: { lat: number; lng: number };
  /**
   * Issue #1629 — Mapbox's own `properties.feature_type`, passed through
   * STRUCTURED (never parsed from a display string). This is how precise the
   * coordinate is: `address`/`poi` are a real point for that entity, everything
   * else is an area centroid. The client used to ASSERT precision instead of
   * reading it — every pick was hardcoded "approximate", so `exact` was
   * unreachable and 0 production rows carried it.
   * Optional so pre-#1629 callers/fixtures keep compiling; absent → approximate.
   * https://docs.mapbox.com/api/search/search-box/
   */
  featureType?: string | null;
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
) => Promise<{ data: any; error: { message?: string } | null }>;

/**
 * ORCH-1361 [location-suggestions] — OPTIONAL Mapbox Search Box RANKING bias,
 * threaded from the consumer host's device location. ADDITIVE: every field is
 * optional and each is forwarded to the edge fn ONLY when present, so a caller
 * that omits `bias` (business pickers, consumer geocodingService adapter)
 * produces a BYTE-IDENTICAL request to the pre-1361 behavior. Without proximity,
 * Mapbox defaults to IP proximity (the edge datacenter) and mis-ranks results.
 *
 * NO `types`/`country` FILTER (INV-3 / ORCH-1079): the shared suggest handler
 * also serves BUSINESS venue-name search (POIs must resolve), and a `country`
 * filter would over-restrict an "explore anywhere" field. `proximity` biases
 * RANKING without excluding any result — that is the fix.
 * Doc-verified formats (https://docs.mapbox.com/api/search/search-box/):
 *   proximity "longitude,latitude"; limit ≤ 10 (suggest only — forward stays
 *   single-result).
 */
export interface LocationBias {
  proximity?: string;
  limit?: number;
}

const MIN_QUERY_LENGTH = 3;

/** Generate one Mapbox session token (UUID) per autocomplete session. Reuse
 *  the SAME token across the suggest→retrieve pair for correct session billing. */
export function newMapboxSessionToken(): string {
  // RN runtimes lack crypto.randomUUID; build a v4-shaped UUID from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Type-ahead autocomplete. Returns up to 5 suggestions. Empty array on any
 * failure or when query.length < 3. Silent fallback — type-ahead failures
 * during keystrokes are not user-actionable.
 * https://docs.mapbox.com/api/search/search-box/#get-suggestions
 */
export async function autocompleteMapbox(
  query: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<PlaceAutocompleteSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  try {
    const { data, error } = await deps.invoke("mapbox-geocode", {
      // ORCH-1361 — proximity rank bias + limit merged ONLY when present;
      // omitted → byte-identical. NO types/country filter (INV-3 / ORCH-1079).
      body: {
        action: "suggest",
        query: q,
        session_token: sessionToken,
        ...(bias?.proximity ? { proximity: bias.proximity } : {}),
        ...(bias?.limit ? { limit: bias.limit } : {}),
      },
    });
    if (error) {
      console.warn("[mapboxGeocodeService] suggest error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data.suggestions)) return [];
    return data.suggestions as PlaceAutocompleteSuggestion[];
  } catch (e) {
    console.warn("[mapboxGeocodeService] suggest throw:", e);
    return [];
  }
}

/**
 * ORCH-1365 [location-search-relevance] — CONSUMER place-search type-ahead.
 * Same shape + silent-[]-on-failure contract as `autocompleteMapbox`, but posts
 * the ADDITIVE `action: "suggest_places"` so the edge fn applies its place-type
 * filter + trailing-country strip + `country` ISO bias (POIs dropped; the real
 * PLACE surfaces for a non-Lagos user — evidence/ORCH-1365). The business
 * `autocompleteMapbox` (venue-name search) is UNCHANGED and filter-free
 * (INV-3 / ORCH-1079).
 *
 * NO proximity for the Preferences field (OQ-4) — a "search a place you are NOT
 * at" field must not bias to the device. `bias.proximity` is kept optional +
 * forwarded ONLY when a caller passes it (Preferences passes none); `limit` is
 * merged when present. `country` is DERIVED server-side from the query, never
 * client-supplied.
 * https://docs.mapbox.com/api/search/search-box/#get-suggestions
 */
export async function autocompletePlacesMapbox(
  query: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<PlaceAutocompleteSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  try {
    const { data, error } = await deps.invoke("mapbox-geocode", {
      body: {
        action: "suggest_places",
        query: q,
        session_token: sessionToken,
        ...(bias?.proximity ? { proximity: bias.proximity } : {}),
        ...(bias?.limit ? { limit: bias.limit } : {}),
      },
    });
    if (error) {
      console.warn("[mapboxGeocodeService] suggest_places error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data.suggestions)) return [];
    return data.suggestions as PlaceAutocompleteSuggestion[];
  } catch (e) {
    console.warn("[mapboxGeocodeService] suggest_places throw:", e);
    return [];
  }
}

/**
 * Retrieve full place details after the user picks a suggestion. Extracts
 * structured city + region + regionCode + countryCode + lat/lng. THROWS on any
 * failure (callers must surface the error to the user).
 * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 */
export async function retrieveMapboxPlace(
  placeId: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
): Promise<PlaceDetails> {
  if (!placeId) throw new Error("MAPBOX_ID_REQUIRED");

  const { data, error } = await deps.invoke("mapbox-geocode", {
    body: { action: "retrieve", mapbox_id: placeId, session_token: sessionToken },
  });

  if (error) {
    throw new Error(error.message ?? "mapbox_proxy_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_proxy_empty_response");
  }
  return data.details as PlaceDetails;
}

/**
 * Reverse-geocode coordinates → PlaceDetails (city/region/regionCode/country).
 * Per-request (no session token). THROWS on failure.
 * https://docs.mapbox.com/api/search/search-box/ (reverse) ·
 * https://docs.mapbox.com/api/search/geocoding/ (v6 fallback)
 */
export async function reverseGeocodeMapbox(
  latitude: number,
  longitude: number,
  deps: { invoke: InvokeFn },
): Promise<PlaceDetails> {
  const { data, error } = await deps.invoke("mapbox-geocode", {
    body: { action: "reverse", latitude, longitude },
  });
  if (error) {
    throw new Error(error.message ?? "mapbox_reverse_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_reverse_empty_response");
  }
  return data.details as PlaceDetails;
}

/**
 * Forward-geocode free text → PlaceDetails. Single-call (no session token).
 * THROWS on failure.
 * https://docs.mapbox.com/api/search/search-box/ (forward) ·
 * https://docs.mapbox.com/api/search/geocoding/ (v6 fallback)
 */
export async function forwardGeocodeMapbox(
  query: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<PlaceDetails> {
  const q = query.trim();
  if (q.length === 0) throw new Error("query_required");

  const { data, error } = await deps.invoke("mapbox-geocode", {
    // ORCH-1361 — forward is single-result (no `limit`); the proximity rank bias
    // is merged ONLY when present so an unbiased caller is byte-identical. NO
    // types/country filter (INV-3 / ORCH-1079).
    body: {
      action: "forward",
      query: q,
      ...(bias?.proximity ? { proximity: bias.proximity } : {}),
    },
  });
  if (error) {
    throw new Error(error.message ?? "mapbox_forward_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_forward_empty_response");
  }
  return data.details as PlaceDetails;
}

/**
 * Issue #1363 — context-validated place → city → country resolution.
 * Expected no-safe-anchor responses are data, while provider/transport failures
 * throw so hosts can render a distinct retry state.
 */
export async function forwardHierarchyMapbox(
  query: string,
  savedContext: SavedLocationContext,
  deps: { invoke: InvokeFn },
): Promise<HierarchicalForwardResult> {
  if (query.trim().length === 0) {
    return { details: null, reason: "needs_context" };
  }
  const { data, error } = await deps.invoke("mapbox-geocode", {
    body: {
      action: "forward_hierarchy",
      query: query.trim(),
      saved_context: {
        ...(savedContext.city?.trim()
          ? { city: savedContext.city.trim() }
          : {}),
        ...(savedContext.countryCode?.trim()
          ? { country_code: savedContext.countryCode.trim().toUpperCase() }
          : {}),
      },
    },
  });
  if (error) {
    throw new Error(error.message ?? "mapbox_forward_hierarchy_failed");
  }
  if (data?.details === null && data?.reason === "needs_context") {
    return { details: null, reason: "needs_context" };
  }
  if (
    !data?.details ||
    !["place", "city", "country"].includes(data.matchLevel) ||
    typeof data.matchedQuery !== "string"
  ) {
    throw new Error("mapbox_forward_hierarchy_empty_response");
  }
  return data as HierarchicalForwardResult;
}

/**
 * Issue #1629 — derive coordinate precision from Mapbox's OWN feature type
 * instead of asserting it.
 *
 * THE DEFECT THIS REPLACES: every business address surface hardcoded
 * `coordinatePrecision: "approximate"` inside `onPick` — the branch that fires
 * when a brand picks a REAL suggestion. `"exact"` existed in the type and was
 * unreachable; production carried 0 exact rows across events, venue_listings
 * and experience_stops. #1373's "Approximate location" caption would therefore
 * have appeared on every venue, event and trip, including precise ones.
 *
 * Mapbox's documented taxonomy (https://docs.mapbox.com/api/search/search-box/):
 *   address — "individual residential or business addresses as a street with
 *             house number"           → a real point  → EXACT
 *   poi     — a specific business/landmark             → a real point → EXACT
 *   street  — "the street, with no house number"       → area        → approximate
 *   country | region | postcode | district | place | locality |
 *   neighborhood | block                                → centroid    → approximate
 *
 * UNKNOWN OR MISSING → "approximate", deliberately. Over-claiming precision is
 * fabricated data (Constitution rule 9) and a lie the user cannot detect;
 * under-claiming is conservative and visible. This is the OPPOSITE default to
 * #1622's failure classifier — same principle, inverted inputs: choose the
 * direction whose failure mode is VISIBLE rather than silent.
 */
const EXACT_FEATURE_TYPES: ReadonlySet<string> = new Set(["address", "poi"]);

export function precisionFromPlaceDetails(
  details: Pick<PlaceDetails, "featureType"> | null | undefined,
): "exact" | "approximate" {
  const ft = details?.featureType;
  if (typeof ft !== "string") return "approximate";
  return EXACT_FEATURE_TYPES.has(ft.trim().toLowerCase()) ? "exact" : "approximate";
}
