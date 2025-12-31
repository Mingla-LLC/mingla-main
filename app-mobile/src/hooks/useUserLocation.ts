import { useQuery } from '@tanstack/react-query';
import { ExperiencesService, UserPreferences } from '../services/experiencesService';
import { offlineService } from '../services/offlineService';
import { enhancedLocationService } from '../services/enhancedLocationService';
import * as Location from 'expo-location';

export interface LocationData {
  lat: number;
  lng: number;
}

const fetchUserLocation = async (
  userId: string | undefined,
  currentMode: string,
  refreshKey: number | string | undefined
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

  let prefs: UserPreferences | null = null;
  let locationFromPrefs = false;

  // First, try to get preferences from cache
  try {
    const cachedPrefs = await offlineService.getOfflineUserPreferences();
    if (cachedPrefs && (cachedPrefs as any).custom_location) {
      console.log('Using cached preferences for location');
      prefs = cachedPrefs as UserPreferences;
      locationFromPrefs = true;
    }
  } catch (error) {
    console.log('No cached preferences found, fetching from database');
  }

  // If not found in cache, fetch from database
  if (!prefs) {
    try {
      prefs = await ExperiencesService.getUserPreferences(userId);
      // Cache the preferences for next time
      if (prefs) {
        await offlineService.cacheUserPreferences(prefs);
      }
    } catch (prefsError) {
      console.log(
        'Error loading preferences from database, falling back to GPS:',
        prefsError
      );
    }
  }

  // Use location from preferences (cached or from DB)
  if (prefs && (prefs as any).custom_location) {
    const savedLocation = (prefs as any).custom_location;
    const coordinatesMatch = savedLocation.match(
      /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/
    );
    
    if (coordinatesMatch) {
      const lat = parseFloat(coordinatesMatch[1]);
      const lng = parseFloat(coordinatesMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        console.log(
          `Using saved coordinates from ${locationFromPrefs ? 'cache' : 'database'}:`,
          { lat, lng }
        );
        return { lat, lng };
      }
    } else {
      // Geocode address
      try {
        const geocoded = await Location.geocodeAsync(savedLocation);
        if (geocoded && geocoded.length > 0) {
          const { latitude, longitude } = geocoded[0];
          console.log(
            `Using geocoded location from ${locationFromPrefs ? 'cache' : 'database'}:`,
            { latitude, longitude }
          );
          return { lat: latitude, lng: longitude };
        }
      } catch (geocodeError) {
        console.log(
          'Could not geocode saved location, falling back to GPS:',
          geocodeError
        );
      }
    }
  }

  // Fallback to GPS
  console.log('No saved location in DB, using current GPS location');
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
  return useQuery({
    queryKey: ['userLocation', userId, currentMode, refreshKey],
    queryFn: () => fetchUserLocation(userId, currentMode, refreshKey),
    enabled: true, // Always enabled, handles userId check internally
    staleTime: Infinity, // Location doesn't go stale unless mode/refreshKey changes (handled by query key)
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    // Show cached data immediately while fresh data loads
    placeholderData: (previousData) => previousData,
  });
};

