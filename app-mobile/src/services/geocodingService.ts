import { formatCoordinates } from "../utils/numberFormatter";

interface GeocodingResult {
  city?: string;
  state?: string;
  country?: string;
  formattedAddress?: string;
  error?: string;
}

export interface AutocompleteSuggestion {
  displayName: string;
  fullAddress: string;
  placeId?: string;
  location?: { lat: number; lng: number };
}

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

      // Check for common locations first (fallback)
      const commonLocation = this.getCommonLocation(latitude, longitude);
      if (commonLocation) {
        const result: GeocodingResult = {
          city: commonLocation.city,
          state: commonLocation.state,
          country: commonLocation.country,
          formattedAddress: commonLocation.formattedAddress,
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      // Use a free geocoding service (OpenStreetMap Nominatim)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
        {
          headers: {
            "User-Agent": "Mingla-Mobile-App/1.0",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data || data.error) {
        throw new Error("Invalid geocoding response");
      }

      const result: GeocodingResult = {
        city: this.extractCity(data),
        state: this.extractState(data),
        country: this.extractCountry(data),
        formattedAddress: this.formatAddress(data),
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

  private extractCity(data: any): string | undefined {
    const address = data.address;
    if (!address) return undefined;

    // Try different city fields in order of preference
    return (
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      address.state_district
    );
  }

  private extractState(data: any): string | undefined {
    const address = data.address;
    if (!address) return undefined;

    return address.state || address.province || address.region;
  }

  private extractCountry(data: any): string | undefined {
    const address = data.address;
    if (!address) return undefined;

    return address.country;
  }

  private formatAddress(data: any): string {
    const city = this.extractCity(data);
    const state = this.extractState(data);
    const country = this.extractCountry(data);

    if (city && state && country) {
      return `${city}, ${state}, ${country}`;
    } else if (city && country) {
      return `${city}, ${country}`;
    } else if (city) {
      return city;
    } else if (state && country) {
      return `${state}, ${country}`;
    } else if (country) {
      return country;
    } else {
      return data.display_name || "Unknown location";
    }
  }

  private getCommonLocation(latitude: number, longitude: number): any | null {
    // Common locations with approximate coordinates
    const commonLocations = [
      {
        lat: 40.7128,
        lng: -74.006,
        city: "New York",
        state: "NY",
        country: "USA",
        formattedAddress: "New York, NY, USA",
        tolerance: 0.1,
      },
      {
        lat: 34.0522,
        lng: -118.2437,
        city: "Los Angeles",
        state: "CA",
        country: "USA",
        formattedAddress: "Los Angeles, CA, USA",
        tolerance: 0.1,
      },
      {
        lat: 51.5074,
        lng: -0.1278,
        city: "London",
        state: "England",
        country: "UK",
        formattedAddress: "London, England, UK",
        tolerance: 0.1,
      },
      {
        lat: 48.8566,
        lng: 2.3522,
        city: "Paris",
        state: "Île-de-France",
        country: "France",
        formattedAddress: "Paris, France",
        tolerance: 0.1,
      },
      {
        lat: 35.6762,
        lng: 139.6503,
        city: "Tokyo",
        state: "Tokyo",
        country: "Japan",
        formattedAddress: "Tokyo, Japan",
        tolerance: 0.1,
      },
      {
        lat: 37.7749,
        lng: -122.4194,
        city: "San Francisco",
        state: "CA",
        country: "USA",
        formattedAddress: "San Francisco, CA, USA",
        tolerance: 0.1,
      },
      {
        lat: 41.8781,
        lng: -87.6298,
        city: "Chicago",
        state: "IL",
        country: "USA",
        formattedAddress: "Chicago, IL, USA",
        tolerance: 0.1,
      },
      {
        lat: 25.7617,
        lng: -80.1918,
        city: "Miami",
        state: "FL",
        country: "USA",
        formattedAddress: "Miami, FL, USA",
        tolerance: 0.1,
      },
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

  // Autocomplete location suggestions
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
      // Option 1: Use Google Places Autocomplete API (if available)
      const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

      if (GOOGLE_API_KEY) {
        try {
          const response = await fetch(
            `https://places.googleapis.com/v1/places:autocomplete`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE_API_KEY,
                "X-Goog-FieldMask":
                  "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
              },
              body: JSON.stringify({
                input: query,
                /*  includedRegionCodes: ["us", "ca", "mx", "gb", "au", "nz"], */
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();

            const suggestions = (data.suggestions || [])
              .filter((s: any) => s.placePrediction)
              .map((suggestion: any) => ({
                displayName: suggestion.placePrediction?.text?.text || "",
                fullAddress: suggestion.placePrediction?.text?.text || "",
                placeId: suggestion.placePrediction?.placeId,
              }));

            if (suggestions.length > 0) {
              this.cacheAutocompleteResult(cacheKey, suggestions);
              return suggestions;
            }
          }
        } catch (googleError) {
          console.warn(
            "Google Places Autocomplete failed, falling back to OpenStreetMap:",
            googleError
          );
          // Fall through to OpenStreetMap
        }
      }

      // Option 2: Fallback to OpenStreetMap Nominatim (free, but rate-limited)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&limit=5&addressdetails=1`,
        {
          headers: {
            "User-Agent": "Mingla-Mobile-App/1.0",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Autocomplete API error: ${response.status}`);
      }

      const data = await response.json();

      const results = (data || []).map((item: any) => {
        const address = item.address || {};
        const city = address.city || address.town || address.village || "";
        const state = address.state || address.province || "";
        const country = address.country || "";

        // Create a display name (city, state or city, country)
        let displayName = "";
        if (city && state) {
          displayName = `${city}, ${state}`;
        } else if (city && country) {
          displayName = `${city}, ${country}`;
        } else if (city) {
          displayName = city;
        } else {
          displayName = item.display_name.split(",")[0];
        }

        return {
          displayName: displayName,
          fullAddress: item.display_name,
          location: {
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
          },
        };
      });

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
