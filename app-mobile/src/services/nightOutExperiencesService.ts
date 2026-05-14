import { supabase } from "./supabase";
import type {
  DiscoverSegmentSlug,
  DiscoverGenreSlug,
} from "../types/discoverFilters";
// ORCH-0824: merged Discover response types.
import type {
  DiscoverMergedResponse,
  DiscoverMergedSearchInput,
} from "../types/mergedDiscover";

export interface NightOutVenue {
  id: string;
  eventName: string;
  artistName: string;
  venueName: string;
  image: string;
  images: string[];
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string;
  price: string;
  date: string;
  time: string;
  localDate: string;
  dateTimeUTC: string;
  location: string;
  address: string;
  coordinates: { lat: number; lng: number };
  genre: string;
  subGenre: string;
  tags: string[];
  ticketUrl: string;
  ticketStatus: string;
  // ORCH-0809: distance is null when city-mode is used (no haversine anchor)
  distance: number | null;
  seatMapUrl?: string;
}

export interface EventsMeta {
  totalResults: number;
  page: number;
  pageSize: number;
  totalPages: number;
  fromCache: boolean;
  keywords: string[];
  usedFallback: boolean;
}

export interface NightOutSearchInput {
  // EXACTLY ONE of city or location must be present.
  city?: {
    name: string;
    stateCode?: string | null;
    countryCode?: string | null;
    // For the edge function's <5-result lat/lng fallback path
    fallbackLat?: number;
    fallbackLng?: number;
    fallbackRadiusKm?: number;
  };
  location?: { lat: number; lng: number };
  radius?: number;

  // Classification — slugs only (server resolves to TM IDs)
  segmentSlug?: DiscoverSegmentSlug;
  genreSlugs?: ReadonlyArray<DiscoverGenreSlug>;

  // Date window — TM local-time pair "YYYY-MM-DDTHH:mm:ss,YYYY-MM-DDTHH:mm:ss"
  localStartEndDateTime?: string;

  // Free-text keyword search (NOT genre-mapped; reserved for a future search box)
  keywords?: string[];

  sort?: string;
  page?: number;
  size?: number;
}

export interface NightOutSearchOutput {
  events: NightOutVenue[];
  meta: EventsMeta;
}

/**
 * Service to fetch real Ticketmaster events for the Discover tab.
 *
 * ORCH-0809 Slice M1: signature rewritten. The legacy `getEvents(location, options)`
 * shape is deleted; Discover is the sole caller and migrates to `search(input)`
 * in Slice M2. Edge function accepts both v1 and v2 request shapes so any
 * other future caller can continue using the previous shape; this client
 * service only emits the v2 shape going forward.
 */
export class NightOutExperiencesService {
  static async search(
    input: NightOutSearchInput,
  ): Promise<NightOutSearchOutput> {
    // Validation: exactly one of city or location
    if (!input.city && !input.location) {
      throw new Error(
        "[NightOutService] city or location is required",
      );
    }
    if (input.city && input.location) {
      throw new Error(
        "[NightOutService] pass either city or location, not both",
      );
    }

    const body: Record<string, unknown> = {
      sort: input.sort ?? "date,asc",
      page: input.page ?? 0,
      size: input.size ?? 20,
    };

    if (input.city) {
      body.city = input.city.name;
      body.stateCode = input.city.stateCode ?? null;
      body.countryCode = input.city.countryCode ?? null;
      if (typeof input.city.fallbackLat === "number") {
        body.latFallback = input.city.fallbackLat;
      }
      if (typeof input.city.fallbackLng === "number") {
        body.lngFallback = input.city.fallbackLng;
      }
      if (typeof input.city.fallbackRadiusKm === "number") {
        body.radiusFallback = input.city.fallbackRadiusKm;
      }
    } else if (input.location) {
      body.location = input.location;
      body.radius = input.radius ?? 50;
    }

    if (input.segmentSlug) body.segmentSlug = input.segmentSlug;
    if (input.genreSlugs && input.genreSlugs.length > 0) {
      body.genreSlugs = input.genreSlugs;
    }
    if (input.localStartEndDateTime) {
      body.localStartEndDateTime = input.localStartEndDateTime;
    }
    if (input.keywords && input.keywords.length > 0) {
      body.keywords = input.keywords;
    }

    try {
      console.log("[NightOutService] Fetching Ticketmaster events:", {
        city: input.city?.name,
        location: input.location,
        segment: input.segmentSlug,
        genres: input.genreSlugs,
        dt: input.localStartEndDateTime,
      });

      const { data, error } = await supabase.functions.invoke(
        "ticketmaster-events",
        { body },
      );

      if (error) {
        console.error("[NightOutService] Error:", error);
        throw new Error(`Failed to fetch events: ${error.message}`);
      }

      if (!data || !data.events) {
        console.log("[NightOutService] No events returned");
        return {
          events: [],
          meta: {
            totalResults: 0,
            page: (input.page ?? 0),
            pageSize: (input.size ?? 20),
            totalPages: 0,
            fromCache: false,
            keywords: input.keywords ? [...input.keywords] : [],
            usedFallback: false,
          },
        };
      }

      console.log(
        `[NightOutService] Received ${data.events.length} events (fromCache: ${data.meta?.fromCache}, usedFallback: ${data.meta?.usedFallback})`,
      );
      return {
        events: data.events as NightOutVenue[],
        meta: data.meta as EventsMeta,
      };
    } catch (error) {
      console.error("[NightOutService] Failed:", error);
      throw error;
    }
  }

  // ORCH-0809 M2: [TRANSITIONAL] getEvents v1 adapter DELETED — DiscoverScreen
  // surgery migrated the single callsite to search() in this slice. The edge
  // function still accepts the v1 wire shape for any future external caller
  // (backward-compat detection in supabase/functions/ticketmaster-events/index.ts),
  // but no client code in this repo emits the v1 shape any more.

  /**
   * ORCH-0824: merged Discover query — fans out to Postgres (business events)
   * AND Ticketmaster server-side, returns one ranked list with business events
   * first.
   *
   * The Ticketmaster facets (segmentSlug, genreSlugs, localStartEndDateTime,
   * keywords) work exactly as in `search()`. The new Mingla-native facets
   * (partyTypeSlugs, vibeTagSlugs, musicGenreSlugs) filter business events and,
   * when active, may suppress Ticketmaster from the response per the
   * I-PROPOSED-DISCOVER-TM-SUPPRESSION invariant.
   *
   * City is REQUIRED (unlike `search()`, which accepts city OR location). The
   * consumer's selected CityPicker city must be passed here; lat/lng is not a
   * primary lookup mode for merged discover.
   *
   * Throws on edge-function error (no silent fallback to empty list — per
   * Constitution #3).
   */
  static async searchMerged(
    input: DiscoverMergedSearchInput,
  ): Promise<DiscoverMergedResponse> {
    if (!input.city || !input.city.name) {
      throw new Error("[NightOutService] searchMerged: city.name is required");
    }

    const body: Record<string, unknown> = {
      city: {
        name: input.city.name,
        stateCode: input.city.stateCode ?? null,
        countryCode: input.city.countryCode ?? null,
        fallbackLat: input.city.fallbackLat,
        fallbackLng: input.city.fallbackLng,
        fallbackRadiusKm: input.city.fallbackRadiusKm,
      },
      page: input.page ?? 1,
      size: input.size ?? 20,
    };
    if (input.segmentSlug) body.segmentSlug = input.segmentSlug;
    if (input.genreSlugs && input.genreSlugs.length > 0) {
      body.genreSlugs = input.genreSlugs;
    }
    if (input.localStartEndDateTime) {
      body.localStartEndDateTime = input.localStartEndDateTime;
    }
    if (input.keywords && input.keywords.length > 0) {
      body.keywords = input.keywords;
    }
    if (input.sort) body.sort = input.sort;
    if (input.partyTypeSlugs && input.partyTypeSlugs.length > 0) {
      body.partyTypeSlugs = input.partyTypeSlugs;
    }
    if (input.vibeTagSlugs && input.vibeTagSlugs.length > 0) {
      body.vibeTagSlugs = input.vibeTagSlugs;
    }
    if (input.musicGenreSlugs && input.musicGenreSlugs.length > 0) {
      body.musicGenreSlugs = input.musicGenreSlugs;
    }

    console.log("[NightOutService] searchMerged:", {
      city: input.city.name,
      partyTypes: input.partyTypeSlugs,
      vibes: input.vibeTagSlugs,
      genres: input.musicGenreSlugs,
    });

    const { data, error } = await supabase.functions.invoke(
      "discover-merged-events",
      { body },
    );

    if (error) {
      console.error("[NightOutService] searchMerged error:", error);
      throw new Error(`Failed to fetch merged Discover: ${error.message}`);
    }
    if (!data) {
      throw new Error("Failed to fetch merged Discover: empty response");
    }

    return data as DiscoverMergedResponse;
  }
}
