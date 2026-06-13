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
import { buildDiscoverMergedResponse } from "./_build-response.ts";
import {
  buildDiscoverCacheKey,
  discoverStaleExpiresAt,
  type DiscoverCacheParams,
} from "./_cache.ts";
import {
  readDbDiscoverCache,
  releaseDistributedBuildLock,
  tryDistributedBuildLock,
  waitForDbDiscoverCache,
  writeDbDiscoverCache,
} from "./_distributed-cache.ts";
import {
  coalesceDiscoverBuild,
  l1Get,
  refreshDiscoverInBackground,
} from "./_memory-cache.ts";
import type { DiscoverMergedResponse } from "./_types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DiscoverMergedRequest {
  city: {
    name: string;
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
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: DiscoverMergedRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const cityName = body.city?.name?.trim();
  if (!cityName) {
    return jsonResponse({ error: "city_required" }, 400);
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
    return jsonResponse({ error: "party_type_slugs_not_canonical" }, 400);
  }
  if (
    vibeTagSlugs.length > 0 &&
    !isSubsetOf(vibeTagSlugs, VIBE_TAG_SLUGS as readonly string[])
  ) {
    return jsonResponse({ error: "vibe_tag_slugs_not_canonical" }, 400);
  }
  if (
    musicGenreSlugs.length > 0 &&
    !isSubsetOf(musicGenreSlugs, MUSIC_GENRE_SLUGS as readonly string[])
  ) {
    return jsonResponse({ error: "music_genre_slugs_not_canonical" }, 400);
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
      return jsonResponse(
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
    return jsonResponse({ error: "supabase_env_missing" }, 500);
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

  const buildFresh = async (): Promise<DiscoverMergedResponse> => {
    const dbCached = await readDbDiscoverCache(supabase, cacheKey);
    if (dbCached) return dbCached;

    const gotLock = await tryDistributedBuildLock(supabase, cacheKey);
    if (!gotLock) {
      const waited = await waitForDbDiscoverCache(supabase, cacheKey);
      if (waited) return waited;
    }

    try {
      const built = await buildDiscoverMergedResponse(buildCtx);
      writeDbDiscoverCache(supabase, cacheKey, built, discoverStaleExpiresAt);
      return built;
    } finally {
      await releaseDistributedBuildLock(supabase, cacheKey);
    }
  };

  const now = Date.now();
  const l1Hit = l1Get(cacheKey, now);
  if (l1Hit) {
    if (now >= l1Hit.freshUntil) {
      refreshDiscoverInBackground(cacheKey, buildFresh);
    }
    return jsonResponse({
      ...l1Hit.response,
      meta: { ...l1Hit.response.meta, fromCache: true },
    });
  }

  try {
    const response = await coalesceDiscoverBuild(cacheKey, buildFresh);
    return jsonResponse(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("db_error:")) {
      return jsonResponse(
        { error: "db_error", detail: msg.slice("db_error:".length) },
        500,
      );
    }
    throw e;
  }
});
