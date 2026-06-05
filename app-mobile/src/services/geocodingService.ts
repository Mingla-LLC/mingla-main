/**
 * geocodingService — META-ORCH-1060 [Mapbox consumer migration] §3.9
 *
 * Thin Mapbox adapter over the shared @mingla/location-input service. ALL
 * legacy free-OSM geocoding usage has been removed (clean sweep — INV-1).
 * The public signatures + caches are PRESERVED so every script-style caller
 * (localeDetection, DiscoverScreen night-out, useUserLocation legacy fallback,
 * PreferencesSheet ORCH-0943 auto-resolve, OnboardingFlow) keeps compiling and
 * moves to Mapbox at once.
 *
 * Adapter mapping (SPEC §3.9):
 *   - autocomplete(query)  → Mapbox FORWARD geocode (edge `forward` action,
 *     ONE call per query, returns the best match WITH coords). We do NOT
 *     eager-retrieve top-N (that would be N billed sessions). Surfaces that
 *     need a full multi-row suggest→retrieve dropdown (CityPicker) use the
 *     shared MapboxAddressInput field directly, bypassing this adapter.
 *   - reverseGeocode(lat,lng) → Mapbox REVERSE geocode (edge `reverse` action).
 *
 * Calls proxy through the `mapbox-geocode` Supabase edge fn (token stays
 * server-side). Mapbox docs:
 *   forward https://docs.mapbox.com/api/search/search-box/
 *   reverse https://docs.mapbox.com/api/search/search-box/
 *   v6 fallback https://docs.mapbox.com/api/search/geocoding/
 */

import {
  forwardGeocodeMapbox,
  reverseGeocodeMapbox,
  type InvokeFn,
  type PlaceDetails,
} from "@mingla/location-input";
import { supabase } from "./supabase";
import { formatCoordinates } from "../utils/numberFormatter";

interface GeocodingResult {
  city?: string;
  state?: string;
  country?: string;
  /** META-ORCH-1060: ISO 3166-1 alpha-2 (e.g. "GB") — structured from Mapbox. */
  countryCode?: string;
  formattedAddress?: string;
  error?: string;
}

export interface AutocompleteSuggestion {
  displayName: string;
  fullAddress: string;
  location?: { lat: number; lng: number };
}

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

      // META-ORCH-1060: Mapbox reverse geocode via the edge fn (replaces the
      // legacy OSM reverse path). Returns structured city/region/regionCode/countryCode.
      const details: PlaceDetails = await reverseGeocodeMapbox(
        latitude,
        longitude,
        { invoke }
      );

      const result: GeocodingResult = {
        city: details.city || undefined,
        state: details.region || undefined,
        country: details.countryCode || undefined, // ISO code (callers prefer countryCode)
        countryCode: details.countryCode || undefined,
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
   * Autocomplete location suggestions.
   *
   * META-ORCH-1060: uses Mapbox FORWARD geocode (one edge call per query) and
   * returns the single best match WITH coords. Multi-row suggest→retrieve UX is
   * served by the shared MapboxAddressInput field (CityPicker), not this adapter
   * — keeping this path to ONE billed Mapbox request per query (SPEC §3.9/§10).
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

    try {
      const details: PlaceDetails = await forwardGeocodeMapbox(query, { invoke });
      const results: AutocompleteSuggestion[] = [
        {
          displayName: details.city || details.formattedAddress,
          fullAddress: details.formattedAddress,
          location: { lat: details.location.lat, lng: details.location.lng },
        },
      ];

      if (results.length > 0) {
        this.cacheAutocompleteResult(cacheKey, results);
      }

      return results;
    } catch (error) {
      console.error("Autocomplete error:", error);
      return [];
    }
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
