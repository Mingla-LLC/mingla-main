/**
 * geocodingService — META-ORCH-1060 §3.9; Google Maps Platform since #4334.
 *
 * Thin adapter over the shared @mingla/location-input places service. The
 * public signatures + caches are kept so every script-style caller
 * (localeDetection, DiscoverScreen device city, useUserLocation legacy
 * fallback, PreferencesSheet ORCH-0943 auto-resolve) keeps working.
 *
 *   - autocomplete(query)     → proxy `forward` (Google Geocoding, English):
 *     the single best match WITH coordinates AND its Google placeId (spec v2
 *     A3.3), so a typed-and-saved anchor can be refreshed.
 *   - reverseGeocode(lat,lng) → proxy `reverse` (Google Geocoding, the D1
 *     city rule: every Lagos State point is "Lagos").
 *
 * Loud failures (spec v2 A3.4, D7): autocomplete returns [] ONLY when nothing
 * matched; when search itself is down it throws LocationSearchUnavailableError
 * (and reports it, throttled, to Sentry). useUserLocation already catches, so
 * its behaviour is unchanged. The 5-minute autocomplete cache and its key are
 * unchanged (A3.6).
 */

import {
  forwardGeocode,
  PlacesServiceError,
  reverseGeocode,
  type InvokeFn,
  type PlaceDetails,
} from "@mingla/location-input";
import { supabase } from "./supabase";
import { reportAddressSearchUnavailable } from "./addressSearchTelemetry";
import { formatCoordinates } from "../utils/numberFormatter";

interface GeocodingResult {
  city?: string;
  state?: string;
  country?: string;
  /** ISO 3166-1 alpha-2 (e.g. "GB") — structured, never parsed. */
  countryCode?: string;
  /**
   * #4334 F-10 — ISO 3166-2 subdivision code (e.g. "NC", "LA"), or undefined.
   * `state` is the region's display NAME; a code column must read this.
   */
  stateCode?: string;
  formattedAddress?: string;
  error?: string;
}

export interface AutocompleteSuggestion {
  displayName: string;
  fullAddress: string;
  location?: { lat: number; lng: number };
  /** #4334 A3.3 — the Google place id, persisted as custom_location_place_id. */
  placeId?: string;
}

/** #4334 A3.4 — location search is down (not "no match"). */
export class LocationSearchUnavailableError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`location_search_unavailable:${code}`);
    this.name = "LocationSearchUnavailableError";
    this.code = code;
  }
}

/** Proxy codes that mean "nothing matched" rather than "search is down". */
const NO_MATCH_CODES: ReadonlySet<string> = new Set(["no_location", "no_locality", "query_required"]);

const invoke: InvokeFn = (fn, options) =>
  supabase.functions.invoke(fn, options);

class GeocodingService {
  private cache: Map<string, GeocodingResult> = new Map();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  // Autocomplete result cache — 5min TTL, max 50 entries
  private autocompleteCache = new Map<
    string,
    { results: AutocompleteSuggestion[]; ts: number }
  >();
  private readonly AUTOCOMPLETE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly AUTOCOMPLETE_CACHE_MAX = 50;

  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<GeocodingResult> {
    try {
      // Create cache key
      const cacheKey = `${formatCoordinates(latitude)},${formatCoordinates(
        longitude
      )}`;

      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      // Check for common locations first (offline fallback — no network)
      const commonLocation = this.getCommonLocation(latitude, longitude);
      if (commonLocation) {
        const result: GeocodingResult = {
          city: commonLocation.city,
          state: commonLocation.state,
          country: commonLocation.country,
          countryCode: commonLocation.countryCode,
          formattedAddress: commonLocation.formattedAddress,
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      // Reverse geocode through the proxy (Google Geocoding, English).
      const details: PlaceDetails = await reverseGeocode(latitude, longitude, { invoke });

      const result: GeocodingResult = {
        city: details.city || undefined,
        state: details.region || undefined,
        country: details.countryCode || undefined, // ISO code (callers prefer countryCode)
        countryCode: details.countryCode || undefined,
        stateCode: details.regionCode || undefined,
        formattedAddress: details.formattedAddress || undefined,
      };

      // Cache the result
      this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      console.error("Geocoding error:", error);
      return {
        error: "Unable to determine location name",
        formattedAddress: `${formatCoordinates(latitude)}, ${formatCoordinates(
          longitude
        )}`,
      };
    }
  }

  private getCommonLocation(latitude: number, longitude: number): any | null {
    // Common locations with approximate coordinates (offline fallback).
    const commonLocations = [
      { lat: 40.7128, lng: -74.006, city: "New York", state: "NY", country: "US", countryCode: "US", formattedAddress: "New York, NY, USA", tolerance: 0.1 },
      { lat: 34.0522, lng: -118.2437, city: "Los Angeles", state: "CA", country: "US", countryCode: "US", formattedAddress: "Los Angeles, CA, USA", tolerance: 0.1 },
      { lat: 51.5074, lng: -0.1278, city: "London", state: "England", country: "GB", countryCode: "GB", formattedAddress: "London, England, UK", tolerance: 0.1 },
      { lat: 48.8566, lng: 2.3522, city: "Paris", state: "Île-de-France", country: "FR", countryCode: "FR", formattedAddress: "Paris, France", tolerance: 0.1 },
      { lat: 35.6762, lng: 139.6503, city: "Tokyo", state: "Tokyo", country: "JP", countryCode: "JP", formattedAddress: "Tokyo, Japan", tolerance: 0.1 },
      { lat: 37.7749, lng: -122.4194, city: "San Francisco", state: "CA", country: "US", countryCode: "US", formattedAddress: "San Francisco, CA, USA", tolerance: 0.1 },
      { lat: 41.8781, lng: -87.6298, city: "Chicago", state: "IL", country: "US", countryCode: "US", formattedAddress: "Chicago, IL, USA", tolerance: 0.1 },
      { lat: 25.7617, lng: -80.1918, city: "Miami", state: "FL", country: "US", countryCode: "US", formattedAddress: "Miami, FL, USA", tolerance: 0.1 },
    ];

    for (const location of commonLocations) {
      const latDiff = Math.abs(latitude - location.lat);
      const lngDiff = Math.abs(longitude - location.lng);

      if (latDiff <= location.tolerance && lngDiff <= location.tolerance) {
        return location;
      }
    }

    return null;
  }

  // Get a short, user-friendly location name
  async getLocationName(latitude: number, longitude: number): Promise<string> {
    try {
      const result = await this.reverseGeocode(latitude, longitude);

      if (result.error) {
        return (
          result.formattedAddress ||
          `${formatCoordinates(latitude)}, ${formatCoordinates(longitude)}`
        );
      }

      // Return the most specific location name available
      if (result.city && result.state) {
        return `${result.city}, ${result.state}`;
      } else if (result.city) {
        return result.city;
      } else if (result.state) {
        return result.state;
      } else if (result.country) {
        return result.country;
      } else {
        return result.formattedAddress || "Unknown location";
      }
    } catch (error) {
      console.error("Error getting location name:", error);
      return `${formatCoordinates(latitude)}, ${formatCoordinates(longitude)}`;
    }
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }

  // Get cache stats
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Autocomplete location suggestions: the single best match for typed text,
   * with coordinates and its Google placeId (one proxy `forward` call).
   * Returns [] when nothing matched; THROWS LocationSearchUnavailableError when
   * search is down (#4334 A3.4) — never an empty list for an outage.
   */
  async autocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    if (!query || query.length < 3) {
      return [];
    }

    // Check autocomplete cache first
    const cacheKey = query.toLowerCase().trim();
    const cached = this.autocompleteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.AUTOCOMPLETE_CACHE_TTL) {
      return cached.results;
    }

    let details: PlaceDetails;
    try {
      details = await forwardGeocode(query, { invoke });
    } catch (error) {
      const code = error instanceof PlacesServiceError ? error.code : "network";
      if (NO_MATCH_CODES.has(code)) return [];
      reportAddressSearchUnavailable(code);
      throw new LocationSearchUnavailableError(code);
    }
    const results: AutocompleteSuggestion[] = [
      {
        displayName: details.city || details.formattedAddress,
        fullAddress: details.formattedAddress,
        location: { lat: details.location.lat, lng: details.location.lng },
        ...(details.placeId ? { placeId: details.placeId } : {}),
      },
    ];
    this.cacheAutocompleteResult(cacheKey, results);
    return results;
  }

  // Store autocomplete result in cache with LRU eviction
  private cacheAutocompleteResult(
    key: string,
    results: AutocompleteSuggestion[]
  ): void {
    this.autocompleteCache.set(key, { results, ts: Date.now() });

    // Evict oldest entry if over limit
    if (this.autocompleteCache.size > this.AUTOCOMPLETE_CACHE_MAX) {
      const oldest = [...this.autocompleteCache.entries()].sort(
        (a, b) => a[1].ts - b[1].ts
      )[0];
      if (oldest) {
        this.autocompleteCache.delete(oldest[0]);
      }
    }
  }
}

export const geocodingService = new GeocodingService();
