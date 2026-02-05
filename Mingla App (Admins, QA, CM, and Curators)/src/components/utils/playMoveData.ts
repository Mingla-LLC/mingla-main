/**
 * Play & Move Data Module
 * 
 * Energetic, activity-based experiences centered on fun, motion, and light competition.
 * Single-location venues that emphasize participation, energy, and social fun.
 * 
 * Categories covered:
 * - Indoor Activities: Bowling, Arcade, Climbing
 * - Outdoor Adventures: Kayaking, Parks
 * - Competition: Axe Throwing, Laser Tag, Escape Rooms
 * - Group Sports: Pickleball, Basketball, Mini Golf
 */

export interface PlayMoveVenue {
  id: string;
  name: string;
  category: 'play-move';
  activityType: 'indoor-active' | 'outdoor-adventure' | 'competitive-fun' | 'climbing-sports' | 'water-sports';
  description: string;
  address: string;
  neighborhood: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  
  // Core venue details
  rating: number;
  reviewCount: number;
  priceLevel: number; // 1-4 scale
  priceRange: string;
  estimatedCostPerPerson: {
    min: number;
    max: number;
  };
  
  // Activities offered
  activities: {
    primary: string;
    secondary?: string[];
    equipment: string[];
  };
  
  // Capacity and group info
  groupCapacity: {
    min: number;
    max: number;
    idealSize: string;
  };
  
  // Experience details
  duration: {
    typical: string;
    min: number; // minutes
    max: number;
  };
  
  // Atmosphere and vibe
  atmosphere: string[];
  intensityLevel: 'light' | 'moderate' | 'high';
  skillLevel: 'beginner-friendly' | 'all-levels' | 'intermediate';
  
  // Timeline for the experience
  timeline: {
    step: number;
    title: string;
    description: string;
    duration: string;
    icon: string;
  }[];
  
  // Amenities
  amenities: {
    parking: boolean;
    publicTransit: boolean;
    foodDrinks: boolean;
    lockers: boolean;
    rentalEquipment: boolean;
    indoor: boolean;
    outdoor: boolean;
  };
  
  // Scheduling
  hours: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  peakTimes: string[];
  reservationRequired: boolean;
  
  // Best for
  bestFor: string[];
  experienceTypes: string[];
  
  // Weather considerations
  weatherDependent: boolean;
  weatherPreference?: string;
  
  // Safety and accessibility
  safetyBriefing: boolean;
  ageRestrictions?: string;
  accessibility: string[];
  
  // Images
  images: string[];
  
  // Contact
  phone: string;
  website: string;
  bookingUrl?: string;
  
  // Social proof
  highlights: string[];
  userTags: string[];
  
  // Matching weights for algorithm
  matchWeights: {
    soloFriendly: number; // 0-1
    groupOriented: number; // 0-1
    competitive: number; // 0-1
    casual: number; // 0-1
    energetic: number; // 0-1
  };
}

// Experience Type Compatibility Matrix for Play & Move
export const playMoveExperienceTypeCompatibility = {
  'Solo adventure': 0.85,
  'Friendly': 0.95,
  'Group fun': 0.98,
  'First date': 0.75,
  'Romantic': 0.60
};

// Activity Type Preferences Mapping
export const playMoveActivityPreferences = {
  'indoor-active': {
    weather: 'any',
    intensity: ['light', 'moderate'],
    social: 'high'
  },
  'outdoor-adventure': {
    weather: 'good',
    intensity: ['moderate', 'high'],
    social: 'medium'
  },
  'competitive-fun': {
    weather: 'any',
    intensity: ['moderate', 'high'],
    social: 'high'
  },
  'climbing-sports': {
    weather: 'any',
    intensity: ['moderate', 'high'],
    social: 'medium'
  },
  'water-sports': {
    weather: 'good',
    intensity: ['moderate', 'high'],
    social: 'medium'
  }
};

/**
 * Calculate Play & Move match score
 * Formula: 0.35(ExperienceType) + 0.25(ActivityCategory) + 0.15(Budget) + 0.15(TravelProximity) + 0.10(GroupCapacity)
 */
export function calculatePlayMoveMatch(
  venue: PlayMoveVenue,
  preferences: any,
  travelTime: number // in minutes
): {
  score: number;
  factors: {
    experienceType: number;
    activityCategory: number;
    budget: number;
    travelProximity: number;
    groupCapacity: number;
  };
} {
  // 1. Experience Type Fit (35%)
  const experienceTypes = preferences.experienceTypes || ['Solo adventure'];
  const experienceTypeScores = experienceTypes.map((type: string) => {
    const baseCompatibility = playMoveExperienceTypeCompatibility[type as keyof typeof playMoveExperienceTypeCompatibility] || 0.5;
    const venueTypeMatch = venue.experienceTypes.includes(type) ? 1.0 : 0.7;
    return baseCompatibility * venueTypeMatch;
  });
  const experienceTypeFit = Math.max(...experienceTypeScores);

  // 2. Activity Category Fit (25%)
  const categories = preferences.categories || [];
  const hasPlayMoveCategory = categories.includes('play-move') || categories.includes('Play & Move');
  const activityCategoryFit = hasPlayMoveCategory ? 1.0 : 0.6;

  // 3. Budget Fit (15%)
  let budgetFit = 1.0;
  if (preferences.budgetMin && preferences.budgetMax) {
    const minBudget = Number(preferences.budgetMin);
    const maxBudget = Number(preferences.budgetMax);
    const venueMidPrice = (venue.estimatedCostPerPerson.min + venue.estimatedCostPerPerson.max) / 2;
    
    if (venueMidPrice < minBudget) {
      budgetFit = 0.7;
    } else if (venueMidPrice > maxBudget) {
      const overBudget = venueMidPrice - maxBudget;
      budgetFit = Math.max(0.3, 1 - (overBudget / maxBudget));
    }
  }

  // 4. Travel Proximity (15%)
  let travelProximity = 1.0;
  if (travelTime <= 15) {
    travelProximity = 1.0;
  } else if (travelTime <= 30) {
    travelProximity = 0.85;
  } else if (travelTime <= 45) {
    travelProximity = 0.65;
  } else {
    travelProximity = 0.4;
  }

  // 5. Group Capacity Fit (10%)
  let groupCapacityFit = 1.0;
  const groupSize = preferences.groupSize || 'Small group (2-4)';
  
  if (groupSize === 'Solo') {
    groupCapacityFit = venue.matchWeights.soloFriendly;
  } else if (groupSize.includes('Large')) {
    groupCapacityFit = venue.matchWeights.groupOriented;
  } else {
    groupCapacityFit = 0.9; // Small groups work well with most activities
  }

  // Calculate weighted score
  const score = (
    experienceTypeFit * 0.35 +
    activityCategoryFit * 0.25 +
    budgetFit * 0.15 +
    travelProximity * 0.15 +
    groupCapacityFit * 0.10
  );

  return {
    score,
    factors: {
      experienceType: experienceTypeFit,
      activityCategory: activityCategoryFit,
      budget: budgetFit,
      travelProximity,
      groupCapacity: groupCapacityFit
    }
  };
}

/**
 * 5 Production-Ready Play & Move Venues
 * Diverse mix covering different activity types and intensity levels
 */
export const playMoveVenues: PlayMoveVenue[] = [
  // 1. Bowling & Arcade Lounge
  {
    id: 'pm-lucky-lanes-001',
    name: 'Lucky Strike Entertainment',
    category: 'play-move',
    activityType: 'indoor-active',
    description: 'Upscale bowling lounge with neon lighting, full arcade, and craft cocktails. Perfect for groups who want to compete in a fun, energetic atmosphere.',
    address: '2201 Mission Street, San Francisco, CA 94110',
    neighborhood: 'Mission District',
    coordinates: {
      lat: 37.7599,
      lng: -122.4194
    },
    rating: 4.5,
    reviewCount: 2847,
    priceLevel: 2,
    priceRange: '$25-45',
    estimatedCostPerPerson: {
      min: 25,
      max: 45
    },
    activities: {
      primary: 'Bowling',
      secondary: ['Arcade Games', 'Billiards', 'Ping Pong'],
      equipment: ['Bowling shoes', 'Arcade tokens', 'Billiard cues']
    },
    groupCapacity: {
      min: 1,
      max: 20,
      idealSize: 'Small to large groups (2-8 people)'
    },
    duration: {
      typical: '1.5-2.5 hours',
      min: 90,
      max: 180
    },
    atmosphere: ['Energetic', 'Social', 'Fun', 'Neon lighting', 'Music'],
    intensityLevel: 'light',
    skillLevel: 'beginner-friendly',
    timeline: [
      {
        step: 1,
        title: 'Arrive & Setup',
        description: 'Check in, get bowling shoes, and choose your lane. Grab drinks from the bar.',
        duration: '10-15 min',
        icon: '👟'
      },
      {
        step: 2,
        title: 'Bowl & Play',
        description: 'Play 2-3 games of bowling and challenge friends to arcade games between rounds.',
        duration: '1-1.5 hours',
        icon: '🎳'
      },
      {
        step: 3,
        title: 'Victory Lap',
        description: 'Celebrate with snacks and drinks in the lounge area. Share your high scores!',
        duration: '20-30 min',
        icon: '🎉'
      }
    ],
    amenities: {
      parking: true,
      publicTransit: true,
      foodDrinks: true,
      lockers: true,
      rentalEquipment: true,
      indoor: true,
      outdoor: false
    },
    hours: {
      monday: '4:00 PM - 12:00 AM',
      tuesday: '4:00 PM - 12:00 AM',
      wednesday: '4:00 PM - 12:00 AM',
      thursday: '4:00 PM - 1:00 AM',
      friday: '12:00 PM - 2:00 AM',
      saturday: '12:00 PM - 2:00 AM',
      sunday: '12:00 PM - 12:00 AM'
    },
    peakTimes: ['Friday 6-10pm', 'Saturday 6-11pm'],
    reservationRequired: true,
    bestFor: ['Groups', 'Date night', 'Team building', 'Competitive fun', 'After work'],
    experienceTypes: ['Friendly', 'Group fun', 'First date'],
    weatherDependent: false,
    safetyBriefing: false,
    accessibility: ['Wheelchair accessible', 'Adaptive bowling equipment'],
    images: [
      'https://images.unsplash.com/photo-1545128485-c400e7702796?w=1200',
      'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1200'
    ],
    phone: '(415) 555-2201',
    website: 'https://luckystrike.com/sf-mission',
    bookingUrl: 'https://luckystrike.com/book',
    highlights: [
      'Neon-lit lanes with premium sound',
      '50+ arcade games',
      'Full bar with craft cocktails',
      'Private lanes for parties'
    ],
    userTags: ['fun vibes', 'great for groups', 'competitive', 'good drinks'],
    matchWeights: {
      soloFriendly: 0.6,
      groupOriented: 0.95,
      competitive: 0.8,
      casual: 0.9,
      energetic: 0.85
    }
  },

  // 2. Rock Climbing Gym
  {
    id: 'pm-climb-mission-002',
    name: 'Mission Cliffs Climbing & Fitness',
    category: 'play-move',
    activityType: 'climbing-sports',
    description: 'Premier indoor climbing facility with bouldering, top-rope, and lead climbing. Welcoming to beginners and challenging for experienced climbers.',
    address: '2295 Harrison Street, San Francisco, CA 94110',
    neighborhood: 'Mission District',
    coordinates: {
      lat: 37.7588,
      lng: -122.4122
    },
    rating: 4.7,
    reviewCount: 1923,
    priceLevel: 2,
    priceRange: '$22-35',
    estimatedCostPerPerson: {
      min: 22,
      max: 35
    },
    activities: {
      primary: 'Rock Climbing',
      secondary: ['Bouldering', 'Yoga classes', 'Fitness area'],
      equipment: ['Climbing shoes', 'Harness', 'Chalk bag', 'Belay device']
    },
    groupCapacity: {
      min: 1,
      max: 8,
      idealSize: 'Solo or small groups (1-4 people)'
    },
    duration: {
      typical: '1.5-2.5 hours',
      min: 90,
      max: 180
    },
    atmosphere: ['Focused', 'Supportive', 'Athletic', 'Community-oriented'],
    intensityLevel: 'moderate',
    skillLevel: 'all-levels',
    timeline: [
      {
        step: 1,
        title: 'Check-In & Gear Up',
        description: 'Sign waiver, rent equipment, and get safety orientation if first time.',
        duration: '15-20 min',
        icon: '🧗'
      },
      {
        step: 2,
        title: 'Warm Up & Climb',
        description: 'Start with easy routes to warm up. Progress to more challenging climbs at your pace.',
        duration: '1-2 hours',
        icon: '💪'
      },
      {
        step: 3,
        title: 'Cool Down',
        description: 'Stretch in the designated area. Share beta with fellow climbers!',
        duration: '15-20 min',
        icon: '🧘'
      }
    ],
    amenities: {
      parking: true,
      publicTransit: true,
      foodDrinks: false,
      lockers: true,
      rentalEquipment: true,
      indoor: true,
      outdoor: false
    },
    hours: {
      monday: '6:00 AM - 11:00 PM',
      tuesday: '6:00 AM - 11:00 PM',
      wednesday: '6:00 AM - 11:00 PM',
      thursday: '6:00 AM - 11:00 PM',
      friday: '6:00 AM - 10:00 PM',
      saturday: '8:00 AM - 8:00 PM',
      sunday: '8:00 AM - 8:00 PM'
    },
    peakTimes: ['Weekdays 5-8pm', 'Saturday mornings'],
    reservationRequired: false,
    bestFor: ['Solo workout', 'Fitness dates', 'Skill building', 'Active friends', 'Challenge seekers'],
    experienceTypes: ['Solo adventure', 'Friendly', 'First date'],
    weatherDependent: false,
    safetyBriefing: true,
    ageRestrictions: 'All ages welcome. Under 18 with guardian.',
    accessibility: ['Adaptive climbing programs available'],
    images: [
      'https://images.unsplash.com/photo-1522163182402-834f871fd851?w=1200',
      'https://images.unsplash.com/photo-1564769625905-50e93615e769?w=1200'
    ],
    phone: '(415) 555-2295',
    website: 'https://touchstoneclimbing.com/mission-cliffs',
    highlights: [
      '14,000 sq ft of climbing terrain',
      'Beginner classes available',
      'Auto-belay systems for solo climbers',
      'Bouldering area with padded floors'
    ],
    userTags: ['great workout', 'welcoming community', 'all skill levels', 'challenging'],
    matchWeights: {
      soloFriendly: 0.9,
      groupOriented: 0.75,
      competitive: 0.7,
      casual: 0.5,
      energetic: 0.95
    }
  },

  // 3. Axe Throwing Venue
  {
    id: 'pm-urban-axes-003',
    name: 'Urban Axes SF',
    category: 'play-move',
    activityType: 'competitive-fun',
    description: 'Thrilling axe throwing experience in a safe, supervised environment. Perfect for competitive groups looking for something unique and memorable.',
    address: '651 Florida Street, San Francisco, CA 94110',
    neighborhood: 'Mission District',
    coordinates: {
      lat: 37.7621,
      lng: -122.4106
    },
    rating: 4.8,
    reviewCount: 1456,
    priceLevel: 2,
    priceRange: '$30-50',
    estimatedCostPerPerson: {
      min: 30,
      max: 50
    },
    activities: {
      primary: 'Axe Throwing',
      secondary: ['Tournament games', 'Group competitions', 'Skills training'],
      equipment: ['Axes (provided)', 'Safety gear', 'Target boards']
    },
    groupCapacity: {
      min: 2,
      max: 20,
      idealSize: 'Small to medium groups (4-12 people)'
    },
    duration: {
      typical: '1-1.5 hours',
      min: 60,
      max: 90
    },
    atmosphere: ['Exciting', 'Competitive', 'Unique', 'High-energy', 'Lumberjack chic'],
    intensityLevel: 'moderate',
    skillLevel: 'beginner-friendly',
    timeline: [
      {
        step: 1,
        title: 'Safety Briefing',
        description: 'Learn proper throwing technique and safety rules from expert coaches.',
        duration: '10-15 min',
        icon: '🪓'
      },
      {
        step: 2,
        title: 'Practice & Compete',
        description: 'Practice your throws, then compete in fun games and tournaments with your group.',
        duration: '45-60 min',
        icon: '🎯'
      },
      {
        step: 3,
        title: 'Victory Celebration',
        description: 'Crown the axe throwing champion! Take photos and celebrate at the lounge.',
        duration: '10-15 min',
        icon: '🏆'
      }
    ],
    amenities: {
      parking: true,
      publicTransit: true,
      foodDrinks: true,
      lockers: true,
      rentalEquipment: true,
      indoor: true,
      outdoor: false
    },
    hours: {
      monday: 'Closed',
      tuesday: '5:00 PM - 10:00 PM',
      wednesday: '5:00 PM - 10:00 PM',
      thursday: '5:00 PM - 10:00 PM',
      friday: '3:00 PM - 11:00 PM',
      saturday: '12:00 PM - 11:00 PM',
      sunday: '12:00 PM - 8:00 PM'
    },
    peakTimes: ['Friday 7-10pm', 'Saturday afternoons'],
    reservationRequired: true,
    bestFor: ['Team building', 'Bachelor/bachelorette parties', 'Competitive groups', 'Unique dates', 'Adrenaline seekers'],
    experienceTypes: ['Friendly', 'Group fun'],
    weatherDependent: false,
    safetyBriefing: true,
    ageRestrictions: 'Ages 12+ (with guardian). 18+ for evening sessions.',
    accessibility: ['Standing required', 'Upper body mobility needed'],
    images: [
      'https://images.unsplash.com/photo-1626897216614-e6c8f3f2b6e5?w=1200',
      'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=1200'
    ],
    phone: '(415) 555-0651',
    website: 'https://urbanaxes.com/sf',
    bookingUrl: 'https://urbanaxes.com/book-sf',
    highlights: [
      'Expert coaching included',
      'Private lanes for groups',
      'Beer and wine available',
      'Tournament-style games'
    ],
    userTags: ['so much fun!', 'great for parties', 'unique experience', 'friendly staff'],
    matchWeights: {
      soloFriendly: 0.3,
      groupOriented: 0.95,
      competitive: 0.95,
      casual: 0.6,
      energetic: 0.9
    }
  },

  // 4. Kayaking Adventure
  {
    id: 'pm-bay-kayak-004',
    name: 'City Kayak - South Beach Harbor',
    category: 'play-move',
    activityType: 'water-sports',
    description: 'Guided kayaking tours along the San Francisco waterfront. Paddle past the Bay Bridge, explore McCovey Cove, and enjoy stunning city views from the water.',
    address: 'Pier 40, South Beach Harbor, San Francisco, CA 94107',
    neighborhood: 'South Beach',
    coordinates: {
      lat: 37.7841,
      lng: -122.3885
    },
    rating: 4.6,
    reviewCount: 1128,
    priceLevel: 3,
    priceRange: '$45-75',
    estimatedCostPerPerson: {
      min: 45,
      max: 75
    },
    activities: {
      primary: 'Kayaking',
      secondary: ['Guided tours', 'Sunset paddles', 'Skills clinics'],
      equipment: ['Kayak', 'Paddle', 'Life jacket', 'Wetsuit (seasonal)', 'Dry bag']
    },
    groupCapacity: {
      min: 1,
      max: 15,
      idealSize: 'Solo or small groups (1-6 people)'
    },
    duration: {
      typical: '2-2.5 hours',
      min: 120,
      max: 180
    },
    atmosphere: ['Adventurous', 'Peaceful', 'Scenic', 'Refreshing', 'Nature-connected'],
    intensityLevel: 'moderate',
    skillLevel: 'beginner-friendly',
    timeline: [
      {
        step: 1,
        title: 'Gear Up & Launch',
        description: 'Get fitted for equipment, receive paddling instruction, and launch from the harbor.',
        duration: '20-30 min',
        icon: '🛶'
      },
      {
        step: 2,
        title: 'Paddle & Explore',
        description: 'Follow your guide along the waterfront. Paddle to McCovey Cove and under the Bay Bridge.',
        duration: '1.5-2 hours',
        icon: '🌊'
      },
      {
        step: 3,
        title: 'Return & Reflect',
        description: 'Return to harbor, rinse off, and share photos. Warm up with hot drinks if chilly!',
        duration: '15-20 min',
        icon: '📸'
      }
    ],
    amenities: {
      parking: true,
      publicTransit: true,
      foodDrinks: false,
      lockers: true,
      rentalEquipment: true,
      indoor: false,
      outdoor: true
    },
    hours: {
      monday: '9:00 AM - 6:00 PM',
      tuesday: '9:00 AM - 6:00 PM',
      wednesday: '9:00 AM - 6:00 PM',
      thursday: '9:00 AM - 6:00 PM',
      friday: '9:00 AM - 7:00 PM',
      saturday: '8:00 AM - 7:00 PM',
      sunday: '8:00 AM - 6:00 PM'
    },
    peakTimes: ['Saturday 10am-2pm', 'Sunset tours'],
    reservationRequired: true,
    bestFor: ['Outdoor adventurers', 'Active dates', 'Nature lovers', 'Photography', 'Fitness enthusiasts'],
    experienceTypes: ['Solo adventure', 'Friendly', 'Romantic', 'First date'],
    weatherDependent: true,
    weatherPreference: 'Clear skies, light wind under 15 mph. Tours may cancel in high winds or rough water.',
    safetyBriefing: true,
    ageRestrictions: 'Ages 10+ (with guardian). 16+ for solo participation.',
    accessibility: ['Must be able to swim', 'Physical fitness required'],
    images: [
      'https://images.unsplash.com/photo-1599587944936-17092e23c638?w=1200',
      'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200'
    ],
    phone: '(415) 555-4000',
    website: 'https://citykayak.com',
    bookingUrl: 'https://citykayak.com/book-tour',
    highlights: [
      'Guided tours with local experts',
      'All equipment provided',
      'Bay Bridge & ballpark views',
      'Small group sizes for personalized attention'
    ],
    userTags: ['amazing views', 'peaceful', 'great workout', 'friendly guides'],
    matchWeights: {
      soloFriendly: 0.8,
      groupOriented: 0.75,
      competitive: 0.3,
      casual: 0.6,
      energetic: 0.85
    }
  },

  // 5. Multi-Activity Sports Park
  {
    id: 'pm-presidio-sports-005',
    name: 'The Presidio Sports & Recreation',
    category: 'play-move',
    activityType: 'outdoor-adventure',
    description: 'Expansive sports complex offering pickleball, basketball courts, disc golf, and group fitness. Beautiful park setting with Bay views.',
    address: 'Main Post, Presidio of San Francisco, CA 94129',
    neighborhood: 'Presidio',
    coordinates: {
      lat: 37.7989,
      lng: -122.4662
    },
    rating: 4.4,
    reviewCount: 892,
    priceLevel: 1,
    priceRange: '$15-30',
    estimatedCostPerPerson: {
      min: 15,
      max: 30
    },
    activities: {
      primary: 'Multi-Sport Complex',
      secondary: ['Pickleball', 'Basketball', 'Disc golf', 'Volleyball', 'Group fitness classes'],
      equipment: ['Court equipment available', 'Ball rentals', 'Disc golf discs']
    },
    groupCapacity: {
      min: 1,
      max: 30,
      idealSize: 'Flexible - solo to large groups'
    },
    duration: {
      typical: '1-2 hours',
      min: 60,
      max: 150
    },
    atmosphere: ['Active', 'Community', 'Fresh air', 'Competitive but friendly', 'Scenic'],
    intensityLevel: 'moderate',
    skillLevel: 'all-levels',
    timeline: [
      {
        step: 1,
        title: 'Arrive & Choose Activity',
        description: 'Check in, pick up equipment, and decide what to play first!',
        duration: '10 min',
        icon: '🏀'
      },
      {
        step: 2,
        title: 'Play & Compete',
        description: 'Engage in your chosen sport. Switch between activities or stay with favorites.',
        duration: '1-1.5 hours',
        icon: '🎾'
      },
      {
        step: 3,
        title: 'Cool Down',
        description: 'Stretch, hydrate, and enjoy the park views. Plan your next visit!',
        duration: '15-20 min',
        icon: '💧'
      }
    ],
    amenities: {
      parking: true,
      publicTransit: true,
      foodDrinks: false,
      lockers: false,
      rentalEquipment: true,
      indoor: false,
      outdoor: true
    },
    hours: {
      monday: '7:00 AM - 8:00 PM',
      tuesday: '7:00 AM - 8:00 PM',
      wednesday: '7:00 AM - 8:00 PM',
      thursday: '7:00 AM - 8:00 PM',
      friday: '7:00 AM - 8:00 PM',
      saturday: '8:00 AM - 7:00 PM',
      sunday: '8:00 AM - 7:00 PM'
    },
    peakTimes: ['Weekday evenings 5-7pm', 'Saturday mornings'],
    reservationRequired: false,
    bestFor: ['Active groups', 'Fitness enthusiasts', 'Outdoor lovers', 'Budget-friendly fun', 'Casual competition'],
    experienceTypes: ['Solo adventure', 'Friendly', 'Group fun'],
    weatherDependent: true,
    weatherPreference: 'Best in mild weather. Courts available in light rain.',
    safetyBriefing: false,
    ageRestrictions: 'All ages welcome',
    accessibility: ['Wheelchair accessible paths', 'Adaptive sports programs'],
    images: [
      'https://images.unsplash.com/photo-1587280501635-68a0e82cd5ff?w=1200',
      'https://images.unsplash.com/photo-1546483875-ad9014c88eba?w=1200'
    ],
    phone: '(415) 555-7989',
    website: 'https://presidiosports.org',
    highlights: [
      'Multiple sports in one location',
      'Beautiful Presidio setting',
      'Affordable drop-in rates',
      'Equipment rental available',
      'Community atmosphere'
    ],
    userTags: ['great variety', 'beautiful location', 'affordable', 'friendly players'],
    matchWeights: {
      soloFriendly: 0.75,
      groupOriented: 0.9,
      competitive: 0.7,
      casual: 0.85,
      energetic: 0.8
    }
  }
];

/**
 * Get Play & Move recommendations based on user preferences
 */
export function getPlayMoveRecommendations(
  preferences: any,
  maxResults: number = 5
): Array<PlayMoveVenue & { matchScore: number; matchFactors: any }> {
  // Default travel time (in real app, would calculate from user location)
  const defaultTravelTime = 20;

  const recommendations = playMoveVenues.map(venue => {
    const match = calculatePlayMoveMatch(venue, preferences, defaultTravelTime);
    return {
      ...venue,
      matchScore: match.score,
      matchFactors: match.factors
    };
  });

  // Filter by minimum threshold (0.65) and sort by score
  return recommendations
    .filter(rec => rec.matchScore >= 0.65)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, maxResults);
}

/**
 * Get activity type details for UI display
 */
export function getActivityTypeInfo(activityType: PlayMoveVenue['activityType']) {
  const typeInfo = {
    'indoor-active': {
      label: 'Indoor Active',
      icon: '🎳',
      description: 'Energetic indoor activities perfect for any weather'
    },
    'outdoor-adventure': {
      label: 'Outdoor Adventure',
      icon: '🏃',
      description: 'Fresh air activities in scenic locations'
    },
    'competitive-fun': {
      label: 'Competitive Fun',
      icon: '🎯',
      description: 'Friendly competition with a unique twist'
    },
    'climbing-sports': {
      label: 'Climbing & Sports',
      icon: '🧗',
      description: 'Vertical challenges and athletic pursuits'
    },
    'water-sports': {
      label: 'Water Sports',
      icon: '🛶',
      description: 'Paddle and play on the water'
    }
  };

  return typeInfo[activityType];
}

export default {
  venues: playMoveVenues,
  calculateMatch: calculatePlayMoveMatch,
  getRecommendations: getPlayMoveRecommendations,
  activityTypeInfo: getActivityTypeInfo
};
