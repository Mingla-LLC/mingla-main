import {
  Coffee, Palette, TreePine, Utensils, Dumbbell, Eye
} from 'lucide-react';

// Helper function to get step data from timeline
export const getStepData = (step: string | { description: string; location?: string; locationName?: string }) => {
  if (typeof step === 'string') {
    return { description: step, location: '', locationName: '' };
  }
  return step;
};

// Open all timeline locations as multi-stop route in Google Maps
export const openAllInMaps = (timeline: any) => {
  if (!timeline) return;
  
  // Collect all locations from timeline steps
  const locations: string[] = [];
  
  Object.values(timeline).forEach((step: any) => {
    const stepData = getStepData(step);
    if (stepData.location) {
      locations.push(stepData.location);
    }
  });

  // Need at least 2 locations for a route
  if (locations.length < 2) {
    // If only one location, just open it
    if (locations.length === 1) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locations[0])}`, '_blank');
    }
    return;
  }

  // First location is origin, last is destination, rest are waypoints
  const origin = encodeURIComponent(locations[0]);
  const destination = encodeURIComponent(locations[locations.length - 1]);
  
  // Middle locations are waypoints (joined by |)
  const waypoints = locations.slice(1, -1).map(loc => encodeURIComponent(loc)).join('|');
  
  // Build Google Maps directions URL with waypoints
  let mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  
  if (waypoints) {
    mapsUrl += `&waypoints=${waypoints}`;
  }
  
  // Add travel mode
  mapsUrl += '&travelmode=driving';
  
  window.open(mapsUrl, '_blank');
};

// Helper function to extract average price from priceRange string
export const extractPriceFromRange = (priceRange: string, pricePerPerson?: number): number => {
  // If explicit pricePerPerson is set, use it
  if (pricePerPerson !== undefined) {
    return pricePerPerson;
  }
  
  // Handle "Free" cards
  if (priceRange.toLowerCase().includes('free')) {
    return 0;
  }
  
  // Extract numbers from price range like "$15-40" or "$150+"
  const numbers = priceRange.match(/\d+/g);
  if (!numbers || numbers.length === 0) {
    return 50; // Default fallback price
  }
  
  // If range has two numbers (e.g., "$15-40"), return the average
  if (numbers.length >= 2) {
    const min = parseInt(numbers[0]);
    const max = parseInt(numbers[1]);
    return (min + max) / 2;
  }
  
  // If only one number (e.g., "$150+"), return that number
  return parseInt(numbers[0]);
};

// Helper function to get icon component from category
export const getIconComponent = (categoryIcon: any) => {
  const iconMap: { [key: string]: any } = {
    Coffee,
    Palette,
    TreePine,
    Utensils,
    Dumbbell,
    Eye
  };
  
  // If it's already a component, return it
  if (typeof categoryIcon === 'function') {
    return categoryIcon;
  }
  
  // If it's a string, look it up in the map
  if (typeof categoryIcon === 'string') {
    return iconMap[categoryIcon] || Coffee;
  }
  
  return Coffee;
};
