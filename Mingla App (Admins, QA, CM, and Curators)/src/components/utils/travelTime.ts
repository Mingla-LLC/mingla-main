/**
 * Travel Time Calculation Utilities
 * Estimates travel time based on distance and transportation mode
 */

export type TravelMode = 'walking' | 'driving' | 'transit' | 'biking';

// Average speeds in km/h for each mode in urban environments
const AVERAGE_SPEEDS: Record<TravelMode, number> = {
  walking: 5,    // 5 km/h
  biking: 15,    // 15 km/h
  transit: 20,   // 20 km/h (includes wait time)
  driving: 30    // 30 km/h (city traffic)
};

/**
 * Calculate travel time in minutes based on distance and mode
 * @param distanceKm Distance in kilometers
 * @param mode Transportation mode
 * @returns Travel time in minutes
 */
export function calculateTravelTime(distanceKm: number, mode: TravelMode): number {
  const speedKmh = AVERAGE_SPEEDS[mode];
  const timeHours = distanceKm / speedKmh;
  const timeMinutes = Math.ceil(timeHours * 60);
  
  return timeMinutes;
}

/**
 * Parse distance string (e.g., "2.5 km") to number
 * @param distanceStr Distance string from card data
 * @returns Distance in kilometers
 */
export function parseDistance(distanceStr: string): number {
  const match = distanceStr.match(/(\d+\.?\d*)/);
  if (!match) return 0;
  return parseFloat(match[1]);
}

/**
 * Format travel time for display
 * @param minutes Travel time in minutes
 * @returns Formatted string (e.g., "15 min" or "1h 30m")
 */
export function formatTravelTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (mins === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h ${mins}m`;
}

/**
 * Calculate arrival time given current time, distance, and travel mode
 * @param currentTime Current date/time
 * @param distanceKm Distance to venue
 * @param mode Travel mode
 * @returns Arrival date/time
 */
export function calculateArrivalTime(
  currentTime: Date,
  distanceKm: number,
  mode: TravelMode
): Date {
  const travelMinutes = calculateTravelTime(distanceKm, mode);
  const arrivalTime = new Date(currentTime);
  arrivalTime.setMinutes(arrivalTime.getMinutes() + travelMinutes);
  
  return arrivalTime;
}

/**
 * Check if a time falls within opening hours
 * @param arrivalTime Time user will arrive
 * @param openingHours Opening hours string (e.g., "Daily 9AM-9PM" or "Mon-Fri 10AM-6PM")
 * @returns Whether the venue is open at that time
 */
export function isOpenAtTime(arrivalTime: Date, openingHours: string): boolean {
  // Handle "24/7" or "Always Open"
  if (openingHours.toLowerCase().includes('24') || openingHours.toLowerCase().includes('always')) {
    return true;
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDay = dayNames[arrivalTime.getDay()];
  const currentHour = arrivalTime.getHours();
  const currentMinute = arrivalTime.getMinutes();

  // Parse opening hours (simplified - handles common formats)
  const hourMatch = openingHours.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?.*?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  
  if (!hourMatch) {
    // If we can't parse, assume it's open (don't filter out)
    return true;
  }

  let openHour = parseInt(hourMatch[1]);
  const openMinute = hourMatch[2] ? parseInt(hourMatch[2]) : 0;
  const openPeriod = hourMatch[3]?.toUpperCase();
  
  let closeHour = parseInt(hourMatch[4]);
  const closeMinute = hourMatch[5] ? parseInt(hourMatch[5]) : 0;
  const closePeriod = hourMatch[6]?.toUpperCase();

  // Convert to 24-hour format
  if (openPeriod === 'PM' && openHour !== 12) openHour += 12;
  if (openPeriod === 'AM' && openHour === 12) openHour = 0;
  if (closePeriod === 'PM' && closeHour !== 12) closeHour += 12;
  if (closePeriod === 'AM' && closeHour === 12) closeHour = 0;

  // Handle overnight closings (e.g., 9PM-2AM)
  if (closeHour < openHour) {
    // If close hour is less than open hour, it means it closes after midnight
    return (currentHour >= openHour || currentHour < closeHour) ||
           (currentHour === openHour && currentMinute >= openMinute) ||
           (currentHour === closeHour && currentMinute < closeMinute);
  }

  // Normal day hours
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const openTotalMinutes = openHour * 60 + openMinute;
  const closeTotalMinutes = closeHour * 60 + closeMinute;

  return currentTotalMinutes >= openTotalMinutes && currentTotalMinutes < closeTotalMinutes;
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
