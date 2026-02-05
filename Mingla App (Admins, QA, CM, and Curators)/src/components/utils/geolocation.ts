/**
 * Robust Geolocation Utility with Error Handling
 * Handles permissions policy, fallbacks, and browser compatibility
 */

export interface GeolocationResult {
  lat: number;
  lng: number;
  accuracy?: number;
  source: 'gps' | 'ip' | 'default';
  error?: string;
}

export interface GeolocationError {
  code: number;
  message: string;
  type: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'NOT_SUPPORTED' | 'PERMISSIONS_POLICY';
}

// Cache location result to avoid multiple API calls
let cachedLocation: GeolocationResult | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Track GPS availability to avoid repeated permission requests
let gpsAvailable: boolean | null = null;

/**
 * Get user's current location using GPS with proper error handling
 * Falls back to IP-based geolocation if GPS fails
 * Results are cached for 5 minutes to avoid repeated API calls
 */
export async function getCurrentLocation(forceRefresh: boolean = false): Promise<GeolocationResult> {
  // Return cached result if available and not expired
  if (!forceRefresh && cachedLocation && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedLocation;
  }
  // Check if geolocation is supported
  if (!navigator.geolocation) {
    gpsAvailable = false;
    return getIPBasedLocation();
  }

  // Skip GPS attempt if we already know it's not available
  if (gpsAvailable === false && !forceRefresh) {
    return getIPBasedLocation();
  }

  try {
    // Try GPS-based location first
    const position = await getGPSLocation();
    const result = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      source: 'gps' as const
    };
    
    // Cache the result and mark GPS as available
    cachedLocation = result;
    cacheTimestamp = Date.now();
    gpsAvailable = true;
    
    return result;
  } catch (error: any) {
    // Mark GPS as unavailable to prevent repeated attempts
    gpsAvailable = false;
    
    // Silently fall back to IP-based location
    // Only log if it's not a permissions policy error (which is expected in some environments)
    if (error?.type !== 'PERMISSIONS_POLICY') {
      console.info('GPS not available, using alternative location method');
    }
    
    // Fall back to IP-based location
    const result = await getIPBasedLocation();
    
    // Cache the fallback result
    cachedLocation = result;
    cacheTimestamp = Date.now();
    
    return result;
  }
}

/**
 * Get GPS location with timeout and error handling
 */
function getGPSLocation(timeout: number = 10000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: timeout,
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('✅ GPS location obtained:', {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
        resolve(position);
      },
      (error) => {
        const errorType = getGeolocationErrorType(error);
        
        // Only log errors that aren't expected (permissions policy errors are common in development)
        if (errorType !== 'PERMISSIONS_POLICY') {
          console.info('GPS location not available:', errorType);
        }
        
        reject({
          code: error.code,
          message: error.message,
          type: errorType
        });
      },
      options
    );
  });
}

/**
 * Get IP-based location as fallback
 * Uses ipapi.co free tier (1000 requests/day)
 */
async function getIPBasedLocation(): Promise<GeolocationResult> {
  try {
    const response = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    const data = await response.json();

    if (data.latitude && data.longitude) {
      console.info('Location obtained via IP geolocation');

      return {
        lat: data.latitude,
        lng: data.longitude,
        source: 'ip'
      };
    }
  } catch (error) {
    // Silently fall through to default location
  }

  // Final fallback to default location
  return getDefaultLocation();
}

/**
 * Get default location (San Francisco)
 * Used as last resort fallback
 */
function getDefaultLocation(): GeolocationResult {
  console.info('Using default location (San Francisco)');
  return {
    lat: 37.7749,
    lng: -122.4194,
    source: 'default'
  };
}

/**
 * Determine the type of geolocation error
 */
function getGeolocationErrorType(error: GeolocationPositionError): GeolocationError['type'] {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      // Check if it's a permissions policy issue
      if (error.message.includes('permissions policy')) {
        return 'PERMISSIONS_POLICY';
      }
      return 'PERMISSION_DENIED';
    case error.POSITION_UNAVAILABLE:
      return 'POSITION_UNAVAILABLE';
    case error.TIMEOUT:
      return 'TIMEOUT';
    default:
      return 'NOT_SUPPORTED';
  }
}

/**
 * Check if geolocation is available and allowed
 */
export async function isGeolocationAvailable(): Promise<boolean> {
  if (!navigator.geolocation) {
    return false;
  }

  // Check permissions API if available
  if ('permissions' in navigator) {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return result.state === 'granted' || result.state === 'prompt';
    } catch (error) {
      // Permissions API not fully supported, assume available
      return true;
    }
  }

  return true;
}

/**
 * Request geolocation permission explicitly
 */
export async function requestGeolocationPermission(): Promise<GeolocationResult> {
  try {
    const position = await getGPSLocation(5000);
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      source: 'gps'
    };
  } catch (error: any) {
    throw error;
  }
}

/**
 * Get user-friendly error message
 */
export function getGeolocationErrorMessage(errorType: GeolocationError['type']): string {
  const messages = {
    PERMISSION_DENIED: 'Location permission denied. Please enable location access in your browser settings.',
    PERMISSIONS_POLICY: 'Location access is blocked by your browser. This app needs to be served over HTTPS to use GPS location.',
    POSITION_UNAVAILABLE: 'Unable to determine your location. Please check your device settings.',
    TIMEOUT: 'Location request timed out. Please try again.',
    NOT_SUPPORTED: 'Your browser does not support geolocation.'
  };

  return messages[errorType] || 'Unable to get your location.';
}

/**
 * Parse location from Google Places result
 */
export function parseLocationFromPlaces(place: any): GeolocationResult {
  if (!place || !place.geometry || !place.geometry.location) {
    throw new Error('Invalid place object');
  }

  return {
    lat: typeof place.geometry.location.lat === 'function' 
      ? place.geometry.location.lat() 
      : place.geometry.location.lat,
    lng: typeof place.geometry.location.lng === 'function'
      ? place.geometry.location.lng()
      : place.geometry.location.lng,
    source: 'gps' // Searched location counts as precise
  };
}

/**
 * Format location for display
 */
export function formatLocation(location: GeolocationResult): string {
  return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
}

/**
 * Calculate distance between two locations (in km)
 * Uses Haversine formula
 */
export function calculateDistance(
  loc1: { lat: number; lng: number },
  loc2: { lat: number; lng: number }
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLon = toRad(loc2.lng - loc1.lng);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(loc1.lat)) * Math.cos(toRad(loc2.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}
