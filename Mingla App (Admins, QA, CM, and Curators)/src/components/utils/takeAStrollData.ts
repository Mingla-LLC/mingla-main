/**
 * Take a Stroll Data Module
 * 
 * Purpose: Provides production-ready stroll route data for the Take a Stroll category
 * 
 * Category Definition:
 * - Light, scenic outings for calm conversation and exploration
 * - ROUTE-BASED: Pairs outdoor location with food/drink stop
 * - Creates balanced experience of movement and relaxation
 * - Duration: 30-40 minutes walk + café time (1-1.5 hours total)
 * - Price range: $5-25 per person (café/snack budget)
 * 
 * Route Types:
 * - Parks + cafés/bakeries
 * - Waterfronts + snack stops
 * - Botanical gardens + tea houses
 * - Urban trails + ice cream shops
 * - Coastal walks + waterfront cafés
 * 
 * Data Structure:
 * Each stroll includes comprehensive routeData with:
 * - Anchor location (park, trail, waterfront)
 * - Paired food/drink stop (café, bakery, ice cream)
 * - Walking route details (duration, distance, scenic points)
 * - 3-5 step timeline
 * - Weather sensitivity (outdoor activity)
 * - Match weights for personalized recommendations
 */

export interface StrollTimelineStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  icon: string;
  location?: string;
}

export interface RouteData {
  anchorLocation: {
    name: string;
    type: 'park' | 'waterfront' | 'trail' | 'botanical-garden' | 'urban-path';
    address: string;
  };
  pairedFoodStop: {
    name: string;
    type: 'cafe' | 'bakery' | 'ice-cream' | 'food-market' | 'tea-house';
    address: string;
    priceRange: string;
  };
  walkingRoute: {
    distance: string;
    duration: string;
    difficulty: 'easy' | 'moderate';
    scenicPoints: string[];
    isLoop: boolean;
  };
  weatherSensitivity: 'high' | 'moderate' | 'low';
  bestTimeOfDay: string[];
  timeline: StrollTimelineStep[];
  matchWeights: {
    soloAdventure: number;
    firstDate: number;
    romantic: number;
    friendly: number;
    conversation: number;
  };
}

export interface StrollCard {
  id: string;
  title: string;
  category: 'stroll';
  description: string;
  strollType: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  pricePerPerson: number;
  atmosphereMarkers: string[];
  highlights: string[];
  fullDescription: string;
  weatherDependent: boolean;
  routeData: RouteData;
}

/**
 * Production-ready Take a Stroll route data
 * 5 diverse scenic routes with paired food stops
 */
export const strollRoutes: StrollCard[] = [
  {
    id: 'stroll-001',
    title: 'Golden Gate Park Stroll + Blue Bottle Coffee',
    category: 'stroll',
    description: 'Peaceful park walk through meadows and gardens with artisan coffee',
    strollType: 'Park & Café',
    rating: 4.8,
    reviewCount: 892,
    priceRange: '$5-15',
    pricePerPerson: 10,
    atmosphereMarkers: ['Peaceful', 'Scenic', 'Nature', 'Relaxing', 'Conversation-friendly'],
    highlights: ['Botanical gardens', 'Quiet meadows', 'Japanese Tea Garden views', 'Artisan coffee'],
    fullDescription: 'Start with a perfectly crafted latte at Blue Bottle, then meander through Golden Gate Park\'s tranquil paths. Pass by botanical gardens and serene meadows perfect for conversation.',
    weatherDependent: true,
    routeData: {
      anchorLocation: {
        name: 'Golden Gate Park',
        type: 'park',
        address: 'Golden Gate Park, San Francisco, CA 94118'
      },
      pairedFoodStop: {
        name: 'Blue Bottle Coffee - Haight',
        type: 'cafe',
        address: '315 Linden Street, San Francisco, CA 94102',
        priceRange: '$5-10'
      },
      walkingRoute: {
        distance: '2.5 km',
        duration: '30-35 min',
        difficulty: 'easy',
        scenicPoints: ['Botanical Garden views', 'Stow Lake glimpses', 'Meadow paths', 'Tree-lined trails'],
        isLoop: true
      },
      weatherSensitivity: 'high',
      bestTimeOfDay: ['morning', 'afternoon'],
      timeline: [
        {
          step: 1,
          title: 'Start at Blue Bottle Coffee',
          description: 'Grab your favorite coffee or pastry. Take a moment to savor before heading out.',
          duration: '10-15 min',
          icon: '☕',
          location: 'Blue Bottle Coffee - Haight'
        },
        {
          step: 2,
          title: 'Enter Golden Gate Park',
          description: 'Walk through the Music Concourse area. Admire the de Young Museum and California Academy of Sciences from outside.',
          duration: '10 min',
          icon: '🌳'
        },
        {
          step: 3,
          title: 'Scenic Garden Walk',
          description: 'Stroll past the Botanical Garden perimeter. Enjoy peaceful meadows and tree-lined paths perfect for conversation.',
          duration: '20-25 min',
          icon: '🌸',
          location: 'San Francisco Botanical Garden area'
        },
        {
          step: 4,
          title: 'Optional Rest Stop',
          description: 'Pause at a scenic bench or meadow. Perfect spot to finish your coffee and chat.',
          duration: '10 min',
          icon: '🪑'
        },
        {
          step: 5,
          title: 'Return Loop',
          description: 'Circle back via a different path. Option to grab a second coffee or treat if desired.',
          duration: '10 min',
          icon: '🔄'
        }
      ],
      matchWeights: {
        soloAdventure: 0.8,
        firstDate: 0.9,
        romantic: 0.85,
        friendly: 0.95,
        conversation: 0.95
      }
    }
  },

  {
    id: 'stroll-002',
    title: 'Embarcadero Waterfront + Ferry Building Marketplace',
    category: 'stroll',
    description: 'Stunning bay views with gourmet snacks from the iconic Ferry Building',
    strollType: 'Waterfront & Market',
    rating: 4.9,
    reviewCount: 1247,
    priceRange: '$8-20',
    pricePerPerson: 15,
    atmosphereMarkers: ['Waterfront', 'Vibrant', 'Iconic', 'Food lovers', 'Bay views'],
    highlights: ['Bay Bridge views', 'Ferry Building shops', 'Pier exploration', 'Gourmet treats'],
    fullDescription: 'Explore the Ferry Building\'s artisan food stalls, then walk the scenic Embarcadero waterfront with Bay Bridge views and active pier atmosphere.',
    weatherDependent: true,
    routeData: {
      anchorLocation: {
        name: 'Embarcadero Waterfront',
        type: 'waterfront',
        address: 'The Embarcadero, San Francisco, CA 94111'
      },
      pairedFoodStop: {
        name: 'Ferry Building Marketplace',
        type: 'food-market',
        address: '1 Ferry Building, San Francisco, CA 94111',
        priceRange: '$8-20'
      },
      walkingRoute: {
        distance: '3.2 km',
        duration: '35-40 min',
        difficulty: 'easy',
        scenicPoints: ['Bay Bridge views', 'Pier 7 overlook', 'Historic piers', 'Waterfront promenade'],
        isLoop: false
      },
      weatherSensitivity: 'moderate',
      bestTimeOfDay: ['morning', 'afternoon', 'evening'],
      timeline: [
        {
          step: 1,
          title: 'Explore Ferry Building',
          description: 'Browse artisan vendors. Grab coffee from Blue Bottle, pastries from Acme Bread, or treats from local vendors.',
          duration: '15-20 min',
          icon: '🏛️',
          location: 'Ferry Building Marketplace'
        },
        {
          step: 2,
          title: 'Waterfront Stroll North',
          description: 'Walk north along the Embarcadero. Take in stunning Bay Bridge views and watch boats in the harbor.',
          duration: '15-20 min',
          icon: '⛵',
          location: 'Embarcadero Promenade'
        },
        {
          step: 3,
          title: 'Pier 7 Overlook',
          description: 'Stop at the iconic wooden Pier 7. Perfect photo spot with panoramic bay views.',
          duration: '10 min',
          icon: '📸',
          location: 'Pier 7'
        },
        {
          step: 4,
          title: 'Continue to Pier 39 Area',
          description: 'Optional: Extend your walk toward Pier 39. See sea lions and enjoy the lively atmosphere.',
          duration: '15-20 min',
          icon: '🦭'
        },
        {
          step: 5,
          title: 'Return or Relax',
          description: 'Head back to Ferry Building or find a waterfront bench. Enjoy your treats with the view.',
          duration: '10-15 min',
          icon: '🌊'
        }
      ],
      matchWeights: {
        soloAdventure: 0.7,
        firstDate: 0.85,
        romantic: 0.9,
        friendly: 0.95,
        conversation: 0.85
      }
    }
  },

  {
    id: 'stroll-003',
    title: 'Presidio Trails + The Warming Hut',
    category: 'stroll',
    description: 'Coastal forest trails with Golden Gate Bridge views and cozy café',
    strollType: 'Trail & Café',
    rating: 4.7,
    reviewCount: 634,
    priceRange: '$6-12',
    pricePerPerson: 9,
    atmosphereMarkers: ['Natural', 'Peaceful', 'Scenic', 'Historic', 'Bridge views'],
    highlights: ['Golden Gate Bridge proximity', 'Forest trails', 'Coastal views', 'Cozy café'],
    fullDescription: 'Wind through peaceful Presidio forest trails with glimpses of the Golden Gate Bridge, ending at The Warming Hut for coffee and homemade treats.',
    weatherDependent: true,
    routeData: {
      anchorLocation: {
        name: 'Presidio Trails',
        type: 'trail',
        address: 'Presidio of San Francisco, CA 94129'
      },
      pairedFoodStop: {
        name: 'The Warming Hut',
        type: 'cafe',
        address: '983 Marine Drive, San Francisco, CA 94129',
        priceRange: '$6-12'
      },
      walkingRoute: {
        distance: '2.8 km',
        duration: '30-35 min',
        difficulty: 'easy',
        scenicPoints: ['Golden Gate Bridge views', 'Forest canopy', 'Coastal overlooks', 'Historic military sites'],
        isLoop: true
      },
      weatherSensitivity: 'high',
      bestTimeOfDay: ['morning', 'afternoon'],
      timeline: [
        {
          step: 1,
          title: 'Meet at The Warming Hut',
          description: 'Start with hot coffee or tea. Grab a pastry or sandwich for the walk.',
          duration: '10-15 min',
          icon: '☕',
          location: 'The Warming Hut'
        },
        {
          step: 2,
          title: 'Coastal Trail Start',
          description: 'Begin walking the Coastal Trail. Enjoy immediate Golden Gate Bridge views and ocean breeze.',
          duration: '10-15 min',
          icon: '🌉',
          location: 'Coastal Trail'
        },
        {
          step: 3,
          title: 'Forest Path Loop',
          description: 'Wind through eucalyptus and cypress forest. Peaceful trails with dappled sunlight and bird songs.',
          duration: '15-20 min',
          icon: '🌲'
        },
        {
          step: 4,
          title: 'Battery Viewpoint',
          description: 'Stop at a historic battery overlook. Take in panoramic bay views and bridge photography.',
          duration: '10 min',
          icon: '🔭'
        },
        {
          step: 5,
          title: 'Return to Warming Hut',
          description: 'Loop back to starting point. Option to grab a second drink or warm up by the fireplace (seasonal).',
          duration: '10 min',
          icon: '🔥'
        }
      ],
      matchWeights: {
        soloAdventure: 0.85,
        firstDate: 0.8,
        romantic: 0.9,
        friendly: 0.9,
        conversation: 0.9
      }
    }
  },

  {
    id: 'stroll-004',
    title: 'Mission Dolores Park + Tartine Bakery',
    category: 'stroll',
    description: 'Urban park with city views and world-famous pastries',
    strollType: 'Urban Park & Bakery',
    rating: 4.8,
    reviewCount: 1089,
    priceRange: '$8-18',
    pricePerPerson: 13,
    atmosphereMarkers: ['Urban', 'Vibrant', 'Social', 'Sunny', 'City views'],
    highlights: ['Downtown skyline views', 'People watching', 'Famous bakery', 'Sunny terraces'],
    fullDescription: 'Pick up legendary pastries from Tartine, then enjoy them while strolling through Mission Dolores Park with its incredible downtown views and vibrant atmosphere.',
    weatherDependent: true,
    routeData: {
      anchorLocation: {
        name: 'Mission Dolores Park',
        type: 'park',
        address: 'Dolores Street & 19th Street, San Francisco, CA 94114'
      },
      pairedFoodStop: {
        name: 'Tartine Bakery',
        type: 'bakery',
        address: '600 Guerrero Street, San Francisco, CA 94110',
        priceRange: '$8-18'
      },
      walkingRoute: {
        distance: '1.8 km',
        duration: '25-30 min',
        difficulty: 'easy',
        scenicPoints: ['Downtown skyline', 'Palm tree row', 'Tennis courts vista', 'Mission District views'],
        isLoop: true
      },
      weatherSensitivity: 'moderate',
      bestTimeOfDay: ['morning', 'afternoon'],
      timeline: [
        {
          step: 1,
          title: 'Start at Tartine Bakery',
          description: 'Grab world-famous morning buns, croissants, or sandwiches. Expect a line - it\'s worth it!',
          duration: '15-20 min',
          icon: '🥐',
          location: 'Tartine Bakery'
        },
        {
          step: 2,
          title: 'Walk to Dolores Park',
          description: 'Short 5-minute walk up the hill. Enter the park and find your perfect spot.',
          duration: '5-10 min',
          icon: '🚶'
        },
        {
          step: 3,
          title: 'Park Exploration',
          description: 'Walk through the park terraces. Admire skyline views, watch dogs play, soak in the vibrant energy.',
          duration: '20-25 min',
          icon: '🌳',
          location: 'Mission Dolores Park'
        },
        {
          step: 4,
          title: 'Find Your Spot',
          description: 'Choose a sunny patch of grass or shaded area. Enjoy your Tartine treats with the view.',
          duration: '15-20 min',
          icon: '🧺'
        },
        {
          step: 5,
          title: 'Optional Neighborhood Walk',
          description: 'Explore colorful Mission District streets. Street art, boutiques, and cafés abound.',
          duration: '15-20 min',
          icon: '🎨'
        }
      ],
      matchWeights: {
        soloAdventure: 0.7,
        firstDate: 0.9,
        romantic: 0.8,
        friendly: 1.0,
        conversation: 0.85
      }
    }
  },

  {
    id: 'stroll-005',
    title: 'Land\'s End Coastal Trail + Cliff House',
    category: 'stroll',
    description: 'Dramatic coastal cliffs with ocean views and historic waterfront café',
    strollType: 'Coastal Trail & Historic Café',
    rating: 4.9,
    reviewCount: 1456,
    priceRange: '$10-20',
    pricePerPerson: 15,
    atmosphereMarkers: ['Dramatic', 'Coastal', 'Scenic', 'Historic', 'Pacific views'],
    highlights: ['Rugged coastline', 'Shipwreck views', 'Golden Gate glimpses', 'Ocean café'],
    fullDescription: 'Experience San Francisco\'s most dramatic coastal trail with sweeping Pacific views, hidden beaches, and the historic Cliff House for refreshments.',
    weatherDependent: true,
    routeData: {
      anchorLocation: {
        name: 'Land\'s End Coastal Trail',
        type: 'trail',
        address: 'Land\'s End Trailhead, San Francisco, CA 94121'
      },
      pairedFoodStop: {
        name: 'Cliff House Bistro',
        type: 'cafe',
        address: '1090 Point Lobos Avenue, San Francisco, CA 94121',
        priceRange: '$10-20'
      },
      walkingRoute: {
        distance: '3.5 km',
        duration: '35-40 min',
        difficulty: 'moderate',
        scenicPoints: ['Pacific Ocean panoramas', 'Mile Rock Beach overlook', 'Sutro Baths ruins', 'Golden Gate Bridge distant views'],
        isLoop: false
      },
      weatherSensitivity: 'high',
      bestTimeOfDay: ['morning', 'afternoon', 'sunset'],
      timeline: [
        {
          step: 1,
          title: 'Start at Cliff House',
          description: 'Begin with coffee or hot chocolate. Take in the ocean views from this historic landmark.',
          duration: '15-20 min',
          icon: '🏛️',
          location: 'Cliff House Bistro'
        },
        {
          step: 2,
          title: 'Sutro Baths Ruins',
          description: 'Explore the fascinating ruins of the historic public baths. Stunning coastal photography spot.',
          duration: '10-15 min',
          icon: '🏛️',
          location: 'Sutro Baths'
        },
        {
          step: 3,
          title: 'Coastal Trail Walk',
          description: 'Traverse the dramatic cliffside trail. Cypress trees, crashing waves, and sweeping ocean vistas.',
          duration: '25-30 min',
          icon: '🌊',
          location: 'Land\'s End Trail'
        },
        {
          step: 4,
          title: 'Mile Rock Viewpoint',
          description: 'Pause at the Mile Rock overlook. See the remains of a shipwreck and distant Golden Gate Bridge.',
          duration: '10-15 min',
          icon: '🔭'
        },
        {
          step: 5,
          title: 'Return or Continue',
          description: 'Loop back via the same trail or continue to China Beach. Return to Cliff House for a meal upgrade (optional).',
          duration: '15-20 min',
          icon: '🔄'
        }
      ],
      matchWeights: {
        soloAdventure: 0.9,
        firstDate: 0.85,
        romantic: 1.0,
        friendly: 0.8,
        conversation: 0.85
      }
    }
  }
];

/**
 * Calculate match score for Take a Stroll based on user preferences
 * 
 * Match Formula:
 * Match = 0.4(ExperienceTypeFit) + 0.2(CategoryFit) + 0.15(BudgetFit) + 0.15(TravelProximity) + 0.1(WeatherFavorability)
 * 
 * Minimum threshold: 0.65 (65%)
 * 
 * @param stroll - The stroll route to score
 * @param userPreferences - User's preferences from PreferencesSheet
 * @returns Match score between 0 and 1
 */
export function calculateStrollMatch(
  stroll: StrollCard,
  userPreferences: any
): number {
  let totalScore = 0;

  // 1. Experience Type Fit (40%)
  const experienceTypes = userPreferences?.experienceTypes || [];
  let experienceScore = 0;
  
  if (experienceTypes.includes('Solo Adventure') || experienceTypes.includes('soloAdventure')) {
    experienceScore = Math.max(experienceScore, stroll.routeData.matchWeights.soloAdventure);
  }
  if (experienceTypes.includes('First Date') || experienceTypes.includes('firstDate')) {
    experienceScore = Math.max(experienceScore, stroll.routeData.matchWeights.firstDate);
  }
  if (experienceTypes.includes('Romantic') || experienceTypes.includes('romantic')) {
    experienceScore = Math.max(experienceScore, stroll.routeData.matchWeights.romantic);
  }
  if (experienceTypes.includes('Friendly') || experienceTypes.includes('friendly')) {
    experienceScore = Math.max(experienceScore, stroll.routeData.matchWeights.friendly);
  }
  if (experienceTypes.includes('Group Fun') || experienceTypes.includes('groupFun')) {
    experienceScore = Math.max(experienceScore, stroll.routeData.matchWeights.friendly * 0.9);
  }
  
  // Default to conversation weight if no match
  if (experienceScore === 0) {
    experienceScore = stroll.routeData.matchWeights.conversation;
  }
  
  totalScore += experienceScore * 0.4;

  // 2. Category Fit (20%)
  let categoryScore = 0.7; // Base score
  
  const userCategories = userPreferences?.categories || [];
  
  // Boost if user likes stroll experiences
  if (userCategories.includes('stroll') || userCategories.includes('Take a Stroll')) {
    categoryScore += 0.2;
  }
  
  // Additional boost for outdoor/nature lovers
  if (userCategories.includes('picnics') || userCategories.includes('wellness')) {
    categoryScore += 0.1;
  }
  
  totalScore += Math.min(categoryScore, 1.0) * 0.2;

  // 3. Budget Fit (15%)
  let budgetScore = 0.9; // Strolls are generally affordable
  
  if (userPreferences?.budgetMin && userPreferences?.budgetMax) {
    const userMin = Number(userPreferences.budgetMin);
    const userMax = Number(userPreferences.budgetMax);
    const strollPrice = stroll.pricePerPerson;
    
    if (strollPrice >= userMin && strollPrice <= userMax) {
      budgetScore = 1.0; // Perfect fit
    } else if (strollPrice < userMin) {
      budgetScore = 0.95; // Under budget (great for strolls)
    } else if (strollPrice > userMax) {
      const overBudget = (strollPrice - userMax) / userMax;
      budgetScore = Math.max(0.6, 1.0 - overBudget);
    }
  }
  
  totalScore += budgetScore * 0.15;

  // 4. Travel Proximity (15%)
  // Use rating as proxy for now (higher rated = worth traveling for)
  const travelScore = stroll.rating / 5.0;
  totalScore += travelScore * 0.15;

  // 5. Weather Favorability (10%)
  // Strolls are weather-dependent, so this is important
  let weatherScore = 0.7; // Base score
  
  const weatherPref = userPreferences?.weatherPreference?.toLowerCase() || '';
  const timeOfDay = userPreferences?.timeOfDay?.toLowerCase() || '';
  
  // Check if time of day matches best times
  const bestTimes = stroll.routeData.bestTimeOfDay;
  if (bestTimes.includes(timeOfDay)) {
    weatherScore += 0.15;
  }
  
  // Weather sensitivity check
  if (weatherPref.includes('sunny') || weatherPref === 'any weather') {
    weatherScore += 0.15;
  }
  
  if (stroll.routeData.weatherSensitivity === 'high' && weatherPref.includes('rain')) {
    weatherScore -= 0.3; // Penalize high weather sensitivity in rain
  }
  
  totalScore += Math.min(Math.max(weatherScore, 0.4), 1.0) * 0.1;

  return Math.min(totalScore, 1.0);
}

/**
 * Get all stroll routes with match scores
 */
export function getStrollRoutesWithScores(userPreferences: any) {
  return strollRoutes.map(stroll => ({
    ...stroll,
    matchScore: Math.round(calculateStrollMatch(stroll, userPreferences) * 100)
  })).filter(stroll => stroll.matchScore >= 65) // Minimum 65% match
    .sort((a, b) => b.matchScore - a.matchScore);
}
