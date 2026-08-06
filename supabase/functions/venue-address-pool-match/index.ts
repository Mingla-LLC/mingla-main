/**
 * Issue #1648 — resolve a PICKED address to a place we already hold.
 *
 * THE GAP THIS CLOSES. Venue onboarding's gate searches the directory by NAME.
 * When that misses — a trading name, a rename, a chain branch, or simply the
 * brand pressing "Continue without a match" — they land in create-from-scratch,
 * type the exact street address of a place we hold, and we ignore it. The
 * strongest identity signal is collected AFTER the only moment it was used.
 *
 * WHY GOOGLE, AND WHY ONLY HERE. `place_pool` is already ~100% Google-keyed
 * (88,362 of 88,367 active rows carry a `google_place_id`), so the match key
 * already exists on our side — what was missing was the same key on the
 * brand's side. Proximity cannot substitute: every existing venue has between
 * 2 and 18 active pool rows within ~130 m, so distance returns a shortlist,
 * never an identity.
 *
 * THE BOUNDARY (ORCH-1079). That sweep removed Google from address
 * AUTOCOMPLETE and its gate keeps that true. This function does NOT autocomplete
 * anything: Mapbox still owns every suggestion the brand sees, unchanged. Google
 * is asked exactly one question, once, AFTER the brand has already chosen —
 * "which place is this?" — and the answer is used only to look up our own
 * directory. GOOGLE MAY RESOLVE IDENTITY; IT MAY NEVER DRIVE SUGGESTIONS.
 * One call per pick, not per keystroke, and no autocomplete-session billing.
 *
 *   POST { formatted_address, lat, lng }
 *     -> 200 { match: PoolMatchResult | null }
 *     -> 400 validation · 401 auth · 429 rate limited · 502 upstream
 *
 * Authed + rate-limited on the same bucket shape as `claim-search-pool`: this
 * spends money per call and reads the pool, so it can never be anonymous.
 *
 * Google Places API (New) `places:searchText`:
 *   https://developers.google.com/maps/documentation/places/web-service/text-search
 * Field mask is deliberately MINIMAL (`places.id` only) — that keeps the call in
 * the Essentials SKU (10,000 free/month) instead of Pro. We need an identity,
 * not a payload; every extra field is money for data we already hold.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNoForbiddenKeys,
  type PoolMatchRow,
  rowToPoolMatch,
} from "../_shared/poolMatchResponse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map<string, number[]>();

const GOOGLE_SEARCH_TEXT_URL =
  "https://places.googleapis.com/v1/places:searchText";

/** Bias the text search to the picked coordinate. Tight on purpose: the address
 *  is already chosen, so this disambiguates same-named branches rather than
 *  discovering anything. */
const LOCATION_BIAS_RADIUS_M = 200;
const UPSTREAM_TIMEOUT_MS = 6_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function checkRateLimit(userId: string, now = Date.now()): boolean {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateBuckets.get(userId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(userId, hits);
    return false;
  }
  hits.push(now);
  rateBuckets.set(userId, hits);
  return true;
}

export interface ResolveInput {
  formattedAddress: string;
  lat: number;
  lng: number;
}

/**
 * Validate the request body. Coordinates are REQUIRED: this endpoint answers
 * "which place is this", and without a coordinate the text search degrades into
 * a discovery query that could return a same-named venue in another city — the
 * exact ambiguity we are here to remove. A free-text address with no pick has no
 * business reaching Google.
 */
export function parseResolveInput(body: unknown): ResolveInput | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "validation" };
  const b = body as Record<string, unknown>;
  const addr = typeof b.formatted_address === "string"
    ? b.formatted_address.trim()
    : "";
  const lat = typeof b.lat === "number" ? b.lat : NaN;
  const lng = typeof b.lng === "number" ? b.lng : NaN;

  if (addr.length < 4) return { error: "validation" };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "validation" };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: "validation" };
  // 0,0 is the null-island sentinel a failed geocode produces — never a real pick.
  if (lat === 0 && lng === 0) return { error: "validation" };

  return { formattedAddress: addr, lat, lng };
}

/**
 * Ask Google which place the brand picked. Returns the place id, or null when
 * Google has no confident answer.
 *
 * NEVER throws for a "no match" — a miss is a legitimate, common outcome (a
 * brand-new venue that genuinely is not in anyone's directory) and must resolve
 * to `null`, not an error the client has to interpret.
 */
export async function resolveGooglePlaceId(
  input: ResolveInput,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(GOOGLE_SEARCH_TEXT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // MINIMAL mask — identity only. Keeps this in the Essentials SKU.
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({
      textQuery: input.formattedAddress,
      maxResultCount: 1,
      locationBias: {
        circle: {
          center: { latitude: input.lat, longitude: input.lng },
          radius: LOCATION_BIAS_RADIUS_M,
        },
      },
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Google answers 200-with-error-body in some cases and non-2xx in others.
    // Both are upstream failures, and neither may be reported as "no match" —
    // that would silently tell a brand we do not know them (see #1620).
    throw new Error(`google_${res.status}`);
  }
  const body = await res.json().catch(() => null) as
    | { places?: Array<{ id?: string }> }
    | null;
  const id = body?.places?.[0]?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function requireUser(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse({ error: "auth_required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(tokenMatch[1]);
  if (error !== null || data.user === null) {
    return jsonResponse({ error: "auth_invalid" }, 401);
  }
  return { userId: data.user.id };
}

/**
 * Shape the pool row for the client. Returns the SAME `PoolMatchResult` the gate
 * already renders, so `ClaimMatchCard` needs no new shape and the presence
 * facts (photos / hours / website / rating / claim state) stay authoritative.
 */
export function matchResponseForRows(rows: PoolMatchRow[]): Response {
  if (rows.length === 0) return jsonResponse({ match: null });
  const match = rowToPoolMatch(rows[0]);
  assertNoForbiddenKeys(match as unknown as Record<string, unknown>);
  return jsonResponse({ match });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userResult = await requireUser(req);
  if (userResult instanceof Response) return userResult;
  if (!checkRateLimit(userResult.userId)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "validation" }, 400);
  }
  const parsed = parseResolveInput(raw);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, 400);

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!apiKey) return jsonResponse({ error: "server_misconfigured" }, 500);

  let googlePlaceId: string | null;
  try {
    googlePlaceId = await resolveGooglePlaceId(parsed, apiKey);
  } catch (e) {
    console.warn("[venue-address-pool-match] upstream failed:", String(e));
    // Fail LOUD, not as "no match". Reporting an upstream outage as "we don't
    // know you" would send a venue we DO hold into create-from-scratch — the
    // exact duplicate this endpoint exists to prevent.
    return jsonResponse({ error: "resolve_unavailable" }, 502);
  }
  if (googlePlaceId === null) return jsonResponse({ match: null });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin.rpc("biz_match_place_pool_by_google_id", {
    p_google_place_id: googlePlaceId,
  });
  if (error !== null) {
    console.error("[venue-address-pool-match] pool lookup failed:", error.message);
    return jsonResponse({ error: "lookup_failed" }, 500);
  }
  return matchResponseForRows((data ?? []) as PoolMatchRow[]);
}

if (import.meta.main) {
  serve(handler);
}
