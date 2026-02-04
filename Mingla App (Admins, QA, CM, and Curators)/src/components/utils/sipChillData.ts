/**
 * Sip & Chill Production-Ready Data Structure
 * 
 * Defines the enhanced attributes specific to Sip & Chill experiences
 * These attributes drive the specialized matching and scoring algorithms
 */

export interface SipChillAttributes {
  // Venue Classification
  venueType: 'cafe' | 'wine_bar' | 'cocktail_bar' | 'speakeasy' | 'brewery' | 'tea_house' | 'roastery';
  
  // Ambience Metrics (0-100 scale)
  ambienceScore: {
    quietness: number;          // How quiet/conversation-friendly (0=loud, 100=whisper-quiet)
    coziness: number;           // Warmth and comfort level
    intimacy: number;           // Private/intimate feel
    sophistication: number;     // Upscale/refined atmosphere
    casualness: number;         // Laid-back/relaxed vibe
  };
  
  // Conversational Suitability
  conversationSuitability: 'excellent' | 'good' | 'moderate' | 'challenging';
  
  // Seating & Space
  seatingOptions: {
    hasIndoorSeating: boolean;
    hasOutdoorSeating: boolean;
    hasPrivateNooks: boolean;
    hasBarSeating: boolean;
    hasLounge: boolean;
    reservationRecommended: boolean;
  };
  
  // Drink Focus
  drinkFocus: {
    primary: string[];          // e.g., ['Coffee', 'Espresso', 'Pour-over']
    specialties: string[];      // Signature drinks/experiences
    hasFlights: boolean;        // Tasting flights available
    hasPairings: boolean;       // Food/drink pairings
  };
  
  // Food Availability (secondary to drinks)
  foodLevel: 'none' | 'snacks' | 'small_bites' | 'light_menu';
  
  // Ambience Details
  ambienceDetails: {
    lighting: 'bright' | 'soft' | 'dim' | 'candle-lit';
    music: 'none' | 'ambient' | 'jazz' | 'acoustic' | 'curated_playlist';
    decor: string;              // Description of aesthetic
    crowdLevel: 'intimate' | 'moderate' | 'bustling';
  };
  
  // Weather Sensitivity
  weatherPreference: {
    idealForRain: boolean;      // Great during bad weather
    idealForSunshine: boolean;  // Great outdoor seating
    seasonality: 'year-round' | 'seasonal';
  };
  
  // Experience Type Fit (0-100 scale for each)
  experienceTypeFit: {
    firstDate: number;
    romantic: number;
    friendly: number;
    soloAdventure: number;
    business: number;
  };
  
  // Exclusions (red flags that disqualify venue)
  excludedIfAny: string[];      // e.g., ['nightclub', 'sports_bar', 'loud_music']
  
  // Time of Day Preferences
  idealTimeOfDay: {
    morning: number;            // 0-100 score
    afternoon: number;
    evening: number;
    lateNight: number;
  };
  
  // Duration
  typicalDuration: {
    min: number;                // minutes
    max: number;
    average: number;
  };
  
  // Timeline Steps (for single-venue experience)
  timelineSteps: {
    step: string;
    description: string;
    duration: string;
    icon: string;
  }[];
}

/**
 * Calculate Sip & Chill specific match score
 * Based on the formula defined in requirements
 */
export function calculateSipChillMatchScore(
  sipChillData: SipChillAttributes,
  userPreferences: any
): number {
  let score = 0;
  
  // Experience Type Fit (40% weight)
  if (userPreferences.experienceTypes && userPreferences.experienceTypes.length > 0) {
    const experienceTypeScores = userPreferences.experienceTypes.map((type: string) => {
      switch (type.toLowerCase()) {
        case 'first date':
        case 'firstdate':
          return sipChillData.experienceTypeFit.firstDate;
        case 'romantic':
          return sipChillData.experienceTypeFit.romantic;
        case 'friendly':
          return sipChillData.experienceTypeFit.friendly;
        case 'solo adventure':
        case 'soloadventure':
          return sipChillData.experienceTypeFit.soloAdventure;
        case 'business':
          return sipChillData.experienceTypeFit.business;
        default:
          return 50; // neutral score
      }
    });
    const avgExperienceScore = experienceTypeScores.reduce((a: number, b: number) => a + b, 0) / experienceTypeScores.length;
    score += (avgExperienceScore / 100) * 0.4;
  } else {
    score += 0.2; // Give half credit if no preference specified
  }
  
  // Ambience Score (25% weight)
  const ambienceAvg = (
    sipChillData.ambienceScore.quietness +
    sipChillData.ambienceScore.coziness +
    sipChillData.ambienceScore.intimacy +
    sipChillData.ambienceScore.sophistication +
    sipChillData.ambienceScore.casualness
  ) / 5;
  score += (ambienceAvg / 100) * 0.25;
  
  // Budget Fit (15% weight)
  // This is handled by the general card generator
  score += 0.15; // Placeholder - will be calculated by cardGenerator
  
  // Travel Time (10% weight)
  // This is handled by the general card generator
  score += 0.10; // Placeholder - will be calculated by cardGenerator
  
  // Weather Comfort (10% weight)
  // Adjust based on current conditions
  const currentSeason = new Date().getMonth();
  const isWinter = currentSeason >= 11 || currentSeason <= 2;
  const isSummer = currentSeason >= 5 && currentSeason <= 8;
  
  let weatherScore = 50; // neutral
  if (isWinter && sipChillData.weatherPreference.idealForRain) {
    weatherScore = 90; // Great for cozy indoor experiences
  } else if (isSummer && sipChillData.weatherPreference.idealForSunshine) {
    weatherScore = 90; // Great for outdoor seating
  } else if (sipChillData.seatingOptions.hasIndoorSeating && sipChillData.seatingOptions.hasOutdoorSeating) {
    weatherScore = 75; // Versatile
  }
  score += (weatherScore / 100) * 0.1;
  
  // Convert to 0-100 scale
  return Math.round(score * 100);
}

/**
 * Check if venue should be excluded based on attributes
 */
export function shouldExcludeVenue(sipChillData: SipChillAttributes): boolean {
  const disqualifyingAttributes = ['nightclub', 'sports_bar', 'loud_music', 'rowdy', 'party_scene'];
  return sipChillData.excludedIfAny.some(attr => disqualifyingAttributes.includes(attr));
}

/**
 * Adjust score based on time of day
 */
export function adjustScoreForTimeOfDay(
  baseScore: number,
  sipChillData: SipChillAttributes,
  timeOfDay: string
): number {
  let timeBonus = 0;
  
  switch (timeOfDay.toLowerCase()) {
    case 'morning':
    case 'breakfast':
      timeBonus = (sipChillData.idealTimeOfDay.morning - 50) / 10; // -5 to +5 range
      break;
    case 'afternoon':
    case 'lunch':
      timeBonus = (sipChillData.idealTimeOfDay.afternoon - 50) / 10;
      break;
    case 'evening':
    case 'dinner':
      timeBonus = (sipChillData.idealTimeOfDay.evening - 50) / 10;
      break;
    case 'late night':
    case 'latenight':
      timeBonus = (sipChillData.idealTimeOfDay.lateNight - 50) / 10;
      break;
    default:
      timeBonus = 0;
  }
  
  return Math.min(100, Math.max(0, baseScore + timeBonus));
}

/**
 * Generate Google Places API query for Sip & Chill venues
 */
export function generateSipChillPlacesQuery(userPreferences: any): {
  types: string[];
  keywords: string[];
  excludeKeywords: string[];
} {
  return {
    types: ['cafe', 'bar', 'night_club'], // night_club will be filtered by keywords
    keywords: [
      'coffee roastery',
      'wine bar',
      'cocktail lounge',
      'speakeasy',
      'brewery taproom',
      'tea house',
      'cozy cafe',
      'quiet bar',
      'conversation-friendly'
    ],
    excludeKeywords: [
      'nightclub',
      'dance club',
      'sports bar',
      'loud',
      'party',
      'crowded',
      'karaoke'
    ]
  };
}
