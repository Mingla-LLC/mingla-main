export interface Category {
  slug: string;
  name: string;
  icon: string;
  description: string;
  detailedDescription: string;
  expectedActivities: string[];
  pairedExperiences?: string[];
  apiMapping: {
    googleMaps: {
      coreAnchors: string[];
      companionAnchors?: string[];
      attributes: string[];
      excludedAttributes?: string[];
    };
    eventbrite: {
      eventTypes: string[];
      tags?: string[];
    };
  };
  logic: {
    hardFilter: string;
    pairingRule?: string;
    hierarchy: {
      broad: string;
      niche: string[];
    };
    fallbackBehavior: string;
  };
  ux: {
    activeColor: string;
    subcategories?: string[];
    contextualPreview: string;
  };
  compatibleWith?: string[];
  incompatibleWith?: string[];
  activityType?: 'stationary' | 'mobile' | 'mixed';
  duration?: 'short' | 'medium' | 'long';
}

export const categories: Category[] = [
  {
    slug: 'nature',
    name: 'Nature',
    icon: '🌿',
    description: 'Outdoor experiences in natural settings — parks, trails, beaches, and wildlife',
    detailedDescription: 'Scenic parks, botanical gardens, hiking trails, beaches, national parks, zoos, and wildlife areas. Perfect for fresh air, calm conversation, and connection with the outdoors.',
    expectedActivities: [
      'Parks, botanical gardens, national parks',
      'Hiking trails and nature reserves',
      'Beaches, zoos, and wildlife parks'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['park', 'botanical_garden', 'hiking_area', 'national_park', 'state_park', 'beach', 'zoo', 'wildlife_park'],
        attributes: ['scenic', 'outdoor', 'peaceful'],
        excludedAttributes: ['bar', 'night_club', 'casino', 'movie_theater', 'bowling_alley', 'fine_dining_restaurant']
      },
      eventbrite: {
        eventTypes: ['outdoor_events', 'nature_tours', 'guided_hikes']
      }
    },
    logic: {
      hardFilter: 'Must be an outdoor natural setting',
      hierarchy: {
        broad: 'Nature',
        niche: ['Parks & Gardens', 'Hiking & Trails', 'Beaches', 'National Parks', 'Zoos & Wildlife']
      },
      fallbackBehavior: 'If no nature spots within range, suggest closest park or botanical garden.'
    },
    ux: {
      activeColor: '#10B981',
      subcategories: ['Parks & Gardens', 'Hiking & Trails', 'Beaches', 'National Parks', 'Zoos & Wildlife'],
      contextualPreview: 'Botanical garden just 10 minutes away — perfect for a peaceful walk.'
    },
    activityType: 'mobile',
    duration: 'medium',
    compatibleWith: ['picnic', 'wellness', 'creative_arts'],
    incompatibleWith: ['watch', 'fine_dining', 'play']
  },
  {
    slug: 'first_meet',
    name: 'First Meet',
    icon: '🤝',
    description: 'Low-pressure social settings perfect for meeting someone new or a first date',
    detailedDescription: 'Bookstores, coffee shops, wine bars, tea houses, pubs, and planetariums — relaxed venues that enable easy conversation without the pressure of a formal date setting.',
    expectedActivities: [
      'Bookstores and coffee shops',
      'Wine bars and pubs',
      'Tea houses and casual lounges',
      'Planetariums'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['bookstore', 'bar', 'pub', 'wine_bar', 'tea_house', 'coffee_shop', 'planetarium'],
        attributes: ['quiet', 'conversational', 'relaxed'],
        excludedAttributes: ['amusement_park', 'water_park', 'bowling_alley', 'spa', 'massage']
      },
      eventbrite: {
        eventTypes: ['social_events', 'networking', 'casual_meetups']
      }
    },
    logic: {
      hardFilter: 'Must be a conversational, low-pressure venue',
      hierarchy: {
        broad: 'First Meet',
        niche: ['Coffee Shops', 'Wine Bars', 'Bookstores', 'Pubs', 'Tea Houses']
      },
      fallbackBehavior: 'If no bookstore or specialty venue found, show nearest coffee shop or wine bar.'
    },
    ux: {
      activeColor: '#6366F1',
      subcategories: ['Coffee Shops', 'Wine Bars', 'Bookstores', 'Pubs', 'Tea Houses'],
      contextualPreview: 'Indie bookstore with a café corner — great for a relaxed first meet.'
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['drink', 'watch', 'creative_arts'],
    incompatibleWith: ['wellness', 'picnic']
  },
  {
    slug: 'picnic',
    name: 'Picnic',
    icon: '🧺',
    description: 'Outdoor picnic experiences in parks, beaches, and botanical gardens',
    detailedDescription: 'Curated spots for a relaxed outdoor picnic — parks, beaches, botanical gardens, and picnic grounds. Bring your own or pick up supplies nearby.',
    expectedActivities: [
      'Picnic grounds and parks',
      'Beaches and botanical gardens',
      'Outdoor green spaces'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['picnic_ground', 'park', 'beach', 'botanical_garden'],
        attributes: ['outdoor', 'open_space', 'family_friendly'],
        excludedAttributes: ['dog_park', 'amusement_park', 'water_park', 'bar', 'night_club', 'casino', 'movie_theater']
      },
      eventbrite: {
        eventTypes: ['outdoor_events', 'picnics', 'garden_events']
      }
    },
    logic: {
      hardFilter: 'Must be an outdoor open space suitable for a picnic',
      hierarchy: {
        broad: 'Picnic',
        niche: ['Parks', 'Beaches', 'Botanical Gardens', 'Picnic Grounds']
      },
      fallbackBehavior: 'If no picnic ground, fall back to nearest park or beach.'
    },
    ux: {
      activeColor: '#84CC16',
      subcategories: ['Parks', 'Beaches', 'Botanical Gardens', 'Picnic Grounds'],
      contextualPreview: 'Waterfront park with picnic tables — beautiful sunset views.'
    },
    activityType: 'mixed',
    duration: 'medium',
    compatibleWith: ['nature', 'drink', 'casual_eats'],
    incompatibleWith: ['fine_dining', 'watch', 'wellness']
  },
  {
    slug: 'drink',
    name: 'Drink',
    icon: '🍹',
    description: 'Bars, pubs, wine bars, coffee shops, and tea houses for drinks and conversation',
    detailedDescription: 'Relaxed venues centered on drinks — cocktail bars, pubs, wine bars, tea houses, and coffee shops. Works for first dates, group hangs, and casual social outings.',
    expectedActivities: [
      'Cocktail bars and pubs',
      'Wine bars and tea houses',
      'Coffee shops and cafes'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['bar', 'pub', 'wine_bar', 'tea_house', 'coffee_shop'],
        attributes: ['relaxed', 'social', 'drinks'],
        excludedAttributes: ['fine_dining_restaurant', 'spa', 'amusement_park']
      },
      eventbrite: {
        eventTypes: ['wine_tastings', 'cocktail_events', 'coffee_events']
      }
    },
    logic: {
      hardFilter: 'Must be a drink-centered venue',
      hierarchy: {
        broad: 'Drink',
        niche: ['Cocktail Bars', 'Wine Bars', 'Pubs', 'Tea Houses', 'Coffee Shops']
      },
      fallbackBehavior: 'If no specialty bar found, show nearest cafe or pub.'
    },
    ux: {
      activeColor: '#F59E0B',
      subcategories: ['Cocktail Bars', 'Wine Bars', 'Pubs', 'Tea Houses', 'Coffee Shops'],
      contextualPreview: 'Cozy wine bar with a curated list — perfect for unwinding.'
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['first_meet', 'casual_eats', 'fine_dining', 'watch', 'play', 'creative_arts', 'picnic'],
    incompatibleWith: ['wellness', 'nature']
  },
  {
    slug: 'casual_eats',
    name: 'Casual Eats',
    icon: '🍔',
    description: 'Affordable, informal dining — burgers, ramen, tacos, pizza, and more',
    detailedDescription: 'Low-stakes, easygoing food outings across a wide range of cuisines. Fast food, diners, sandwich shops, ramen bars, pizza spots, and everything in between.',
    expectedActivities: [
      'Burgers, tacos, pizza, ramen',
      'Diners, delis, brunch spots',
      'Fast casual and food courts'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'buffet_restaurant', 'brunch_restaurant', 'diner', 'fast_food_restaurant', 'food_court',
          'hamburger_restaurant', 'pizza_restaurant', 'ramen_restaurant', 'sandwich_shop', 'sushi_restaurant',
          'afghani_restaurant', 'african_restaurant', 'american_restaurant', 'asian_restaurant',
          'barbecue_restaurant', 'brazilian_restaurant', 'breakfast_restaurant', 'indian_restaurant',
          'indonesian_restaurant', 'japanese_restaurant', 'korean_restaurant', 'lebanese_restaurant',
          'mediterranean_restaurant', 'mexican_restaurant', 'middle_eastern_restaurant', 'seafood_restaurant',
          'spanish_restaurant', 'thai_restaurant', 'turkish_restaurant', 'vegan_restaurant',
          'vegetarian_restaurant', 'vietnamese_restaurant', 'chinese_restaurant'
        ],
        attributes: ['affordable', 'casual', 'informal'],
        excludedAttributes: ['fine_dining_restaurant', 'bar', 'night_club', 'spa']
      },
      eventbrite: {
        eventTypes: ['food_festivals', 'pop_up_dining', 'street_food_events']
      }
    },
    logic: {
      hardFilter: 'Must be food-centered and informal in pricing/setting',
      hierarchy: {
        broad: 'Casual Eats',
        niche: ['Burgers', 'Pizza', 'Ramen', 'Tacos', 'Brunch', 'Asian Cuisine', 'Diners']
      },
      fallbackBehavior: 'If no exact match, show nearest highly rated casual restaurant.'
    },
    ux: {
      activeColor: '#F97316',
      subcategories: ['Burgers', 'Pizza', 'Ramen', 'Tacos', 'Brunch', 'Asian Cuisine', 'Diners'],
      contextualPreview: 'Ramen bar 8 minutes away — $14 bowls, open late.'
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['drink', 'watch', 'play', 'picnic'],
    incompatibleWith: ['wellness', 'fine_dining']
  },
  {
    slug: 'fine_dining',
    name: 'Fine Dining',
    icon: '🍽️',
    description: 'Elevated dining — steakhouses, French cuisine, Italian, Greek, and fine dining restaurants',
    detailedDescription: 'Curated, sit-down dining experiences centered on quality. Fine dining restaurants, steakhouses, French, Greek, and Italian restaurants for special occasions and refined outings.',
    expectedActivities: [
      'Fine dining restaurants',
      'Steakhouses',
      'French, Greek, and Italian restaurants'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['fine_dining_restaurant', 'steak_house', 'french_restaurant', 'greek_restaurant', 'italian_restaurant'],
        attributes: ['upscale', 'refined', 'reservation_recommended'],
        excludedAttributes: ['fast_food_restaurant', 'food_court', 'bar', 'bowling_alley', 'amusement_park']
      },
      eventbrite: {
        eventTypes: ['chef_led_dinners', 'wine_pairing_events', 'fine_dining_events']
      }
    },
    logic: {
      hardFilter: 'Must be upscale or chef-led dining',
      hierarchy: {
        broad: 'Fine Dining',
        niche: ['Steakhouses', 'French', 'Italian', 'Greek', 'Fine Dining Restaurants']
      },
      fallbackBehavior: 'If no fine dining options, reframe best mid-range option nearby.'
    },
    ux: {
      activeColor: '#7C3AED',
      subcategories: ['Steakhouses', 'French', 'Italian', 'Greek', 'Fine Dining Restaurants'],
      contextualPreview: 'Intimate Italian bistro with a prix fixe menu — reservations recommended.'
    },
    activityType: 'stationary',
    duration: 'long',
    compatibleWith: ['drink', 'watch'],
    incompatibleWith: ['casual_eats', 'picnic', 'play', 'nature']
  },
  {
    slug: 'watch',
    name: 'Watch',
    icon: '🎬',
    description: 'Movie theaters and comedy clubs — shared entertainment experiences',
    detailedDescription: 'Venues centered on watching and being entertained together. Movie theaters and comedy clubs for a fun shared evening.',
    expectedActivities: [
      'Movie theaters',
      'Comedy clubs and stand-up shows'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['movie_theater', 'comedy_club'],
        attributes: ['entertainment', 'indoor', 'seated'],
        excludedAttributes: ['spa', 'botanical_garden', 'park', 'restaurant']
      },
      eventbrite: {
        eventTypes: ['film_screenings', 'comedy_nights', 'movie_events']
      }
    },
    logic: {
      hardFilter: 'Must be a cinema or comedy venue',
      hierarchy: {
        broad: 'Watch',
        niche: ['Movies', 'Comedy Shows', 'Special Screenings']
      },
      fallbackBehavior: 'If no movie theater found, show nearest comedy club or performing arts venue.'
    },
    ux: {
      activeColor: '#3B82F6',
      subcategories: ['Movies', 'Comedy Shows', 'Special Screenings'],
      contextualPreview: 'Comedy club with a headliner tonight — doors at 7pm.'
    },
    activityType: 'stationary',
    duration: 'medium',
    compatibleWith: ['drink', 'casual_eats', 'fine_dining', 'first_meet'],
    incompatibleWith: ['nature', 'picnic', 'wellness']
  },
  {
    slug: 'creative_arts',
    name: 'Creative & Arts',
    icon: '🎨',
    description: 'Art galleries, museums, planetariums, karaoke, and creative spaces',
    detailedDescription: 'Inspiring venues for art lovers and curious minds. Art galleries, museums, planetariums, karaoke bars, and coffee roasteries where creativity flows freely.',
    expectedActivities: [
      'Art galleries and museums',
      'Planetariums',
      'Karaoke bars',
      'Coffee roasteries'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['art_gallery', 'museum', 'planetarium', 'karaoke', 'coffee_roastery'],
        attributes: ['creative', 'cultural', 'inspiring'],
        excludedAttributes: ['fast_food_restaurant', 'bar', 'bowling_alley', 'spa']
      },
      eventbrite: {
        eventTypes: ['art_events', 'museum_nights', 'cultural_events', 'creative_workshops']
      }
    },
    logic: {
      hardFilter: 'Must be a creative or cultural venue',
      hierarchy: {
        broad: 'Creative & Arts',
        niche: ['Art Galleries', 'Museums', 'Planetariums', 'Karaoke', 'Coffee Roasteries']
      },
      fallbackBehavior: 'If no gallery or museum found, show nearest karaoke bar or roastery.'
    },
    ux: {
      activeColor: '#EC4899',
      subcategories: ['Art Galleries', 'Museums', 'Planetariums', 'Karaoke', 'Coffee Roasteries'],
      contextualPreview: 'Art gallery opening tonight — free admission, wine served.'
    },
    activityType: 'stationary',
    duration: 'medium',
    compatibleWith: ['drink', 'first_meet', 'nature', 'play'],
    incompatibleWith: ['wellness', 'fine_dining']
  },
  {
    slug: 'play',
    name: 'Play',
    icon: '🎯',
    description: 'Bowling, arcades, escape rooms, trampoline parks, amusement parks, and more',
    detailedDescription: 'High-energy, fun-first venues for groups and couples who want to move, compete, and laugh. Bowling alleys, arcades, escape rooms, trampolines, mini golf, ice skating, and adventure parks.',
    expectedActivities: [
      'Bowling, mini golf, ice skating',
      'Arcades, escape rooms, trampolines',
      'Amusement parks, water parks',
      'Karaoke and casinos'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'bowling_alley', 'amusement_park', 'water_park', 'video_arcade', 'karaoke', 'casino',
          'trampoline_park', 'mini_golf_course', 'ice_skating_rink', 'skate_park', 'escape_room', 'adventure_park'
        ],
        attributes: ['active', 'fun', 'group_friendly'],
        excludedAttributes: ['spa', 'massage', 'botanical_garden', 'fine_dining_restaurant']
      },
      eventbrite: {
        eventTypes: ['recreational_events', 'game_nights', 'group_activities']
      }
    },
    logic: {
      hardFilter: 'Must be an active, game-based, or entertainment venue',
      hierarchy: {
        broad: 'Play',
        niche: ['Bowling', 'Arcades', 'Escape Rooms', 'Trampolines', 'Mini Golf', 'Amusement Parks', 'Ice Skating']
      },
      fallbackBehavior: 'If no dedicated play venue found, show nearest bowling alley or arcade.'
    },
    ux: {
      activeColor: '#EF4444',
      subcategories: ['Bowling', 'Arcades', 'Escape Rooms', 'Trampolines', 'Mini Golf', 'Amusement Parks', 'Ice Skating'],
      contextualPreview: 'Escape room challenge for 4–6 players — book tonight.'
    },
    activityType: 'mixed',
    duration: 'medium',
    compatibleWith: ['drink', 'casual_eats', 'creative_arts'],
    incompatibleWith: ['wellness', 'fine_dining', 'nature']
  },
  {
    slug: 'wellness',
    name: 'Wellness',
    icon: '🧘',
    description: 'Spas, saunas, and hot springs for relaxation and rejuvenation',
    detailedDescription: 'Restorative experiences centered on calm and self-care. Spas, saunas, and hot springs for solo or shared relaxation.',
    expectedActivities: [
      'Spas and wellness centers',
      'Saunas',
      'Hot springs'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['spa', 'sauna', 'hot_spring'],
        attributes: ['relaxing', 'restorative', 'mindful'],
        excludedAttributes: ['bar', 'night_club', 'casino', 'bowling_alley', 'amusement_park', 'fast_food_restaurant']
      },
      eventbrite: {
        eventTypes: ['wellness_events', 'spa_days', 'mindfulness_workshops']
      }
    },
    logic: {
      hardFilter: 'Must be a wellness or spa venue',
      hierarchy: {
        broad: 'Wellness',
        niche: ['Spas', 'Saunas', 'Hot Springs']
      },
      fallbackBehavior: 'If no spa found, suggest nearest wellness center or sauna.'
    },
    ux: {
      activeColor: '#14B8A6',
      subcategories: ['Spas', 'Saunas', 'Hot Springs'],
      contextualPreview: 'Spa day with sauna access — book a couples package.'
    },
    activityType: 'stationary',
    duration: 'long',
    compatibleWith: ['nature'],
    incompatibleWith: ['play', 'drink', 'watch', 'casual_eats', 'fine_dining']
  }
];

export const getCategoryBySlug = (slug: string): Category | undefined => {
  return categories.find(category => category.slug === slug);
};

/**
 * Check if two categories are compatible with each other
 */
export const areCategoriesCompatible = (category1: string, category2: string): boolean => {
  const cat1 = getCategoryBySlug(category1);
  const cat2 = getCategoryBySlug(category2);
  
  if (!cat1 || !cat2) return true; // If category not found, allow it
  
  // Check if either category explicitly lists the other as incompatible
  if (cat1.incompatibleWith?.includes(category2) || cat2.incompatibleWith?.includes(category1)) {
    return false;
  }
  
  // Check if either category explicitly lists the other as compatible
  if (cat1.compatibleWith?.includes(category2) || cat2.compatibleWith?.includes(category1)) {
    return true;
  }
  
  // Default to compatible if no explicit rules
  return true;
};

/**
 * Get available categories based on currently selected categories
 */
export const getAvailableCategories = (selectedCategories: string[]): Category[] => {
  if (selectedCategories.length === 0) {
    return categories; // All categories available if none selected
  }
  
  return categories.filter(category => {
    // Don't show already selected categories
    if (selectedCategories.includes(category.slug)) {
      return false;
    }
    
    // Check compatibility with all selected categories
    return selectedCategories.every(selectedCategory => 
      areCategoriesCompatible(category.slug, selectedCategory)
    );
  });
};

/**
 * Get incompatible categories for a given category
 */
export const getIncompatibleCategories = (categorySlug: string): string[] => {
  const category = getCategoryBySlug(categorySlug);
  return category?.incompatibleWith || [];
};

/**
 * Get compatible categories for a given category
 */
export const getCompatibleCategories = (categorySlug: string): string[] => {
  const category = getCategoryBySlug(categorySlug);
  return category?.compatibleWith || [];
};

// Categories × Experience Types Cross-Mapping
export const getCategoryExperienceTypeCombinations = (categorySlug: string, experienceType: string): string => {
  const combinations: Record<string, Record<string, string>> = {
    'stroll': {
      'first_date': 'Scenic park walk + gelato nearby — low pressure, easy conversation.',
      'romantic': 'Sunset stroll along the waterfront ending at a cozy wine bar.',
      'friendly': 'Group garden walk + taco truck outside the park gates.',
      'solo_adventure': 'Botanical garden stroll with coffee to-go from nearby café.',
      'group_fun': 'City mural walk with food truck rally at the finish line.',
      'business': 'Walking meeting route with coffee stop along the way.'
    },
    'sip': {
      'first_date': 'Speakeasy with soft lighting and quiet booths — great for conversation.',
      'romantic': 'Wine bar with a 6-glass tasting flight and live acoustic music.',
      'friendly': 'Neighborhood brewery with board games and casual vibes.',
      'solo_adventure': 'Specialty coffee roastery — perfect for journaling or reading.',
      'group_fun': 'Cocktail lounge with large tables and happy hour pitchers.',
      'business': 'Hotel lobby bar with Wi-Fi and private lounge seating.'
    },
    'casual_eats': {
      'first_date': 'Casual ramen shop — low-key and easy for a first meet.',
      'romantic': 'Late-night taco truck crawl for two under string lights.',
      'friendly': 'Food truck rally — great for trying different bites with friends.',
      'solo_adventure': 'Hole-in-the-wall noodle shop — counter seating, quick service.',
      'group_fun': 'Pizza-by-the-slice joint with outdoor benches for the crew.',
      'business': 'Casual café with Wi-Fi and deli sandwiches — informal lunch spot.'
    },
    'screen_relax': {
      'first_date': 'Indie cinema showing a cult classic at 7pm.',
      'romantic': 'Drive-in double feature — bring blankets and snacks.',
      'friendly': 'Comedy club lineup — group tickets available.',
      'solo_adventure': 'Arthouse screening — perfect for solo movie lovers.',
      'group_fun': 'Big-screen watch party of the championship game.',
      'business': 'Industry documentary screening followed by a networking mixer.'
    },
    'creative': {
      'first_date': 'Sip & Paint night with wine included — playful and low-stakes.',
      'romantic': 'Couples pottery class — make something together to keep.',
      'friendly': 'Cooking class for friends — team up to make pasta or dumplings.',
      'solo_adventure': 'Saturday candle-making workshop — take home your own creation.',
      'group_fun': 'Escape-room style craft workshop — collaborate on a challenge.',
      'business': 'Corporate team-building cooking class — private session available.'
    },
    'play_move': {
      'first_date': 'Glow-in-the-dark mini golf — fun, flirty, and interactive.',
      'romantic': 'Evening skate date — rent skates and glide under the lights.',
      'friendly': 'Arcade night — grab tokens and compete in games.',
      'solo_adventure': 'Solo bouldering session — day pass includes gear rental.',
      'group_fun': 'Bowling alley with neon lights — lane reservations for 6.',
      'business': 'Casual networking pickleball tournament.'
    },
    'dining': {
      'first_date': 'Modern bistro with prix fixe menu, $65 per person.',
      'romantic': 'Omakase counter with 10 seats — chef\'s choice, candlelit ambience.',
      'friendly': 'Family-style rooftop dinner with shared plates.',
      'solo_adventure': 'Seasonal tasting menu at chef\'s counter — perfect for solo foodies.',
      'group_fun': 'Wine-pairing dinner with large communal table.',
      'business': 'Upscale steakhouse with private rooms and Wi-Fi.'
    },
    'wellness': {
      'first_date': 'Couples yoga followed by herbal tea lounge.',
      'romantic': 'Day spa package with sauna + massage for two.',
      'friendly': 'Group sound bath meditation — mats provided.',
      'solo_adventure': 'Sunset yoga in the park — solo mats welcome.',
      'group_fun': 'Wellness retreat day pass — yoga, meditation, and healthy lunch.',
      'business': 'Mindfulness workshop for teams — private booking available.'
    },
    'freestyle': {
      'first_date': 'Secret pop-up dessert bar — intimate but unexpected.',
      'romantic': 'Lantern festival with live music — magical, outdoors.',
      'friendly': 'Street art crawl with food trucks and DJs.',
      'solo_adventure': 'Experimental pop-up gallery with immersive installations.',
      'group_fun': 'Rooftop silent disco — headphones on, dance together.',
      'business': 'Startup pitch night disguised as a pop-up bar mixer.'
    }
  };

  return combinations[categorySlug]?.[experienceType] || `${categorySlug} experience for ${experienceType}`;
};

// Date Selection Types
export interface DateSelection {
  type: 'now' | 'today' | 'this_weekend' | 'pick_date';
  label: string;
  description: string;
  icon: string;
  timeRange?: {
    start: string;
    end: string;
  };
}

export const dateSelections: DateSelection[] = [
  {
    type: 'now',
    label: 'Now',
    description: 'What\'s open right this minute',
    icon: '⚡',
    timeRange: {
      start: 'now',
      end: '+30min'
    }
  },
  {
    type: 'today',
    label: 'Today',
    description: 'From afternoon into evening',
    icon: '☀️',
    timeRange: {
      start: 'afternoon',
      end: '11:59pm'
    }
  },
  {
    type: 'this_weekend',
    label: 'This Weekend',
    description: 'Great for Fri–Sun planning',
    icon: '📅',
    timeRange: {
      start: 'friday_12pm',
      end: 'sunday_11:59pm'
    }
  },
  {
    type: 'pick_date',
    label: 'Pick a Date',
    description: 'Choose exact day & time',
    icon: '🗓️'
  }
];

// Time Slot Presets for "Pick a Date"
export interface TimeSlot {
  label: string;
  icon: string;
  startTime: string;
  endTime: string;
  description: string;
}

export const timeSlots: TimeSlot[] = [
  {
    label: 'Brunch',
    icon: '🍳',
    startTime: '11:00',
    endTime: '13:00',
    description: 'Perfect for morning meetups'
  },
  {
    label: 'Afternoon',
    icon: '☀️',
    startTime: '14:00',
    endTime: '17:00',
    description: 'Great for daytime activities'
  },
  {
    label: 'Dinner',
    icon: '🍽️',
    startTime: '18:00',
    endTime: '21:00',
    description: 'Ideal for evening experiences'
  },
  {
    label: 'Late Night',
    icon: '🌙',
    startTime: '22:00',
    endTime: '00:00',
    description: 'Perfect for night owls'
  }
];

// Enhanced Time Slot with Best Time Guidance
export interface EnhancedTimeSlot extends TimeSlot {
  bestTime?: string;
  avoidTime?: string;
  crowdLevel?: 'low' | 'moderate' | 'high' | 'peak';
  weatherSuggestion?: string;
}

export const enhancedTimeSlots: EnhancedTimeSlot[] = [
  {
    label: 'Brunch',
    icon: '🍳',
    startTime: '11:00',
    endTime: '13:00',
    description: 'Perfect for morning meetups',
    bestTime: '11:30am',
    avoidTime: '12:30pm',
    crowdLevel: 'moderate',
    weatherSuggestion: 'Great for outdoor seating'
  },
  {
    label: 'Afternoon',
    icon: '☀️',
    startTime: '14:00',
    endTime: '17:00',
    description: 'Great for daytime activities',
    bestTime: '3:00pm',
    avoidTime: '4:00pm',
    crowdLevel: 'low',
    weatherSuggestion: 'Perfect for outdoor activities'
  },
  {
    label: 'Dinner',
    icon: '🍽️',
    startTime: '18:00',
    endTime: '21:00',
    description: 'Ideal for evening experiences',
    bestTime: '7:00pm',
    avoidTime: '8:00pm',
    crowdLevel: 'high',
    weatherSuggestion: 'Cozy indoor dining recommended'
  },
  {
    label: 'Late Night',
    icon: '🌙',
    startTime: '22:00',
    endTime: '00:00',
    description: 'Perfect for night owls',
    bestTime: '10:30pm',
    avoidTime: '11:30pm',
    crowdLevel: 'peak',
    weatherSuggestion: 'Indoor venues preferred'
  }
];

// Exact Time Selection Interface
export interface ExactTimeSelection {
  hour: number;
  minute: number;
  period: 'AM' | 'PM';
}

// Time Slot Logic Functions
export const getTimeSlotLogic = (timeSlot: string) => {
  const logic: Record<string, { filter: string; description: string }> = {
    'Brunch': {
      filter: 'venues open + events active between 11am–1pm',
      description: 'Show venues open + events active between 11am–1pm'
    },
    'Afternoon': {
      filter: 'venues open + events active between 2pm–5pm',
      description: 'Show venues open + events active between 2pm–5pm'
    },
    'Dinner': {
      filter: 'venues open + events active between 6pm–9pm',
      description: 'Show venues open + events active between 6pm–9pm'
    },
    'Late Night': {
      filter: 'venues open + events active between 10pm–12am',
      description: 'Show venues open + events active between 10pm–12am'
    }
  };
  
  return logic[timeSlot] || { filter: 'all available times', description: 'Show all available times' };
};

// Best Time to Go Suggestions
export const getBestTimeSuggestion = (timeSlot: string, weatherCondition?: string) => {
  const suggestions: Record<string, string> = {
    'Brunch': 'Best at 11:30am (not too crowded)',
    'Afternoon': 'Avoid 3pm (peak busy). Try 4pm instead.',
    'Dinner': 'Best at 7pm (not too crowded)',
    'Late Night': 'Best at 10:30pm (prime time)'
  };
  
  const baseSuggestion = suggestions[timeSlot] || 'Good time to go';
  
  if (weatherCondition) {
    return `${baseSuggestion} • Weather: ${weatherCondition}`;
  }
  
  return baseSuggestion;
};

// Fallback Smart Suggestions
export const getFallbackSuggestion = (timeSlot: string) => {
  const fallbacks: Record<string, string> = {
    'Brunch': 'No brunch options available — but here are great coffee shops and breakfast spots nearby.',
    'Afternoon': 'Limited afternoon activities — try these indoor options or consider an earlier time.',
    'Dinner': 'No dinner reservations available — but here are great casual dining spots with walk-in availability.',
    'Late Night': 'No late-night options available — but here are great dinner spots earlier in the evening.'
  };
  
  return fallbacks[timeSlot] || 'Limited options for this time — here are some alternatives nearby.';
};

// Travel Mode System
export interface TravelMode {
  id: string;
  label: string;
  icon: string;
  description: string;
  maxDistance: number;
  maxTime: number;
  coverage: string;
  googleMapsMode: 'walking' | 'driving' | 'transit';
}

export const travelModes: TravelMode[] = [
  {
    id: 'walk',
    label: 'Walk',
    icon: '🚶‍♀️',
    description: 'Best for nearby spots (~30 min or less)',
    maxDistance: 2, // miles
    maxTime: 45, // minutes
    coverage: '~2 miles',
    googleMapsMode: 'walking'
  },
  {
    id: 'drive',
    label: 'Drive',
    icon: '🚗',
    description: 'Reach more places (~45 min by car)',
    maxDistance: 20, // miles
    maxTime: 180, // minutes (3 hours)
    coverage: '~20 miles',
    googleMapsMode: 'driving'
  },
  {
    id: 'transit',
    label: 'Public Transit',
    icon: '🚌',
    description: 'City trips, up to ~45 min by bus/train',
    maxDistance: 15, // miles (transit distance)
    maxTime: 120, // minutes (2 hours)
    coverage: '~45 min ride',
    googleMapsMode: 'transit'
  }
];

// Travel Time Logic Functions
export const getTravelTimeLogic = (mode: string) => {
  const logic: Record<string, { filter: string; description: string }> = {
    'walk': {
      filter: 'max ~2 miles / ~45 min walking time',
      description: 'Show venues within 2 miles or 45 minutes walking time'
    },
    'drive': {
      filter: 'up to ~20 miles / ~180 min driving time (adjust for traffic)',
      description: 'Show venues within 20 miles or 3 hours driving time'
    },
    'transit': {
      filter: 'depends on real schedules; limit to ~120 min travel',
      description: 'Show venues accessible by public transit within 2 hours'
    }
  };
  
  return logic[mode] || { filter: 'all available distances', description: 'Show all available venues' };
};

// Human-Friendly Travel Time Conversion
export const getHumanFriendlyTravelTime = (mode: string, timeMinutes: number, distance?: number) => {
  const conversions: Record<string, (time: number, dist?: number) => string> = {
    'walk': (time, dist) => {
      if (time <= 5) return 'just a short walk';
      if (time <= 15) return `just a ${time}-min walk`;
      if (time <= 30) return `a ${time}-min walk`;
      return `a ${time}-min walk${dist ? ` (${dist.toFixed(1)} miles)` : ''}`;
    },
    'drive': (time, dist) => {
      if (time <= 10) return 'quick drive';
      if (time <= 20) return `quick ${time}-min drive`;
      if (time <= 45) return `${time}-min drive`;
      return `${time}-min drive${dist ? ` (${dist.toFixed(1)} miles)` : ''}`;
    },
    'transit': (time, dist) => {
      if (time <= 15) return 'short transit ride';
      if (time <= 30) return `${time}-min ride`;
      if (time <= 60) return `${time}-min transit ride`;
      return `${time}-min transit ride${dist ? ` (${dist.toFixed(1)} miles)` : ''}`;
    }
  };
  
  const converter = conversions[mode];
  return converter ? converter(timeMinutes, distance) : `${timeMinutes}-min travel`;
};

// Smart Travel Hints
export const getSmartTravelHint = (mode: string, venue: any) => {
  const hints: Record<string, (venue: any) => string> = {
    'walk': (venue) => {
      if (venue.park_nearby) return `${venue.travelTime} walk through the park`;
      if (venue.scenic_route) return `${venue.travelTime} scenic walk`;
      return `${venue.travelTime} walk`;
    },
    'drive': (venue) => {
      if (venue.parking_available) return `${venue.travelTime} drive, parking available`;
      if (venue.valet_parking) return `${venue.travelTime} drive, valet parking`;
      if (venue.street_parking) return `${venue.travelTime} drive, street parking nearby`;
      return `${venue.travelTime} drive`;
    },
    'transit': (venue) => {
      if (venue.no_transfers) return `${venue.travelTime} subway ride, no transfers`;
      if (venue.one_transfer) return `${venue.travelTime} transit ride, 1 transfer`;
      if (venue.direct_route) return `${venue.travelTime} direct transit ride`;
      return `${venue.travelTime} transit ride`;
    }
  };
  
  const hintGenerator = hints[mode];
  return hintGenerator ? hintGenerator(venue) : `${venue.travelTime} travel`;
};

// Fallback Travel Suggestions
export const getTravelFallbackSuggestion = (mode: string, closestVenue: any) => {
  const fallbacks: Record<string, string> = {
    'walk': `Closest match: ${closestVenue.travelTime} walk, just above your preference.`,
    'drive': `Closest match: ${closestVenue.travelTime} drive, slightly further than preferred.`,
    'transit': `Closest match: ${closestVenue.travelTime} transit ride, longer than your preference.`
  };
  
  return fallbacks[mode] || `Closest match: ${closestVenue.travelTime} travel, just above your preference.`;
};

// Travel Constraint System
export interface TravelConstraint {
  type: 'time' | 'distance';
  label: string;
  icon: string;
  description: string;
  microcopy: string;
  defaultValues: {
    walk: number;
    drive: number;
    transit: number;
  };
  unit: string;
}

export const travelConstraints: TravelConstraint[] = [
  {
    type: 'time',
    label: 'By Time',
    icon: '⏱️',
    description: 'Keep it under X minutes to get there',
    microcopy: 'By Time adjusts for traffic & transit schedules',
    defaultValues: {
      walk: 10,
      drive: 20,
      transit: 30
    },
    unit: 'minutes'
  },
  {
    type: 'distance',
    label: 'By Distance',
    icon: '📍',
    description: 'Keep it within X miles around me',
    microcopy: 'By Distance is a straight radius around you',
    defaultValues: {
      walk: 2,
      drive: 10,
      transit: 8
    },
    unit: 'miles'
  }
];

// Travel Constraint Logic Functions
export const getTravelConstraintLogic = (constraintType: string, travelMode: string) => {
  const logic: Record<string, Record<string, { filter: string; description: string }>> = {
    'time': {
      'walk': {
        filter: 'max 10 minutes walking time (adjusts for pace)',
        description: 'Show venues within 10 minutes walking time, adjusted for walking pace'
      },
      'drive': {
        filter: 'max 20 minutes driving time (adjusts for traffic)',
        description: 'Show venues within 20 minutes driving time, adjusted for real-time traffic'
      },
      'transit': {
        filter: 'max 30 minutes transit time (adjusts for schedules)',
        description: 'Show venues within 30 minutes transit time, adjusted for real-time schedules'
      }
    },
    'distance': {
      'walk': {
        filter: 'max 2 miles straight-line radius',
        description: 'Show venues within 2 miles straight-line radius from your location'
      },
      'drive': {
        filter: 'max 10 miles straight-line radius',
        description: 'Show venues within 10 miles straight-line radius from your location'
      },
      'transit': {
        filter: 'max 8 miles straight-line radius',
        description: 'Show venues within 8 miles straight-line radius from your location'
      }
    }
  };
  
  return logic[constraintType]?.[travelMode] || { 
    filter: 'all available venues', 
    description: 'Show all available venues' 
  };
};

// Human-Friendly Constraint Display
export const getHumanFriendlyConstraint = (constraintType: string, value: number, travelMode: string) => {
  if (constraintType === 'time') {
    return `Keep it under ${value} minutes to get there`;
  } else {
    return `Keep it within ${value} miles around you`;
  }
};

// Card Preview Constraint Display
export const getCardPreviewConstraint = (constraintType: string, travelTime: string, distance: string, userLimit: number) => {
  if (constraintType === 'time') {
    return `${travelTime}, within your ${userLimit} min limit`;
  } else {
    return `${distance} away, fits your ${userLimit}-mile radius`;
  }
};

// Constraint Validation
export const validateTravelConstraint = (constraintType: string, value: number, travelMode: string) => {
  const constraints = travelConstraints.find(c => c.type === constraintType);
  if (!constraints) return { valid: false, message: 'Invalid constraint type' };
  
  const defaults = constraints.defaultValues[travelMode as keyof typeof constraints.defaultValues];
  const minValue = Math.max(1, defaults * 0.5);
  const maxValue = defaults * 3;
  
  if (value < minValue) {
    return { 
      valid: false, 
      message: `Minimum ${constraintType === 'time' ? 'time' : 'distance'}: ${minValue}${constraints.unit}` 
    };
  }
  
  if (value > maxValue) {
    return { 
      valid: false, 
      message: `Maximum ${constraintType === 'time' ? 'time' : 'distance'}: ${maxValue}${constraints.unit}` 
    };
  }
  
  return { valid: true, message: 'Valid constraint' };
};

// Starting Location System
export interface StartingLocation {
  type: 'gps' | 'search' | 'saved';
  label: string;
  icon: string;
  description: string;
  microcopy: string;
  requiresPermission?: boolean;
}

export const startingLocationTypes: StartingLocation[] = [
  {
    type: 'gps',
    label: 'Use My Location',
    icon: '📍',
    description: 'Auto-detect via GPS',
    microcopy: 'Most accurate for current location',
    requiresPermission: true
  },
  {
    type: 'search',
    label: 'Search for a Place',
    icon: '🔍',
    description: 'Type in city, area, landmark, or address',
    microcopy: 'Perfect for planning in another city'
  },
  {
    type: 'saved',
    label: 'Saved Locations',
    icon: '⭐',
    description: 'Use saved Home or Work address',
    microcopy: 'Quick access to your places'
  }
];

// Starting Location Logic Functions
export const getStartingLocationLogic = (locationType: string) => {
  const logic: Record<string, { method: string; description: string; accuracy: string }> = {
    'gps': {
      method: 'GPS coordinates from device',
      description: 'Uses device GPS for precise current location',
      accuracy: 'Most accurate for current location'
    },
    'search': {
      method: 'Google Maps Geocoding API',
      description: 'Converts text search to latitude/longitude coordinates',
      accuracy: 'High accuracy with disambiguation for vague names'
    },
    'saved': {
      method: 'Saved user addresses',
      description: 'Uses pre-saved Home or Work addresses',
      accuracy: 'Depends on saved address accuracy'
    }
  };
  
  return logic[locationType] || { 
    method: 'Unknown method', 
    description: 'Unknown location method', 
    accuracy: 'Unknown accuracy' 
  };
};

// Location Disambiguation
export const getLocationDisambiguation = (searchTerm: string) => {
  const ambiguousTerms: Record<string, string[]> = {
    'springfield': ['Springfield, MA', 'Springfield, IL', 'Springfield, MO'],
    'union square': ['Union Square, NYC', 'Union Square, SF'],
    'central park': ['Central Park, NYC', 'Central Park, Chicago'],
    'washington': ['Washington, DC', 'Washington State'],
    'portland': ['Portland, OR', 'Portland, ME'],
    'richmond': ['Richmond, VA', 'Richmond, CA']
  };
  
  const lowerTerm = searchTerm.toLowerCase();
  return ambiguousTerms[lowerTerm] || [];
};

// Human-Friendly Location Display
export const getHumanFriendlyLocation = (location: any) => {
  if (location.type === 'gps') {
    return 'Current Location (GPS)';
  } else if (location.type === 'saved') {
    return `${location.label} (${location.address})`;
  } else {
    return location.displayName || location.address || 'Selected Location';
  }
};

// Location Validation
export const validateStartingLocation = (location: any) => {
  if (!location) {
    return { valid: false, message: 'No location selected' };
  }
  
  if (location.type === 'gps' && (!location.latitude || !location.longitude)) {
    return { valid: false, message: 'GPS location not available' };
  }
  
  if (location.type === 'search' && (!location.latitude || !location.longitude)) {
    return { valid: false, message: 'Search location not found' };
  }
  
  if (location.type === 'saved' && !location.address) {
    return { valid: false, message: 'Saved address not available' };
  }
  
  return { valid: true, message: 'Valid location' };
};

// Quick Location Shortcuts
export const getQuickLocationShortcuts = () => {
  return [
    {
      id: 'home',
      label: 'Home',
      icon: '🏠',
      description: 'Your saved home address',
      color: '#4CAF50'
    },
    {
      id: 'work',
      label: 'Work',
      icon: '🏢',
      description: 'Your saved work address',
      color: '#FF6B35'
    },
    {
      id: 'gps',
      label: 'Use GPS',
      icon: '📍',
      description: 'Current location',
      color: '#FF6B35'
    }
  ];
};

// Location Search Autocomplete
export const getLocationSearchSuggestions = (query: string) => {
  const commonPlaces = [
    'Times Square, NYC',
    'Central Park, NYC',
    'Golden Gate Bridge, SF',
    'Union Square, SF',
    'Millennium Park, Chicago',
    'Pike Place Market, Seattle',
    'French Quarter, New Orleans',
    'Rodeo Drive, Beverly Hills',
    'Las Vegas Strip, NV',
    'Miami Beach, FL'
  ];
  
  if (!query || query.length < 2) {
    return commonPlaces.slice(0, 5);
  }
  
  return commonPlaces.filter(place => 
    place.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);
};

// Map Pin Preview Logic
export const getMapPinPreview = (location: any, constraintType: string, constraintValue: number) => {
  if (!location || !location.latitude || !location.longitude) {
    return null;
  }
  
  return {
    center: {
      latitude: location.latitude,
      longitude: location.longitude
    },
    radius: constraintType === 'distance' ? constraintValue * 1609.34 : null, // Convert miles to meters
    title: getHumanFriendlyLocation(location),
    description: constraintType === 'time' 
      ? `Within ${constraintValue} minutes travel time`
      : `Within ${constraintValue} miles radius`
  };
};
