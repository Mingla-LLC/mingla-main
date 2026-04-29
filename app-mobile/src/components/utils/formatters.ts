// Utility functions for formatting currency and measurements based on user preferences

import { getRate } from '../../services/currencyService';
import { currencySymbolMap } from '../../services/countryCurrencyService';
import { getUserLocale } from '../../utils/localeUtils';

// Currency symbols - use comprehensive list from countryCurrencyService
// Falls back to basic symbols for any missing currencies
export const currencyData: Record<string, { symbol: string }> = {
  // Default symbols from countryCurrencyService
  ...Object.entries(currencySymbolMap).reduce((acc, [code, symbol]) => {
    acc[code] = { symbol };
    return acc;
  }, {} as Record<string, { symbol: string }>),
  // Additional currencies not in country list but still supported
  USD: { symbol: '$' },
};

// Currencies that don't use decimal places (or have very low decimal value)
const wholeNumberCurrencies = [
  // East Asian
  'JPY', 'KRW', 'VND', 'KHR', 'LAK', 'MMK', 'KPW',
  // African
  'XOF', 'XAF', 'SLL', 'GNF', 'UGX', 'TZS', 'RWF', 'BIF', 
  'SOS', 'DJF', 'KMF', 'MGA', 'MWK', 'SDG', 'SSP',
  // Others with very low decimal value
  'HUF', 'CLP', 'PYG', 'IDR', 'IRR', 'IQD', 'LBP',
  // Algerian Dinar
  'DZD'
];

/**
 * Format currency based on user preferences with thousand separators
 * @param amount - Amount in USD
 * @param currencyCode - Target currency code
 * @returns Formatted currency string (e.g., 136851 -> "$136,851")
 */
export function formatCurrency(amount: number, currencyCode: string = 'USD'): string {
  const currency = currencyData[currencyCode as keyof typeof currencyData];
  const rate = getRate(currencyCode);
  if (!currency) return `$${Math.round(amount).toLocaleString(getUserLocale())}`;

  const convertedAmount = amount * rate;
  
  if (wholeNumberCurrencies.includes(currencyCode)) {
    return `${currency.symbol}${Math.round(convertedAmount).toLocaleString(getUserLocale())}`;
  }
  
  // For currencies with decimals, format with 2 decimal places and thousand separators
  return `${currency.symbol}${convertedAmount.toLocaleString(getUserLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Convert distance based on measurement system
 * @param miles - Distance in miles
 * @param system - 'Metric' or 'Imperial'
 * @returns Formatted distance string
 */
export function formatDistance(miles: number, system: 'Metric' | 'Imperial' = 'Imperial'): string {
  if (system === 'Metric') {
    const km = miles * 1.60934;
    if (km < 1) {
      const meters = Math.round(km * 1000);
      return `${meters}m`;
    }
    return `${km.toFixed(1)}km`;
  }
  
  if (miles < 1) {
    const feet = Math.round(miles * 5280);
    return `${feet}ft`;
  }
  return `${miles.toFixed(1)}mi`;
}

/**
 * Convert temperature based on measurement system
 * @param fahrenheit - Temperature in Fahrenheit
 * @param system - 'Metric' or 'Imperial'
 * @returns Formatted temperature string
 */
export function formatTemperature(fahrenheit: number, system: 'Metric' | 'Imperial' = 'Imperial'): string {
  if (system === 'Metric') {
    const celsius = (fahrenheit - 32) * 5/9;
    return `${Math.round(celsius)}°C`;
  }
  return `${Math.round(fahrenheit)}°F`;
}

/**
 * Convert height/size measurements
 * @param feet - Height in feet
 * @param system - 'Metric' or 'Imperial'
 * @returns Formatted height string
 */
export function formatHeight(feet: number, system: 'Metric' | 'Imperial' = 'Imperial'): string {
  if (system === 'Metric') {
    const meters = feet * 0.3048;
    if (meters < 1) {
      const cm = Math.round(meters * 100);
      return `${cm}cm`;
    }
    return `${meters.toFixed(1)}m`;
  }
  
  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  return inches > 0 ? `${wholeFeet}'${inches}"` : `${wholeFeet}'`;
}

/**
 * Convert weight measurements
 * @param pounds - Weight in pounds
 * @param system - 'Metric' or 'Imperial'
 * @returns Formatted weight string
 */
export function formatWeight(pounds: number, system: 'Metric' | 'Imperial' = 'Imperial'): string {
  if (system === 'Metric') {
    const kg = pounds * 0.453592;
    return `${kg.toFixed(1)}kg`;
  }
  return `${pounds}lbs`;
}

/**
 * Get currency symbol for display
 * @param currencyCode - Currency code
 * @returns Currency symbol
 */
export function getCurrencySymbol(currencyCode: string = 'USD'): string {
  const currency = currencyData[currencyCode as keyof typeof currencyData];
  return currency?.symbol || '$';
}

/**
 * Convert a price range string from USD to user's preferred currency
 * @param priceRange - Price range string in USD (e.g., "$20-40", "$100+", "Free", "$50")
 * @param currencyCode - Target currency code
 * @returns Formatted price range string in target currency
 */
export function formatPriceRange(priceRange: string | undefined, currencyCode: string = 'USD'): string {
  if (!priceRange || priceRange.includes('undefined') || priceRange.includes('NaN')) return 'Free';
  
  // Handle "Free" or non-numeric ranges
  if (priceRange.toLowerCase() === 'free' || priceRange === '-') {
    return priceRange;
  }

  const currency = currencyData[currencyCode as keyof typeof currencyData];
  const rate = getRate(currencyCode);
  const symbol = currency?.symbol || '$';

  // Extract numbers from the price range
  // Patterns: "$20-40", "$20 - $40", "$100+", "$50", "20-40"
  const rangeMatch = priceRange.match(/\$?([\d,]+(?:\.\d{2})?)\s*[-–]\s*\$?([\d,]+(?:\.\d{2})?)/i);
  const singleMatch = priceRange.match(/\$?([\d,]+(?:\.\d{2})?)\+?/i);
  const hasPlus = priceRange.includes('+');

  if (rangeMatch) {
    // Range format: $20-40 or $20 - $40
    const minUSD = parseFloat(rangeMatch[1].replace(/,/g, ''));
    const maxUSD = parseFloat(rangeMatch[2].replace(/,/g, ''));
    const minConverted = Math.round(minUSD * rate);
    const maxConverted = Math.round(maxUSD * rate);
    
    return `${symbol}${minConverted.toLocaleString(getUserLocale())} - ${symbol}${maxConverted.toLocaleString(getUserLocale())}`;
  } else if (singleMatch) {
    // Single value format: $100+ or $50
    const valueUSD = parseFloat(singleMatch[1].replace(/,/g, ''));
    const valueConverted = Math.round(valueUSD * rate);
    
    return `${symbol}${valueConverted.toLocaleString(getUserLocale())}${hasPlus ? '+' : ''}`;
  }

  // If we can't parse, return original
  return priceRange;
}

/**
 * Get conversion rate for currency
 * @param currencyCode - Target currency code
 * @returns Conversion rate from USD
 */
export function getCurrencyRate(currencyCode: string = 'USD'): number {
  return getRate(currencyCode);
}

/**
 * Parse a pre-formatted distance string and convert based on measurement system
 * Backend returns distance in km format (e.g., "2.5 km", "500m")
 * @param distanceString - Pre-formatted distance string from backend
 * @param system - 'Metric' or 'Imperial'
 * @returns Formatted distance string in the user's preferred system
 */
export function parseAndFormatDistance(distanceString: string | undefined, system: 'Metric' | 'Imperial' = 'Imperial'): string {
  // ORCH-0659/0660 (rework v2): return empty string instead of literal 'Nearby'
  // when input is missing/malformed. Caller branches on truthy/null to hide the
  // pill — never fabricate a placeholder string (Constitution #9). Lines 223/230/238
  // ('Nearby' for genuinely-tiny distances) intentionally preserved — defensible UX,
  // i18n cleanup deferred to ORCH-0673.
  if (!distanceString || distanceString.includes('undefined') || distanceString.includes('NaN')) return '';

  // Try to extract numeric value and unit from the string
  const kmMatch = distanceString.match(/([\d.]+)\s*km/i);
  const mMatch = distanceString.match(/([\d.]+)\s*m(?!i)/i); // 'm' but not 'mi'
  const miMatch = distanceString.match(/([\d.]+)\s*mi/i);
  const ftMatch = distanceString.match(/([\d.]+)\s*ft/i);

  let distanceInKm: number;

  if (kmMatch) {
    distanceInKm = parseFloat(kmMatch[1]);
  } else if (mMatch) {
    distanceInKm = parseFloat(mMatch[1]) / 1000;
  } else if (miMatch) {
    // Convert miles to km
    distanceInKm = parseFloat(miMatch[1]) * 1.60934;
  } else if (ftMatch) {
    // Convert feet to km
    distanceInKm = parseFloat(ftMatch[1]) * 0.0003048;
  } else {
    // Can't parse, return original
    return distanceString;
  }

  // Guard: if distance rounds to effectively zero, show "Nearby"
  if (distanceInKm < 0.005) {
    return 'Nearby';
  }

  // Convert to user's preferred system
  if (system === 'Metric') {
    if (distanceInKm < 1) {
      const meters = Math.round(distanceInKm * 1000);
      return meters === 0 ? 'Nearby' : `${meters}m`;
    }
    return `${distanceInKm.toFixed(1)} km`;
  } else {
    // Imperial
    const miles = distanceInKm / 1.60934;
    if (miles < 0.1) {
      const feet = Math.round(miles * 5280);
      return feet === 0 ? 'Nearby' : `${feet} ft`;
    }
    return `${miles.toFixed(1)} mi`;
  }
}

/**
 * Format a raw distance in meters based on measurement system
 * @param meters - Distance in meters
 * @param system - 'Metric' or 'Imperial'
 * @param suffix - Optional suffix like 'away' (default: '')
 * @returns Formatted distance string
 */
export function formatDistanceFromMeters(meters: number, system: 'Metric' | 'Imperial' = 'Imperial', suffix: string = ''): string {
  const suffixStr = suffix ? ` ${suffix}` : '';
  
  if (system === 'Metric') {
    if (meters < 1000) {
      return `${Math.round(meters)}m${suffixStr}`;
    }
    return `${(meters / 1000).toFixed(1)}km${suffixStr}`;
  } else {
    // Imperial
    const feet = meters * 3.28084;
    if (feet < 528) { // Less than 0.1 miles
      return `${Math.round(feet)} ft${suffixStr}`;
    }
    const miles = meters / 1609.34;
    return `${miles.toFixed(1)} mi${suffixStr}`;
  }
}