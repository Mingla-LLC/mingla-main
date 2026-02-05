/**
 * Google Maps Travel Time Integration
 * Production-ready travel time calculations using Google Distance Matrix API
 */

export type TravelMode = 'walking' | 'driving' | 'transit' | 'biking';

export interface TravelResult {
  distanceMeters: number;
  distanceText: string;
  durationSeconds: number;
  durationText: string;
  travelMode: TravelMode;
}

export interface Location {
  lat: number;
  lng: number;
  address?: string;
}

/**
 * Convert Mingla travel mode to Google Maps travel mode
 */
function toGoogleTravelMode(mode: TravelMode): google.maps.TravelMode {
  const modeMap: Record<TravelMode, google.maps.TravelMode> = {
    walking: google.maps.TravelMode.WALKING,
    driving: google.maps.TravelMode.DRIVING,
    transit: google.maps.TravelMode.TRANSIT,
    biking: google.maps.TravelMode.BICYCLING
  };
  return modeMap[mode];
}

/**
 * Calculate travel time using Google Maps Distance Matrix API
 * This is the production-ready version that uses real Google Maps data
 */
export async function calculateRealTravelTime(
  origin: Location,
  destination: Location,
  travelMode: TravelMode,
  departureTime?: Date
): Promise<TravelResult> {
  // Check if Google Maps is loaded
  if (typeof google === 'undefined' || !google.maps) {
    console.warn('Google Maps not loaded, falling back to estimated travel time');
    return calculateEstimatedTravelTime(origin, destination, travelMode);
  }

  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();

    const request: google.maps.DistanceMatrixRequest = {
      origins: [{ lat: origin.lat, lng: origin.lng }],
      destinations: [{ lat: destination.lat, lng: destination.lng }],
      travelMode: toGoogleTravelMode(travelMode),
      unitSystem: google.maps.UnitSystem.METRIC,
      // Include departure time for transit to get real-time schedules
      ...(travelMode === 'transit' && departureTime ? {
        transitOptions: {
          departureTime: departureTime
        }
      } : {}),
      // Include traffic for driving
      ...(travelMode === 'driving' ? {
        drivingOptions: {
          departureTime: departureTime || new Date(),
          trafficModel: google.maps.TrafficModel.BEST_GUESS
        }
      } : {})
    };

    service.getDistanceMatrix(request, (response, status) => {
      if (status !== google.maps.DistanceMatrixStatus.OK) {
        console.error('Distance Matrix request failed:', status);
        // Fallback to estimated
        resolve(calculateEstimatedTravelTime(origin, destination, travelMode));
        return;
      }

      const result = response?.rows[0]?.elements[0];

      if (!result || result.status !== google.maps.DistanceMatrixElementStatus.OK) {
        console.error('Distance Matrix element failed:', result?.status);
        // Fallback to estimated
        resolve(calculateEstimatedTravelTime(origin, destination, travelMode));
        return;
      }

      resolve({
        distanceMeters: result.distance.value,
        distanceText: result.distance.text,
        durationSeconds: result.duration.value,
        durationText: result.duration.text,
        travelMode
      });
    });
  });
}

/**
 * Batch calculate travel times for multiple destinations
 * More efficient than calling calculateRealTravelTime multiple times
 */
export async function calculateBatchTravelTimes(
  origin: Location,
  destinations: Location[],
  travelMode: TravelMode,
  departureTime?: Date
): Promise<TravelResult[]> {
  // Google Distance Matrix API allows max 25 destinations per request
  const BATCH_SIZE = 25;
  const results: TravelResult[] = [];

  for (let i = 0; i < destinations.length; i += BATCH_SIZE) {
    const batch = destinations.slice(i, i + BATCH_SIZE);
    const batchResults = await calculateBatchInternal(origin, batch, travelMode, departureTime);
    results.push(...batchResults);
  }

  return results;
}

async function calculateBatchInternal(
  origin: Location,
  destinations: Location[],
  travelMode: TravelMode,
  departureTime?: Date
): Promise<TravelResult[]> {
  if (typeof google === 'undefined' || !google.maps) {
    return destinations.map(dest => 
      calculateEstimatedTravelTime(origin, dest, travelMode)
    );
  }

  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();

    const request: google.maps.DistanceMatrixRequest = {
      origins: [{ lat: origin.lat, lng: origin.lng }],
      destinations: destinations.map(d => ({ lat: d.lat, lng: d.lng })),
      travelMode: toGoogleTravelMode(travelMode),
      unitSystem: google.maps.UnitSystem.METRIC,
      ...(travelMode === 'transit' && departureTime ? {
        transitOptions: {
          departureTime: departureTime
        }
      } : {}),
      ...(travelMode === 'driving' ? {
        drivingOptions: {
          departureTime: departureTime || new Date(),
          trafficModel: google.maps.TrafficModel.BEST_GUESS
        }
      } : {})
    };

    service.getDistanceMatrix(request, (response, status) => {
      if (status !== google.maps.DistanceMatrixStatus.OK) {
        console.error('Batch Distance Matrix request failed:', status);
        resolve(destinations.map(dest => 
          calculateEstimatedTravelTime(origin, dest, travelMode)
        ));
        return;
      }

      const results: TravelResult[] = [];

      response?.rows[0]?.elements.forEach((element, index) => {
        if (element.status === google.maps.DistanceMatrixElementStatus.OK) {
          results.push({
            distanceMeters: element.distance.value,
            distanceText: element.distance.text,
            durationSeconds: element.duration.value,
            durationText: element.duration.text,
            travelMode
          });
        } else {
          // Fallback for failed elements
          results.push(
            calculateEstimatedTravelTime(origin, destinations[index], travelMode)
          );
        }
      });

      resolve(results);
    });
  });
}

/**
 * Fallback: Estimate travel time based on distance and average speeds
 * Used when Google Maps API is unavailable
 */
export function calculateEstimatedTravelTime(
  origin: Location,
  destination: Location,
  travelMode: TravelMode
): TravelResult {
  // Calculate straight-line distance (Haversine formula)
  const R = 6371; // Earth's radius in km
  const dLat = toRad(destination.lat - origin.lat);
  const dLon = toRad(destination.lng - origin.lng);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(origin.lat)) * Math.cos(toRad(destination.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineDistanceKm = R * c;
  
  // Apply routing factor (actual road distance is typically 1.4x straight line)
  const routingFactor = 1.4;
  const actualDistanceKm = straightLineDistanceKm * routingFactor;
  
  // Average speeds in km/h for urban environments
  const AVERAGE_SPEEDS: Record<TravelMode, number> = {
    walking: 5,    // 5 km/h
    biking: 15,    // 15 km/h
    transit: 20,   // 20 km/h (includes wait time)
    driving: 30    // 30 km/h (city traffic)
  };
  
  const speedKmh = AVERAGE_SPEEDS[travelMode];
  const durationHours = actualDistanceKm / speedKmh;
  const durationSeconds = Math.ceil(durationHours * 3600);
  
  return {
    distanceMeters: Math.round(actualDistanceKm * 1000),
    distanceText: `${actualDistanceKm.toFixed(1)} km`,
    durationSeconds,
    durationText: formatDuration(durationSeconds),
    travelMode
  };
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function formatDuration(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  
  if (minutes < 60) {
    return `${minutes} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (mins === 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  
  return `${hours} hour${hours > 1 ? 's' : ''} ${mins} min`;
}

/**
 * Calculate arrival time given travel result
 */
export function calculateArrivalTime(
  departureTime: Date,
  travelResult: TravelResult
): Date {
  const arrival = new Date(departureTime);
  arrival.setSeconds(arrival.getSeconds() + travelResult.durationSeconds);
  return arrival;
}

/**
 * Check if travel time is within constraint
 */
export function isWithinTravelConstraint(
  travelResult: TravelResult,
  constraintType: 'time' | 'distance',
  constraintValue: number,
  measurementSystem: 'Metric' | 'Imperial' = 'Metric'
): boolean {
  if (constraintType === 'time') {
    // Constraint is in minutes
    const travelMinutes = Math.ceil(travelResult.durationSeconds / 60);
    return travelMinutes <= constraintValue;
  } else {
    // Constraint is in km or miles
    let distanceKm = travelResult.distanceMeters / 1000;
    
    if (measurementSystem === 'Imperial') {
      // Convert km to miles
      distanceKm = distanceKm * 0.621371;
    }
    
    return distanceKm <= constraintValue;
  }
}

/**
 * Get user-friendly travel mode label
 */
export function getTravelModeLabel(mode: TravelMode): string {
  const labels: Record<TravelMode, string> = {
    walking: 'Walking',
    biking: 'Biking',
    transit: 'Public Transit',
    driving: 'Driving'
  };
  return labels[mode];
}

/**
 * Get travel mode icon emoji
 */
export function getTravelModeIcon(mode: TravelMode): string {
  const icons: Record<TravelMode, string> = {
    walking: '🚶',
    biking: '🚴',
    transit: '🚇',
    driving: '🚗'
  };
  return icons[mode];
}

/**
 * Format travel result for display
 */
export function formatTravelResult(result: TravelResult): string {
  return `${result.durationText} • ${result.distanceText}`;
}
