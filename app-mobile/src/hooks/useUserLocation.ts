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

// Module-level cached location — populated asynchronously from AsyncStorage on import.
// Exported for ORCH-0391 proximity check: RecommendationsContext compares this with the
// persisted deck location to decide whether to show cached cards on cold start.
// Do NOT use this for deck query keys or fetch params — it's a hint, not authoritative.
export let cachedLocationSync: LocationData | null = null;
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
  customLat: number | null,
  customLng: number | null,
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

  if (!useGps) {
    // Priority 1: Use saved coordinates (already resolved when user picked location)
    if (customLat != null && customLng != null) {
      console.log('Using saved custom coordinates from preferences:', { lat: customLat, lng: customLng });
      return { lat: customLat, lng: customLng };
    }

    // Priority 2: Geocode address string (fallback for legacy data without coords)
    if (customLocation) {
      const coordinatesMatch = customLocation.match(
        /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/
      );
      if (coordinatesMatch) {
        const lat = parseFloat(coordinatesMatch[1]);
        const lng = parseFloat(coordinatesMatch[2]);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
      }

      try {
        const suggestions = await geocodingService.autocomplete(customLocation);
        const firstWithLocation = suggestions.find(s => s.location);
        if (firstWithLocation?.location) {
          return { lat: firstWithLocation.location.lat, lng: firstWithLocation.location.lng };
        }
      } catch {
        // Geocoding failed — do NOT fall through to GPS silently
      }

      // Geocoding failed and no saved coordinates — return null, NOT GPS
      console.warn('[useUserLocation] Custom location set but no coords and geocode failed — returning null');
      return null;
    }

    // use_gps_location=false but no custom location or coords — return null
    return null;
  }

  // GPS mode
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
  customLat: number | null,
  customLng: number | null,
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
    fetchLocationCore(userId, currentMode, customLat, customLng, customLocation, useGpsFlag),
    timeoutPromise,
  ]);
};

export const useUserLocation = (
  userId: string | undefined,
  currentMode: string
) => {
  // Read current preferences from React Query cache to get location fields.
  // CRITICAL: Normalize undefined → stable defaults so the query key does NOT change
  // when preferences load. Before prefs load, cachedPrefs is undefined, so both values
  // are undefined. After prefs load, they become null/true. Normalizing prevents this
  // transition from changing the query key and triggering a redundant location refetch.
  const cachedPrefs = useQueryClient().getQueryData<UserPreferences>(
    ['userPreferences', userId]
  );
  const customLat = cachedPrefs?.custom_lat ?? null;
  const customLng = cachedPrefs?.custom_lng ?? null;
  const customLocation = cachedPrefs?.custom_location ?? null;
  const useGpsFlag = cachedPrefs?.use_gps_location ?? true;

  // DO NOT add refreshKey (or any non-location preference signal) to this query key.
  // See ORCH-0485 + I-LOCATION-INVALIDATE-ON-LOCATION-ONLY (Phase 2.1 of ORCH-0490).
  // Location must only invalidate when a location-affecting field changes:
  // customLat, customLng, customLocation, useGpsFlag. Adding refreshKey causes
  // every preference change (category toggle, datetime, travel mode) to fire a
  // fresh GPS resolve — 1-3s warm, up to 13s cold — blocking the deck fetch.
  const query = useQuery({
    queryKey: ['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag],
    queryFn: () => fetchUserLocation(userId, currentMode, customLat, customLng, customLocation, useGpsFlag),
    enabled: true,
    staleTime: useGpsFlag ? 5 * 60 * 1000 : Infinity, // GPS: 5 min (re-resolve on city change); custom: never (address doesn't change)
    gcTime: 24 * 60 * 60 * 1000,
    // Never use placeholderData or initialData for location queries.
    // These carry forward STALE coordinates from previous location modes,
    // causing the deck to fire with wrong-city coordinates.
    // The queryFn resolves in <50ms for custom mode (reads from params)
    // and ~1-3s for GPS mode — brief null is acceptable.
    placeholderData: undefined,
    initialData: undefined,
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
