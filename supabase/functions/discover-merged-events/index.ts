/**
 * ORCH-0824 — discover-merged-events
 *
 * ORCH-426 G1: L1 memory cache + DB cache (SWR) + pg_discover_business_events RPC
 * + cross-isolate build lock for 10k VU load gate.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PARTY_TYPE_SLUGS,
  VIBE_TAG_SLUGS,
  MUSIC_GENRE_SLUGS,
  isSubsetOf,
} from "../_shared/eventTaxonomy.ts";
import { parseLocalStartEndDateTime } from "../_shared/timezone.ts";
import {
  buildDiscoverCacheKey,
  type DiscoverCacheParams,
} from "./_cache.ts";
import {
  coalesceDiscoverBuild,
  l1Get,
  refreshDiscoverInBackground,
} from "./_memory-cache.ts";
import { DiscoverOverloadedError, resolveDiscoverEntry } from "./_resolve-entry.ts";
import { serveDiscoverBytes } from "./_response-bytes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-encoding",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DiscoverMergedRequest {
  /**
   * The query ANCHOR. #1637: `name` is OPTIONAL as long as the coordinate
   * triple is present. A consumer cold launch has device coordinates seconds
   * before a reverse-geocode can name the city, and requiring the name here was
   * the single gate that forced Discover into two sequential fetches — a
   * Ticketmaster-only one first (structurally unable to carry a Mingla event),
   * then a merged one that re-ordered the deck under the user's thumb.
   */
  city: {
    name?: string | null;
    stateCode?: string | null;
    countryCode?: string | null;
    fallbackLat?: number;
    fallbackLng?: number;
    fallbackRadiusKm?: number;
  };
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
  page?: number;
  size?: number;
  partyTypeSlugs?: string[];
  vibeTagSlugs?: string[];
  musicGenreSlugs?: string[];
  timezone?: string;
  /**
   * #1637 — keep-warm ping marker. `city` is REQUIRED for every real request,
   * so a warm ping cannot be expressed as a real body; it is its own shape.
   */
  warmPing?: boolean;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function jsonError(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError({ error: "method_not_allowed" }, 405);
  }

  let body: DiscoverMergedRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError({ error: "invalid_json" }, 400);
  }

  // ── #1637 Keep-warm ping: boot the isolate without running business logic ──
  // MUST stay above the `city_required` check. This function is on the consumer
  // Discover cold-open path and had zero traffic in 24h, so it was cold on every
  // real open (1.5-4s isolate boot vs ~90-120ms warm). The cron ping carries no
  // city by design — priming an L2 row instead would buy a row that is already
  // stale (120s fresh TTL vs the 300s cron period) at the cost of a real
  // Ticketmaster API call and a DB write every 5 minutes. Matches the
  // discover-cards / generate-curated-experiences / get-person-hero-cards /
  // record-visit / get-paired-saves / get-paired-profile-cards convention.
  if (body.warmPing) {
    return jsonError({ status: "warm" }, 200);
  }

  // ── #1637 The anchor: a city name OR a coordinate triple. ────────────────
  // The error code stays `city_required` for wire compatibility (and the
  // keep-warm coverage gate pins the warm short-circuit ahead of it), but the
  // condition is now "no anchor at all" rather than "no city name". Coordinates
  // alone are a complete query: the business RPC has an ST_DWithin geo
  // predicate (issue #1020) and Ticketmaster has latlong+radius mode, so both
  // supplies answer the same coords-anchored question concurrently.
  const cityNameRaw = body.city?.name?.trim();
  const cityName: string | null =
    cityNameRaw && cityNameRaw.length > 0 ? cityNameRaw : null;
  const hasGeoAnchor =
    typeof body.city?.fallbackLat === "number" &&
    Number.isFinite(body.city.fallbackLat) &&
    typeof body.city?.fallbackLng === "number" &&
    Number.isFinite(body.city.fallbackLng) &&
    typeof body.city?.fallbackRadiusKm === "number" &&
    Number.isFinite(body.city.fallbackRadiusKm) &&
    body.city.fallbackRadiusKm > 0;
  if (!cityName && !hasGeoAnchor) {
    return jsonError({ error: "city_required" }, 400);
  }

  const page = Math.max(1, body.page ?? 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, body.size ?? DEFAULT_PAGE_SIZE));

  const partyTypeSlugs = (body.partyTypeSlugs ?? []).filter(Boolean);
  const vibeTagSlugs = (body.vibeTagSlugs ?? []).filter(Boolean);
  const musicGenreSlugs = (body.musicGenreSlugs ?? []).filter(Boolean);

  if (
    partyTypeSlugs.length > 0 &&
    !isSubsetOf(partyTypeSlugs, PARTY_TYPE_SLUGS as readonly string[])
  ) {
    return jsonError({ error: "party_type_slugs_not_canonical" }, 400);
  }
  if (
    vibeTagSlugs.length > 0 &&
    !isSubsetOf(vibeTagSlugs, VIBE_TAG_SLUGS as readonly string[])
  ) {
    return jsonError({ error: "vibe_tag_slugs_not_canonical" }, 400);
  }
  if (
    musicGenreSlugs.length > 0 &&
    !isSubsetOf(musicGenreSlugs, MUSIC_GENRE_SLUGS as readonly string[])
  ) {
    return jsonError({ error: "music_genre_slugs_not_canonical" }, 400);
  }

  const requestTimezone = (body.timezone ?? "UTC").trim() || "UTC";
  let dateWindowUtc: { startUtc: string; endUtc: string } | null = null;
  if (body.localStartEndDateTime && body.localStartEndDateTime.length > 0) {
    try {
      dateWindowUtc = parseLocalStartEndDateTime(
        body.localStartEndDateTime,
        requestTimezone,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(
        {
          error: msg.startsWith("invalid_local_") ? msg : "invalid_timezone",
          detail: msg,
        },
        400,
      );
    }
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonError({ error: "supabase_env_missing" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const cacheParams: DiscoverCacheParams = {
    cityName,
    stateCode: body.city.stateCode,
    countryCode: body.city.countryCode,
    page,
    size,
    partyTypeSlugs,
    vibeTagSlugs,
    musicGenreSlugs,
    dateWindowUtc,
    segmentSlug: body.segmentSlug,
    genreSlugs: body.genreSlugs,
    localStartEndDateTime: body.localStartEndDateTime,
    keywords: body.keywords,
    sort: body.sort,
    timezone: requestTimezone,
    // issue #1020 — fold the browsed geo center/radius into the cache key so two
    // "Brussels" requests with different centers/radii don't cross-serve one
    // radius-filtered deck (Constitution #13 — exclusion consistency).
    fallbackLat: body.city.fallbackLat,
    fallbackLng: body.city.fallbackLng,
    fallbackRadiusKm: body.city.fallbackRadiusKm,
  };
  const cacheKey = buildDiscoverCacheKey(cacheParams);

  const buildCtx = {
    supabase,
    cityName,
    city: body.city,
    page,
    size,
    partyTypeSlugs,
    vibeTagSlugs,
    musicGenreSlugs,
    dateWindowUtc,
    segmentSlug: body.segmentSlug,
    genreSlugs: body.genreSlugs,
    localStartEndDateTime: body.localStartEndDateTime,
    keywords: body.keywords,
    sort: body.sort,
  };

  const resolveEntry = () => resolveDiscoverEntry(supabase, cacheKey, buildCtx);

  const now = Date.now();
  const l1Hit = l1Get(cacheKey, now);
  if (l1Hit) {
    if (now >= l1Hit.freshUntil) {
      refreshDiscoverInBackground(cacheKey, resolveEntry);
    }
    return serveDiscoverBytes(req, l1Hit.bytes, corsHeaders);
  }

  try {
    const entry = await coalesceDiscoverBuild(cacheKey, resolveEntry);
    return serveDiscoverBytes(req, entry.bytes, corsHeaders);
  } catch (e) {
    if (e instanceof DiscoverOverloadedError) {
      return jsonError({ error: "discover_overloaded" }, 503, { "Retry-After": "5" });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("db_error:")) {
      return jsonError(
        { error: "db_error", detail: msg.slice("db_error:".length) },
        500,
      );
    }
    throw e;
  }
});
