import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserPreferences } from '../services/experiencesService';
import { enhancedLocationService } from '../services/enhancedLocationService';
import { geocodingService } from '../services/geocodingService';

export interface LocationData {
  lat: number;
  lng: number;
}

const LOCATION_CACHE_KEY = '@mingla/lastLocation';

// Module-level cached location — populated asynchronously from AsyncStorage on import
let cachedLocationSync: LocationData | null = null;
AsyncStorage.getItem(LOCATION_CACHE_KEY).then(raw => {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.lat && parsed.lng) cachedLocationSync = { lat: parsed.lat, lng: parsed.lng };
    } catch {}
  }
}).catch(() => {});

const fetchLocationCore = async (
  userId: string | undefined,
  currentMode: string,
  refreshKey: number | string | undefined,
  customLocation: string | null | undefined,
  useGpsFlag: boolean | undefined
): Promise<LocationData | null> => {
  if (!userId) {
    // Fallback to GPS for anonymous users
    const location = await enhancedLocationService.getCurrentLocation();
    if (location) {
      return { lat: location.latitude, lng: location.longitude };
    }
    const lastKnown = await enhancedLocationService.getLastKnownLocation();
    if (lastKnown) {
      return { lat: lastKnown.latitude, lng: lastKnown.longitude };
    }
    return null; // No location available for anonymous user
  }

  // Determine whether to use GPS or custom location
  const useGps = (useGpsFlag !== false); // default true

  if (!useGps && customLocation) {
    const coordinatesMatch = customLocation.match(
      /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/
    );

    if (coordinatesMatch) {
      const lat = parseFloat(coordinatesMatch[1]);
      const lng = parseFloat(coordinatesMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        console.log('Using saved coordinates from preferences:', { lat, lng });
        return { lat, lng };
      }
    } else {
      // Geocode address string via HTTP API — NOT native Location.geocodeAsync
      // (native forward geocode shares rate bucket with reverseGeocodeAsync)
      try {
        const suggestions = await geocodingService.autocomplete(customLocation);
        const firstWithLocation = suggestions.find(s => s.location);
        if (firstWithLocation?.location) {
          console.log('Using geocoded location from preferences:', customLocation);
          return { lat: firstWithLocation.location.lat, lng: firstWithLocation.location.lng };
        }
      } catch {
        // fall through to GPS
      }
    }
  }

  // Fall back to GPS
  console.log('Using current GPS location');
  const location = await enhancedLocationService.getCurrentLocation();
  if (location) {
    return { lat: location.latitude, lng: location.longitude };
  }
  const lastKnown = await enhancedLocationService.getLastKnownLocation();
  if (lastKnown) {
    return { lat: lastKnown.latitude, lng: lastKnown.longitude };
  }
  // No GPS available — return null to signal "location unavailable"
  // Callers must handle null gracefully (show prompt, use last cached, etc.)
  // Do NOT return a hardcoded default — it corrupts location-based results
  return null;
};

// Wraps fetchLocationCore in a 13-second total timeout (10s GPS + 3s buffer for
// last-known fallback). Without a cap, the total operation has no bound.
const fetchUserLocation = async (
  userId: string | undefined,
  currentMode: string,
  refreshKey: number | string | undefined,
  customLocation: string | null | undefined,
  useGpsFlag: boolean | undefined
): Promise<LocationData | null> => {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("useUserLocation timed out after 13s")),
      13000
    )
  );
  return Promise.race([
    fetchLocationCore(userId, currentMode, refreshKey, customLocation, useGpsFlag),
    timeoutPromise,
  ]);
};

export const useUserLocation = (
  userId: string | undefined,
  currentMode: string,
  refreshKey: number | string | undefined
) => {
  // Read current preferences from React Query cache to get location fields.
  // CRITICAL: Normalize undefined → stable defaults so the query key does NOT change
  // when preferences load. Before prefs load, cachedPrefs is undefined, so both values
  // are undefined. After prefs load, they become null/true. Normalizing prevents this
  // transition from changing the query key and triggering a redundant location refetch.
  const cachedPrefs = useQueryClient().getQueryData<UserPreferences>(
    ['userPreferences', userId]
  );
  const customLocation = cachedPrefs?.custom_location ?? null;
  const useGpsFlag = cachedPrefs?.use_gps_location ?? true;

  const query = useQuery({
    queryKey: ['userLocation', userId, currentMode, refreshKey, customLocation, useGpsFlag],
    queryFn: () => fetchUserLocation(userId, currentMode, refreshKey, customLocation, useGpsFlag),
    enabled: true,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    initialData: cachedLocationSync ?? undefined,
  });

  // Persist resolved location to AsyncStorage for instant startup on next launch
  useEffect(() => {
    if (query.data?.lat && query.data?.lng) {
      AsyncStorage.setItem(
        LOCATION_CACHE_KEY,
        JSON.stringify({ lat: query.data.lat, lng: query.data.lng, ts: Date.now() })
      ).catch(() => {});
    }
  }, [query.data?.lat, query.data?.lng]);

  return query;
};
