/**
 * Screen & Relax Production-Ready Data Structure
 * 
 * Defines the enhanced attributes specific to Screen & Relax experiences
 * These attributes drive the specialized matching and scoring algorithms
 */

export interface ScreenRelaxAttributes {
  // Venue Classification
  venueType: 'movie_theater' | 'indie_cinema' | 'drive_in' | 'comedy_club' | 'theater' | 'performing_arts';
  
  // Entertainment Metrics (0-100 scale)
  entertainmentScore: {
    screenQuality: number;        // Visual quality for cinema (0=poor, 100=IMAX/premium)
    soundQuality: number;         // Audio experience quality
    seatingComfort: number;       // Comfort level of seating
    atmosphere: number;           // Overall ambience and vibe
    varietyOffers: number;        // Range of shows/films offered
  };
  
  // Show/Screening Details
  showDetails: {
    currentShowing?: string;      // What's currently playing/performing
    genres: string[];             // Film/show genres (comedy, drama, horror, musical, etc.)
    showLength: number;           // Typical runtime in minutes
    hasMatinee: boolean;          // Offers daytime shows
    hasEvening: boolean;          // Offers evening shows
    hasLateNight: boolean;        // Offers late night shows
  };
  
  // Venue Characteristics
  venueCharacteristics: {
    isIndoor: boolean;
    isOutdoor: boolean;
    hasReservedSeating: boolean;
    hasGeneralAdmission: boolean;
    requiresAdvanceBooking: boolean;
    allowsWalkIns: boolean;
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
  
  // Accessibility & Amenities
  amenities: {
    hasSnackBar: boolean;
    hasDining: boolean;
    hasBar: boolean;            // For comedy clubs, theaters with bars
    hasParking: boolean;
    wheelchairAccessible: boolean;
  };
  
  // Price Structure
  priceStructure: {
    ticketType: 'standard' | 'premium' | 'vip' | 'general_admission' | 'reserved';
    dynamicPricing: boolean;    // Prices vary by showtime
    groupDiscounts: boolean;
  };
  
  // Time Alignment
  showtimeProximity: {
    morning: number;            // 0-100 score for morning shows
    afternoon: number;
    evening: number;
    lateNight: number;
  };
  
  // Weather Sensitivity
  weatherImpact: {
    indoorVenue: boolean;
    weatherAffectsExperience: boolean;  // True for drive-ins, outdoor theaters
    idealWeather?: string;              // "Clear skies" for outdoor venues
  };
  
  // Social Dynamics
  socialDynamics: {
    conversationDuringShow: 'none' | 'minimal' | 'encouraged';  // Comedy clubs may encourage
    audienceInteraction: boolean;                               // Stand-up, improv
    sharedExperience: number;                                   // 0-100: how much it's about sharing
  };
  
  // Exclusions
  excludedIfAny: string[];      // e.g., ['nightclub', 'sports_venue']
  
  // Duration
  typicalDuration: {
    min: number;                // minutes (including pre/post time)
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
 * Calculate Screen & Relax specific match score
 * Based on the formula defined in requirements
 */
export function calculateScreenRelaxMatchScore(
  screenRelaxData: ScreenRelaxAttributes,
  userPreferences: any
): number {
  let score = 0;
  
  // Experience Type Fit (40% weight)
  if (userPreferences.experienceTypes && userPreferences.experienceTypes.length > 0) {
    const experienceTypeScores = userPreferences.experienceTypes.map((type: string) => {
      switch (type.toLowerCase()) {
        case 'first date':
        case 'firstdate':
          return screenRelaxData.experienceTypeFit.firstDate;
        case 'romantic':
          return screenRelaxData.experienceTypeFit.romantic;
        case 'friendly':
          return screenRelaxData.experienceTypeFit.friendly;
        case 'group fun':
        case 'groupfun':
          return screenRelaxData.experienceTypeFit.groupFun;
        case 'solo adventure':
        case 'soloadventure':
          return screenRelaxData.experienceTypeFit.soloAdventure;
        case 'family':
          return screenRelaxData.experienceTypeFit.family;
        default:
          return 50; // neutral score
      }
    });
    const avgExperienceScore = experienceTypeScores.reduce((a: number, b: number) => a + b, 0) / experienceTypeScores.length;
    score += (avgExperienceScore / 100) * 0.4;
  } else {
    score += 0.2; // Give half credit if no preference specified
  }
  
  // Entertainment Relevance (25% weight)
  const entertainmentAvg = (
    screenRelaxData.entertainmentScore.screenQuality +
    screenRelaxData.entertainmentScore.soundQuality +
    screenRelaxData.entertainmentScore.seatingComfort +
    screenRelaxData.entertainmentScore.atmosphere +
    screenRelaxData.entertainmentScore.varietyOffers
  ) / 5;
  score += (entertainmentAvg / 100) * 0.25;
  
  // Budget Fit (15% weight)
  // This is handled by the general card generator
  score += 0.15; // Placeholder - will be calculated by cardGenerator
  
  // Travel Proximity (10% weight)
  // This is handled by the general card generator
  score += 0.10; // Placeholder - will be calculated by cardGenerator
  
  // Time Alignment (10% weight) - Showtime proximity
  const preferredTime = userPreferences.timeOfDay?.toLowerCase() || 'evening';
  let timeScore = 50; // neutral
  
  switch (preferredTime) {
    case 'morning':
      timeScore = screenRelaxData.showtimeProximity.morning;
      break;
    case 'afternoon':
      timeScore = screenRelaxData.showtimeProximity.afternoon;
      break;
    case 'evening':
      timeScore = screenRelaxData.showtimeProximity.evening;
      break;
    case 'late night':
    case 'latenight':
      timeScore = screenRelaxData.showtimeProximity.lateNight;
      break;
    default:
      timeScore = 70; // Default to good score
  }
  
  score += (timeScore / 100) * 0.1;
  
  // Convert to 0-100 scale
  return Math.round(score * 100);
}

/**
 * Check if venue should be excluded based on attributes
 */
export function shouldExcludeScreenRelaxVenue(screenRelaxData: ScreenRelaxAttributes): boolean {
  const disqualifyingAttributes = ['nightclub', 'sports_venue', 'bar_only', 'dance_club'];
  return screenRelaxData.excludedIfAny.some(attr => disqualifyingAttributes.includes(attr));
}

/**
 * Adjust score based on showtime proximity to user's preferred time
 */
export function adjustScoreForShowtime(
  baseScore: number,
  screenRelaxData: ScreenRelaxAttributes,
  preferredTime: string
): number {
  let timeBonus = 0;
  
  switch (preferredTime.toLowerCase()) {
    case 'morning':
      timeBonus = (screenRelaxData.showtimeProximity.morning - 50) / 10; // -5 to +5 range
      break;
    case 'afternoon':
    case 'matinee':
      timeBonus = (screenRelaxData.showtimeProximity.afternoon - 50) / 10;
      break;
    case 'evening':
    case 'night':
      timeBonus = (screenRelaxData.showtimeProximity.evening - 50) / 10;
      break;
    case 'late night':
    case 'latenight':
      timeBonus = (screenRelaxData.showtimeProximity.lateNight - 50) / 10;
      break;
    default:
      timeBonus = 0;
  }
  
  return Math.min(100, Math.max(0, baseScore + timeBonus));
}

/**
 * Generate Google Places API query for Screen & Relax venues
 */
export function generateScreenRelaxPlacesQuery(userPreferences: any): {
  types: string[];
  keywords: string[];
  excludeKeywords: string[];
} {
  return {
    types: ['movie_theater', 'performing_arts_theater', 'night_club'], // night_club filtered by keywords for comedy
    keywords: [
      'cinema',
      'movie theater',
      'indie film',
      'comedy club',
      'stand-up comedy',
      'theater',
      'musical',
      'stage performance',
      'drive-in theater',
      'improv',
      'performing arts'
    ],
    excludeKeywords: [
      'nightclub',
      'dance club',
      'sports bar',
      'karaoke',
      'live band'
    ]
  };
}

/**
 * Determine optimal showtime based on user preferences
 */
export function suggestShowtime(
  screenRelaxData: ScreenRelaxAttributes,
  preferredTime: string
): string {
  const time = preferredTime.toLowerCase();
  
  if (time.includes('morning') && screenRelaxData.showDetails.hasMatinee) {
    return '10:30 AM Matinee';
  } else if (time.includes('afternoon') && screenRelaxData.showDetails.hasMatinee) {
    return '2:00 PM Matinee';
  } else if (time.includes('evening') && screenRelaxData.showDetails.hasEvening) {
    return '7:30 PM Showtime';
  } else if (time.includes('late') && screenRelaxData.showDetails.hasLateNight) {
    return '10:00 PM Late Show';
  } else {
    // Default to evening
    return '7:30 PM Showtime';
  }
}
