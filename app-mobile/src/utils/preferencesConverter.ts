import type { RecommendationsRequest } from '../types';

interface PreferencesSheetState {
  budgetRange: [number, number];
  categories: string[];
  experienceTypes?: string[];
  time: string;
  travel: string;
  travelConstraint: 'time' | 'distance';
  travelTime: number;
  travelDistance: number;
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
    console.log('📍 Using current location:', originLat, originLng);
  } else if (preferences.location === 'custom' && preferences.custom_lat && preferences.custom_lng) {
    originLat = preferences.custom_lat;
    originLng = preferences.custom_lng;
    console.log('📍 Using custom location:', originLat, originLng);
  } else if (preferences.custom_lat && preferences.custom_lng) {
    originLat = preferences.custom_lat;
    originLng = preferences.custom_lng;
    console.log('📍 Using fallback custom location:', originLat, originLng);
  } else {
    console.log('📍 Using default location (Cary, NC):', originLat, originLng);
  }

  // Convert time preference to time window
  const timeWindow = convertTimePreference(preferences.time);

  // Convert travel mode
  const travelMode = convertTravelMode(preferences.travel);

  // Convert travel constraint
  const travelConstraint = {
    type: preferences.travelConstraint.toUpperCase() as 'TIME' | 'DISTANCE',
    ...(preferences.travelConstraint === 'time' 
      ? { maxMinutes: preferences.travelTime }
      : { maxDistance: preferences.travelDistance }
    )
  };

  return {
    budget: {
      min: preferences.budgetRange[0],
      max: preferences.budgetRange[1],
      perPerson: true
    },
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
