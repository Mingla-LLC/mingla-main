interface UserPreferences {
  budget_min?: number;
  budget_max?: number;
  categories?: string[];
  travel_mode?: string;
  [key: string]: any;
}

interface TripContext {
  category: string;
  cost: number;
  location: string;
  duration: string;
  isIndoor?: boolean;
  isOutdoor?: boolean;
  hasFood?: boolean;
  isActive?: boolean;
  isRelaxing?: boolean;
  isRomantic?: boolean;
  isCultural?: boolean;
  isAdventurous?: boolean;
}

export function generateWhyItFits(preferences: UserPreferences, trip: TripContext): string {
  const reasons: string[] = [];
  
  // Budget alignment
  if (preferences.budget_min && preferences.budget_max) {
    if (trip.cost >= preferences.budget_min && trip.cost <= preferences.budget_max) {
      reasons.push("fits your budget perfectly");
    }
  }
  
  // Category preferences
  if (preferences.categories && preferences.categories.length > 0) {
    const matchedCategories = preferences.categories.filter(cat => 
      trip.category.toLowerCase().includes(cat.toLowerCase())
    );
    if (matchedCategories.length > 0) {
      reasons.push(`matches your interest in ${matchedCategories.join(', ')}`);
    }
  }
  
  // Travel mode preferences
  if (preferences.travel_mode) {
    switch (preferences.travel_mode) {
      case 'walking':
        if (trip.location.includes('downtown') || trip.location.includes('city center')) {
          reasons.push("perfect for exploring on foot");
        }
        break;
      case 'public_transit':
        reasons.push("easily accessible by public transport");
        break;
      case 'driving':
        reasons.push("convenient parking available");
        break;
    }
  }
  
  // Default fallback with personalization
  if (reasons.length === 0) {
    const categoryMatch = trip.category.toLowerCase();
    if (categoryMatch.includes('food') || categoryMatch.includes('dining')) {
      reasons.push("great local dining experience");
    } else if (categoryMatch.includes('culture') || categoryMatch.includes('art')) {
      reasons.push("enriching cultural experience");
    } else if (categoryMatch.includes('outdoor') || categoryMatch.includes('nature')) {
      reasons.push("perfect outdoor adventure");
    } else {
      reasons.push("highly rated local experience");
    }
  }
  
  return reasons.slice(0, 2).join(" and ");
}

export function generatePerfectFor(trip: TripContext, preferences?: UserPreferences): string[] {
  const tags: string[] = [];
  
  const category = trip.category.toLowerCase();
  const hasFood = category.includes('food') || category.includes('dining') || category.includes('restaurant');
  const isCultural = category.includes('culture') || category.includes('museum') || category.includes('art');
  const isOutdoor = category.includes('outdoor') || category.includes('park') || category.includes('nature');
  const isActive = category.includes('sports') || category.includes('hiking') || category.includes('active');
  
  // Context-based tags
  if (hasFood) {
    tags.push("First Date", "Foodie Adventure");
  }
  
  if (isCultural) {
    tags.push("Date Night", "Cultural Explorer");
  }
  
  if (isOutdoor) {
    tags.push("Nature Lover", "Active Couple");
  }
  
  if (isActive) {
    tags.push("Fitness Enthusiast", "Adventure Seeker");
  }
  
  // Budget-based tags
  if (trip.cost < 20) {
    tags.push("Budget Friendly");
  } else if (trip.cost > 100) {
    tags.push("Special Occasion");
  }
  
  // Duration-based tags
  if (trip.duration.includes("30 min") || trip.duration.includes("1 hour")) {
    tags.push("Quick Escape");
  } else if (trip.duration.includes("3 hour") || trip.duration.includes("4 hour")) {
    tags.push("Half Day Trip");
  }
  
  // Location-based tags
  if (trip.location.includes("downtown") || trip.location.includes("city")) {
    tags.push("Urban Explorer");
  }
  
  // Default romantic/friendly options
  if (tags.length < 3) {
    tags.push("Romantic", "Friendly Hangout");
  }
  
  return tags.slice(0, 4);
}

export function generatePlanBOptions(originalTrip: TripContext, preferences?: UserPreferences): TripContext[] {
  const alternatives: TripContext[] = [];
  
  // Indoor alternative for outdoor activities
  if (originalTrip.category.toLowerCase().includes('outdoor')) {
    alternatives.push({
      ...originalTrip,
      category: originalTrip.category.replace('outdoor', 'indoor'),
      location: originalTrip.location + " - Indoor Alternative",
      cost: originalTrip.cost * 0.8,
      isIndoor: true,
      isOutdoor: false
    });
  }
  
  // Budget-friendly alternative
  if (originalTrip.cost > 50) {
    alternatives.push({
      ...originalTrip,
      cost: Math.max(originalTrip.cost * 0.5, 15),
      location: originalTrip.location + " - Budget Option",
      duration: originalTrip.duration
    });
  }
  
  // Different category but same area
  const categoryAlternatives = [
    { from: 'dining', to: 'culture', modifier: 'nearby museum or gallery' },
    { from: 'culture', to: 'dining', modifier: 'local restaurant or café' },
    { from: 'outdoor', to: 'culture', modifier: 'indoor cultural site' },
    { from: 'culture', to: 'outdoor', modifier: 'nearby park or outdoor space' }
  ];
  
  const currentCategory = originalTrip.category.toLowerCase();
  const matchingAlternative = categoryAlternatives.find(alt => 
    currentCategory.includes(alt.from)
  );
  
  if (matchingAlternative) {
    alternatives.push({
      ...originalTrip,
      category: matchingAlternative.to,
      location: originalTrip.location + ` - ${matchingAlternative.modifier}`,
      cost: originalTrip.cost * (Math.random() * 0.4 + 0.8), // 80-120% of original cost
    });
  }
  
  return alternatives.slice(0, 2);
}