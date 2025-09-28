/**
 * Utility functions for converting cost-related data
 */
import { roundToDecimals, parseDecimal } from './numberFormatter';

/**
 * Converts a cost value to a numeric value for database storage
 * Handles various formats like "$20-40", "$30", "30", etc.
 */
export function convertCostToNumber(cost: number | string | undefined): number {
  if (typeof cost === 'number') {
    return roundToDecimals(cost, 2);
  }
  
  if (typeof cost === 'string') {
    // Remove currency symbols and extract numeric value
    const cleanString = cost.replace(/[$,\s]/g, '');
    
    // Handle ranges like "20-40" by taking the average
    if (cleanString.includes('-')) {
      const [min, max] = cleanString.split('-').map(Number);
      if (!isNaN(min) && !isNaN(max)) {
        return roundToDecimals((min + max) / 2, 2);
      }
    }
    
    // Handle single values
    const numericValue = parseDecimal(cleanString);
    return roundToDecimals(numericValue, 2);
  }
  
  // Default fallback
  return 30.00;
}

/**
 * Formats a numeric cost value for display
 */
export function formatCostForDisplay(cost: number): string {
  if (cost <= 0) return 'Free';
  return `$${roundToDecimals(cost, 2)}`;
}

/**
 * Gets a cost range for display based on price level
 */
export function getCostRangeFromPriceLevel(priceLevel: number): string {
  const ranges = {
    1: '$10-20',
    2: '$20-40', 
    3: '$40-80',
    4: '$80-150',
    5: '$150+'
  };
  
  return ranges[priceLevel as keyof typeof ranges] || '$20-40';
}
