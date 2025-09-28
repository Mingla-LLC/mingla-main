import { formatCoordinates } from '../utils/numberFormatter';

interface GeocodingResult {
  city?: string;
  state?: string;
  country?: string;
  formattedAddress?: string;
  error?: string;
}

class GeocodingService {
  private cache: Map<string, GeocodingResult> = new Map();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  async reverseGeocode(latitude: number, longitude: number): Promise<GeocodingResult> {
    try {
      // Create cache key
      const cacheKey = `${formatCoordinates(latitude)},${formatCoordinates(longitude)}`;
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached) {
        console.log('Returning cached geocoding result');
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
            'User-Agent': 'Mingla-Mobile-App/1.0',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data || data.error) {
        throw new Error('Invalid geocoding response');
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
      console.error('Geocoding error:', error);
      return {
        error: 'Unable to determine location name',
        formattedAddress: `${formatCoordinates(latitude)}, ${formatCoordinates(longitude)}`,
      };
    }
  }

  private extractCity(data: any): string | undefined {
    const address = data.address;
    if (!address) return undefined;

    // Try different city fields in order of preference
    return address.city || 
           address.town || 
           address.village || 
           address.municipality ||
           address.county ||
           address.state_district;
  }

  private extractState(data: any): string | undefined {
    const address = data.address;
    if (!address) return undefined;

    return address.state || 
           address.province || 
           address.region;
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
      return data.display_name || 'Unknown location';
    }
  }

  private getCommonLocation(latitude: number, longitude: number): any | null {
    // Common locations with approximate coordinates
    const commonLocations = [
      {
        lat: 40.7128,
        lng: -74.0060,
        city: 'New York',
        state: 'NY',
        country: 'USA',
        formattedAddress: 'New York, NY, USA',
        tolerance: 0.1
      },
      {
        lat: 34.0522,
        lng: -118.2437,
        city: 'Los Angeles',
        state: 'CA',
        country: 'USA',
        formattedAddress: 'Los Angeles, CA, USA',
        tolerance: 0.1
      },
      {
        lat: 51.5074,
        lng: -0.1278,
        city: 'London',
        state: 'England',
        country: 'UK',
        formattedAddress: 'London, England, UK',
        tolerance: 0.1
      },
      {
        lat: 48.8566,
        lng: 2.3522,
        city: 'Paris',
        state: 'Île-de-France',
        country: 'France',
        formattedAddress: 'Paris, France',
        tolerance: 0.1
      },
      {
        lat: 35.6762,
        lng: 139.6503,
        city: 'Tokyo',
        state: 'Tokyo',
        country: 'Japan',
        formattedAddress: 'Tokyo, Japan',
        tolerance: 0.1
      },
      {
        lat: 37.7749,
        lng: -122.4194,
        city: 'San Francisco',
        state: 'CA',
        country: 'USA',
        formattedAddress: 'San Francisco, CA, USA',
        tolerance: 0.1
      },
      {
        lat: 41.8781,
        lng: -87.6298,
        city: 'Chicago',
        state: 'IL',
        country: 'USA',
        formattedAddress: 'Chicago, IL, USA',
        tolerance: 0.1
      },
      {
        lat: 25.7617,
        lng: -80.1918,
        city: 'Miami',
        state: 'FL',
        country: 'USA',
        formattedAddress: 'Miami, FL, USA',
        tolerance: 0.1
      }
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
        return result.formattedAddress || `${formatCoordinates(latitude)}, ${formatCoordinates(longitude)}`;
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
        return result.formattedAddress || 'Unknown location';
      }
    } catch (error) {
      console.error('Error getting location name:', error);
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
}

export const geocodingService = new GeocodingService();
