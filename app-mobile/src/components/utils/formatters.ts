// Utility functions for formatting currency and measurements based on user preferences

import { convertBetween, getServableRate } from '../../services/currencyService';
import {
  buildDisplayPrice,
  trustedServerPrice,
  type DisplayPrice,
  type DisplayPriceInput,
} from '../../utils/displayPrice';
import { LIVE_DISPLAY_PRICE_SESSION } from '../../utils/liveDisplayPriceSession';
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
 * Format an amount in a target currency, converting FROM `sourceCurrency`.
 *
 * #4347: every argument is REQUIRED. The old `sourceCurrency = 'USD'` default
 * let NGN ticket money be read as dollars and "converted" USD→USD into
 * "$100,000"; the compiler now makes each caller say what currency its amount
 * is in. Explorer prices should use `formatDisplayPrice` (the ≈ / rounding /
 * no-servable-rate rules); this stays for exact same-currency labels.
 *
 * @param amount - Amount expressed in `sourceCurrency`
 * @param currencyCode - Currency to display in
 * @param sourceCurrency - Currency the `amount` is in
 */
export function formatCurrency(
  amount: number,
  currencyCode: string,
  sourceCurrency: string,
): string {
  const currency = currencyData[currencyCode as keyof typeof currencyData];
  const symbol = currency?.symbol ?? `${currencyCode} `;

  const convertedAmount = convertBetween(amount, sourceCurrency, currencyCode);

  if (wholeNumberCurrencies.includes(currencyCode)) {
    return `${symbol}${Math.round(convertedAmount).toLocaleString(getUserLocale())}`;
  }

  // For currencies with decimals, format with 2 decimal places and thousand separators
  return `${symbol}${convertedAmount.toLocaleString(getUserLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * #4347 — THE Explorer price formatter. Binds the pure rule in
 * utils/displayPrice.ts to the app's symbol table and its SERVABLE live rates.
 * Pass the amount, the currency it is in, the viewer's currency and (when the
 * card carries them) the server's display fields. Returns null when the input
 * is not an honest price, so the caller hides the span.
 */
export function formatDisplayPrice(input: DisplayPriceInput): DisplayPrice | null {
  // Server fields count only when this app session received them live.
  const server = trustedServerPrice(input.server, LIVE_DISPLAY_PRICE_SESSION);
  return buildDisplayPrice({ ...input, server }, {
    symbolFor: (code) => currencyData[code]?.symbol ?? null,
    rateFor: getServableRate,
    locale: getUserLocale(),
  });
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "naira" — the currency's spoken name, i18n'd, falling back to its code. */
export function currencyName(code: string, t: Translate): string {
  return t(`cards:price.currency_${code}`, { defaultValue: code });
}

/**
 * #4347 — the expanded surfaces' second line when a price was converted:
 * "₦100,000 · charged in naira". null when nothing was converted, so the line
 * is absent rather than repeating the main figure.
 */
export function formatChargedInLine(
  sourceText: string | null | undefined,
  sourceCurrency: string | null | undefined,
  t: Translate,
): string | null {
  if (typeof sourceText !== 'string' || sourceText.length === 0) return null;
  if (typeof sourceCurrency !== 'string' || sourceCurrency.length === 0) return null;
  return t('cards:price.charged_in', {
    defaultValue: '{{amount}} · charged in {{currency}}',
    amount: sourceText,
    currency: currencyName(sourceCurrency, t),
  });
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
export function getCurrencySymbol(currencyCode: string): string {
  const currency = currencyData[currencyCode as keyof typeof currencyData];
  return currency?.symbol || currencyCode;
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
