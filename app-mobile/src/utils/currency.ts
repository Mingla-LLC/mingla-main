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

// #4347: formatAmountWithSymbol and formatPriceRangeWithCommas were deleted.
// Neither had a caller, and both wrote a currency symbol next to a number
// without knowing what currency the number was in (formatPriceRangeWithCommas
// swapped a "$" for the viewer's glyph on an unconverted amount). Explorer
// prices go through formatDisplayPrice in components/utils/formatters.
