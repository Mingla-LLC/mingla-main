/**
 * Ve2 — debounced place_pool search via claim-search-pool edge function.
 *
 * ORCH-1263 §B1 — the row mapper grows the presence facts + claimState +
 * venueCategoryConfident (old-fn tolerant defaults: booleans false, count 0,
 * claimState "available"), and `fetchPlaceAdoptionDetail` fetches the FULL
 * adoption payload via the same edge fn's `{place_id}` detail mode — fired
 * ONLY on explicit claim intent ("Yes, this is me"), shared 10/min bucket.
 */

import type {
  PoolAdoptionDetail,
  PoolMatch,
  PoolSearchResponse,
} from "../types/poolMatch";
import {
  POOL_SEARCH_DEFAULT_LIMIT,
  POOL_SEARCH_MIN_QUERY_LENGTH,
} from "../types/poolMatch";
import { supabase } from "./supabase";

/** ORCH-1263 — typed 404 for the detail mode's `place_not_available`. */
export class PlaceNotAvailableError extends Error {
  constructor() {
    super("place_not_available");
    this.name = "PlaceNotAvailableError";
  }
}

function asOptionalString(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function mapMatchRow(raw: Record<string, unknown>): PoolMatch {
  const claimState = raw.claimState === "claimed" || raw.claimState === "pending"
    ? raw.claimState
    : "available";
  return {
    id: String(raw.id),
    name: String(raw.name),
    address: asOptionalString(raw.address),
    city: asOptionalString(raw.city),
    country: asOptionalString(raw.country),
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    googlePlaceId: asOptionalString(raw.googlePlaceId),
    primaryPhotoUrl: asOptionalString(raw.primaryPhotoUrl),
    primaryType: asOptionalString(raw.primaryType),
    types: Array.isArray(raw.types) ? raw.types.map(String) : [],
    venueCategory: raw.venueCategory as PoolMatch["venueCategory"],
    openingHours: raw.openingHours ?? null,
    photoUrls: Array.isArray(raw.photoUrls)
      ? raw.photoUrls.map(String)
      : [],
    // ORCH-1263 §B1 — old-fn tolerance: absent fields default false/0/available
    // (pre-1263 edge shape keeps the shipped wizard working; the 23505 submit
    // backstop still guards the race).
    hasHours: raw.hasHours === true,
    hasPhone: raw.hasPhone === true,
    hasWebsite: raw.hasWebsite === true,
    hasRating: raw.hasRating === true,
    photoCount: typeof raw.photoCount === "number" && raw.photoCount > 0
      ? raw.photoCount
      : 0,
    claimState,
    venueCategoryConfident: raw.venueCategoryConfident === true,
  };
}

/** #3040 B-C17 — the HTTP status behind a supabase-js FunctionsHttpError. */
export const poolSearchHttpStatus = (error: unknown): number | null => {
  if (error === null || typeof error !== "object") return null;
  const context = (error as { context?: { status?: unknown } }).context;
  return context !== undefined && typeof context?.status === "number" ? context.status : null;
};

/**
 * Search place_pool by name (authenticated). Returns [] when query too short.
 */
export async function searchPoolMatches(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<PoolMatch[]> {
  const q = query.trim();
  if (q.length < POOL_SEARCH_MIN_QUERY_LENGTH) {
    return [];
  }

  const invoke = (): ReturnType<typeof supabase.functions.invoke> =>
    supabase.functions.invoke("claim-search-pool", {
      body: {
        query: q,
        limit: POOL_SEARCH_DEFAULT_LIMIT,
        fetch_all: true,
      },
      // #3040 B-C17 [A-17] — a superseded keystroke's search is cancelled for
      // real, so it stops spending the 10-per-minute rate budget.
      signal: options.signal,
    });

  const aborted = (): boolean => options.signal?.aborted === true;
  let { data, error } = await invoke();
  // #3040 B-C17 — one quiet retry after 1 s for a server hiccup (5xx).
  if (error !== null && (poolSearchHttpStatus(error) ?? 0) >= 500 && !aborted()) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    if (aborted()) throw error;
    ({ data, error } = await invoke());
  }

  if (error !== null) {
    // #3040 B-C17 [A-17] — a 429 arrives as a FunctionsHttpError whose message
    // is generic, so the hook read it as "check your connection". Name it.
    if (poolSearchHttpStatus(error) === 429) throw new Error("rate_limited");
    const status = poolSearchHttpStatus(error);
    if (status !== null && status >= 500) throw new Error("search_unavailable");
    throw error;
  }

  const body = data as PoolSearchResponse | { error?: string };
  if (body !== null && typeof body === "object" && "error" in body) {
    const code = String((body as { error: string }).error);
    if (code === "rate_limited") {
      throw new Error("rate_limited");
    }
    throw new Error(code);
  }

  const matches = (body as PoolSearchResponse)?.matches ?? [];
  return matches.map((m) =>
    mapMatchRow(m as unknown as Record<string, unknown>),
  );
}

/**
 * Issue #1648 — resolve a PICKED address to a place we already hold.
 *
 * Same response shape as `searchPoolMatches` (the edge fn reuses
 * `rowToPoolMatch`), so the gate's `ClaimMatchCard` renders it unchanged and the
 * presence facts / claim state stay authoritative. Returns null when Google has
 * no confident answer or the resolved place simply is not in our pool — both
 * are ordinary outcomes for a genuinely new venue.
 *
 * NEVER swallows an upstream failure into `null`. The edge fn answers 502
 * `resolve_unavailable` when Google is unreachable, and reporting that as "we
 * don't know you" would push a venue we DO hold into create-from-scratch — the
 * exact duplicate this whole path exists to prevent (#1620's lesson: a monitor
 * that cannot report failure reports success).
 */
export async function matchPoolByAddress(input: {
  formattedAddress: string;
  lat: number;
  lng: number;
}): Promise<PoolMatch | null> {
  const { data, error } = await supabase.functions.invoke(
    "venue-address-pool-match",
    {
      body: {
        formatted_address: input.formattedAddress,
        lat: input.lat,
        lng: input.lng,
      },
    },
  );

  if (error !== null) {
    const code = await detailErrorCode(error);
    throw new Error(code ?? error.message ?? "match_failed");
  }

  const body = data as { match?: unknown; error?: string } | null;
  if (body !== null && typeof body === "object" && "error" in body) {
    throw new Error(String((body as { error: string }).error));
  }

  const raw = body?.match;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return null;
  }
  return mapMatchRow(raw as Record<string, unknown>);
}

/**
 * ORCH-1263 §B1 — read the structured `{ error }` body off a non-2xx edge
 * response (supabase-js stashes the real Response on `.context` behind the
 * opaque FunctionsHttpError message — same posture as pipelineInvokeError).
 */
async function detailErrorCode(
  error: { message?: string; context?: unknown },
): Promise<string | null> {
  const ctx = (error as { context?: unknown }).context;
  if (
    ctx !== null && ctx !== undefined &&
    typeof (ctx as Response).json === "function"
  ) {
    try {
      const parsed = (await (ctx as Response).json()) as { error?: string };
      if (typeof parsed?.error === "string" && parsed.error.length > 0) {
        return parsed.error;
      }
    } catch {
      // fall through — opaque failure surfaces below
    }
  }
  return null;
}

function mapDetailBody(raw: Record<string, unknown>): PoolAdoptionDetail {
  const facetsRaw = raw.facets;
  const facets: Record<string, boolean | null> = {};
  if (facetsRaw !== null && typeof facetsRaw === "object") {
    for (const [k, v] of Object.entries(facetsRaw as Record<string, unknown>)) {
      facets[k] = typeof v === "boolean" ? v : null;
    }
  }
  return {
    id: String(raw.id),
    name: String(raw.name),
    address: asOptionalString(raw.address),
    city: asOptionalString(raw.city),
    country: asOptionalString(raw.country),
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    googlePlaceId: asOptionalString(raw.googlePlaceId),
    primaryType: asOptionalString(raw.primaryType),
    types: Array.isArray(raw.types) ? raw.types.map(String) : [],
    openingHours: raw.openingHours ?? null,
    photoUrls: Array.isArray(raw.photoUrls) ? raw.photoUrls.map(String) : [],
    nationalPhoneNumber: asOptionalString(raw.nationalPhoneNumber),
    website: asOptionalString(raw.website),
    priceTiers: Array.isArray(raw.priceTiers)
      ? raw.priceTiers.map(String)
      : [],
    priceLevel: asOptionalString(raw.priceLevel),
    generativeSummary: asOptionalString(raw.generativeSummary),
    editorialSummary: asOptionalString(raw.editorialSummary),
    reservable: raw.reservable === true,
    facets,
    venueCategory: raw.venueCategory as PoolAdoptionDetail["venueCategory"],
    venueCategoryConfident: raw.venueCategoryConfident === true,
  };
}

/**
 * ORCH-1263 §B1 — full adoption payload for ONE unclaimed place. Fired ONLY on
 * explicit claim intent (D-B copy-on-start). Throws PlaceNotAvailableError on
 * the fail-close 404 (claimed/pending/inactive → blocked-at-the-gate swap).
 */
export async function fetchPlaceAdoptionDetail(
  placePoolId: string,
  _options: { signal?: AbortSignal } = {},
): Promise<PoolAdoptionDetail> {
  const { data, error } = await supabase.functions.invoke("claim-search-pool", {
    body: { place_id: placePoolId },
  });

  if (error !== null) {
    const code = await detailErrorCode(error);
    if (code === "place_not_available") {
      throw new PlaceNotAvailableError();
    }
    if (code === "rate_limited") {
      throw new Error("rate_limited");
    }
    throw new Error(code ?? error.message ?? "detail_failed");
  }

  const body = data as { detail?: unknown; error?: string } | null;
  if (body !== null && typeof body === "object" && "error" in body) {
    const code = String((body as { error: string }).error);
    if (code === "place_not_available") throw new PlaceNotAvailableError();
    throw new Error(code);
  }
  const detail = body?.detail;
  if (detail === null || detail === undefined || typeof detail !== "object") {
    throw new Error("detail_failed");
  }
  return mapDetailBody(detail as Record<string, unknown>);
}
