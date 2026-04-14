/**
 * Busyness Service — Mapbox Directions + Venue-Type Heuristic Engine
 *
 * Travel time + traffic: Mapbox Directions API (driving-traffic profile)
 * Busyness: Proprietary venue-type-aware heuristic (static constants)
 * Fallback: Time-of-day traffic heuristic when Mapbox unavailable
 *
 * Replaces Google Routes API + BestTime.app (ORCH-0419, 2026-04-13).
 */

import {
  getVenueCategory,
  getPopularTimesForCategory,
  VENUE_POPULARITY,
} from "../constants/venuePopularityPatterns";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || "";
const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving-traffic";

export interface TrafficInfo {
  trafficCondition: "Light" | "Moderate" | "Heavy";
  currentTravelTime: string;
}

export interface BusynessData {
  isBusy: boolean;
  busynessLevel: "Not Busy" | "Moderate" | "Busy" | "Very Busy";
  currentPopularity: number; // 0-100
  popularTimes: PopularTime[];
  message: string;
  trafficInfo?: TrafficInfo;
  isEstimated: boolean;
}

export interface PopularTime {
  day: string;
  times: { hour: string; popularity: number }[];
}

class BusynessService {
  // In-memory caches
  private cache = new Map<string, { data: BusynessData; ts: number }>();
  private routeCache = new Map<string, { data: TrafficInfo; ts: number }>();
  private CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private ROUTE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
   * Get busyness + traffic for a venue.
   *
   * @param venueName   — venue display name (for cache key)
   * @param lat         — venue latitude
   * @param lng         — venue longitude
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
    const busynessResult = this.getVenueTypeHeuristic(category, venueNow);

    // ── Attach real traffic from Mapbox ──
    if (MAPBOX_TOKEN) {
      const traffic = await this.fetchMapboxTraffic(lat, lng);
      if (traffic) {
        busynessResult.trafficInfo = traffic;
      }
    }

    // If still no trafficInfo (no token, no location, or Mapbox failed), use heuristic
    if (!busynessResult.trafficInfo) {
      busynessResult.trafficInfo = this.getTrafficHeuristic(venueNow);
    }

    // ── Cache & return ──
    this.cache.set(cacheKey, { data: busynessResult, ts: Date.now() });
    return busynessResult;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Mapbox Directions API — Real Traffic & Travel Time
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fetch real-time travel duration + traffic from Mapbox Directions API.
   * Uses driving-traffic profile for real traffic conditions.
   *
   * CRITICAL: Mapbox uses longitude,latitude order (opposite of Google).
   */
  private async fetchMapboxTraffic(
    destLat: number,
    destLng: number
  ): Promise<TrafficInfo | null> {
    try {
      // Get user's current location
      let originLat: number | null = null;
      let originLng: number | null = null;

      try {
        const { enhancedLocationService } = require("./enhancedLocationService");
        const loc = await enhancedLocationService.getCurrentLocation();
        if (loc) {
          originLat = loc.latitude;
          originLng = loc.longitude;
        }
      } catch {
        // Location unavailable — skip real traffic
      }

      if (originLat === null || originLng === null) return null;

      // Check route cache (30min TTL) — round coords to 2 decimals for cache hits
      const routeCacheKey = `${originLat.toFixed(2)}_${originLng.toFixed(2)}_${destLat.toFixed(2)}_${destLng.toFixed(2)}`;
      const cachedRoute = this.routeCache.get(routeCacheKey);
      if (cachedRoute && Date.now() - cachedRoute.ts < this.ROUTE_CACHE_TTL) {
        return cachedRoute.data;
      }

      // Mapbox URL: coordinates are lng,lat (NOT lat,lng)
      const url =
        `${MAPBOX_DIRECTIONS_URL}/${originLng},${originLat};${destLng},${destLat}` +
        `?access_token=${MAPBOX_TOKEN}&overview=false`;

      const response = await fetch(url);

      if (!response.ok) {
        console.warn("[Mapbox] HTTP error:", response.status);
        return null;
      }

      const data = await response.json();

      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        console.warn("[Mapbox] No routes in response:", data.code);
        return null;
      }

      const route = data.routes[0];
      const durationSec: number = route.duration ?? 0;
      // duration_typical may be missing — fall back to duration (ratio = 1.0 → "Light")
      const typicalSec: number = route.duration_typical ?? route.duration ?? 0;
      const durationMin = Math.ceil(durationSec / 60);

      // Determine traffic condition from ratio of actual vs typical
      const ratio = typicalSec > 0 ? durationSec / typicalSec : 1;
      let condition: TrafficInfo["trafficCondition"];
      if (ratio <= 1.1) {
        condition = "Light";
      } else if (ratio <= 1.35) {
        condition = "Moderate";
      } else {
        condition = "Heavy";
      }

      const result: TrafficInfo = {
        trafficCondition: condition,
        currentTravelTime: `${durationMin} min`,
      };

      // Cache the result
      this.routeCache.set(routeCacheKey, { data: result, ts: Date.now() });

      // Evict old cache entries (keep max 30)
      if (this.routeCache.size > 30) {
        const oldest = [...this.routeCache.entries()].sort(
          (a, b) => a[1].ts - b[1].ts
        )[0];
        if (oldest) this.routeCache.delete(oldest[0]);
      }

      return result;
    } catch (error) {
      console.warn("[Mapbox] Error:", error);
      return null;
    }
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
  //  Traffic Heuristic Fallback
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Time-of-day traffic estimate when Mapbox is unavailable.
   * Kept as fallback for no-location-permission or network-failure cases.
   * Uses venue-local time.
   */
  private getTrafficHeuristic(venueNow: Date): TrafficInfo {
    const hour = this.getVenueHour(venueNow);
    const dayOfWeek = this.getVenueDay(venueNow);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let condition: TrafficInfo["trafficCondition"];
    let extraMin: number;

    if (isWeekend) {
      if ((hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 19)) {
        condition = "Moderate";
        extraMin = 5;
      } else {
        condition = "Light";
        extraMin = 0;
      }
    } else {
      if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
        condition = "Heavy";
        extraMin = 15;
      } else if (
        (hour >= 12 && hour <= 14) ||
        (hour >= 16 && hour < 17) ||
        (hour > 19 && hour <= 20)
      ) {
        condition = "Moderate";
        extraMin = 7;
      } else {
        condition = "Light";
        extraMin = 0;
      }
    }

    return {
      trafficCondition: condition,
      currentTravelTime: `${10 + extraMin} min`,
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
