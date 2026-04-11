// Currency symbols and formatting utilities
import { getUserLocale } from './localeUtils';

export const getCurrencySymbol = (currency: string): string => {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    AUD: '$',
    CAD: '$',
    CHF: '₣',
    CNY: '¥',
    SEK: 'kr',
    NZD: '$',
    MXN: '$',
    SGD: '$',
    HKD: '$',
    NOK: 'kr',
    KRW: '₩',
    TRY: '₺',
    RUB: '₽',
    INR: '₹',
    BRL: 'R$',
    ZAR: 'R',
    DKK: 'kr',
    PLN: 'zł',
    TWD: '$',
    THB: '฿',
    MYR: 'RM',
    CZK: 'Kč',
    HUF: 'Ft',
    ILS: '₪',
    CLP: '$',
    PHP: '₱',
    AED: 'د.إ',
    COP: '$',
    SAR: '﷼',
    RON: 'lei',
    BGN: 'лв',
    HRK: 'kn',
    ISK: 'kr',
    IDR: 'Rp',
    VND: '₫',
    EGP: '£',
    QAR: '﷼',
    KWD: 'د.ك',
    BHD: 'د.ب',
    OMR: '﷼',
    JOD: 'د.ا',
    LBP: '£',
    PEN: 'S/',
    UYU: '$',
    ARS: '$',
    NGN: '₦'
  };
  
  return symbols[currency] || currency;
};

/**
 * Format a number with thousand separators (commas)
 * @param num - The number to format
 * @returns Formatted string with commas (e.g., 136851 -> "136,851")
 */
export const formatNumberWithCommas = (num: number): string => {
  return Math.round(num).toLocaleString(getUserLocale());
};

// RELIABILITY: Do NOT use this for user-facing price display — it does NOT apply
// exchange rate conversion. Use formatCurrency from 'components/utils/formatters'
// instead, which applies getRate() for proper currency conversion.
// This function only formats a number with the currency symbol — no conversion.
export const formatAmountWithSymbol = (amount: number, currency: string = 'USD'): string => {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${formatNumberWithCommas(amount)}`;
};

/**
 * Format a price range string with proper thousand separators
 * Handles formats like "$20-40", "$100+", "Free", "$136851"
 * @param priceRange - Price range string 
 * @param currency - Target currency code (default: 'USD')
 * @returns Formatted price range with commas (e.g., "$136851" -> "$136,851")
 */
export const formatPriceRangeWithCommas = (priceRange: string | undefined, currency: string = 'USD'): string => {
  if (!priceRange) return '';
  
  // Handle "Free" or non-numeric ranges
  if (priceRange.toLowerCase() === 'free' || priceRange === '-') {
    return priceRange;
  }

  const symbol = getCurrencySymbol(currency);

  // Extract numbers and format them with commas
  // Pattern: replace any number (with optional decimals) with its comma-formatted version
  const formatted = priceRange.replace(/\d+(\.\d+)?/g, (match) => {
    const num = parseFloat(match);
    return formatNumberWithCommas(num);
  });

  // If the original had a currency symbol, replace it with the target currency symbol
  if (formatted.startsWith('$') || formatted.startsWith('£') || formatted.startsWith('€') || formatted.startsWith('¥')) {
    return symbol + formatted.slice(1);
  }
  
  // If no symbol present but has numbers, add the symbol
  if (/\d/.test(formatted) && !formatted.match(/^[^\d]*[₦₹₩฿₱₫₺₽﷼]/)) {
    return symbol + formatted;
  }

  return formatted;
};
