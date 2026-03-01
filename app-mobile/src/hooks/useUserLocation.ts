import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPreferences } from '../services/experiencesService';
import { enhancedLocationService } from '../services/enhancedLocationService';
import * as Location from 'expo-location';

export interface LocationData {
  lat: number;
  lng: number;
}

const fetchUserLocation = async (
  userId: string | undefined,
  currentMode: string,
  refreshKey: number | string | undefined,
  customLocation: string | null | undefined,
  useGpsFlag: boolean | undefined
): Promise<LocationData> => {
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
    return { lat: 37.7749, lng: -122.4194 }; // Default San Francisco
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
      // Geocode address string
      try {
        const geocoded = await Location.geocodeAsync(customLocation);
        if (geocoded && geocoded.length > 0) {
          console.log('Using geocoded location from preferences:', customLocation);
          return { lat: geocoded[0].latitude, lng: geocoded[0].longitude };
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
  return { lat: 37.7749, lng: -122.4194 }; // Default
};

export const useUserLocation = (
  userId: string | undefined,
  currentMode: string,
  refreshKey: number | string | undefined
) => {
  // Read current preferences from React Query cache to get location fields
  const cachedPrefs = useQueryClient().getQueryData<UserPreferences>(
    ['userPreferences', userId]
  );
  const customLocation = cachedPrefs?.custom_location;
  const useGpsFlag = cachedPrefs?.use_gps_location;

  return useQuery({
    queryKey: ['userLocation', userId, currentMode, refreshKey, customLocation, useGpsFlag],
    queryFn: () => fetchUserLocation(userId, currentMode, refreshKey, customLocation, useGpsFlag),
    enabled: true, // Always enabled, handles userId check internally
    staleTime: Infinity, // Location doesn't go stale unless mode/refreshKey/location prefs change
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    placeholderData: (previousData) => previousData,
  });
};
