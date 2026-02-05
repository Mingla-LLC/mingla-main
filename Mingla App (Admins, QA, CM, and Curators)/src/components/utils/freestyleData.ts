/**
 * Freestyle Data Module
 * 
 * Purpose: Provides production-ready wildcard experience data for the Freestyle category
 * 
 * Category Definition:
 * - Spontaneous, surprising, unique experiences designed for discovery
 * - CROSS-CATEGORY: Pulls from all experience types (dining, creative, wellness, entertainment)
 * - Focus on novelty, uniqueness, and the "this looks interesting" factor
 * - Time-sensitive events, pop-ups, and one-of-a-kind experiences
 * - Duration: 2-4 hours (flexible, open-ended)
 * - Price range: $10-50 per person
 * 
 * Experience Types:
 * - Seasonal and cultural festivals
 * - Art walks, night markets, food fairs
 * - Quirky pop-ups and immersive installations
 * - Secret supper clubs or themed experiences
 * - Hybrid events (museum + DJ, cinema + dinner)
 * - Surprise AI-surfaced recommendations
 * 
 * Data Structure:
 * Each freestyle experience includes:
 * - Novelty indicators (time-limited, unique, trending)
 * - Loose 3-4 step timeline (flexible exploration flow)
 * - Cross-category elements
 * - Discovery and spontaneity markers
 * - Open-ended duration estimates
 * - Match weights for personalized recommendations
 */

export interface FreestyleTimelineStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  icon: string;
  isFlexible?: boolean;
}

export interface FreestyleCard {
  id: string;
  title: string;
  category: 'freestyle';
  description: string;
  freestyleType: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  pricePerPerson: number;
  atmosphereMarkers: string[];
  highlights: string[];
  fullDescription: string;
  noveltyIndicators: {
    isTimeLimited: boolean;
    isPopUp: boolean;
    isTrending: boolean;
    isUnique: boolean;
    seasonalEvent?: string;
  };
  crossCategoryElements: string[];
  eventType: 'festival' | 'pop-up' | 'installation' | 'themed-night' | 'hybrid' | 'market';
  outdoorEvent: boolean;
  timeline: FreestyleTimelineStep[];
  estimatedDuration: string;
  flexibleTiming: boolean;
  matchWeights: {
    soloAdventure: number;
    firstDate: number;
    romantic: number;
    friendly: number;
    groupFun: number;
  };
}

/**
 * Production-ready Freestyle experience data
 * 5 diverse wildcard experiences across different event types
 */
export const freestyleExperiences: FreestyleCard[] = [
  {
    id: 'freestyle-001',
    title: 'GlowFest - Neon Night Market',
    category: 'freestyle',
    description: 'Open-air night market with glowing art installations, live DJs, and global street food',
    freestyleType: 'Night Market + Art Festival',
    rating: 4.8,
    reviewCount: 1432,
    priceRange: '$15-35',
    pricePerPerson: 25,
    atmosphereMarkers: ['Vibrant', 'Social', 'Artistic', 'Festival vibes', 'Instagram-worthy'],
    highlights: ['Neon light installations', 'Live DJ sets', '20+ food vendors', 'Outdoor dancing'],
    fullDescription: 'An immersive outdoor night market featuring glowing art installations, multiple live DJ performances, and diverse international street food vendors. Wander through neon-lit pathways, sample global cuisines, and dance under the stars.',
    noveltyIndicators: {
      isTimeLimited: true,
      isPopUp: false,
      isTrending: true,
      isUnique: true,
      seasonalEvent: 'Summer Series'
    },
    crossCategoryElements: ['Food (Casual Eats)', 'Art (Creative)', 'Music (Entertainment)', 'Social (Group Fun)'],
    eventType: 'market',
    outdoorEvent: true,
    flexibleTiming: true,
    estimatedDuration: '2-4 hours',
    timeline: [
      {
        step: 1,
        title: 'Arrive at GlowFest',
        description: 'Head to the festival grounds. Doors open at 6 PM. Grab a map and explore the glowing pathways.',
        duration: '15-20 min',
        icon: '🎪',
        isFlexible: true
      },
      {
        step: 2,
        title: 'Explore Food Vendors',
        description: 'Wander through 20+ international street food stalls. Sample Korean tacos, Venezuelan arepas, or Japanese takoyaki.',
        duration: '45-60 min',
        icon: '🍜',
        isFlexible: true
      },
      {
        step: 3,
        title: 'Art Installation Walk',
        description: 'Stroll through interactive neon art installations. Perfect photo opportunities with glowing sculptures and light tunnels.',
        duration: '30-45 min',
        icon: '✨',
        isFlexible: true
      },
      {
        step: 4,
        title: 'Live Music & Dancing',
        description: 'Catch the DJ set at the main stage or chill at the lounge area. Stay as long as you want — event runs until midnight.',
        duration: '1-2 hours',
        icon: '🎵',
        isFlexible: true
      }
    ],
    matchWeights: {
      soloAdventure: 0.7,
      firstDate: 0.85,
      romantic: 0.75,
      friendly: 1.0,
      groupFun: 1.0
    }
  },

  {
    id: 'freestyle-002',
    title: 'The Secret Gallery - Immersive Pop-Up',
    category: 'freestyle',
    description: 'Hidden pop-up art gallery with interactive installations and surprise performances',
    freestyleType: 'Pop-Up Art Experience',
    rating: 4.9,
    reviewCount: 876,
    priceRange: '$20-30',
    pricePerPerson: 25,
    atmosphereMarkers: ['Mysterious', 'Artistic', 'Interactive', 'Intimate', 'Curated'],
    highlights: ['Secret location revealed 24h before', 'Interactive installations', 'Live performance art', 'Limited capacity'],
    fullDescription: 'A mysterious pop-up art gallery in an undisclosed warehouse location. Experience cutting-edge interactive installations, live performance art, and surprise creative moments. Location revealed to ticket holders 24 hours in advance.',
    noveltyIndicators: {
      isTimeLimited: true,
      isPopUp: true,
      isTrending: true,
      isUnique: true
    },
    crossCategoryElements: ['Art (Creative)', 'Performance (Entertainment)', 'Discovery (Adventure)'],
    eventType: 'pop-up',
    outdoorEvent: false,
    flexibleTiming: true,
    estimatedDuration: '2-3 hours',
    timeline: [
      {
        step: 1,
        title: 'Find the Secret Location',
        description: 'Follow the address revealed in your confirmation email. Look for the subtle entrance marker.',
        duration: '10-15 min',
        icon: '🗺️',
        isFlexible: false
      },
      {
        step: 2,
        title: 'Interactive Installations',
        description: 'Explore 8 rooms of immersive art. Touch, play with, and become part of the installations.',
        duration: '60-90 min',
        icon: '🎨',
        isFlexible: true
      },
      {
        step: 3,
        title: 'Surprise Performance',
        description: 'Catch the live performance art piece. Times vary — ask staff for the schedule or wander and discover.',
        duration: '20-30 min',
        icon: '🎭',
        isFlexible: true
      },
      {
        step: 4,
        title: 'Lounge & Reflect',
        description: 'Relax in the gallery lounge with complimentary drinks. Chat with artists and fellow explorers.',
        duration: '30-45 min',
        icon: '🍷',
        isFlexible: true
      }
    ],
    matchWeights: {
      soloAdventure: 0.85,
      firstDate: 0.9,
      romantic: 0.85,
      friendly: 0.95,
      groupFun: 0.8
    }
  },

  {
    id: 'freestyle-003',
    title: 'Underground Supper Club - Chef\'s Mystery Menu',
    category: 'freestyle',
    description: 'Secret dining experience with a surprise 5-course menu in a hidden location',
    freestyleType: 'Secret Supper Club',
    rating: 4.9,
    reviewCount: 623,
    priceRange: '$45-65',
    pricePerPerson: 55,
    atmosphereMarkers: ['Intimate', 'Exclusive', 'Mysterious', 'Culinary adventure', 'Sophisticated'],
    highlights: ['Secret location', '5-course mystery menu', 'Limited to 20 guests', 'Wine pairings included'],
    fullDescription: 'An exclusive underground dining experience hosted by a renowned chef in a secret location. Enjoy a surprise 5-course tasting menu with wine pairings, intimate atmosphere, and culinary storytelling.',
    noveltyIndicators: {
      isTimeLimited: true,
      isPopUp: true,
      isTrending: true,
      isUnique: true
    },
    crossCategoryElements: ['Dining (Fine Dining)', 'Social (Intimate)', 'Discovery (Secret)', 'Entertainment (Storytelling)'],
    eventType: 'themed-night',
    outdoorEvent: false,
    flexibleTiming: false,
    estimatedDuration: '3-4 hours',
    timeline: [
      {
        step: 1,
        title: 'Arrive at Secret Location',
        description: 'Address sent 48 hours before. Arrive at the unmarked door and use the secret knock pattern provided.',
        duration: '10 min',
        icon: '🚪',
        isFlexible: false
      },
      {
        step: 2,
        title: 'Welcome Reception',
        description: 'Mingle with fellow diners over champagne and amuse-bouche. Meet the chef and learn about the evening\'s theme.',
        duration: '30 min',
        icon: '🥂',
        isFlexible: false
      },
      {
        step: 3,
        title: '5-Course Mystery Menu',
        description: 'Experience the surprise tasting menu with wine pairings. Each course tells a story, each flavor is a discovery.',
        duration: '2-2.5 hours',
        icon: '🍽️',
        isFlexible: false
      },
      {
        step: 4,
        title: 'Dessert & Digestif',
        description: 'End with an elaborate dessert course and digestif. Chat with the chef, exchange contacts with new friends.',
        duration: '30-45 min',
        icon: '🍰',
        isFlexible: true
      }
    ],
    matchWeights: {
      soloAdventure: 0.6,
      firstDate: 0.95,
      romantic: 1.0,
      friendly: 0.85,
      groupFun: 0.75
    }
  },

  {
    id: 'freestyle-004',
    title: 'Skyline Cinema - Rooftop Movie Night',
    category: 'freestyle',
    description: 'Outdoor cinema on a downtown rooftop with craft cocktails and city views',
    freestyleType: 'Rooftop Cinema Experience',
    rating: 4.7,
    reviewCount: 1089,
    priceRange: '$25-40',
    pricePerPerson: 32,
    atmosphereMarkers: ['Romantic', 'Urban', 'Cozy', 'Cinematic', 'Sophisticated'],
    highlights: ['Rooftop setting with skyline views', 'Craft cocktail bar', 'Blankets and cushions provided', 'Curated classic films'],
    fullDescription: 'Watch classic and indie films under the stars on a downtown rooftop. Enjoy craft cocktails, gourmet snacks, and stunning city skyline views. Cozy blankets and cushions provided for the ultimate outdoor cinema experience.',
    noveltyIndicators: {
      isTimeLimited: true,
      isPopUp: false,
      isTrending: true,
      isUnique: true,
      seasonalEvent: 'Summer Cinema Series'
    },
    crossCategoryElements: ['Entertainment (Screen & Relax)', 'Dining (Sip & Chill)', 'Romance (Dates)', 'Urban (Views)'],
    eventType: 'hybrid',
    outdoorEvent: true,
    flexibleTiming: false,
    estimatedDuration: '3-4 hours',
    timeline: [
      {
        step: 1,
        title: 'Rooftop Check-In',
        description: 'Arrive early to grab the best spots. Check in at the rooftop entrance and claim your blanket and cushions.',
        duration: '15-20 min',
        icon: '🎬',
        isFlexible: true
      },
      {
        step: 2,
        title: 'Pre-Show Cocktails',
        description: 'Visit the craft cocktail bar. Order drinks and snacks while enjoying sunset views over the city skyline.',
        duration: '30-45 min',
        icon: '🍹',
        isFlexible: true
      },
      {
        step: 3,
        title: 'Movie Screening',
        description: 'Settle in with blankets as the film begins. Tonight\'s feature starts at 8:30 PM. Immersive audio, stunning visuals.',
        duration: '2-2.5 hours',
        icon: '🎥',
        isFlexible: false
      },
      {
        step: 4,
        title: 'Post-Film Hangout',
        description: 'Linger on the rooftop after the credits. Chat about the movie, enjoy the night air, or grab one last drink.',
        duration: '20-30 min',
        icon: '🌃',
        isFlexible: true
      }
    ],
    matchWeights: {
      soloAdventure: 0.75,
      firstDate: 0.95,
      romantic: 1.0,
      friendly: 0.9,
      groupFun: 0.85
    }
  },

  {
    id: 'freestyle-005',
    title: 'Lunar Festival - Cultural Celebration',
    category: 'freestyle',
    description: 'Annual cultural festival with traditional performances, lanterns, and authentic cuisine',
    freestyleType: 'Cultural Festival',
    rating: 4.8,
    reviewCount: 2134,
    priceRange: '$10-30',
    pricePerPerson: 20,
    atmosphereMarkers: ['Cultural', 'Festive', 'Family-friendly', 'Authentic', 'Celebratory'],
    highlights: ['Traditional dance performances', 'Lantern lighting ceremony', 'Authentic street food', 'Cultural workshops'],
    fullDescription: 'Celebrate lunar traditions with this vibrant cultural festival featuring traditional performances, lantern lighting ceremony, authentic cuisine from multiple regions, and hands-on cultural workshops. A beautiful blend of heritage and celebration.',
    noveltyIndicators: {
      isTimeLimited: true,
      isPopUp: false,
      isTrending: true,
      isUnique: true,
      seasonalEvent: 'Annual Lunar Festival'
    },
    crossCategoryElements: ['Culture (Heritage)', 'Food (Casual Eats)', 'Performance (Entertainment)', 'Community (Social)'],
    eventType: 'festival',
    outdoorEvent: true,
    flexibleTiming: true,
    estimatedDuration: '2-4 hours',
    timeline: [
      {
        step: 1,
        title: 'Festival Entry & Exploration',
        description: 'Enter the festival grounds. Pick up a program guide and explore colorful decorations, vendor stalls, and cultural displays.',
        duration: '20-30 min',
        icon: '🏮',
        isFlexible: true
      },
      {
        step: 2,
        title: 'Food Tasting Tour',
        description: 'Sample authentic dishes from various regional vendors. Try dumplings, spring rolls, bubble tea, and traditional desserts.',
        duration: '45-60 min',
        icon: '🥟',
        isFlexible: true
      },
      {
        step: 3,
        title: 'Cultural Performances',
        description: 'Watch traditional dance performances on the main stage. Lion dances, folk music, and martial arts demonstrations.',
        duration: '30-45 min',
        icon: '🎭',
        isFlexible: true
      },
      {
        step: 4,
        title: 'Lantern Lighting Ceremony',
        description: 'Participate in the magical lantern lighting ceremony at sunset. Write wishes on lanterns and release them into the sky.',
        duration: '30-40 min',
        icon: '🪔',
        isFlexible: false
      }
    ],
    matchWeights: {
      soloAdventure: 0.75,
      firstDate: 0.85,
      romantic: 0.8,
      friendly: 0.95,
      groupFun: 1.0
    }
  }
];

/**
 * Calculate match score for Freestyle based on user preferences
 * 
 * Match Formula:
 * Match = 0.3(ExperienceTypeFit) + 0.25(NoveltyScore) + 0.15(BudgetFit) + 0.15(TravelProximity) + 0.15(WeatherSuitability)
 * 
 * Minimum threshold: 0.65 (65%)
 * 
 * @param experience - The freestyle experience to score
 * @param userPreferences - User's preferences from PreferencesSheet
 * @returns Match score between 0 and 1
 */
export function calculateFreestyleMatch(
  experience: FreestyleCard,
  userPreferences: any
): number {
  let totalScore = 0;

  // 1. Experience Type Fit (30%)
  const experienceTypes = userPreferences?.experienceTypes || [];
  let experienceScore = 0;
  
  if (experienceTypes.includes('Solo Adventure') || experienceTypes.includes('soloAdventure')) {
    experienceScore = Math.max(experienceScore, experience.matchWeights.soloAdventure);
  }
  if (experienceTypes.includes('First Date') || experienceTypes.includes('firstDate')) {
    experienceScore = Math.max(experienceScore, experience.matchWeights.firstDate);
  }
  if (experienceTypes.includes('Romantic') || experienceTypes.includes('romantic')) {
    experienceScore = Math.max(experienceScore, experience.matchWeights.romantic);
  }
  if (experienceTypes.includes('Friendly') || experienceTypes.includes('friendly')) {
    experienceScore = Math.max(experienceScore, experience.matchWeights.friendly);
  }
  if (experienceTypes.includes('Group Fun') || experienceTypes.includes('groupFun')) {
    experienceScore = Math.max(experienceScore, experience.matchWeights.groupFun);
  }
  
  // Default to friendly weight if no match (freestyle is generally social)
  if (experienceScore === 0) {
    experienceScore = experience.matchWeights.friendly;
  }
  
  totalScore += experienceScore * 0.3;

  // 2. Novelty Score (25%) - Unique to Freestyle
  let noveltyScore = 0.7; // Base novelty
  
  const { noveltyIndicators } = experience;
  
  // Time-limited events have higher novelty
  if (noveltyIndicators.isTimeLimited) {
    noveltyScore += 0.1;
  }
  
  // Pop-ups are inherently novel
  if (noveltyIndicators.isPopUp) {
    noveltyScore += 0.1;
  }
  
  // Trending experiences get a boost
  if (noveltyIndicators.isTrending) {
    noveltyScore += 0.05;
  }
  
  // Unique one-of-a-kind experiences
  if (noveltyIndicators.isUnique) {
    noveltyScore += 0.05;
  }
  
  totalScore += Math.min(noveltyScore, 1.0) * 0.25;

  // 3. Budget Fit (15%)
  let budgetScore = 0.85; // Base score
  
  if (userPreferences?.budgetMin && userPreferences?.budgetMax) {
    const userMin = Number(userPreferences.budgetMin);
    const userMax = Number(userPreferences.budgetMax);
    const experiencePrice = experience.pricePerPerson;
    
    if (experiencePrice >= userMin && experiencePrice <= userMax) {
      budgetScore = 1.0; // Perfect fit
    } else if (experiencePrice < userMin) {
      budgetScore = 0.95; // Under budget (still great)
    } else if (experiencePrice > userMax) {
      const overBudget = (experiencePrice - userMax) / userMax;
      budgetScore = Math.max(0.6, 1.0 - overBudget);
    }
  }
  
  totalScore += budgetScore * 0.15;

  // 4. Travel Proximity (15%)
  // Use rating as proxy for now (higher rated = worth traveling for)
  const travelScore = experience.rating / 5.0;
  totalScore += travelScore * 0.15;

  // 5. Weather Suitability (15%)
  let weatherScore = 0.75; // Base score
  
  const weatherPref = userPreferences?.weatherPreference?.toLowerCase() || '';
  
  // Outdoor events are weather-sensitive
  if (experience.outdoorEvent) {
    if (weatherPref.includes('sunny') || weatherPref === 'any weather') {
      weatherScore += 0.2; // Bonus for outdoor in good weather
    }
    if (weatherPref.includes('rain')) {
      weatherScore -= 0.3; // Penalty for outdoor in rain
    }
  } else {
    // Indoor events work in any weather
    if (weatherPref.includes('rain') || weatherPref.includes('cold')) {
      weatherScore += 0.15; // Bonus for indoor when weather is bad
    }
  }
  
  // Flexible timing helps with weather planning
  if (experience.flexibleTiming) {
    weatherScore += 0.1;
  }
  
  totalScore += Math.min(Math.max(weatherScore, 0.4), 1.0) * 0.15;

  return Math.min(totalScore, 1.0);
}

/**
 * Get all freestyle experiences with match scores
 */
export function getFreestyleExperiencesWithScores(userPreferences: any) {
  return freestyleExperiences.map(experience => ({
    ...experience,
    matchScore: Math.round(calculateFreestyleMatch(experience, userPreferences) * 100)
  })).filter(experience => experience.matchScore >= 65) // Minimum 65% match
    .sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Filter experiences by event type
 */
export function getExperiencesByType(
  eventType: 'festival' | 'pop-up' | 'installation' | 'themed-night' | 'hybrid' | 'market',
  userPreferences?: any
) {
  const filtered = freestyleExperiences.filter(exp => exp.eventType === eventType);
  
  if (userPreferences) {
    return filtered.map(experience => ({
      ...experience,
      matchScore: Math.round(calculateFreestyleMatch(experience, userPreferences) * 100)
    })).filter(experience => experience.matchScore >= 65)
      .sort((a, b) => b.matchScore - a.matchScore);
  }
  
  return filtered;
}

/**
 * Filter experiences by novelty indicators
 */
export function getTrendingExperiences(userPreferences?: any) {
  const trending = freestyleExperiences.filter(exp => exp.noveltyIndicators.isTrending);
  
  if (userPreferences) {
    return trending.map(experience => ({
      ...experience,
      matchScore: Math.round(calculateFreestyleMatch(experience, userPreferences) * 100)
    })).filter(experience => experience.matchScore >= 65)
      .sort((a, b) => b.matchScore - a.matchScore);
  }
  
  return trending;
}

/**
 * Filter pop-up experiences only
 */
export function getPopUpExperiences(userPreferences?: any) {
  const popUps = freestyleExperiences.filter(exp => exp.noveltyIndicators.isPopUp);
  
  if (userPreferences) {
    return popUps.map(experience => ({
      ...experience,
      matchScore: Math.round(calculateFreestyleMatch(experience, userPreferences) * 100)
    })).filter(experience => experience.matchScore >= 65)
      .sort((a, b) => b.matchScore - a.matchScore);
  }
  
  return popUps;
}
