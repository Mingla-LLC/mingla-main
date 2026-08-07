/**
 * Busyness Service — Venue-Type Heuristic Engine
 *
 * Busyness: Proprietary venue-type-aware heuristic (static constants).
 *
 * Replaces Google Routes API + BestTime.app (ORCH-0419, 2026-04-13).
 *
 * ---------------------------------------------------------------------------
 * TRAFFIC IS DELETED, DELIBERATELY — #1605 wave 4 rework
 *
 * This service used to fetch a Mapbox Directions `driving-traffic` route from
 * the viewer's GPS to the venue on EVERY expanded-card open, and `main`'s
 * `BusynessSection` rendered the result as a Traffic row: car icon, condition
 * chip, travel time. Wave 4 deleted the row and left the producer running, so
 * the round-trip fired for a row nobody saw. That state is not defensible in
 * either direction, so the producer goes with the row. Three reasons, in order
 * of weight:
 *
 *   1. THE FALLBACK FABRICATED (Constitution 9). `getTrafficHeuristic` returned
 *      `${10 + extraMin} min` from nothing but the clock — a literal 10, 17 or
 *      25 minutes presented beside a real Mapbox reading in the identical row,
 *      with no disclosure. It fired whenever `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`
 *      was unset, location permission was denied, or the request failed — i.e.
 *      for every user who declines location, always. This is the "15 min travel
 *      time" already on this programme's fabricated-value list.
 *   2. THE REAL ARM DUPLICATED A FACT THE SHEET ALREADY STATES. The plate
 *      carries the viewer-relative DISTANCE span; D-2 of the design is explicit
 *      that travel time is not rendered beside it because "14 min" next to
 *      "6.7 mi" is the same fact twice.
 *   3. IT WAS A PER-OPEN NETWORK COST on a third-party quota, for a row that
 *      answered a question ("how long to drive there right now") the sheet is
 *      not the place to answer — Directions is one tap away and authoritative.
 *
 * Deleted with it: `TrafficInfo`, `BusynessData.trafficInfo`,
 * `ExpandedCardData.trafficInfo`, `fetchMapboxTraffic`, `getTrafficHeuristic`,
 * the route cache, and `expanded_details:busyness.{traffic,clear_roads,clear,
 * moderate,heavy}` in all 29 locales. Nothing in the tree reads a traffic
 * field after this change, and `S-8` in the wave's gate fails if one comes
 * back without a render site.
 */

import {
  getVenueCategory,
  getPopularTimesForCategory,
  VENUE_POPULARITY,
} from "../constants/venuePopularityPatterns";

export interface BusynessData {
  isBusy: boolean;
  busynessLevel: "Not Busy" | "Moderate" | "Busy" | "Very Busy";
  currentPopularity: number; // 0-100
  popularTimes: PopularTime[];
  message: string;
  isEstimated: boolean;
}

export interface PopularTime {
  day: string;
  times: { hour: string; popularity: number }[];
}

class BusynessService {
  // In-memory cache
  private cache = new Map<string, { data: BusynessData; ts: number }>();
  private CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  // ─── Venue-Local Time ───────────────────────────────────────────────────

  /**
   * Build a Date whose getUTC*() methods return venue-local values.
   * Uses the UTC offset from Open-Meteo (passed via ExpandedCardModal).
   * Same epoch-shift pattern as the previous Google Timezone integration.
   */
  private getVenueLocalDate(utcOffsetSeconds?: number): Date {
    if (utcOffsetSeconds == null) {
      // No timezone info — use device time
      return new Date();
    }
    const utcNow = Math.floor(Date.now() / 1000);
    const localEpoch = (utcNow + utcOffsetSeconds) * 1000;
    return new Date(localEpoch);
  }

  /**
   * Extract hour from a venue-local Date (epoch-shifted → use getUTC*).
   */
  private getVenueHour(venueDate: Date): number {
    return venueDate.getUTCHours();
  }

  /**
   * Extract day-of-week from a venue-local Date (0=Sun … 6=Sat).
   */
  private getVenueDay(venueDate: Date): number {
    return venueDate.getUTCDay();
  }

  // ─── Main Entry Point ─────────────────────────────────────────────────

  /**
   * Get busyness for a venue.
   *
   * @param venueName   — venue display name (for cache key)
   * @param lat         — venue latitude (cache key only)
   * @param lng         — venue longitude (cache key only)
   * @param address     — venue address (unused, kept for API compat)
   * @param _placeId    — Google Place ID (unused, kept for API compat)
   * @param category    — Mingla category slug (e.g. 'casual_eats')
   * @param utcOffsetSeconds — UTC offset from Open-Meteo response
   */
  async getVenueBusyness(
    venueName: string,
    lat: number,
    lng: number,
    address?: string,
    _placeId?: string,
    category?: string,
    utcOffsetSeconds?: number
  ): Promise<BusynessData | null> {
    // ── Check cache ──
    const cacheKey = `${venueName}_${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
      return cached.data;
    }

    // ── Resolve venue-local time ──
    const venueNow = this.getVenueLocalDate(utcOffsetSeconds);

    // ── Build venue-type-aware busyness ──
    // No network call. The Mapbox Directions round-trip that used to run here
    // on every expanded-card open is deleted — see the file header.
    const busynessResult = this.getVenueTypeHeuristic(category, venueNow);

    // ── Cache & return ──
    this.cache.set(cacheKey, { data: busynessResult, ts: Date.now() });
    return busynessResult;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Venue-Type-Aware Busyness Heuristic
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Venue-type-aware busyness using static popularity curves.
   * Different venue types have different busy patterns (coffee shop ≠ bar).
   */
  private getVenueTypeHeuristic(
    category: string | undefined,
    venueNow: Date
  ): BusynessData {
    const venueCategory = getVenueCategory(category);
    const dayOfWeek = this.getVenueDay(venueNow);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const currentHour = this.getVenueHour(venueNow);

    const curve = VENUE_POPULARITY[venueCategory];
    const popularity = isWeekend
      ? curve.weekend[currentHour]
      : curve.weekday[currentHour];

    const busynessLevel = this.calculateBusynessLevel(popularity);
    const popularTimes = getPopularTimesForCategory(venueCategory, isWeekend);

    return {
      isBusy: popularity > 50,
      busynessLevel,
      currentPopularity: popularity,
      popularTimes,
      message: this.generateMessageFromLevel(busynessLevel, popularity),
      isEstimated: true,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Shared Helpers
  // ═══════════════════════════════════════════════════════════════════════

  private calculateBusynessLevel(
    popularity: number
  ): "Not Busy" | "Moderate" | "Busy" | "Very Busy" {
    if (popularity < 25) return "Not Busy";
    if (popularity < 50) return "Moderate";
    if (popularity < 75) return "Busy";
    return "Very Busy";
  }

  private generateMessageFromLevel(
    level: BusynessData["busynessLevel"],
    popularity: number
  ): string {
    switch (level) {
      case "Very Busy":
        return `Very busy right now (${popularity}%). Consider visiting later.`;
      case "Busy":
        return `Getting busy (${popularity}%). Expect moderate crowds.`;
      case "Moderate":
        return `Moderate crowd (${popularity}%). Good time to visit.`;
      default:
        return `Not busy (${popularity}%) — great time to visit!`;
    }
  }
}

export const busynessService = new BusynessService();
