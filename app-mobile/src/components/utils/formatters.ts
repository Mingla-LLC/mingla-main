// Utility functions for formatting currency and measurements based on user preferences

import { getRate } from '../../services/currencyService';

// Currency symbols (rates come from currencyService)
export const currencyData: Record<string, { symbol: string }> = {
  USD: { symbol: '$' },
  AUD: { symbol: 'A$' },
  BIF: { symbol: 'FBu' },
  BRL: { symbol: 'R$' },
  BWP: { symbol: 'P' },
  CAD: { symbol: 'C$' },
  CHF: { symbol: 'CHF' },
  CNY: { symbol: '¥' },
  CVE: { symbol: '$' },
  CZK: { symbol: 'Kč' },
  DJF: { symbol: 'Fdj' },
  DKK: { symbol: 'kr' },
  DZD: { symbol: 'د.ج' },
  EGP: { symbol: '£' },
  ERN: { symbol: 'Nfk' },
  ETB: { symbol: 'Br' },
  EUR: { symbol: '€' },
  GBP: { symbol: '£' },
  GHS: { symbol: '₵' },
  GMD: { symbol: 'D' },
  GNF: { symbol: 'FG' },
  HKD: { symbol: 'HK$' },
  HUF: { symbol: 'Ft' },
  ILS: { symbol: '₪' },
  INR: { symbol: '₹' },
  JPY: { symbol: '¥' },
  KES: { symbol: 'KSh' },
  KMF: { symbol: 'CF' },
  KRW: { symbol: '₩' },
  LRD: { symbol: 'L$' },
  LSL: { symbol: 'L' },
  LYD: { symbol: 'ل.د' },
  MAD: { symbol: 'د.م.' },
  MGA: { symbol: 'Ar' },
  MRU: { symbol: 'UM' },
  MUR: { symbol: '₨' },
  MXN: { symbol: '$' },
  NAD: { symbol: 'N$' },
  NGN: { symbol: '₦' },
  NOK: { symbol: 'kr' },
  NZD: { symbol: 'NZ$' },
  PLN: { symbol: 'zł' },
  RUB: { symbol: '₽' },
  RWF: { symbol: 'RF' },
  SCR: { symbol: '₨' },
  SDG: { symbol: '£' },
  SEK: { symbol: 'kr' },
  SGD: { symbol: 'S$' },
  SLL: { symbol: 'Le' },
  SOS: { symbol: 'Sh' },
  SSP: { symbol: '£' },
  SZL: { symbol: 'L' },
  TND: { symbol: 'د.ت' },
  TRY: { symbol: '₺' },
  TZS: { symbol: 'TSh' },
  UGX: { symbol: 'USh' },
  XOF: { symbol: 'CFA' },
  ZAR: { symbol: 'R' }
};

// Currencies that don't use decimal places
const wholeNumberCurrencies = [
  'JPY', 'KRW', 'HUF', 'XOF', 'SLL', 'GNF', 'UGX', 'TZS', 'RWF', 'BIF', 
  'SOS', 'DJF', 'KMF', 'MGA', 'DZD'
];

/**
 * Format currency based on user preferences
 * @param amount - Amount in USD
 * @param currencyCode - Target currency code
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currencyCode: string = 'USD'): string {
  const currency = currencyData[currencyCode as keyof typeof currencyData];
  const rate = getRate(currencyCode);
  if (!currency) return `$${amount.toFixed(2)}`;

  const convertedAmount = amount * rate;
  
  if (wholeNumberCurrencies.includes(currencyCode)) {
    return `${currency.symbol}${Math.round(convertedAmount).toLocaleString()}`;
  }
  
  return `${currency.symbol}${convertedAmount.toFixed(2)}`;
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
 * Get conversion rate for currency
 * @param currencyCode - Target currency code
 * @returns Conversion rate from USD
 */
export function getCurrencyRate(currencyCode: string = 'USD'): number {
  return getRate(currencyCode);
}