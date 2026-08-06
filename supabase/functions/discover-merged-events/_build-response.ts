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
  /** #1637 — null for a coords-anchored request; `city.fallback*` is the anchor. */
  cityName: string | null;
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
    // #1637 — a coords-anchored request passes NO city names. In
    // pg_discover_business_events the predicate is
    // `e.city = ANY(p_cities) OR ST_DWithin(pin, center, radius)`, and
    // `= ANY('{}')` is FALSE (never NULL), so an empty array cleanly hands the
    // whole selection to the geo branch. That branch is the one issue #1020
    // added precisely because a venue's own town label under-delivers against a
    // browsed metro, so a coords anchor is not a degraded query — for a user
    // standing in a suburb it is the better one.
    cities: cityName === null ? [] : cityMatchValues(cityName),
    lowerBoundUtc,
    upperStartUtc: dateWindowUtc?.endUtc ?? null,
    partyTypeSlugs,
    vibeTagSlugs,
    musicGenreSlugs,
    offset: businessOffset,
    limit: size,
    // issue #1020 — thread the browsed metro center/radius into the business RPC
    // so its geo-radius OR-fallback surfaces sub-municipality venues. Absent coords
    // → undefined ?? null → SQL NULL → city-only behavior, unchanged.
    centerLat: city.fallbackLat ?? null,
    centerLng: city.fallbackLng ?? null,
    radiusKm: city.fallbackRadiusKm ?? null,
  });

  const ticketmasterPromise = (async () => {
    if (!tmGate) {
      return {
        tmCalled: false,
        tmError: null as string | null,
        tmItems: [] as Record<string, unknown>[],
        tmTotal: 0,
        tmUsedFallback: false,
      };
    }

    let tmError: string | null = null;
    let tmItems: Record<string, unknown>[] = [];
    let tmTotal = 0;
    let tmUsedFallback = false;
    const mergedTmGenreSlugs = [...(genreSlugs ?? []), ...tmMappable];

    // #1637 — page indexing. This function is 1-indexed on the wire
    // (`Math.max(1, body.page ?? 1)` in index.ts, pinned by the ORCH-0839-A
    // T-A1 gate) but the Ticketmaster Discovery API is 0-indexed, and the value
    // was being forwarded unconverted. So the merged path asked Ticketmaster for
    // its SECOND page while the deleted Ticketmaster-only client path asked for
    // its FIRST — two fetches, two disjoint event sets, which is why the deck
    // did not merely shift when the second one landed, it swapped. One page
    // index now, for every anchor.
    const tmPage = Math.max(0, page - 1);

    const tmPayload: Record<string, unknown> = cityName === null
      ? {
        // #1637 coords anchor: latlong+radius mode. Byte-for-byte the query the
        // deleted Ticketmaster-only first fetch used, so the Ticketmaster half
        // of the very first deck is unchanged from what users see today — the
        // Mingla half simply arrives with it instead of seconds later.
        // `ticketmaster-events` rejects city AND location together, so the city
        // fields are omitted entirely rather than sent as null.
        location: { lat: city.fallbackLat, lng: city.fallbackLng },
        radius: city.fallbackRadiusKm,
        segmentSlug,
        genreSlugs: mergedTmGenreSlugs.length > 0
          ? mergedTmGenreSlugs
          : undefined,
        localStartEndDateTime,
        keywords,
        sort,
        page: tmPage,
        size,
      }
      : {
        city: cityName,
        stateCode: city.stateCode ?? null,
        countryCode: city.countryCode ?? null,
        latFallback: city.fallbackLat,
        lngFallback: city.fallbackLng,
        radiusFallback: city.fallbackRadiusKm,
        segmentSlug,
        genreSlugs: mergedTmGenreSlugs.length > 0
          ? mergedTmGenreSlugs
          : undefined,
        localStartEndDateTime,
        keywords,
        sort,
        page: tmPage,
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
        // #1637 — surface the city→lat/lng widening so the consumer's
        // "Showing events near you" banner can finally fire. It was previously
        // dropped here and fed only by the client's Ticketmaster-only path,
        // which by construction ran with no city, so the banner's
        // `fallbackActive && effectiveCity` condition was unsatisfiable.
        tmUsedFallback = tmRes.data.meta?.usedFallback === true;
        if (tmItems.length === 0 && tmTotal > 0) {
          tmError = tmError ?? "ticketmaster_upstream_dropped_events";
        }
      }
    } catch (e) {
      tmError = e instanceof Error ? e.message : String(e);
      console.warn("[discover-merged-events] TM throw:", tmError);
    }

    void minglaOnly;
    return { tmCalled: true, tmError, tmItems, tmTotal, tmUsedFallback };
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
    /** #1637 — optional so a caller built before this field still type-checks. */
    tmUsedFallback?: boolean;
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
      tmUsedFallback: tmResult.tmUsedFallback === true,
      page,
      pageSize: size,
      fromCache,
    },
  };
}
