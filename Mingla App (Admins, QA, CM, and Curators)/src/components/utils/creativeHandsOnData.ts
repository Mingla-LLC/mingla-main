/**
 * Creative & Hands-On Production-Ready Data Structure
 * 
 * Defines enhanced attributes specific to Creative & Hands-On experiences
 * These attributes drive specialized matching and scoring algorithms
 */

export interface CreativeHandsOnAttributes {
  // Workshop Classification
  workshopType: 'pottery' | 'painting' | 'cooking' | 'baking' | 'jewelry' | 'woodworking' | 'glassblowing' | 'floral' | 'candle_making' | 'diy_craft';
  
  // Activity Metrics (0-100 scale)
  activityScore: {
    handsOnLevel: number;         // How interactive and participatory (0=lecture, 100=fully hands-on)
    skillBuilding: number;         // Learning/skill development value
    creativeFreedom: number;       // How much creative control participants have
    socialInteraction: number;    // Level of group interaction encouraged
    takeHomeValue: number;        // Quality/value of what you take home
  };
  
  // Workshop Details
  workshopDetails: {
    currentOffering?: string;     // What's currently being taught
    skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'all-levels';
    maxParticipants: number;      // Class size
    materialsIncluded: boolean;
    materialsProvided: string[];  // List of what's provided
    duration: number;             // Workshop length in minutes
    hasInstructor: boolean;
    instructorStyle: 'guided' | 'demonstration' | 'hands-off' | 'collaborative';
  };
  
  // Venue Characteristics
  venueCharacteristics: {
    isIndoor: boolean;
    hasStudio: boolean;
    hasWorkstations: boolean;
    requiresReservation: boolean;
    allowsWalkIns: boolean;
    allowsGroups: boolean;
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
    hasRefreshments: boolean;
    hasSnacks: boolean;
    hasDrinks: boolean;           // Sip & Paint style
    hasStorage: boolean;          // For wet items, drying racks
    hasParking: boolean;
    wheelchairAccessible: boolean;
    provideAprons: boolean;
  };
  
  // Price Structure
  priceStructure: {
    sessionType: 'per-person' | 'per-couple' | 'per-group';
    includesMaterials: boolean;
    includesTool: boolean;
    takeHomePiece: boolean;
    groupDiscounts: boolean;
  };
  
  // Time Alignment (0-100 score)
  timeAlignment: {
    morning: number;              // Availability and suitability
    afternoon: number;
    evening: number;
    weekend: number;
  };
  
  // Weather Sensitivity
  weatherImpact: {
    indoorVenue: boolean;
    weatherAffectsExperience: boolean;
  };
  
  // Social Dynamics
  socialDynamics: {
    conversationFriendly: boolean;        // Can you chat while working?
    encouragesCollaboration: boolean;
    soloFriendly: boolean;
    pairFriendly: boolean;
    groupFriendly: boolean;
  };
  
  // Activity Comfort
  activityComfort: {
    physicalDemand: 'low' | 'medium' | 'high';
    messiness: 'clean' | 'somewhat-messy' | 'very-messy';
    concentration: 'relaxed' | 'moderate' | 'focused';
  };
  
  // Exclusions
  excludedIfAny: string[];        // e.g., ['lecture_only', 'passive_viewing']
  
  // Duration
  typicalDuration: {
    min: number;                  // minutes
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
 * Calculate Creative & Hands-On specific match score
 * Based on the formula: 35% exp type + 25% activity category + 15% budget + 15% travel + 10% time
 */
export function calculateCreativeHandsOnMatchScore(
  creativeData: CreativeHandsOnAttributes,
  userPreferences: any
): number {
  let score = 0;
  
  // Experience Type Fit (35% weight)
  if (userPreferences.experienceTypes && userPreferences.experienceTypes.length > 0) {
    const experienceTypeScores = userPreferences.experienceTypes.map((type: string) => {
      switch (type.toLowerCase()) {
        case 'first date':
        case 'firstdate':
          return creativeData.experienceTypeFit.firstDate;
        case 'romantic':
          return creativeData.experienceTypeFit.romantic;
        case 'friendly':
          return creativeData.experienceTypeFit.friendly;
        case 'group fun':
        case 'groupfun':
          return creativeData.experienceTypeFit.groupFun;
        case 'solo adventure':
        case 'soloadventure':
          return creativeData.experienceTypeFit.soloAdventure;
        case 'family':
          return creativeData.experienceTypeFit.family;
        default:
          return 50; // neutral score
      }
    });
    const avgExperienceScore = experienceTypeScores.reduce((a: number, b: number) => a + b, 0) / experienceTypeScores.length;
    score += (avgExperienceScore / 100) * 0.35;
  } else {
    score += 0.175; // Give half credit if no preference specified
  }
  
  // Activity Category Fit (25% weight)
  const activityAvg = (
    creativeData.activityScore.handsOnLevel +
    creativeData.activityScore.skillBuilding +
    creativeData.activityScore.creativeFreedom +
    creativeData.activityScore.socialInteraction +
    creativeData.activityScore.takeHomeValue
  ) / 5;
  score += (activityAvg / 100) * 0.25;
  
  // Budget Fit (15% weight) - handled by card generator
  score += 0.15;
  
  // Travel Proximity (15% weight) - handled by card generator
  score += 0.15;
  
  // Time Alignment (10% weight)
  const preferredTime = userPreferences.timeOfDay?.toLowerCase() || 'afternoon';
  let timeScore = 50; // neutral
  
  switch (preferredTime) {
    case 'morning':
      timeScore = creativeData.timeAlignment.morning;
      break;
    case 'afternoon':
      timeScore = creativeData.timeAlignment.afternoon;
      break;
    case 'evening':
      timeScore = creativeData.timeAlignment.evening;
      break;
    case 'weekend':
      timeScore = creativeData.timeAlignment.weekend;
      break;
    default:
      timeScore = 70;
  }
  
  score += (timeScore / 100) * 0.1;
  
  // Convert to 0-100 scale
  return Math.round(score * 100);
}

/**
 * Check if workshop should be excluded based on attributes
 */
export function shouldExcludeCreativeVenue(creativeData: CreativeHandsOnAttributes): boolean {
  const disqualifyingAttributes = ['lecture_only', 'passive_viewing', 'demonstration_only', 'no_participation'];
  return creativeData.excludedIfAny.some(attr => disqualifyingAttributes.includes(attr));
}

/**
 * Adjust score based on time of day alignment
 */
export function adjustScoreForTimeOfDay(
  baseScore: number,
  creativeData: CreativeHandsOnAttributes,
  preferredTime: string
): number {
  let timeBonus = 0;
  
  switch (preferredTime.toLowerCase()) {
    case 'morning':
      timeBonus = (creativeData.timeAlignment.morning - 50) / 10;
      break;
    case 'afternoon':
      timeBonus = (creativeData.timeAlignment.afternoon - 50) / 10;
      break;
    case 'evening':
      timeBonus = (creativeData.timeAlignment.evening - 50) / 10;
      break;
    case 'weekend':
      timeBonus = (creativeData.timeAlignment.weekend - 50) / 10;
      break;
    default:
      timeBonus = 0;
  }
  
  return Math.min(100, Math.max(0, baseScore + timeBonus));
}

/**
 * Generate Google Places API query for Creative & Hands-On venues
 */
export function generateCreativePlacesQuery(userPreferences: any): {
  types: string[];
  keywords: string[];
  excludeKeywords: string[];
} {
  return {
    types: ['art_studio', 'school', 'store'], // Some workshops are in stores
    keywords: [
      'pottery studio',
      'ceramics class',
      'painting class',
      'sip and paint',
      'cooking class',
      'baking workshop',
      'jewelry making',
      'woodworking',
      'glassblowing',
      'floral design',
      'candle making',
      'DIY workshop',
      'craft class',
      'hands-on workshop',
      'art workshop'
    ],
    excludeKeywords: [
      'school',
      'university',
      'lecture',
      'museum',
      'gallery only',
      'theory class'
    ]
  };
}

/**
 * Determine skill level compatibility
 */
export function checkSkillLevelMatch(
  workshopSkillLevel: string,
  userExperience: string = 'beginner'
): boolean {
  if (workshopSkillLevel === 'all-levels') return true;
  
  const levels: { [key: string]: number } = {
    'beginner': 1,
    'intermediate': 2,
    'advanced': 3
  };
  
  const workshopLevel = levels[workshopSkillLevel] || 1;
  const userLevel = levels[userExperience] || 1;
  
  // Allow one level up or down
  return Math.abs(workshopLevel - userLevel) <= 1;
}

/**
 * Suggest what to bring based on workshop type
 */
export function suggestWhatToBring(workshopType: string): string[] {
  const suggestions: { [key: string]: string[] } = {
    'pottery': ['Comfortable clothes', 'Hair tie (if long hair)', 'Towel'],
    'painting': ['Old clothes or apron', 'Hair tie', 'Inspiration photo (optional)'],
    'cooking': ['Apron', 'Hair tie', 'Containers for leftovers'],
    'baking': ['Apron', 'Hair tie', 'Containers for treats'],
    'jewelry': ['Reading glasses (if needed)', 'Design inspiration'],
    'woodworking': ['Closed-toe shoes', 'Safety glasses', 'Hair tie'],
    'glassblowing': ['Comfortable heat-resistant clothes', 'Hair tie', 'Closed-toe shoes'],
    'floral': ['Scissors (optional)', 'Vase (optional)'],
    'candle_making': ['Containers (optional)', 'Design ideas'],
    'diy_craft': ['Creative ideas', 'Comfortable clothes']
  };
  
  return suggestions[workshopType] || ['Comfortable clothes', 'Creative mindset'];
}
