/**
 * Casual Eats Data Module
 * 
 * Purpose: Provides production-ready casual dining data for the Casual Eats category
 * 
 * Category Definition:
 * - Relaxed, budget-friendly food outings
 * - Focus on comfort, convenience, and flavor without formality
 * - SINGLE-VENUE: No multi-stop routes or pairings
 * - Duration: 45-75 minutes (quick, easy dining)
 * - Price range: $5-25 per person ($-$$ tier)
 * - No reservations needed
 * 
 * Venue Types:
 * - Tacos, pizza, burgers, noodles/ramen
 * - Cafés, delis, diners
 * - Food trucks, pop-up eateries
 * - Street food festivals, casual markets
 * 
 * Data Structure:
 * Each casual eatery includes:
 * - Simple 3-step timeline (Arrive, Eat, Finish)
 * - Quick service indicators
 * - Casual atmosphere markers
 * - Budget-friendly pricing
 * - Group-friendly seating
 * - Cuisine type and dietary options
 * - Match weights for personalized recommendations
 */

export interface CasualEatsTimelineStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  icon: string;
}

export interface CasualEatsCard {
  id: string;
  title: string;
  category: 'casual-eats';
  description: string;
  cuisineType: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  pricePerPerson: number;
  atmosphereMarkers: string[];
  highlights: string[];
  fullDescription: string;
  serviceStyle: 'counter-order' | 'table-service' | 'food-truck' | 'self-serve';
  dietaryOptions: string[];
  groupFriendly: boolean;
  quickService: boolean;
  outdoorSeating: boolean;
  timeline: CasualEatsTimelineStep[];
  estimatedDuration: string;
  matchWeights: {
    soloAdventure: number;
    firstDate: number;
    romantic: number;
    friendly: number;
    groupFun: number;
  };
}

/**
 * Production-ready Casual Eats venue data
 * 5 diverse casual dining spots across different cuisines
 */
export const casualEateries: CasualEatsCard[] = [
  {
    id: 'casual-001',
    title: 'Taco Libre - Mission District',
    category: 'casual-eats',
    description: 'Authentic street tacos with fresh ingredients and vibrant flavors',
    cuisineType: 'Mexican',
    rating: 4.7,
    reviewCount: 2156,
    priceRange: '$8-15',
    pricePerPerson: 12,
    atmosphereMarkers: ['Vibrant', 'Casual', 'Authentic', 'Lively', 'Quick service'],
    highlights: ['Fresh handmade tortillas', 'Local ingredients', 'Vegetarian options', 'Fast service'],
    fullDescription: 'Experience authentic Mexican street food in a colorful, energetic setting. Order at the counter, watch your tacos being made fresh, and enjoy bold flavors without the wait.',
    serviceStyle: 'counter-order',
    dietaryOptions: ['Vegetarian', 'Vegan options', 'Gluten-free tortillas'],
    groupFriendly: true,
    quickService: true,
    outdoorSeating: true,
    estimatedDuration: '45-60 min',
    timeline: [
      {
        step: 1,
        title: 'Arrive & Order',
        description: 'Walk in, check out the colorful menu board, and order at the counter. No reservation needed — just good vibes.',
        duration: '5-10 min',
        icon: '🌮'
      },
      {
        step: 2,
        title: 'Enjoy Your Meal',
        description: 'Grab a spot at the communal tables or outdoor patio. Tacos arrive fresh and fast — perfect for casual conversation.',
        duration: '30-40 min',
        icon: '😋'
      },
      {
        step: 3,
        title: 'Finish Up',
        description: 'Cap it off with horchata or a Mexican soda. Quick, delicious, and budget-friendly — taco perfection.',
        duration: '10-15 min',
        icon: '🥤'
      }
    ],
    matchWeights: {
      soloAdventure: 0.75,
      firstDate: 0.85,
      romantic: 0.6,
      friendly: 0.95,
      groupFun: 1.0
    }
  },

  {
    id: 'casual-002',
    title: 'Slice Society - Downtown',
    category: 'casual-eats',
    description: 'New York-style pizza by the slice with creative toppings',
    cuisineType: 'Pizza',
    rating: 4.8,
    reviewCount: 1843,
    priceRange: '$6-18',
    pricePerPerson: 10,
    atmosphereMarkers: ['Urban', 'Fast', 'Classic', 'Social', 'No-frills'],
    highlights: ['Giant slices', 'Late night hours', 'Creative toppings', 'Quick grab-and-go'],
    fullDescription: 'Classic New York-style pizza joint serving massive slices with both traditional and inventive toppings. Perfect for a quick bite or casual hangout with friends.',
    serviceStyle: 'counter-order',
    dietaryOptions: ['Vegetarian', 'Vegan cheese available'],
    groupFriendly: true,
    quickService: true,
    outdoorSeating: false,
    estimatedDuration: '30-45 min',
    timeline: [
      {
        step: 1,
        title: 'Order Your Slice',
        description: 'Point to your favorite pizza in the case — pepperoni, margherita, or wild mushroom. Heated fresh and ready in minutes.',
        duration: '5 min',
        icon: '🍕'
      },
      {
        step: 2,
        title: 'Dig In',
        description: 'Grab a booth or stand at the counter. Fold your slice New York-style and enjoy the perfect cheese-to-sauce ratio.',
        duration: '20-30 min',
        icon: '🤤'
      },
      {
        step: 3,
        title: 'Sweet Finish (Optional)',
        description: 'Add a cannoli or garlic knots if you are still hungry. Fast, filling, and always satisfying.',
        duration: '10 min',
        icon: '🍰'
      }
    ],
    matchWeights: {
      soloAdventure: 0.85,
      firstDate: 0.75,
      romantic: 0.5,
      friendly: 0.95,
      groupFun: 0.95
    }
  },

  {
    id: 'casual-003',
    title: 'The Burger Shack',
    category: 'casual-eats',
    description: 'Juicy gourmet burgers with hand-cut fries in a retro diner setting',
    cuisineType: 'American',
    rating: 4.6,
    reviewCount: 3201,
    priceRange: '$12-20',
    pricePerPerson: 16,
    atmosphereMarkers: ['Retro', 'Comfort food', 'Casual', 'Family-friendly', 'Classic diner'],
    highlights: ['Gourmet burger combos', 'Hand-cut fries', 'Craft sodas', 'Vegetarian burger'],
    fullDescription: 'Retro-style burger joint serving juicy, perfectly grilled burgers with creative toppings. Think classic American comfort food elevated with quality ingredients and laid-back vibes.',
    serviceStyle: 'table-service',
    dietaryOptions: ['Vegetarian', 'Gluten-free bun available'],
    groupFriendly: true,
    quickService: true,
    outdoorSeating: true,
    estimatedDuration: '50-70 min',
    timeline: [
      {
        step: 1,
        title: 'Seat Yourself & Order',
        description: 'Grab a booth or counter seat. Browse the menu of creative burgers — from classic cheeseburgers to bacon-jalapeño specials.',
        duration: '10-15 min',
        icon: '🍔'
      },
      {
        step: 2,
        title: 'Feast Time',
        description: 'Burgers arrive hot and juicy with a mountain of hand-cut fries. Messy, delicious, and totally worth it.',
        duration: '30-40 min',
        icon: '🍟'
      },
      {
        step: 3,
        title: 'Shake It Off',
        description: 'Finish with a thick milkshake or craft soda. Classic diner vibes, modern flavors — pure comfort food bliss.',
        duration: '10-15 min',
        icon: '🥤'
      }
    ],
    matchWeights: {
      soloAdventure: 0.7,
      firstDate: 0.8,
      romantic: 0.65,
      friendly: 0.9,
      groupFun: 0.95
    }
  },

  {
    id: 'casual-004',
    title: 'Noodle Station - Japantown',
    category: 'casual-eats',
    description: 'Authentic ramen bowls with rich broths and fresh toppings',
    cuisineType: 'Japanese',
    rating: 4.9,
    reviewCount: 2487,
    priceRange: '$10-18',
    pricePerPerson: 14,
    atmosphereMarkers: ['Authentic', 'Cozy', 'Minimalist', 'Quick', 'Warming'],
    highlights: ['Rich tonkotsu broth', 'Handmade noodles', 'Customizable toppings', 'Vegetarian ramen'],
    fullDescription: 'Authentic ramen shop serving steaming bowls of perfectly cooked noodles in rich, flavorful broths. Minimalist Japanese aesthetic meets soul-warming comfort food.',
    serviceStyle: 'counter-order',
    dietaryOptions: ['Vegetarian', 'Vegan broth available', 'Gluten-free noodles'],
    groupFriendly: true,
    quickService: true,
    outdoorSeating: false,
    estimatedDuration: '40-55 min',
    timeline: [
      {
        step: 1,
        title: 'Order & Customize',
        description: 'Choose your ramen style — tonkotsu, miso, or shoyu. Pick your toppings: soft egg, pork belly, bamboo shoots, nori.',
        duration: '5-10 min',
        icon: '🍜'
      },
      {
        step: 2,
        title: 'Slurp Away',
        description: 'Your steaming bowl arrives in minutes. Enjoy rich broth, springy noodles, and perfect toppings in a cozy setting.',
        duration: '25-35 min',
        icon: '🥢'
      },
      {
        step: 3,
        title: 'Green Tea Finish',
        description: 'End with complimentary green tea or upgrade to a Japanese beer. Simple, satisfying, soul-warming.',
        duration: '10 min',
        icon: '🍵'
      }
    ],
    matchWeights: {
      soloAdventure: 0.9,
      firstDate: 0.85,
      romantic: 0.75,
      friendly: 0.95,
      groupFun: 0.85
    }
  },

  {
    id: 'casual-005',
    title: 'Fusion Street Market',
    category: 'casual-eats',
    description: 'Rotating food trucks and pop-up stalls with global street food',
    cuisineType: 'Fusion / Street Food',
    rating: 4.7,
    reviewCount: 1623,
    priceRange: '$8-22',
    pricePerPerson: 15,
    atmosphereMarkers: ['Outdoor', 'Social', 'Diverse', 'Vibrant', 'Festival vibes'],
    highlights: ['Multiple food vendors', 'Outdoor seating area', 'Live music (weekends)', 'Variety of cuisines'],
    fullDescription: 'Open-air food market featuring rotating food trucks and pop-up vendors. From Korean BBQ tacos to Vietnamese banh mi to Ethiopian injera — explore global street food in one lively spot.',
    serviceStyle: 'food-truck',
    dietaryOptions: ['Vegetarian', 'Vegan', 'Gluten-free', 'Varies by vendor'],
    groupFriendly: true,
    quickService: true,
    outdoorSeating: true,
    estimatedDuration: '60-75 min',
    timeline: [
      {
        step: 1,
        title: 'Explore & Choose',
        description: 'Wander through the food stalls. Browse Korean BBQ, Mediterranean wraps, artisan tacos — pick what calls to you.',
        duration: '10-15 min',
        icon: '🚚'
      },
      {
        step: 2,
        title: 'Feast at the Tables',
        description: 'Grab your order from the truck and find a spot at the communal picnic tables. Mix and match with friends for a shared feast.',
        duration: '35-45 min',
        icon: '🌮'
      },
      {
        step: 3,
        title: 'Dessert Hunt',
        description: 'Finish with churros, artisan ice cream, or bubble tea from another vendor. Casual, fun, and endlessly varied.',
        duration: '15-20 min',
        icon: '🍦'
      }
    ],
    matchWeights: {
      soloAdventure: 0.65,
      firstDate: 0.8,
      romantic: 0.55,
      friendly: 1.0,
      groupFun: 1.0
    }
  }
];

/**
 * Calculate match score for Casual Eats based on user preferences
 * 
 * Match Formula:
 * Match = 0.35(ExperienceTypeFit) + 0.25(BudgetFit) + 0.15(CuisinePreference) + 0.15(TravelProximity) + 0.10(WeatherComfort)
 * 
 * Minimum threshold: 0.65 (65%)
 * 
 * @param eatery - The casual eatery to score
 * @param userPreferences - User's preferences from PreferencesSheet
 * @returns Match score between 0 and 1
 */
export function calculateCasualEatsMatch(
  eatery: CasualEatsCard,
  userPreferences: any
): number {
  let totalScore = 0;

  // 1. Experience Type Fit (35%)
  const experienceTypes = userPreferences?.experienceTypes || [];
  let experienceScore = 0;
  
  if (experienceTypes.includes('Solo Adventure') || experienceTypes.includes('soloAdventure')) {
    experienceScore = Math.max(experienceScore, eatery.matchWeights.soloAdventure);
  }
  if (experienceTypes.includes('First Date') || experienceTypes.includes('firstDate')) {
    experienceScore = Math.max(experienceScore, eatery.matchWeights.firstDate);
  }
  if (experienceTypes.includes('Romantic') || experienceTypes.includes('romantic')) {
    experienceScore = Math.max(experienceScore, eatery.matchWeights.romantic);
  }
  if (experienceTypes.includes('Friendly') || experienceTypes.includes('friendly')) {
    experienceScore = Math.max(experienceScore, eatery.matchWeights.friendly);
  }
  if (experienceTypes.includes('Group Fun') || experienceTypes.includes('groupFun')) {
    experienceScore = Math.max(experienceScore, eatery.matchWeights.groupFun);
  }
  
  // Default to friendly weight if no match (casual eats are social)
  if (experienceScore === 0) {
    experienceScore = eatery.matchWeights.friendly;
  }
  
  totalScore += experienceScore * 0.35;

  // 2. Budget Fit (25%)
  let budgetScore = 0.9; // Casual eats are inherently budget-friendly
  
  if (userPreferences?.budgetMin && userPreferences?.budgetMax) {
    const userMin = Number(userPreferences.budgetMin);
    const userMax = Number(userPreferences.budgetMax);
    const eateryPrice = eatery.pricePerPerson;
    
    if (eateryPrice >= userMin && eateryPrice <= userMax) {
      budgetScore = 1.0; // Perfect fit
    } else if (eateryPrice < userMin) {
      budgetScore = 0.98; // Under budget (great value)
    } else if (eateryPrice > userMax) {
      const overBudget = (eateryPrice - userMax) / userMax;
      budgetScore = Math.max(0.65, 1.0 - overBudget);
    }
  }
  
  totalScore += budgetScore * 0.25;

  // 3. Cuisine Preference (15%)
  let cuisineScore = 0.7; // Base score
  
  const userCategories = userPreferences?.categories || [];
  
  // Boost if user selected casual-eats category
  if (userCategories.includes('casual-eats') || userCategories.includes('Casual Eats')) {
    cuisineScore += 0.2;
  }
  
  // Additional boost for food-loving categories
  if (userCategories.includes('dining') || userCategories.includes('picnics')) {
    cuisineScore += 0.1;
  }
  
  totalScore += Math.min(cuisineScore, 1.0) * 0.15;

  // 4. Travel Proximity (15%)
  // Use rating as proxy for now (higher rated = worth traveling for)
  const travelScore = eatery.rating / 5.0;
  totalScore += travelScore * 0.15;

  // 5. Weather Comfort (10%)
  let weatherScore = 0.8; // Base score (most casual eats work in any weather)
  
  const weatherPref = userPreferences?.weatherPreference?.toLowerCase() || '';
  
  // Outdoor seating considerations
  if (eatery.outdoorSeating) {
    if (weatherPref.includes('sunny') || weatherPref === 'any weather') {
      weatherScore += 0.15; // Bonus for outdoor option in good weather
    }
    if (weatherPref.includes('rain')) {
      weatherScore -= 0.1; // Small penalty for outdoor seating in rain
    }
  } else {
    // Indoor-only venues get slight boost in bad weather
    if (weatherPref.includes('rain') || weatherPref.includes('cold')) {
      weatherScore += 0.1;
    }
  }
  
  // Quick service is weather-independent (good for any conditions)
  if (eatery.quickService) {
    weatherScore += 0.1;
  }
  
  totalScore += Math.min(Math.max(weatherScore, 0.5), 1.0) * 0.1;

  return Math.min(totalScore, 1.0);
}

/**
 * Get all casual eateries with match scores
 */
export function getCasualEateriesWithScores(userPreferences: any) {
  return casualEateries.map(eatery => ({
    ...eatery,
    matchScore: Math.round(calculateCasualEatsMatch(eatery, userPreferences) * 100)
  })).filter(eatery => eatery.matchScore >= 65) // Minimum 65% match
    .sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Filter eateries by cuisine type
 */
export function getEateriesByCuisine(cuisineType: string, userPreferences?: any) {
  const filtered = casualEateries.filter(eatery => 
    eatery.cuisineType.toLowerCase().includes(cuisineType.toLowerCase())
  );
  
  if (userPreferences) {
    return filtered.map(eatery => ({
      ...eatery,
      matchScore: Math.round(calculateCasualEatsMatch(eatery, userPreferences) * 100)
    })).filter(eatery => eatery.matchScore >= 65)
      .sort((a, b) => b.matchScore - a.matchScore);
  }
  
  return filtered;
}

/**
 * Filter eateries by dietary options
 */
export function getEateriesByDiet(dietaryNeeds: string[], userPreferences?: any) {
  const filtered = casualEateries.filter(eatery => 
    dietaryNeeds.some(need => 
      eatery.dietaryOptions.some(option => 
        option.toLowerCase().includes(need.toLowerCase())
      )
    )
  );
  
  if (userPreferences) {
    return filtered.map(eatery => ({
      ...eatery,
      matchScore: Math.round(calculateCasualEatsMatch(eatery, userPreferences) * 100)
    })).filter(eatery => eatery.matchScore >= 65)
      .sort((a, b) => b.matchScore - a.matchScore);
  }
  
  return filtered;
}
