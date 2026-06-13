/**
 * ORCH-426 G1 — build merged discover response (business RPC + TM fan-out).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapMinglaMusicGenresToTmSlugs } from "../_shared/eventTaxonomy.ts";
import {
  cityMatchValues,
  fetchDiscoverBusinessEvents,
} from "./_business-query.ts";
import type {
  BusinessEventCard,
  DiscoverMergedResponse,
  MergedDiscoverItem,
} from "./_types.ts";

export interface BuildDiscoverContext {
  supabase: SupabaseClient;
  cityName: string;
  city: {
    stateCode?: string | null;
    countryCode?: string | null;
    fallbackLat?: number;
    fallbackLng?: number;
    fallbackRadiusKm?: number;
  };
  page: number;
  size: number;
  partyTypeSlugs: string[];
  vibeTagSlugs: string[];
  musicGenreSlugs: string[];
  dateWindowUtc: { startUtc: string; endUtc: string } | null;
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
}

export async function buildDiscoverMergedResponse(
  ctx: BuildDiscoverContext,
): Promise<DiscoverMergedResponse> {
  const {
    supabase,
    cityName,
    city,
    page,
    size,
    partyTypeSlugs,
    vibeTagSlugs,
    musicGenreSlugs,
    dateWindowUtc,
    segmentSlug,
    genreSlugs,
    localStartEndDateTime,
    keywords,
    sort,
  } = ctx;

  const tmSuppressedByMinglaFacet =
    partyTypeSlugs.length > 0 || vibeTagSlugs.length > 0;
  const { tmMappable, minglaOnly } = mapMinglaMusicGenresToTmSlugs(musicGenreSlugs);
  const tmSuppressedByMinglaOnlyGenres =
    musicGenreSlugs.length > 0 && tmMappable.length === 0;
  const tmGate = !tmSuppressedByMinglaFacet && !tmSuppressedByMinglaOnlyGenres;

  const lowerBoundUtc =
    dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString();
  const businessOffset = (page - 1) * size;

  const businessPromise = fetchDiscoverBusinessEvents(supabase, {
    cities: cityMatchValues(cityName),
    lowerBoundUtc,
    upperStartUtc: dateWindowUtc?.endUtc ?? null,
    partyTypeSlugs,
    vibeTagSlugs,
    musicGenreSlugs,
    offset: businessOffset,
    limit: size,
  });

  const ticketmasterPromise = (async () => {
    if (!tmGate) {
      return { tmCalled: false, tmError: null as string | null, tmItems: [] as Record<string, unknown>[], tmTotal: 0 };
    }

    let tmError: string | null = null;
    let tmItems: Record<string, unknown>[] = [];
    let tmTotal = 0;
    const mergedTmGenreSlugs = [...(genreSlugs ?? []), ...tmMappable];

    const tmPayload: Record<string, unknown> = {
      city: cityName,
      stateCode: city.stateCode ?? null,
      countryCode: city.countryCode ?? null,
      latFallback: city.fallbackLat,
      lngFallback: city.fallbackLng,
      radiusFallback: city.fallbackRadiusKm,
      segmentSlug,
      genreSlugs: mergedTmGenreSlugs.length > 0 ? mergedTmGenreSlugs : undefined,
      localStartEndDateTime,
      keywords,
      sort,
      page,
      size,
    };

    try {
      const tmRes = await supabase.functions.invoke("ticketmaster-events", {
        body: tmPayload,
      });
      if (tmRes.error) {
        tmError = tmRes.error.message ?? "ticketmaster_invoke_failed";
        console.warn("[discover-merged-events] TM error:", tmError);
      } else if (tmRes.data && Array.isArray(tmRes.data.events)) {
        tmItems = tmRes.data.events;
        tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length;
        if (tmItems.length === 0 && tmTotal > 0) {
          tmError = tmError ?? "ticketmaster_upstream_dropped_events";
        }
      }
    } catch (e) {
      tmError = e instanceof Error ? e.message : String(e);
      console.warn("[discover-merged-events] TM throw:", tmError);
    }

    void minglaOnly;
    return { tmCalled: true, tmError, tmItems, tmTotal };
  })();

  const [{ businessItems, businessTotal }, tmResult] = await Promise.all([
    businessPromise,
    ticketmasterPromise,
  ]);

  return mergeDiscoverResponse({
    businessItems,
    businessTotal,
    tmResult,
    page,
    size,
    fromCache: false,
  });
}

export function mergeDiscoverResponse(args: {
  businessItems: BusinessEventCard[];
  businessTotal: number;
  tmResult: {
    tmCalled: boolean;
    tmError: string | null;
    tmItems: Record<string, unknown>[];
    tmTotal: number;
  };
  page: number;
  size: number;
  fromCache: boolean;
}): DiscoverMergedResponse {
  const { businessItems, businessTotal, tmResult, page, size, fromCache } = args;
  const businessSpread: MergedDiscoverItem[] = businessItems.map(
    (it) => ({ source: "business_event", item: it }),
  );
  const remainingForTm = Math.max(0, size - businessSpread.length);
  const tmSpread: MergedDiscoverItem[] = tmResult.tmItems
    .slice(0, remainingForTm)
    .map((it) => ({ source: "ticketmaster", item: it }));

  return {
    items: [...businessSpread.slice(0, size), ...tmSpread],
    meta: {
      businessCount: businessSpread.length,
      ticketmasterCount: tmSpread.length,
      businessTotalAvailable: businessTotal,
      ticketmasterTotalAvailable: tmResult.tmTotal,
      tmCalled: tmResult.tmCalled,
      tmError: tmResult.tmError,
      page,
      pageSize: size,
      fromCache,
    },
  };
}
