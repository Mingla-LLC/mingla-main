/**
 * Utility functions for consistent number formatting across the app
 * Ensures all non-integer numbers are limited to two decimal places
 */

/**
 * Formats a number to a maximum of 2 decimal places
 * Removes trailing zeros for cleaner display
 */
export function formatDecimal(value: number, maxDecimals: number = 2): string {
  if (isNaN(value) || !isFinite(value)) {
    return '0';
  }
  
  // Round to maxDecimals places
  const rounded = Math.round(value * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
  
  // Format and remove trailing zeros
  return rounded.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/**
 * Formats a number to exactly 2 decimal places (for currency, percentages, etc.)
 */
export function formatToTwoDecimals(value: number): string {
  if (isNaN(value) || !isFinite(value)) {
    return '0.00';
  }
  
  return value.toFixed(2);
}

/**
 * Formats a number to 1 decimal place (for ratings, etc.)
 */
export function formatToOneDecimal(value: number): string {
  if (isNaN(value) || !isFinite(value)) {
    return '0.0';
  }
  
  return value.toFixed(1);
}

/**
 * Formats coordinates to 4 decimal places (for lat/lng)
 */
export function formatCoordinates(value: number): string {
  if (isNaN(value) || !isFinite(value)) {
    return '0.0000';
  }
  
  return value.toFixed(4);
}

/**
 * Formats a percentage to 1 decimal place
 */
export function formatPercentage(value: number): string {
  if (isNaN(value) || !isFinite(value)) {
    return '0.0%';
  }
  
  return `${value.toFixed(1)}%`;
}

/**
 * Formats large numbers with appropriate suffixes (K, M)
 */
export function formatLargeNumber(value: number): string {
  if (isNaN(value) || !isFinite(value)) {
    return '0';
  }
  
  if (value >= 1000000) {
    return `${formatDecimal(value / 1000000)}M`;
  }
  if (value >= 1000) {
    return `${formatDecimal(value / 1000)}K`;
  }
  return Math.round(value).toString();
}

/**
 * Safely parses a string to a number with proper decimal handling
 */
export function parseDecimal(value: string | number): number {
  if (typeof value === 'number') {
    return isNaN(value) ? 0 : value;
  }
  
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Rounds a number to a specific number of decimal places
 */
export function roundToDecimals(value: number, decimals: number = 2): number {
  if (isNaN(value) || !isFinite(value)) {
    return 0;
  }
  
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Formats currency values consistently
 */
export function formatCurrency(value: number, currency: string = '$'): string {
  if (isNaN(value) || !isFinite(value)) {
    return `${currency}0.00`;
  }
  
  return `${currency}${formatToTwoDecimals(value)}`;
}

/**
 * Formats distance values with appropriate units
 */
export function formatDistance(distance: number, unit: 'km' | 'miles' = 'km'): string {
  if (isNaN(distance) || !isFinite(distance)) {
    return `0${unit}`;
  }
  
  if (unit === 'km') {
    if (distance < 1) {
      return `${Math.round(distance * 1000)}m`;
    }
    return `${formatDecimal(distance)}km`;
  } else {
    if (distance < 1) {
      return `${Math.round(distance * 5280)}ft`;
    }
    return `${formatDecimal(distance)}mi`;
  }
}

/**
 * Formats duration in a human-readable format
 */
export function formatDuration(minutes: number): string {
  if (isNaN(minutes) || !isFinite(minutes) || minutes < 0) {
    return '0min';
  }
  
  if (minutes < 60) {
    return `${Math.round(minutes)}min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h ${remainingMinutes}min`;
}
