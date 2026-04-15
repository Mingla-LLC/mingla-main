import type { RecommendationsRequest } from '../types';

// ORCH-0434: Removed priceTiers, budgetRange. Added intentToggle, categoryToggle, selectedDates.
interface PreferencesSheetState {
  categories: string[];
  experienceTypes?: string[];
  time: string;
  travel: string;
  travelConstraint: 'time';
  travelTime: number;
  location: string;
  customLocation?: string;
  custom_lat?: number | null;
  custom_lng?: number | null;
  groupSize: number;
  intentToggle: boolean;
  categoryToggle: boolean;
  selectedDates: string[] | null;
}

export const convertPreferencesToRequest = (
  preferences: PreferencesSheetState,
  currentLat?: number,
  currentLng?: number,
  measurementSystem: 'metric' | 'imperial' = 'metric'
): RecommendationsRequest => {
  // Determine origin coordinates
  let originLat = 35.7915; // Default to Cary, NC
  let originLng = -78.7811;

  if (preferences.location === 'current' && currentLat && currentLng) {
    originLat = currentLat;
    originLng = currentLng;
  } else if (preferences.location === 'custom' && preferences.custom_lat && preferences.custom_lng) {
    originLat = preferences.custom_lat;
    originLng = preferences.custom_lng;
  } else if (preferences.custom_lat && preferences.custom_lng) {
    originLat = preferences.custom_lat;
    originLng = preferences.custom_lng;
  }

  // Convert time preference to time window
  const timeWindow = convertTimePreference(preferences.time);

  // Convert travel mode
  const travelMode = convertTravelMode(preferences.travel);

  // Convert travel constraint
  const travelConstraint = {
    type: 'TIME' as const,
    maxMinutes: preferences.travelTime,
  };

  return {
    categories: preferences.categories,
    experienceTypes: preferences.experienceTypes || [],
    timeWindow,
    travel: {
      mode: travelMode,
      constraint: travelConstraint
    },
    origin: {
      lat: originLat,
      lng: originLng
    },
    units: measurementSystem
  };
};

const convertTimePreference = (time: string) => {
  const now = new Date();
  
  switch (time.toLowerCase()) {
    case 'now':
      return {
        kind: 'Now' as const,
        start: null,
        end: null,
        timeOfDay: now.toTimeString().slice(0, 5)
      };
    
    case 'tonight':
      return {
        kind: 'Tonight' as const,
        start: null,
        end: null,
        timeOfDay: '19:00'
      };
    
    case 'this weekend':
      return {
        kind: 'ThisWeekend' as const,
        start: null,
        end: null,
        timeOfDay: '14:00'
      };
    
    case 'custom':
      // For custom, we'd need additional date/time inputs from preferences
      return {
        kind: 'Custom' as const,
        start: now.toISOString(),
        end: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(), // +4 hours
        timeOfDay: now.toTimeString().slice(0, 5)
      };
    
    default:
      return {
        kind: 'Now' as const,
        start: null,
        end: null,
        timeOfDay: now.toTimeString().slice(0, 5)
      };
  }
};

/**
 * Normalize preference fields to enforce consistency before saving to DB.
 * Eliminates conflicting combinations of date/time fields and location fields.
 */
// ORCH-0434: time_slot/time_slots/time_of_day rules removed. Only location consistency remains.
export function normalizePreferencesForSave(prefs: {
  date_option?: string | null;
  datetime_pref?: string | null;
  use_gps_location?: boolean;
  custom_location?: string | null;
  custom_lat?: number | null;
  custom_lng?: number | null;
}): typeof prefs {
  const normalized = { ...prefs };

  // Location consistency: GPS and custom are mutually exclusive
  if (normalized.use_gps_location === true) {
    normalized.custom_location = null;
  } else if (normalized.custom_location) {
    normalized.use_gps_location = false;
  }

  return normalized;
}

const convertTravelMode = (travel: string): 'WALKING' | 'DRIVING' | 'TRANSIT' => {
  switch (travel.toLowerCase()) {
    case 'walk':
      return 'WALKING';
    case 'drive':
      return 'DRIVING';
    case 'public transport':
    case 'public':
    case 'transit':
      return 'TRANSIT';
    default:
      return 'DRIVING';
  }
};
