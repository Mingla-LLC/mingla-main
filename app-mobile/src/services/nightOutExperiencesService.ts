import { supabase } from "./supabase";
// #1637: the DiscoverSegmentSlug / DiscoverGenreSlug imports went with the
// deleted Ticketmaster-only `search()` and its NightOutSearchInput type.
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

/**
 * Service to fetch Discover experiences.
 *
 * ORCH-0809 Slice M1: the legacy `getEvents(location, options)` shape is
 * deleted; Discover migrated to a structured input.
 *
 * #1637 [discover-single-fetch]: `search()` — the direct, TICKETMASTER-ONLY
 * call into the `ticketmaster-events` edge function — is DELETED, along with
 * its `NightOutSearchInput` / `NightOutSearchOutput` / `EventsMeta` types.
 *
 * It had exactly one caller: DiscoverScreen's no-city branch. That branch fired
 * on every cold launch (device coordinates always beat a reverse-geocode of
 * those same coordinates), and it hard-set `setBusinessEvents([])`, so the first
 * deck every user saw was structurally incapable of containing a Mingla event.
 * `searchMerged` below now serves both anchors, so there is ONE client path into
 * Discover's supply and no second door to walk back through. Constitution #8 —
 * remove the broken path, do not leave it standing next to the fixed one.
 *
 * The `ticketmaster-events` edge function is untouched and still live: the
 * merged endpoint fans out to it server-side, and keep-warm pings it.
 */
export class NightOutExperiencesService {
  /**
   * ORCH-0824: merged Discover query — fans out to Postgres (business events)
   * AND Ticketmaster server-side, returns one ranked list with business events
   * first.
   *
   * The new Mingla-native facets (partyTypeSlugs, vibeTagSlugs,
   * musicGenreSlugs) filter business events and, when active, may suppress
   * Ticketmaster from the response per the I-PROPOSED-DISCOVER-TM-SUPPRESSION
   * invariant.
   *
   * #1637: the query needs an ANCHOR — EITHER a structured city name OR a
   * coordinate pair with a radius. City is no longer required. A coords-only
   * anchor runs the business RPC on its ST_DWithin geo predicate and asks
   * Ticketmaster in latlong+radius mode, which is what lets a cold launch issue
   * ONE request carrying BOTH supplies instead of a Ticketmaster-only request
   * followed seconds later by a merged one.
   *
   * Throws on a missing anchor and on edge-function error (no silent fallback to
   * an empty list — Constitution #3).
   */
  static async searchMerged(
    input: DiscoverMergedSearchInput,
  ): Promise<DiscoverMergedResponse> {
    const cityName =
      typeof input.city?.name === "string" && input.city.name.trim().length > 0
        ? input.city.name
        : null;
    const hasCoords =
      typeof input.city?.fallbackLat === "number" &&
      typeof input.city?.fallbackLng === "number" &&
      typeof input.city?.fallbackRadiusKm === "number";
    if (!cityName && !hasCoords) {
      throw new Error(
        "[NightOutService] searchMerged: needs city.name OR fallbackLat+fallbackLng+fallbackRadiusKm",
      );
    }

    const body: Record<string, unknown> = {
      city: {
        name: cityName,
        stateCode: input.city?.stateCode ?? null,
        countryCode: input.city?.countryCode ?? null,
        fallbackLat: input.city?.fallbackLat,
        fallbackLng: input.city?.fallbackLng,
        fallbackRadiusKm: input.city?.fallbackRadiusKm,
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
    // ORCH-0828: forward the device's IANA timezone so the server can
    // anchor `localStartEndDateTime` correctly for the business-events
    // date filter. Falls back to UTC if the platform can't resolve it.
    if (input.timezone && input.timezone.length > 0) {
      body.timezone = input.timezone;
    } else {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (typeof tz === "string" && tz.length > 0) body.timezone = tz;
      } catch {
        // fall through: server defaults to UTC + logs a warning
      }
    }

    console.log("[NightOutService] searchMerged:", {
      // #1637: log the ANCHOR, not just the city — a coords-anchored request
      // logging `city: undefined` would read as a bug to the next person
      // tailing this on a device.
      anchor: cityName ? "city" : "coords",
      city: cityName,
      coords: cityName
        ? undefined
        : {
            lat: input.city?.fallbackLat,
            lng: input.city?.fallbackLng,
            radiusKm: input.city?.fallbackRadiusKm,
          },
      partyTypes: input.partyTypeSlugs,
      vibes: input.vibeTagSlugs,
      genres: input.musicGenreSlugs,
      // ORCH-0828 REWORK: log the actual date window + resolved timezone +
      // segment so runtime traces can verify exactly what the client sent
      // (the brutal-retest investigation lost an hour because these were
      // absent from the log).
      segmentSlug: input.segmentSlug,
      localStartEndDateTime: input.localStartEndDateTime,
      timezone: body.timezone,
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
