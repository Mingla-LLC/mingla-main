import type { RecommendationsRequest } from '../types';
import { PriceTierSlug, TIER_BY_SLUG } from '../constants/priceTiers';

interface PreferencesSheetState {
  priceTiers: PriceTierSlug[];
  /** @deprecated Use priceTiers instead */
  budgetRange?: [number, number];
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
    priceTiers: preferences.priceTiers,
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

/** Valid exact time format: "H:MM AM/PM" or "HH:MM AM/PM" */
const EXACT_TIME_RE = /^(1[0-2]|0?[1-9]):[0-5][0-9]\s?(AM|PM)$/i;

/**
 * Normalize preference fields to enforce consistency before saving to DB.
 * Eliminates conflicting combinations of date/time fields and location fields.
 */
export function normalizePreferencesForSave(prefs: {
  date_option?: string | null;
  time_slot?: string | null;
  exact_time?: string | null;
  datetime_pref?: string | null;
  use_gps_location?: boolean;
  custom_location?: string | null;
}): typeof prefs {
  const normalized = { ...prefs };

  // Date/time consistency: clear irrelevant fields based on date_option
  const dateOpt = (normalized.date_option || '').toLowerCase();
  if (dateOpt === 'now') {
    normalized.time_slot = null;
    normalized.exact_time = null;
    normalized.datetime_pref = null;
  } else if (dateOpt === 'today') {
    normalized.datetime_pref = null;
  } else if (dateOpt === 'weekend' || dateOpt === 'this weekend') {
    // Weekend can have a time slot but not an exact datetime
    normalized.datetime_pref = null;
  }
  // "Pick a Date" / "custom" keeps datetime_pref as-is

  // Exact time validation: discard malformed values
  if (normalized.exact_time && !EXACT_TIME_RE.test(normalized.exact_time)) {
    normalized.exact_time = null;
  }

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
