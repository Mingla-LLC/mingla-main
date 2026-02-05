// Currency conversion utilities
export const exchangeRates = {
  USD: 1.00,
  EUR: 0.85,
  GBP: 0.73,
  CAD: 1.25,
  AUD: 1.35,
  JPY: 110.0,
  CHF: 0.92,
  CNY: 6.45,
  SEK: 8.95,
  NOK: 8.85,
  DKK: 6.34,
  PLN: 3.89,
  CZK: 21.5,
  HUF: 298.0,
  RUB: 74.5,
  INR: 74.8,
  BRL: 5.15,
  MXN: 17.8,
  ZAR: 14.2,
  KRW: 1180.0,
  SGD: 1.32,
  HKD: 7.78,
  NZD: 1.42,
  TRY: 8.45,
  ILS: 3.25
};

export const currencySymbols = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
  CHF: 'CHF',
  CNY: '¥',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  RUB: '₽',
  INR: '₹',
  BRL: 'R$',
  MXN: '$',
  ZAR: 'R',
  KRW: '₩',
  SGD: 'S$',
  HKD: 'HK$',
  NZD: 'NZ$',
  TRY: '₺',
  ILS: '₪'
};

export function convertCurrency(amountInUSD: number, targetCurrency: string): number {
  const rate = exchangeRates[targetCurrency as keyof typeof exchangeRates];
  return amountInUSD * (rate || 1);
}

export function formatCurrency(amountInUSD: number, targetCurrency: string): string {
  const convertedAmount = convertCurrency(amountInUSD, targetCurrency);
  const symbol = currencySymbols[targetCurrency as keyof typeof currencySymbols] || '$';
  
  // Handle currencies that don't use decimal places
  if (targetCurrency === 'JPY' || targetCurrency === 'KRW' || targetCurrency === 'HUF') {
    return `${symbol}${Math.round(convertedAmount).toLocaleString()}`;
  }
  
  return `${symbol}${convertedAmount.toFixed(2)}`;
}

// Distance conversion utilities
export function convertDistance(distanceInMiles: number, measurementSystem: 'Metric' | 'Imperial'): number {
  if (measurementSystem === 'Metric') {
    return distanceInMiles * 1.60934; // Convert miles to kilometers
  }
  return distanceInMiles;
}

export function formatDistance(distanceInMiles: number, measurementSystem: 'Metric' | 'Imperial'): string {
  const distance = convertDistance(distanceInMiles, measurementSystem);
  const unit = measurementSystem === 'Metric' ? 'km' : 'mi';
  
  if (distance < 1) {
    const smallDistance = measurementSystem === 'Metric' ? distance * 1000 : distance * 5280;
    const smallUnit = measurementSystem === 'Metric' ? 'm' : 'ft';
    return `${Math.round(smallDistance)} ${smallUnit}`;
  }
  
  return `${distance.toFixed(1)} ${unit}`;
}

// Temperature conversion utilities
export function convertTemperature(fahrenheit: number, measurementSystem: 'Metric' | 'Imperial'): number {
  if (measurementSystem === 'Metric') {
    return (fahrenheit - 32) * 5/9; // Convert Fahrenheit to Celsius
  }
  return fahrenheit;
}

export function formatTemperature(fahrenheit: number, measurementSystem: 'Metric' | 'Imperial'): string {
  const temp = convertTemperature(fahrenheit, measurementSystem);
  const unit = measurementSystem === 'Metric' ? '°C' : '°F';
  return `${Math.round(temp)}${unit}`;
}

// Size/height conversion utilities
export function convertHeight(inches: number, measurementSystem: 'Metric' | 'Imperial'): number {
  if (measurementSystem === 'Metric') {
    return inches * 2.54; // Convert inches to centimeters
  }
  return inches;
}

export function formatHeight(inches: number, measurementSystem: 'Metric' | 'Imperial'): string {
  if (measurementSystem === 'Metric') {
    const cm = convertHeight(inches, measurementSystem);
    if (cm >= 100) {
      return `${(cm / 100).toFixed(1)} m`;
    }
    return `${Math.round(cm)} cm`;
  }
  
  const feet = Math.floor(inches / 12);
  const remainingInches = inches % 12;
  return `${feet}'${remainingInches}"`;
}

// Weight conversion utilities
export function convertWeight(pounds: number, measurementSystem: 'Metric' | 'Imperial'): number {
  if (measurementSystem === 'Metric') {
    return pounds * 0.453592; // Convert pounds to kilograms
  }
  return pounds;
}

export function formatWeight(pounds: number, measurementSystem: 'Metric' | 'Imperial'): string {
  const weight = convertWeight(pounds, measurementSystem);
  const unit = measurementSystem === 'Metric' ? 'kg' : 'lbs';
  return `${weight.toFixed(1)} ${unit}`;
}

// Area conversion utilities
export function convertArea(squareFeet: number, measurementSystem: 'Metric' | 'Imperial'): number {
  if (measurementSystem === 'Metric') {
    return squareFeet * 0.092903; // Convert square feet to square meters
  }
  return squareFeet;
}

export function formatArea(squareFeet: number, measurementSystem: 'Metric' | 'Imperial'): string {
  const area = convertArea(squareFeet, measurementSystem);
  const unit = measurementSystem === 'Metric' ? 'm²' : 'ft²';
  return `${area.toFixed(1)} ${unit}`;
}

// Category display name mapping
export const categoryDisplayNames: Record<string, string> = {
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
};

export function getCategoryDisplayName(categoryId: string): string {
  return categoryDisplayNames[categoryId] || categoryId;
}