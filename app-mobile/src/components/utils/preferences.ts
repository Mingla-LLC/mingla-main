// #4347: this file's own exchange-rate table, convertCurrency and
// formatCurrency (a second formatCurrency with a 'USD' source default and a
// '$' fallback) were deleted. Nothing imported them; they were a wrong import
// waiting to happen. Prices: formatDisplayPrice in ./formatters.

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