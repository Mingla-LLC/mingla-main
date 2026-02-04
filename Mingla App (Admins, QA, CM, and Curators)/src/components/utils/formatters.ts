// Utility functions for formatting currency and measurements based on user preferences

// Currency data with exchange rates and symbols
export const currencyData = {
  USD: { symbol: '$', rate: 1.00 },
  AUD: { symbol: 'A$', rate: 1.35 },
  BIF: { symbol: 'FBu', rate: 2000.0 },
  BRL: { symbol: 'R$', rate: 5.15 },
  BWP: { symbol: 'P', rate: 11.2 },
  CAD: { symbol: 'C$', rate: 1.25 },
  CHF: { symbol: 'CHF', rate: 0.92 },
  CNY: { symbol: '¥', rate: 6.45 },
  CVE: { symbol: '$', rate: 95.8 },
  CZK: { symbol: 'Kč', rate: 21.5 },
  DJF: { symbol: 'Fdj', rate: 177.0 },
  DKK: { symbol: 'kr', rate: 6.34 },
  DZD: { symbol: 'د.ج', rate: 134.0 },
  EGP: { symbol: '£', rate: 31.0 },
  ERN: { symbol: 'Nfk', rate: 15.0 },
  ETB: { symbol: 'Br', rate: 50.8 },
  EUR: { symbol: '€', rate: 0.85 },
  GBP: { symbol: '£', rate: 0.73 },
  GHS: { symbol: '₵', rate: 12.05 },
  GMD: { symbol: 'D', rate: 53.5 },
  GNF: { symbol: 'FG', rate: 8600.0 },
  HKD: { symbol: 'HK$', rate: 7.78 },
  HUF: { symbol: 'Ft', rate: 298.0 },
  ILS: { symbol: '₪', rate: 3.25 },
  INR: { symbol: '₹', rate: 74.8 },
  JPY: { symbol: '¥', rate: 110.0 },
  KES: { symbol: 'KSh', rate: 108.5 },
  KMF: { symbol: 'CF', rate: 425.0 },
  KRW: { symbol: '₩', rate: 1180.0 },
  LRD: { symbol: 'L$', rate: 151.0 },
  LSL: { symbol: 'L', rate: 14.2 },
  LYD: { symbol: 'ل.د', rate: 4.8 },
  MAD: { symbol: 'د.م.', rate: 10.1 },
  MGA: { symbol: 'Ar', rate: 4150.0 },
  MRU: { symbol: 'UM', rate: 36.8 },
  MUR: { symbol: '₨', rate: 44.2 },
  MXN: { symbol: '$', rate: 17.8 },
  NAD: { symbol: 'N$', rate: 14.2 },
  NGN: { symbol: '₦', rate: 460.0 },
  NOK: { symbol: 'kr', rate: 8.85 },
  NZD: { symbol: 'NZ$', rate: 1.42 },
  PLN: { symbol: 'zł', rate: 3.89 },
  RUB: { symbol: '₽', rate: 74.5 },
  RWF: { symbol: 'RF', rate: 1020.0 },
  SCR: { symbol: '₨', rate: 13.4 },
  SDG: { symbol: '£', rate: 600.0 },
  SEK: { symbol: 'kr', rate: 8.95 },
  SGD: { symbol: 'S$', rate: 1.32 },
  SLL: { symbol: 'Le', rate: 11500.0 },
  SOS: { symbol: 'Sh', rate: 570.0 },
  SSP: { symbol: '£', rate: 130.2 },
  SZL: { symbol: 'L', rate: 14.2 },
  TND: { symbol: 'د.ت', rate: 3.1 },
  TRY: { symbol: '₺', rate: 8.45 },
  TZS: { symbol: 'TSh', rate: 2320.0 },
  UGX: { symbol: 'USh', rate: 3650.0 },
  XOF: { symbol: 'CFA', rate: 565.0 },
  ZAR: { symbol: 'R', rate: 14.2 }
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
  if (!currency) return `$${amount.toFixed(2)}`;

  const convertedAmount = amount * currency.rate;
  
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
  const currency = currencyData[currencyCode as keyof typeof currencyData];
  return currency?.rate || 1.0;
}

/**
 * Experience type mapping (matches PreferencesSheet options)
 */
export const EXPERIENCE_TYPES = {
  soloAdventure: 'Solo Adventure',
  firstDate: 'First Date',
  romantic: 'Romantic',
  friendly: 'Friendly',
  groupFun: 'Group Fun',
  business: 'Business'
} as const;

/**
 * Get experience type label from ID
 * @param experienceTypeId - Experience type ID
 * @returns Human-readable label
 */
export function getExperienceTypeLabel(experienceTypeId: string): string {
  return EXPERIENCE_TYPES[experienceTypeId as keyof typeof EXPERIENCE_TYPES] || experienceTypeId;
}

/**
 * Category mapping system for consistent category handling across the app
 * Maps category IDs (used in preferences) to display labels
 */
export const CATEGORY_MAP = {
  stroll: 'Take a Stroll',
  sipChill: 'Sip & Chill',
  casualEats: 'Casual Eats',
  screenRelax: 'Screen & Relax',
  creative: 'Creative & Hands-On',
  picnics: 'Picnics',
  playMove: 'Play & Move',
  diningExp: 'Dining Experiences',
  wellness: 'Wellness Dates',
  freestyle: 'Freestyle'
} as const;

/**
 * Reverse mapping: labels to IDs
 * Also includes kebab-case variants for API compatibility
 */
const LABEL_TO_CATEGORY_ID: { [key: string]: string } = {
  'Take a Stroll': 'stroll',
  'Sip & Chill': 'sipChill',
  'Casual Eats': 'casualEats',
  'Screen & Relax': 'screenRelax',
  'Creative & Hands-On': 'creative',
  'Picnics': 'picnics',
  'Play & Move': 'playMove',
  'Dining Experiences': 'diningExp',
  'Wellness Dates': 'wellness',
  'Freestyle': 'freestyle',
  // Kebab-case variants
  'sip-chill': 'sipChill',
  'casual-eats': 'casualEats',
  'screen-relax': 'screenRelax',
  'play-move': 'playMove',
  'dining-exp': 'diningExp',
  'take-a-stroll': 'stroll'
};

/**
 * Get category label from ID
 * @param categoryId - Category ID (e.g., 'stroll', 'sipChill')
 * @returns Human-readable label (e.g., 'Take a Stroll')
 */
export function getCategoryLabel(categoryId: string): string {
  return CATEGORY_MAP[categoryId as keyof typeof CATEGORY_MAP] || categoryId;
}

/**
 * Get category ID from label (normalizes labels to IDs)
 * @param categoryLabel - Category label (e.g., 'Take a Stroll')
 * @returns Category ID (e.g., 'stroll')
 */
export function getCategoryId(categoryLabel: string): string {
  // If it's already an ID, return as-is
  if (categoryLabel in CATEGORY_MAP) {
    return categoryLabel;
  }
  // If it's a label, convert to ID
  return LABEL_TO_CATEGORY_ID[categoryLabel] || categoryLabel;
}

/**
 * Normalize category value to ID format
 * Handles both ID and label inputs, always returns ID
 * @param category - Category ID or label
 * @returns Normalized category ID
 */
export function normalizeCategoryToId(category: string): string {
  return getCategoryId(category);
}

/**
 * Check if two categories match (handles both IDs and labels)
 * @param category1 - First category (ID or label)
 * @param category2 - Second category (ID or label)
 * @returns True if categories match
 */
export function categoriesMatch(category1: string, category2: string): boolean {
  const id1 = normalizeCategoryToId(category1);
  const id2 = normalizeCategoryToId(category2);
  return id1 === id2;
}

/**
 * Get all category IDs
 * @returns Array of category IDs
 */
export function getAllCategoryIds(): string[] {
  return Object.keys(CATEGORY_MAP);
}

/**
 * Get all category labels
 * @returns Array of category labels
 */
export function getAllCategoryLabels(): string[] {
  return Object.values(CATEGORY_MAP);
}