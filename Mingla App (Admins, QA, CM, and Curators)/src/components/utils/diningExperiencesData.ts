/**
 * Dining Experiences Data Module
 * 
 * Purpose: Provides production-ready fine dining venue data for the Dining Experiences category
 * 
 * Category Definition:
 * - Elevated, reservation-based meals for special occasions
 * - Single-venue experiences (no multi-stop routes)
 * - Focus on quality, presentation, atmosphere, and service
 * - Price range: $$$-$$$$ ($80-$200+ per person)
 * - Duration: 1.5-3 hours typical
 * 
 * Venue Types:
 * - Fine dining restaurants
 * - Omakase & chef-led experiences
 * - Tasting menus & prix fixe
 * - Wine-pairing dinners
 * - Rooftop & scenic dining
 * - Seasonal & pop-up culinary events
 * 
 * Data Structure:
 * Each venue includes comprehensive diningExperienceData with:
 * - Cuisine type & dining style
 * - Atmosphere markers (romantic, elegant, scenic, etc.)
 * - Reservation requirements & dress code
 * - 3-4 step timeline
 * - Match weights for personalized recommendations
 */

export interface DiningTimelineStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  icon: string;
}

export interface DiningExperienceData {
  cuisineType: string;
  diningStyle: 'fine-dining' | 'omakase' | 'tasting-menu' | 'prix-fixe' | 'chef-table' | 'rooftop' | 'seasonal';
  atmosphereMarkers: string[];
  reservationRequired: boolean;
  dressCode: 'formal' | 'business-casual' | 'smart-casual' | 'casual-elegant';
  privateOptions: boolean;
  timeline: DiningTimelineStep[];
  matchWeights: {
    romantic: number;
    business: number;
    celebration: number;
    intimate: number;
    social: number;
  };
}

export interface DiningVenueCard {
  id: string;
  title: string;
  category: 'dining-exp';
  description: string;
  cuisineType: string;
  diningStyle: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  pricePerPerson: number;
  address: string;
  atmosphereMarkers: string[];
  highlights: string[];
  fullDescription: string;
  reservationRequired: boolean;
  dressCode: string;
  openingHours: string;
  phoneNumber: string;
  website: string;
  diningExperienceData: DiningExperienceData;
}

/**
 * Production-ready Dining Experiences venue data
 * 5 diverse fine dining venues covering different cuisines and experiences
 */
export const diningVenues: DiningVenueCard[] = [
  {
    id: 'dining-001',
    title: 'Atelier Moderne',
    category: 'dining-exp',
    description: 'Contemporary American fine dining with seasonal tasting menus',
    cuisineType: 'Modern American',
    diningStyle: 'Tasting Menu',
    rating: 4.9,
    reviewCount: 487,
    priceRange: '$140-180',
    pricePerPerson: 165,
    address: '789 Market Street, San Francisco, CA 94103',
    atmosphereMarkers: ['Romantic', 'Elegant', 'Intimate', 'Quiet', 'Upscale'],
    highlights: ['7-course tasting menu', 'Wine pairings', 'Farm-to-table', 'Chef interactions'],
    fullDescription: 'Experience the pinnacle of contemporary American cuisine with our seasonally-driven 7-course tasting menu. Chef Michelle Dubois sources directly from local farms to create innovative dishes that celebrate California\'s bounty.',
    reservationRequired: true,
    dressCode: 'Business Casual',
    openingHours: 'Tue-Sat 5:30PM-10PM, Closed Sun-Mon',
    phoneNumber: '(415) 555-7890',
    website: 'https://ateliermoderne.com',
    diningExperienceData: {
      cuisineType: 'Modern American',
      diningStyle: 'tasting-menu',
      atmosphereMarkers: ['romantic', 'elegant', 'intimate', 'quiet', 'candlelit'],
      reservationRequired: true,
      dressCode: 'business-casual',
      privateOptions: true,
      timeline: [
        {
          step: 1,
          title: 'Arrive & Welcome',
          description: 'Check in 5-10 minutes early. Enjoy a welcome cocktail at our bar while your table is prepared.',
          duration: '10-15 min',
          icon: '🥂'
        },
        {
          step: 2,
          title: 'Tasting Experience',
          description: 'Savor a 7-course journey through seasonal California cuisine. Each course is paired with stories from the chef.',
          duration: '2-2.5 hours',
          icon: '🍽️'
        },
        {
          step: 3,
          title: 'Optional Wine Pairing',
          description: 'Enhance your experience with our sommelier\'s curated wine pairings for each course.',
          duration: 'Throughout meal',
          icon: '🍷'
        },
        {
          step: 4,
          title: 'Dessert & Departure',
          description: 'Conclude with artisanal desserts and coffee. Take your time - no rush.',
          duration: '20-30 min',
          icon: '🍰'
        }
      ],
      matchWeights: {
        romantic: 0.95,
        business: 0.6,
        celebration: 0.9,
        intimate: 0.95,
        social: 0.7
      }
    }
  },

  {
    id: 'dining-002',
    title: 'Sushi Masamoto',
    category: 'dining-exp',
    description: 'Authentic omakase experience with master sushi chef',
    cuisineType: 'Japanese Omakase',
    diningStyle: 'Omakase',
    rating: 4.8,
    reviewCount: 342,
    priceRange: '$180-220',
    pricePerPerson: 200,
    address: '456 Geary Street, San Francisco, CA 94102',
    atmosphereMarkers: ['Intimate', 'Traditional', 'Chef-led', 'Exclusive', 'Authentic'],
    highlights: ['16-piece omakase', 'Chef\'s counter seating', 'Seasonal fish', 'Premium sake'],
    fullDescription: 'Sit at the intimate 10-seat counter and watch Chef Masamoto craft each piece of nigiri with precision. Featuring the finest seasonal fish flown in from Tokyo\'s Tsukiji Market.',
    reservationRequired: true,
    dressCode: 'Smart Casual',
    openingHours: 'Wed-Sun 6PM-10PM, Two seatings: 6PM & 8:30PM',
    phoneNumber: '(415) 555-8901',
    website: 'https://sushimasamoto.com',
    diningExperienceData: {
      cuisineType: 'Japanese',
      diningStyle: 'omakase',
      atmosphereMarkers: ['intimate', 'traditional', 'quiet', 'chef-interaction', 'exclusive'],
      reservationRequired: true,
      dressCode: 'smart-casual',
      privateOptions: false,
      timeline: [
        {
          step: 1,
          title: 'Arrive & Seat',
          description: 'Arrive promptly for your seating time. Take your place at the chef\'s counter.',
          duration: '5 min',
          icon: '🪑'
        },
        {
          step: 2,
          title: 'Omakase Journey',
          description: 'Chef Masamoto personally prepares 16 pieces of seasonal nigiri, one at a time. Enjoy at the pace set by the chef.',
          duration: '1.5-2 hours',
          icon: '🍣'
        },
        {
          step: 3,
          title: 'Sake Pairing',
          description: 'Optional premium sake pairings selected to complement each course.',
          duration: 'Throughout meal',
          icon: '🍶'
        },
        {
          step: 4,
          title: 'Completion',
          description: 'Finish with miso soup and tamago. Thank the chef and depart.',
          duration: '10-15 min',
          icon: '🍵'
        }
      ],
      matchWeights: {
        romantic: 0.85,
        business: 0.8,
        celebration: 0.9,
        intimate: 1.0,
        social: 0.5
      }
    }
  },

  {
    id: 'dining-003',
    title: 'Le Ciel Rooftop',
    category: 'dining-exp',
    description: 'French haute cuisine with panoramic city and bay views',
    cuisineType: 'French Fine Dining',
    diningStyle: 'Fine Dining',
    rating: 4.7,
    reviewCount: 623,
    priceRange: '$120-160',
    pricePerPerson: 145,
    address: 'Infinity Tower, 50th Floor, 301 Mission Street, San Francisco, CA 94105',
    atmosphereMarkers: ['Scenic', 'Romantic', 'Upscale', 'Celebration-worthy', 'Views'],
    highlights: ['Panoramic views', 'Classic French cuisine', 'Extensive wine list', 'Live piano'],
    fullDescription: 'Perched on the 50th floor, Le Ciel offers breathtaking 360-degree views of San Francisco and the Bay. Chef Pierre Laurent brings authentic French haute cuisine with modern California influences.',
    reservationRequired: true,
    dressCode: 'Formal',
    openingHours: 'Mon-Sun 5:30PM-11PM',
    phoneNumber: '(415) 555-9012',
    website: 'https://lecielrooftop.com',
    diningExperienceData: {
      cuisineType: 'French',
      diningStyle: 'fine-dining',
      atmosphereMarkers: ['scenic', 'romantic', 'elegant', 'upscale', 'live-music', 'views'],
      reservationRequired: true,
      dressCode: 'formal',
      privateOptions: true,
      timeline: [
        {
          step: 1,
          title: 'Arrive & Ascend',
          description: 'Take the express elevator to the 50th floor. Check in at the host stand and enjoy the view while waiting.',
          duration: '10 min',
          icon: '🏙️'
        },
        {
          step: 2,
          title: 'Aperitif & Menu',
          description: 'Begin with champagne or a signature cocktail. Review the à la carte menu or prix fixe options.',
          duration: '15-20 min',
          icon: '🥂'
        },
        {
          step: 3,
          title: 'Multi-Course Dinner',
          description: 'Enjoy appetizer, entrée, and dessert while live piano music plays. Request window seating for sunset views.',
          duration: '2-2.5 hours',
          icon: '🍽️'
        },
        {
          step: 4,
          title: 'After-Dinner Drinks',
          description: 'Optional: Move to the lounge area for cognac or coffee while taking in the city lights.',
          duration: '20-30 min',
          icon: '☕'
        }
      ],
      matchWeights: {
        romantic: 1.0,
        business: 0.75,
        celebration: 1.0,
        intimate: 0.8,
        social: 0.85
      }
    }
  },

  {
    id: 'dining-004',
    title: 'Trattoria Bella Vista',
    category: 'dining-exp',
    description: 'Intimate Italian chef\'s table with handmade pasta and rustic charm',
    cuisineType: 'Italian Fine Dining',
    diningStyle: 'Chef\'s Table',
    rating: 4.8,
    reviewCount: 294,
    priceRange: '$95-130',
    pricePerPerson: 115,
    address: '1842 Union Street, San Francisco, CA 94123',
    atmosphereMarkers: ['Cozy', 'Romantic', 'Family-style', 'Warm', 'Rustic-elegant'],
    highlights: ['Chef\'s table experience', 'Handmade pasta', 'Italian wine selection', 'Intimate setting'],
    fullDescription: 'Experience authentic Italian hospitality at our 20-seat intimate trattoria. Watch Chef Marco prepare handmade pasta tableside and share stories of his Tuscan heritage. Family-style portions encourage sharing and conversation.',
    reservationRequired: true,
    dressCode: 'Casual Elegant',
    openingHours: 'Thu-Sun 5PM-10PM',
    phoneNumber: '(415) 555-0123',
    website: 'https://trattoriabellavista.com',
    diningExperienceData: {
      cuisineType: 'Italian',
      diningStyle: 'chef-table',
      atmosphereMarkers: ['cozy', 'romantic', 'warm', 'intimate', 'family-style', 'rustic'],
      reservationRequired: true,
      dressCode: 'casual-elegant',
      privateOptions: true,
      timeline: [
        {
          step: 1,
          title: 'Welcome & Antipasti',
          description: 'Chef Marco greets you personally. Start with complimentary focaccia and a selection of antipasti.',
          duration: '15-20 min',
          icon: '🍞'
        },
        {
          step: 2,
          title: 'Pasta Making Demo',
          description: 'Watch the chef prepare handmade pasta for your course. Learn traditional techniques and family recipes.',
          duration: '20-30 min',
          icon: '👨‍🍳'
        },
        {
          step: 3,
          title: 'Multi-Course Feast',
          description: 'Enjoy primi, secondi, and contorni served family-style. Wine pairings available.',
          duration: '1.5-2 hours',
          icon: '🍝'
        },
        {
          step: 4,
          title: 'Dolci & Limoncello',
          description: 'Finish with homemade tiramisu and complimentary limoncello. Linger and enjoy the ambiance.',
          duration: '20-30 min',
          icon: '🍰'
        }
      ],
      matchWeights: {
        romantic: 0.9,
        business: 0.5,
        celebration: 0.85,
        intimate: 0.95,
        social: 0.9
      }
    }
  },

  {
    id: 'dining-005',
    title: 'Fusion by Aria',
    category: 'dining-exp',
    description: 'Modern Asian-Californian fusion with award-winning wine program',
    cuisineType: 'Fusion Cuisine',
    diningStyle: 'Prix Fixe',
    rating: 4.6,
    reviewCount: 418,
    priceRange: '$110-145',
    pricePerPerson: 130,
    address: '2245 Fillmore Street, San Francisco, CA 94115',
    atmosphereMarkers: ['Modern', 'Sophisticated', 'Energetic', 'Stylish', 'Social'],
    highlights: ['5-course prix fixe', 'Award-winning wine list', 'Open kitchen', 'Innovative cuisine'],
    fullDescription: 'Chef Aria Chen reimagines Asian and California cuisines through her innovative 5-course prix fixe menu. The open kitchen creates an energetic atmosphere while maintaining refined service. Wine Spectator Award of Excellence.',
    reservationRequired: true,
    dressCode: 'Smart Casual',
    openingHours: 'Tue-Sun 5:30PM-10:30PM',
    phoneNumber: '(415) 555-1234',
    website: 'https://fusionbyaria.com',
    diningExperienceData: {
      cuisineType: 'Asian-Californian Fusion',
      diningStyle: 'prix-fixe',
      atmosphereMarkers: ['modern', 'sophisticated', 'energetic', 'stylish', 'open-kitchen'],
      reservationRequired: true,
      dressCode: 'smart-casual',
      privateOptions: true,
      timeline: [
        {
          step: 1,
          title: 'Arrival & Cocktails',
          description: 'Check in and choose between dining room or chef\'s counter. Start with a creative cocktail from the bar.',
          duration: '10-15 min',
          icon: '🍸'
        },
        {
          step: 2,
          title: 'Prix Fixe Journey',
          description: 'Experience 5 innovative courses blending Asian techniques with California ingredients. Watch the open kitchen in action.',
          duration: '2-2.5 hours',
          icon: '🍱'
        },
        {
          step: 3,
          title: 'Wine Pairing',
          description: 'Optional sommelier-selected wine pairing with each course, featuring rare California and international selections.',
          duration: 'Throughout meal',
          icon: '🍷'
        },
        {
          step: 4,
          title: 'Finale & Farewell',
          description: 'Conclude with signature mochi dessert and tea service. Browse the wine retail corner before departing.',
          duration: '15-25 min',
          icon: '🍵'
        }
      ],
      matchWeights: {
        romantic: 0.75,
        business: 0.85,
        celebration: 0.8,
        intimate: 0.7,
        social: 0.9
      }
    }
  }
];

/**
 * Calculate match score for Dining Experiences based on user preferences
 * 
 * Match Formula:
 * Match = 0.4(ExperienceTypeFit) + 0.25(AmbienceScore) + 0.15(BudgetFit) + 0.1(TravelProximity) + 0.1(AvailabilityScore)
 * 
 * Minimum threshold: 0.65 (65%)
 * 
 * @param venue - The dining venue to score
 * @param userPreferences - User's preferences from PreferencesSheet
 * @returns Match score between 0 and 1
 */
export function calculateDiningMatch(
  venue: DiningVenueCard,
  userPreferences: any
): number {
  let totalScore = 0;

  // 1. Experience Type Fit (40%)
  const experienceTypes = userPreferences?.experienceTypes || [];
  let experienceScore = 0;
  
  if (experienceTypes.includes('Romantic') || experienceTypes.includes('romantic')) {
    experienceScore = Math.max(experienceScore, venue.diningExperienceData.matchWeights.romantic);
  }
  if (experienceTypes.includes('Business') || experienceTypes.includes('business')) {
    experienceScore = Math.max(experienceScore, venue.diningExperienceData.matchWeights.business);
  }
  if (experienceTypes.includes('First Date') || experienceTypes.includes('firstDate')) {
    experienceScore = Math.max(experienceScore, venue.diningExperienceData.matchWeights.romantic * 0.9);
  }
  if (experienceTypes.includes('Friendly') || experienceTypes.includes('friendly')) {
    experienceScore = Math.max(experienceScore, venue.diningExperienceData.matchWeights.social);
  }
  if (experienceTypes.includes('Group Fun') || experienceTypes.includes('groupFun')) {
    experienceScore = Math.max(experienceScore, venue.diningExperienceData.matchWeights.social);
  }
  
  // Default to intimate/celebration if no specific match
  if (experienceScore === 0) {
    experienceScore = (venue.diningExperienceData.matchWeights.intimate + venue.diningExperienceData.matchWeights.celebration) / 2;
  }
  
  totalScore += experienceScore * 0.4;

  // 2. Ambience Score (25%)
  // Check if user preferences align with venue atmosphere
  let ambienceScore = 0.7; // Base score
  
  const userVibes = userPreferences?.categories || [];
  const venueAtmosphere = venue.atmosphereMarkers.map(m => m.toLowerCase());
  
  // Boost if user likes dining experiences
  if (userVibes.includes('diningExp') || userVibes.includes('dining-exp')) {
    ambienceScore += 0.2;
  }
  
  // Check for specific atmosphere preferences
  if (venueAtmosphere.includes('romantic') && experienceTypes.includes('Romantic')) {
    ambienceScore += 0.1;
  }
  if (venueAtmosphere.includes('scenic') || venueAtmosphere.includes('views')) {
    ambienceScore += 0.05;
  }
  
  totalScore += Math.min(ambienceScore, 1.0) * 0.25;

  // 3. Budget Fit (15%)
  let budgetScore = 0.8; // Default good fit for fine dining
  
  if (userPreferences?.budgetMin && userPreferences?.budgetMax) {
    const userMin = Number(userPreferences.budgetMin);
    const userMax = Number(userPreferences.budgetMax);
    const venuePrice = venue.pricePerPerson;
    
    if (venuePrice >= userMin && venuePrice <= userMax) {
      budgetScore = 1.0; // Perfect fit
    } else if (venuePrice < userMin) {
      budgetScore = 0.7; // Under budget (still good)
    } else if (venuePrice > userMax) {
      const overBudget = (venuePrice - userMax) / userMax;
      budgetScore = Math.max(0.4, 1.0 - overBudget); // Penalty for over budget
    }
  }
  
  totalScore += budgetScore * 0.15;

  // 4. Travel Proximity (10%)
  // Use rating as proxy for proximity (venues with higher ratings assumed to be worth travel)
  const travelScore = venue.rating / 5.0;
  totalScore += travelScore * 0.1;

  // 5. Availability Score (10%)
  // All dining venues require reservations, base score on popularity
  const availabilityScore = Math.min(1.0, venue.reviewCount / 500);
  totalScore += availabilityScore * 0.1;

  return Math.min(totalScore, 1.0);
}

/**
 * Get all dining venues with match scores
 */
export function getDiningVenuesWithScores(userPreferences: any) {
  return diningVenues.map(venue => ({
    ...venue,
    matchScore: Math.round(calculateDiningMatch(venue, userPreferences) * 100)
  })).filter(venue => venue.matchScore >= 65) // Minimum 65% match
    .sort((a, b) => b.matchScore - a.matchScore);
}
