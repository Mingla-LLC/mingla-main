/**
 * Picnics Production-Ready Data Structure
 * 
 * Defines enhanced attributes specific to Picnic experiences
 * These are TWO-STOP experiences (grocery + park) with weather sensitivity
 */

export interface PicnicsAttributes {
  // Route Structure - Two stops required
  routeStructure: {
    stop1Type: 'grocery_store' | 'market' | 'convenience_store' | 'deli';
    stop1Name: string;
    stop1Address: string;
    stop2Type: 'park' | 'beach' | 'botanical_garden' | 'waterfront' | 'scenic_overlook';
    stop2Name: string;
    stop2Address: string;
    travelBetweenStops: number; // minutes
  };
  
  // Location Metrics (0-100 scale)
  locationScore: {
    scenicValue: number;          // How beautiful/photogenic
    privacyLevel: number;         // Crowded vs. secluded
    amenitiesNearby: number;      // Restrooms, water fountains, parking
    accessibilityScore: number;   // Ease of access
    safetyRating: number;         // Well-lit, populated areas
  };
  
  // Picnic Details
  picnicDetails: {
    idealTime: 'morning' | 'afternoon' | 'evening' | 'sunset';
    typicalDuration: number;      // minutes at the park
    hasShade: boolean;
    hasTables: boolean;
    hasGrills: boolean;
    allowsAlcohol: boolean;
    petFriendly: boolean;
  };
  
  // Grocery/Market Details
  groceryDetails: {
    storeType: 'full_grocery' | 'specialty_market' | 'convenience' | 'deli';
    hasReadyMade: boolean;        // Pre-made sandwiches, salads
    hasPicnicSupplies: boolean;   // Blankets, utensils for sale
    priceRange: 'budget' | 'moderate' | 'upscale';
    openUntil: string;            // Closing time
  };
  
  // Weather Sensitivity (CRITICAL for picnics)
  weatherRequirements: {
    minTemp: number;              // Fahrenheit
    maxTemp: number;
    idealWeather: string[];       // ['sunny', 'partly_cloudy']
    avoidWeather: string[];       // ['rain', 'thunderstorm', 'snow']
    windTolerance: 'low' | 'medium' | 'high';
    uvSensitivity: boolean;       // If high UV is a concern
  };
  
  // Experience Type Fit (0-100 scale for each)
  experienceTypeFit: {
    firstDate: number;
    romantic: number;
    friendly: number;
    groupFun: number;
    soloAdventure: number;
    family: number;
  };
  
  // Amenities at Park
  parkAmenities: {
    hasRestrooms: boolean;
    hasWaterFountain: boolean;
    hasParking: boolean;
    hasPlayground: boolean;       // For families
    hasTrails: boolean;           // For post-picnic walk
    wheelchairAccessible: boolean;
  };
  
  // Price Structure
  priceStructure: {
    estimatedGroceryCost: number; // Per person
    parkingCost: number;          // 0 if free
    totalEstimate: number;        // Per person including everything
  };
  
  // Time Alignment (0-100 score)
  timeAlignment: {
    morning: number;              // Some parks better for morning
    afternoon: number;
    evening: number;
    sunset: number;               // Sunset views
  };
  
  // Social Dynamics
  socialDynamics: {
    conversationFriendly: boolean; // Easy to chat
    activityOptions: string[];     // Games, sports, reading
    romanticPotential: number;     // 0-100 for romantic atmosphere
    groupCapacity: 'intimate' | 'small' | 'large';
  };
  
  // Suggested Shopping List
  suggestedItems: {
    essentials: string[];          // ['Blanket', 'Water', 'Sunscreen']
    foodIdeas: string[];           // ['Sandwiches', 'Fruit', 'Cheese']
    optionalExtras: string[];      // ['Wine', 'Games', 'Speaker']
  };
  
  // Exclusions
  excludedIfAny: string[];         // e.g., ['unsafe_area', 'closed_park', 'no_grocery_nearby']
  
  // Duration Breakdown
  typicalDuration: {
    groceryStop: number;           // minutes
    travelTopark: number;          // minutes
    atPark: number;                // minutes
    total: number;
  };
  
  // Timeline Steps (for two-stop experience)
  timelineSteps: {
    step: string;
    locationName: string;
    description: string;
    duration: string;
    icon: string;
  }[];
}

/**
 * Calculate Picnics specific match score
 * Based on the formula: 30% exp type + 25% weather + 20% budget + 15% travel + 10% availability
 */
export function calculatePicnicsMatchScore(
  picnicsData: PicnicsAttributes,
  userPreferences: any,
  weatherData?: any
): number {
  let score = 0;
  
  // Experience Type Fit (30% weight)
  if (userPreferences.experienceTypes && userPreferences.experienceTypes.length > 0) {
    const experienceTypeScores = userPreferences.experienceTypes.map((type: string) => {
      switch (type.toLowerCase()) {
        case 'first date':
        case 'firstdate':
          return picnicsData.experienceTypeFit.firstDate;
        case 'romantic':
          return picnicsData.experienceTypeFit.romantic;
        case 'friendly':
          return picnicsData.experienceTypeFit.friendly;
        case 'group fun':
        case 'groupfun':
          return picnicsData.experienceTypeFit.groupFun;
        case 'solo adventure':
        case 'soloadventure':
          return picnicsData.experienceTypeFit.soloAdventure;
        case 'family':
          return picnicsData.experienceTypeFit.family;
        default:
          return 50; // neutral score
      }
    });
    const avgExperienceScore = experienceTypeScores.reduce((a: number, b: number) => a + b, 0) / experienceTypeScores.length;
    score += (avgExperienceScore / 100) * 0.3;
  } else {
    score += 0.15; // Give half credit if no preference specified
  }
  
  // Weather Suitability (25% weight) - CRITICAL
  const weatherScore = calculateWeatherSuitability(picnicsData, weatherData);
  score += (weatherScore / 100) * 0.25;
  
  // Budget Fit (20% weight) - handled by card generator
  score += 0.20;
  
  // Travel Proximity (15% weight) - handled by card generator
  score += 0.15;
  
  // Availability Score (10% weight) - grocery store open, park accessible
  const availabilityScore = checkAvailability(picnicsData, userPreferences);
  score += (availabilityScore / 100) * 0.1;
  
  // Convert to 0-100 scale
  return Math.round(score * 100);
}

/**
 * Calculate weather suitability for picnic
 * Returns 0-100 score based on current/forecasted weather
 */
export function calculateWeatherSuitability(
  picnicsData: PicnicsAttributes,
  weatherData?: any
): number {
  if (!weatherData) {
    return 70; // Neutral score if no weather data
  }
  
  let score = 100;
  
  // Check temperature
  const temp = weatherData.temperature || 70;
  if (temp < picnicsData.weatherRequirements.minTemp) {
    score -= 30; // Too cold
  } else if (temp > picnicsData.weatherRequirements.maxTemp) {
    score -= 20; // Too hot
  }
  
  // Check weather condition
  const condition = weatherData.condition?.toLowerCase() || 'clear';
  if (picnicsData.weatherRequirements.avoidWeather.some(avoid => condition.includes(avoid))) {
    score -= 50; // Bad weather
  } else if (picnicsData.weatherRequirements.idealWeather.some(ideal => condition.includes(ideal))) {
    score += 0; // Ideal weather, no change
  } else {
    score -= 10; // Okay but not ideal
  }
  
  // Check wind
  const wind = weatherData.windSpeed || 5;
  if (wind > 15 && picnicsData.weatherRequirements.windTolerance === 'low') {
    score -= 20;
  } else if (wind > 25 && picnicsData.weatherRequirements.windTolerance === 'medium') {
    score -= 20;
  }
  
  // Check precipitation
  if (weatherData.precipitation && weatherData.precipitation > 20) {
    score -= 40; // Likely rain
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Check if grocery store and park are available at user's preferred time
 */
export function checkAvailability(
  picnicsData: PicnicsAttributes,
  userPreferences: any
): number {
  let score = 100;
  
  // Check if grocery store will be open
  // In production, this would check actual hours
  const preferredTime = userPreferences.timeOfDay?.toLowerCase() || 'afternoon';
  
  if (preferredTime === 'late night' || preferredTime === 'very early morning') {
    score -= 30; // Most stores closed
  }
  
  // Parks are generally always accessible, but some close at dusk
  if (preferredTime === 'late night') {
    score -= 20; // Safety concern
  }
  
  return score;
}

/**
 * Check if picnic should be excluded based on attributes
 */
export function shouldExcludePicnic(picnicsData: PicnicsAttributes): boolean {
  const disqualifyingAttributes = ['unsafe_area', 'closed_park', 'no_grocery_nearby', 'under_construction'];
  return picnicsData.excludedIfAny.some(attr => disqualifyingAttributes.includes(attr));
}

/**
 * Adjust score based on time of day preference
 */
export function adjustScoreForTimeOfDay(
  baseScore: number,
  picnicsData: PicnicsAttributes,
  preferredTime: string
): number {
  let timeBonus = 0;
  
  switch (preferredTime.toLowerCase()) {
    case 'morning':
      timeBonus = (picnicsData.timeAlignment.morning - 50) / 10;
      break;
    case 'afternoon':
      timeBonus = (picnicsData.timeAlignment.afternoon - 50) / 10;
      break;
    case 'evening':
      timeBonus = (picnicsData.timeAlignment.evening - 50) / 10;
      break;
    case 'sunset':
      timeBonus = (picnicsData.timeAlignment.sunset - 50) / 10;
      break;
    default:
      timeBonus = 0;
  }
  
  return Math.min(100, Math.max(0, baseScore + timeBonus));
}

/**
 * Generate weather warning message if conditions are poor
 */
export function generateWeatherWarning(
  picnicsData: PicnicsAttributes,
  weatherData: any
): string | null {
  if (!weatherData) return null;
  
  const condition = weatherData.condition?.toLowerCase() || '';
  const temp = weatherData.temperature || 70;
  const precipitation = weatherData.precipitation || 0;
  
  // Check for deal-breakers
  if (picnicsData.weatherRequirements.avoidWeather.some(avoid => condition.includes(avoid))) {
    return `⚠️ ${condition} expected — consider rescheduling your picnic`;
  }
  
  if (temp < picnicsData.weatherRequirements.minTemp) {
    return `❄️ Temperature ${temp}°F — may be too cold for outdoor dining`;
  }
  
  if (temp > picnicsData.weatherRequirements.maxTemp) {
    return `🌡️ Temperature ${temp}°F — may be too hot, bring extra water`;
  }
  
  if (precipitation > 30) {
    return `🌧️ ${precipitation}% chance of rain — bring backup plan`;
  }
  
  return null;
}

/**
 * Generate Google Places API query for Picnics (two queries: grocery + park)
 */
export function generatePicnicsPlacesQuery(userPreferences: any): {
  groceryQuery: {
    types: string[];
    keywords: string[];
    excludeKeywords: string[];
  };
  parkQuery: {
    types: string[];
    keywords: string[];
    excludeKeywords: string[];
  };
} {
  return {
    groceryQuery: {
      types: ['supermarket', 'grocery_or_supermarket', 'convenience_store'],
      keywords: [
        'grocery',
        'supermarket',
        'market',
        'trader joes',
        'whole foods',
        'deli',
        'convenience store'
      ],
      excludeKeywords: [
        'pharmacy',
        'gas station only'
      ]
    },
    parkQuery: {
      types: ['park', 'tourist_attraction'],
      keywords: [
        'park',
        'picnic area',
        'botanical garden',
        'waterfront',
        'beach',
        'scenic overlook',
        'green space',
        'lakeside'
      ],
      excludeKeywords: [
        'amusement park',
        'water park',
        'parking',
        'dog park only'
      ]
    }
  };
}

/**
 * Suggest optimal picnic time based on weather and park characteristics
 */
export function suggestOptimalTime(
  picnicsData: PicnicsAttributes,
  weatherForecast: any[]
): string {
  // In production, analyze weather forecast for next 7 days
  // Return best time slot
  
  if (picnicsData.picnicDetails.idealTime === 'sunset') {
    return 'Evening around 6-7 PM for sunset views';
  } else if (picnicsData.timeAlignment.afternoon > 90) {
    return 'Afternoon around 2-4 PM for best conditions';
  } else if (picnicsData.timeAlignment.morning > 90) {
    return 'Morning around 10-11 AM before crowds';
  }
  
  return 'Afternoon is typically ideal';
}
