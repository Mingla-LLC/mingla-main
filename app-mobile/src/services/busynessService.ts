/**
 * Busyness Service — BestTime.app + Google Routes API Integration
 *
 * Primary: BestTime.app for real foot-traffic / popular-times data
 * Secondary: Google Routes API for real-time travel duration & traffic
 * Fallback : Time-of-day heuristics when no API keys are configured
 */

const BESTTIME_API_KEY = process.env.EXPO_PUBLIC_BESTTIME_API_KEY || "";
const BESTTIME_BASE_URL = "https://besttime.app/api/v1";
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const GOOGLE_ROUTES_BASE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

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
}

export interface PopularTime {
  day: string;
  times: { hour: string; popularity: number }[];
}

// ─── BestTime response shapes (subset) ───────────────────────────────
interface BestTimeHourAnalysis {
  hour: number;
  intensity_nr: number; // 0-100
  intensity_txt: string; // "Low" | "Average" | "High" | "Very High"
}

interface BestTimeDayAnalysis {
  day_info: { day_int: number; day_text: string };
  hour_analysis: BestTimeHourAnalysis[];
  peak_hours: { peak_start: number; peak_end: number }[];
  quiet_hours: { quiet_start: number; quiet_end: number }[];
}

// ─── Google Routes response shapes (subset) ──────────────────────────
interface GoogleRoutesRoute {
  duration: string; // e.g. "843s"
  staticDuration: string; // without traffic
  distanceMeters: number;
}

class BusynessService {
  // Simple in-memory cache: venueKey → { data, timestamp }
  private cache = new Map<string, { data: BusynessData; ts: number }>();
  private tzCache = new Map<string, { offsetSec: number; ts: number }>();
  private CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private TZ_CACHE_TTL = 60 * 60 * 1000; // 1 hour (timezone offsets change rarely)

  /**
   * Get the current local time at a specific lat/lng using the Google Time Zone API.
   * Falls back to device time if the API call fails or no key is configured.
   */
  private async getLocalTimeAtVenue(lat: number, lng: number): Promise<Date> {
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn("[BusynessService] No GOOGLE_MAPS_API_KEY — using device time");
      return new Date();
    }

    const tzCacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
    const cached = this.tzCache.get(tzCacheKey);
    if (cached && Date.now() - cached.ts < this.TZ_CACHE_TTL) {
      // Apply cached offset: UTC epoch + offset = venue local epoch
      const utcNow = Math.floor(Date.now() / 1000);
      const localEpoch = (utcNow + cached.offsetSec) * 1000;
      return new Date(localEpoch);
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const url =
        `https://maps.googleapis.com/maps/api/timezone/json` +
        `?location=${lat},${lng}&timestamp=${timestamp}&key=${GOOGLE_MAPS_API_KEY}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.warn("[TimeZone] HTTP error:", response.status);
        return new Date();
      }

      const data = await response.json();
      if (data.status !== "OK") {
        console.warn("[TimeZone] API error:", data.status, data.errorMessage);
        return new Date();
      }

      // rawOffset = UTC offset for the timezone (seconds)
      // dstOffset = additional DST offset (seconds)
      const totalOffsetSec: number = (data.rawOffset ?? 0) + (data.dstOffset ?? 0);

      // Cache the offset
      this.tzCache.set(tzCacheKey, { offsetSec: totalOffsetSec, ts: Date.now() });

      // Build a Date whose getHours()/getDay() reflect the venue's local time.
      // We shift the UTC epoch by the venue's offset so that getUTCHours() etc.
      // return venue-local values, then wrap in a Date.
      const utcNow = Math.floor(Date.now() / 1000);
      const localEpoch = (utcNow + totalOffsetSec) * 1000;
      const venueDate = new Date(localEpoch);

      console.log(
        `[TimeZone] Venue (${lat.toFixed(2)},${lng.toFixed(2)}): ` +
          `offset=${totalOffsetSec / 3600}h, local=${venueDate.getUTCHours()}:${venueDate.getUTCMinutes().toString().padStart(2, "0")} ` +
          `(device=${new Date().getHours()}:${new Date().getMinutes().toString().padStart(2, "0")})`
      );

      return venueDate;
    } catch (error) {
      console.error("[TimeZone] Error fetching timezone:", error);
      return new Date();
    }
  }

  /**
   * Extract hour and day-of-week from a venue-local Date.
   * If the Date was built via getLocalTimeAtVenue(), use getUTC* methods
   * (because we shifted the epoch). For a plain new Date(), use local methods.
   * To keep it simple we always use getUTC* since getLocalTimeAtVenue
   * returns an epoch-shifted Date where UTC = venue local.
   */
  private getVenueHour(venueDate: Date): number {
    return venueDate.getUTCHours();
  }

  private getVenueDay(venueDate: Date): number {
    return venueDate.getUTCDay(); // 0=Sun … 6=Sat
  }

  /**
   * Main entry point — get busyness + traffic for a venue.
   */
  async getVenueBusyness(
    venueName: string,
    lat: number,
    lng: number,
    address?: string,
    _placeId?: string
  ): Promise<BusynessData | null> {
    // ── Check cache ──
    const cacheKey = `${venueName}_${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
      return cached.data;
    }

    // ── Resolve the current local time at the venue ──
    const venueNow = await this.getLocalTimeAtVenue(lat, lng);

    // ── Try BestTime (real foot-traffic) ──
    let busynessResult: BusynessData | null = null;
    if (BESTTIME_API_KEY) {
      busynessResult = await this.fetchBestTimeBusyness(venueName, address, lat, lng, venueNow);
    }

    // ── If BestTime failed or no key, use time-of-day heuristic ──
    if (!busynessResult) {
      busynessResult = this.getTimeBasedHeuristic(venueNow);
    }

    // ── Attach real traffic info from Google Routes ──
    if (GOOGLE_MAPS_API_KEY) {
      const traffic = await this.fetchGoogleRoutesTraffic(lat, lng);
      if (traffic) {
        busynessResult.trafficInfo = traffic;
      }
    }

    // If still no trafficInfo, use heuristic
    if (!busynessResult.trafficInfo) {
      busynessResult.trafficInfo = this.estimateTrafficConditions(venueNow);
    }

    // ── Cache & return ──
    this.cache.set(cacheKey, { data: busynessResult, ts: Date.now() });
    return busynessResult;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BestTime.app Integration
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Fetch real foot-traffic data from BestTime.app
   * Uses the "forecast" endpoint to get week-long hourly data,
   * then extracts the current hour's live intensity.
   */
  private async fetchBestTimeBusyness(
    venueName: string,
    address: string | undefined,
    lat: number,
    lng: number,
    venueNow: Date
  ): Promise<BusynessData | null> {
    // BestTime is picky about venue matching. Try multiple search strategies
    // in order of specificity until one succeeds.
    const attempts: { venue_name: string; venue_address: string }[] = [];

    if (address) {
      // Strategy 1: name + bare address (don't duplicate the name in address)
      attempts.push({ venue_name: venueName, venue_address: address });
      // Strategy 2: use just the address as both fields (BestTime often resolves this)
      attempts.push({ venue_name: address, venue_address: address });
    }
    // Strategy 3: name only (fallback for well-known venues)
    attempts.push({ venue_name: venueName, venue_address: venueName });

    for (const attempt of attempts) {
      const result = await this.callBestTimeForecast(attempt.venue_name, attempt.venue_address, venueNow);
      if (result) return result;
    }

    console.warn("[BestTime] All search strategies failed for:", venueName);
    return null;
  }

  /**
   * Single BestTime forecast API call.
   * Returns null if the venue isn't found or there's an error.
   */
  private async callBestTimeForecast(
    venueName: string,
    venueAddress: string,
    venueNow: Date
  ): Promise<BusynessData | null> {
    try {
      const params = new URLSearchParams({
        api_key_private: BESTTIME_API_KEY,
        venue_name: venueName,
        venue_address: venueAddress,
      });
      const forecastUrl = `${BESTTIME_BASE_URL}/forecasts?${params.toString()}`;
      const response = await fetch(forecastUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        console.warn("[BestTime] HTTP error:", response.status);
        return null;
      }

      const data = await response.json();

      if (data.status !== "OK" || !data.analysis) {
        console.warn("[BestTime] No analysis in response:", data.message || data.status);
        return null;
      }

      const analyses: BestTimeDayAnalysis[] = data.analysis;

      // Convert to our PopularTime format
      const dayMap: Record<number, string> = {
        0: "Monday",
        1: "Tuesday",
        2: "Wednesday",
        3: "Thursday",
        4: "Friday",
        5: "Saturday",
        6: "Sunday",
      };

      const popularTimes: PopularTime[] = analyses.map((day) => ({
        day: dayMap[day.day_info.day_int] || day.day_info.day_text,
        times: day.hour_analysis.map((h) => ({
          hour: `${h.hour.toString().padStart(2, "0")}:00`,
          popularity: h.intensity_nr,
        })),
      }));

      // Get current hour's popularity — use venue's local time, not device time
      const jsDay = this.getVenueDay(venueNow); // 0=Sun … 6=Sat
      // BestTime: 0=Mon … 6=Sun  →  convert JS day
      const bestTimeDay = jsDay === 0 ? 6 : jsDay - 1;
      const currentHour = this.getVenueHour(venueNow);

      const todayAnalysis = analyses.find(
        (d) => d.day_info.day_int === bestTimeDay
      );
      const currentHourEntry = todayAnalysis?.hour_analysis.find(
        (h) => h.hour === currentHour
      );

      const currentPopularity = currentHourEntry?.intensity_nr ?? 30;
      const busynessLevel = this.calculateBusynessLevel(currentPopularity);

      // Build a smarter message using peak/quiet data
      const peakHours = todayAnalysis?.peak_hours ?? [];
      const quietHours = todayAnalysis?.quiet_hours ?? [];
      const message = this.buildBestTimeMessage(
        busynessLevel,
        currentPopularity,
        peakHours,
        quietHours
      );

      console.log(
        `[BestTime] ${venueName}: ${currentPopularity}% (${busynessLevel}) at ${currentHour}:00`
      );

      return {
        isBusy: currentPopularity > 50,
        busynessLevel,
        currentPopularity,
        popularTimes,
        message,
      };
    } catch (error) {
      console.error("[BestTime] Error:", error);
      return null;
    }
  }

  /**
   * Build a user-friendly message from BestTime peak/quiet data
   */
  private buildBestTimeMessage(
    level: BusynessData["busynessLevel"],
    popularity: number,
    peakHours: { peak_start: number; peak_end: number }[],
    quietHours: { quiet_start: number; quiet_end: number }[]
  ): string {
    const formatHr = (h: number | undefined | null): string | null => {
      if (h == null || isNaN(h)) return null;
      const ampm = h >= 12 ? "PM" : "AM";
      const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${display} ${ampm}`;
    };

    // Helper to format a time range, returning null if either hour is missing
    const formatRange = (start: number | undefined | null, end: number | undefined | null): string | null => {
      const s = formatHr(start);
      const e = formatHr(end);
      if (!s || !e) return null;
      return `${s} – ${e}`;
    };

    if (level === "Very Busy") {
      if (quietHours.length > 0) {
        const q = quietHours[0];
        const range = formatRange(q.quiet_start, q.quiet_end);
        if (range) {
          return `Very busy right now (${popularity}%). Try visiting around ${range} for fewer crowds.`;
        }
      }
      return `Very busy right now (${popularity}%). Consider visiting at a different time.`;
    }

    if (level === "Busy") {
      if (quietHours.length > 0) {
        const q = quietHours[0];
        const range = formatRange(q.quiet_start, q.quiet_end);
        if (range) {
          return `Getting busy (${popularity}%). Less crowded around ${range}.`;
        }
      }
      return `Getting busy (${popularity}%). Expect moderate crowds.`;
    }

    if (level === "Moderate") {
      if (peakHours.length > 0) {
        const p = peakHours[0];
        const range = formatRange(p.peak_start, p.peak_end);
        if (range) {
          return `Moderate crowd (${popularity}%). Peak hours: ${range}.`;
        }
      }
      return `Moderate crowd (${popularity}%). Good time to visit.`;
    }

    // Not Busy
    return `Not busy (${popularity}%) — great time to visit!`;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Google Routes API — Real Traffic & Travel Time
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Fetch real-time travel duration using Google Routes API.
   * Requests TRAFFIC_AWARE routing to get actual vs. static duration.
   */
  private async fetchGoogleRoutesTraffic(
    destLat: number,
    destLng: number
  ): Promise<TrafficInfo | null> {
    try {
      // We need the user's current location as origin.
      // Import is deferred to avoid circular deps; fall back to heuristic if unavailable.
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

      const response = await fetch(GOOGLE_ROUTES_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: { latitude: originLat, longitude: originLng },
            },
          },
          destination: {
            location: {
              latLng: { latitude: destLat, longitude: destLng },
            },
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
      });

      if (!response.ok) {
        console.warn("[GoogleRoutes] HTTP error:", response.status);
        console.log("[GoogleRoutes] Error:", await response.text());
        return null;
      }

      const data = await response.json();
      const route: GoogleRoutesRoute | undefined = data.routes?.[0];
      if (!route) return null;

      // duration is like "843s", staticDuration is like "720s"
      const durationSec = parseInt(route.duration.replace("s", ""), 10) || 0;
      const staticSec = parseInt(route.staticDuration.replace("s", ""), 10) || 0;
      const durationMin = Math.ceil(durationSec / 60);

      // Determine traffic condition from the ratio of actual vs static
      const ratio = staticSec > 0 ? durationSec / staticSec : 1;
      let condition: TrafficInfo["trafficCondition"];
      if (ratio <= 1.1) {
        condition = "Light";
      } else if (ratio <= 1.35) {
        condition = "Moderate";
      } else {
        condition = "Heavy";
      }

      return {
        trafficCondition: condition,
        currentTravelTime: `${durationMin} min`,
      };
    } catch (error) {
      console.error("[GoogleRoutes] Error:", error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Heuristic Fallbacks
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Time-of-day based busyness when BestTime API is unavailable.
   * Uses day-of-week and hour to approximate crowd levels.
   * Now uses venue-local time instead of device time.
   */
  private getTimeBasedHeuristic(venueNow: Date): BusynessData {
    const hour = this.getVenueHour(venueNow);
    const dayOfWeek = this.getVenueDay(venueNow);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let popularity: number;
    // Lunch peak
    if (hour >= 12 && hour <= 14) {
      popularity = isWeekend ? 70 : 60;
    }
    // Dinner peak
    else if (hour >= 18 && hour <= 20) {
      popularity = isWeekend ? 75 : 65;
    }
    // Weekend nightlife
    else if (hour >= 20 && hour <= 23 && isWeekend) {
      popularity = 65;
    }
    // Weekday morning commute
    else if (hour >= 7 && hour <= 9 && !isWeekend) {
      popularity = 45;
    }
    // Afternoon lull
    else if (hour >= 14 && hour < 18) {
      popularity = 35;
    }
    // Early morning / late night
    else {
      popularity = 20;
    }

    const busynessLevel = this.calculateBusynessLevel(popularity);

    // Generate a simple popular times array for the UI bar chart
    const popularTimes = this.generateHeuristicPopularTimes(isWeekend);

    return {
      isBusy: popularity > 50,
      busynessLevel,
      currentPopularity: popularity,
      popularTimes,
      message: this.generateMessageFromLevel(busynessLevel, popularity),
    };
  }

  /**
   * Generate a simple 7-day popular times array based on typical patterns.
   */
  private generateHeuristicPopularTimes(isWeekend: boolean): PopularTime[] {
    const days = [
      "Monday", "Tuesday", "Wednesday", "Thursday",
      "Friday", "Saturday", "Sunday",
    ];

    return days.map((day, idx) => {
      const isWE = idx >= 5; // Fri=4 is weekday in this array; Sat=5, Sun=6
      const times = Array.from({ length: 24 }, (_, h) => {
        let pop = 10;
        if (h >= 7 && h < 9 && !isWE) pop = 45;
        else if (h >= 10 && h < 12 && isWE) pop = 55;
        else if (h >= 12 && h < 14) pop = isWE ? 70 : 60;
        else if (h >= 14 && h < 18) pop = 30;
        else if (h >= 18 && h < 20) pop = isWE ? 75 : 65;
        else if (h >= 20 && h < 23 && isWE) pop = 65;
        else if (h >= 20 && h < 22 && !isWE) pop = 40;
        return { hour: `${h.toString().padStart(2, "0")}:00`, popularity: pop };
      });
      return { day, times };
    });
  }

  /**
   * Estimate traffic conditions heuristically when Google Routes is unavailable.
   * Uses venue-local time instead of device time.
   */
  private estimateTrafficConditions(venueNow: Date): TrafficInfo {
    const hour = this.getVenueHour(venueNow);
    const isWeekend = this.getVenueDay(venueNow) === 0 || this.getVenueDay(venueNow) === 6;

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
      } else if ((hour >= 12 && hour <= 14) || (hour >= 16 && hour < 17) || (hour > 19 && hour <= 20)) {
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

  // ═══════════════════════════════════════════════════════════════════
  //  Shared Helpers
  // ═══════════════════════════════════════════════════════════════════

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
