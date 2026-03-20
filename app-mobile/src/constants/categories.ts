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
    name: 'Nature & Views',
    icon: '🌿',
    description: 'Natural landscapes — parks, lakes, hiking trails, scenic views, and wildlife',
    detailedDescription: 'National parks, lakes, rivers, mountain peaks, hiking trails, botanical gardens, scenic spots, observation decks, and wildlife areas. Perfect for fresh air, adventure, and connection with the outdoors.',
    expectedActivities: [
      'Parks, gardens, national parks, and state parks',
      'Lakes, rivers, mountains, and scenic spots',
      'Hiking trails, campgrounds, and wildlife areas',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'national_park', 'state_park', 'nature_preserve', 'wildlife_refuge',
          'wildlife_park', 'scenic_spot', 'garden', 'botanical_garden',
          'park', 'lake', 'river', 'island', 'mountain_peak',
          'woods', 'hiking_area', 'campground', 'picnic_ground',
        ],
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
        broad: 'Nature & Views',
        niche: ['Parks & Gardens', 'Lakes & Rivers', 'Mountains & Hiking', 'Wildlife & Reserves']
      },
      fallbackBehavior: 'If no nature spots within range, suggest closest park or botanical garden.'
    },
    ux: {
      activeColor: '#10B981',
      subcategories: ['Parks & Gardens', 'Lakes & Rivers', 'Mountains & Hiking', 'Wildlife & Reserves'],
      contextualPreview: 'A beautiful lake just 15 minutes away — perfect for a peaceful outing.'
    },
    activityType: 'mobile',
    duration: 'medium',
    compatibleWith: ['picnic_park', 'wellness', 'creative_arts'],
    incompatibleWith: ['watch', 'fine_dining', 'play']
  },
  {
    slug: 'first_meet',
    name: 'First Meet',
    icon: '🤝',
    description: 'Cafés, activities, and cultural spots — perfect for meeting someone new',
    detailedDescription: 'Coffee shops, bookstores, bowling alleys, arcades, art galleries, parks, museums, and more. Low-pressure venues mixing conversation, fun activities, and cultural outings for a memorable first meeting.',
    expectedActivities: [
      'Cafés, tea houses, bookstores, and bakeries',
      'Bowling, mini golf, arcades, and karaoke',
      'Parks, galleries, museums, and botanical gardens',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'cafe', 'bowling_alley', 'park',
          'coffee_shop', 'miniature_golf_course', 'art_gallery',
          'tea_house', 'video_arcade', 'museum',
          'book_store', 'amusement_center', 'botanical_garden',
          'bakery', 'go_karting_venue', 'cultural_center',
          'dessert_shop', 'karaoke', 'plaza',
          'ice_cream_shop', 'comedy_club', 'tourist_attraction',
          'juice_shop', 'paintball_center', 'art_museum',
          'donut_shop', 'dance_hall', 'garden',
          'breakfast_restaurant', 'brunch_restaurant',
        ],
        attributes: ['quiet', 'conversational', 'relaxed', 'fun', 'cultural'],
        excludedAttributes: [
          'night_club', 'bar', 'fine_dining_restaurant',
          'water_park', 'indoor_playground', 'church',
        ],
      },
      eventbrite: {
        eventTypes: ['social_events', 'networking', 'casual_meetups']
      }
    },
    logic: {
      hardFilter: 'Must be a low-pressure venue suitable for a first meeting',
      hierarchy: {
        broad: 'First Meet',
        niche: ['Cafés & Coffee', 'Fun Activities', 'Culture & Outdoors']
      },
      fallbackBehavior: 'If no activity or cultural venue found, show nearest café or coffee shop.'
    },
    ux: {
      activeColor: '#6366F1',
      subcategories: ['Cafés & Coffee', 'Fun Activities', 'Culture & Outdoors'],
      contextualPreview: 'Indie bookstore with a café corner, bowling alley, or art gallery nearby — pick your vibe.'
    },
    activityType: 'mixed',
    duration: 'short',
    compatibleWith: ['drink', 'watch', 'creative_arts'],
    incompatibleWith: ['wellness', 'picnic_park']
  },
  {
    slug: 'picnic_park',
    name: 'Picnic Park',
    icon: '🧺',
    description: 'Parks, picnic grounds, botanical gardens, and nature preserves for outdoor dining',
    detailedDescription: 'Parks, city parks, picnic grounds, state parks, botanical gardens, gardens, and nature preserves. Perfect for a relaxed outdoor meal with scenic views, walking trails, and open green spaces.',
    expectedActivities: [
      'Parks and picnic grounds with tables and shelters',
      'Botanical gardens and nature preserves for scenic picnics',
      'State parks and city parks with open green spaces',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['park', 'city_park', 'picnic_ground', 'state_park', 'botanical_garden', 'garden', 'nature_preserve'],
        attributes: ['outdoor', 'open_space', 'family_friendly'],
        excludedAttributes: [
          'gym', 'fitness_center', 'sports_complex', 'stadium',
          'amusement_park', 'amusement_center', 'casino', 'night_club',
          'shopping_mall', 'parking', 'zoo', 'aquarium',
        ],
      },
      eventbrite: {
        eventTypes: ['outdoor_events', 'picnics', 'garden_events']
      }
    },
    logic: {
      hardFilter: 'Must be an outdoor park, garden, or nature preserve suitable for picnics',
      hierarchy: {
        broad: 'Picnic Park',
        niche: ['Parks', 'Picnic Grounds', 'Botanical Gardens', 'Nature Preserves']
      },
      fallbackBehavior: 'If no park or picnic ground nearby, show closest available outdoor venue.'
    },
    ux: {
      activeColor: '#84CC16',
      subcategories: ['Parks', 'Picnic Grounds', 'Botanical Gardens', 'Nature Preserves'],
      contextualPreview: 'Scenic park with picnic tables — perfect for an outdoor meal.'
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
    description: 'Bars, cocktail bars, breweries, coffee shops, tea houses, and more',
    detailedDescription: 'Drink-focused venues — bars, cocktail bars, beer gardens, breweries, coffee shops, coffee roasteries, tea houses, and juice bars. Works for first dates, group hangs, and casual social outings.',
    expectedActivities: [
      'Bars, cocktail bars, and beer gardens',
      'Breweries, pubs, and nightlife',
      'Coffee shops, tea houses, and juice bars'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'bar', 'coffee_shop', 'cocktail_bar', 'coffee_roastery',
          'wine_bar', 'coffee_stand', 'brewery', 'tea_house',
          'pub', 'juice_shop', 'beer_garden', 'brewpub', 'lounge_bar', 'night_club',
        ],
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
        niche: ['Cocktail Bars', 'Wine Bars', 'Pubs', 'Breweries', 'Beer Gardens', 'Coffee Shops', 'Tea Houses', 'Juice Bars']
      },
      fallbackBehavior: 'If no specialty bar found, show nearest coffee shop or pub.'
    },
    ux: {
      activeColor: '#F59E0B',
      subcategories: ['Cocktail Bars', 'Wine Bars', 'Pubs', 'Breweries', 'Beer Gardens', 'Coffee Shops', 'Tea Houses', 'Juice Bars'],
      contextualPreview: 'Cozy wine bar with a curated list — perfect for unwinding.'
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['first_meet', 'casual_eats', 'fine_dining', 'watch', 'play', 'creative_arts', 'picnic_park'],
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
          'vegetarian_restaurant', 'vietnamese_restaurant', 'chinese_restaurant', 'steak_house',
          'french_restaurant', 'greek_restaurant', 'italian_restaurant'
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
    compatibleWith: ['drink', 'watch', 'play', 'picnic_park'],
    incompatibleWith: ['wellness', 'fine_dining']
  },
  {
    slug: 'fine_dining',
    name: 'Fine Dining',
    icon: '🍽️',
    description: 'Elevated dining — steakhouses, French, seafood, Mediterranean, Spanish, tapas, bistros, and fine dining restaurants',
    detailedDescription: 'Curated, sit-down dining experiences centered on quality. Fine dining restaurants, steakhouses, French, seafood, Mediterranean, Spanish, tapas, oyster bars, bistros, gastropubs, and wine bars for special occasions and refined outings.',
    expectedActivities: [
      'Fine dining restaurants and steakhouses',
      'French, seafood, Mediterranean, and Spanish restaurants',
      'Tapas, oyster bars, bistros, gastropubs, and wine bars'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'fine_dining_restaurant', 'french_restaurant', 'steak_house',
          'seafood_restaurant', 'mediterranean_restaurant', 'spanish_restaurant',
          'tapas_restaurant', 'oyster_bar_restaurant', 'bistro',
          'gastropub', 'wine_bar',
        ],
        attributes: ['upscale', 'refined', 'reservation_recommended'],
        excludedAttributes: ['fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant', 'sandwich_shop', 'food_court', 'buffet_restaurant', 'diner']
      },
      eventbrite: {
        eventTypes: ['chef_led_dinners', 'wine_pairing_events', 'fine_dining_events']
      }
    },
    logic: {
      hardFilter: 'Must be upscale or chef-led dining',
      hierarchy: {
        broad: 'Fine Dining',
        niche: ['Steakhouses', 'French', 'Seafood', 'Mediterranean', 'Spanish', 'Tapas', 'Bistros', 'Gastropubs', 'Fine Dining Restaurants']
      },
      fallbackBehavior: 'If no fine dining options, reframe best mid-range option nearby.'
    },
    ux: {
      activeColor: '#7C3AED',
      subcategories: ['Steakhouses', 'French', 'Seafood', 'Mediterranean', 'Spanish', 'Tapas', 'Bistros', 'Gastropubs', 'Fine Dining Restaurants'],
      contextualPreview: 'Intimate Italian bistro with a prix fixe menu — reservations recommended.'
    },
    activityType: 'stationary',
    duration: 'long',
    compatibleWith: ['drink', 'watch'],
    incompatibleWith: ['casual_eats', 'picnic_park', 'play', 'nature']
  },
  {
    slug: 'watch',
    name: 'Watch',
    icon: '🎬',
    description: 'Movie theaters for a fun shared evening',
    detailedDescription: 'Movie theaters for a classic, low-effort outing. Grab popcorn and enjoy the latest releases or indie screenings together.',
    expectedActivities: [
      'Movie theaters and cinema screenings',
      'Indie films and special screenings',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'movie_theater',
        ],
        attributes: ['entertainment', 'indoor', 'seated'],
        excludedAttributes: [
          'amusement_park', 'amusement_center', 'video_arcade',
          'bowling_alley', 'paintball_center', 'go_karting_venue',
          'miniature_golf_course', 'skateboard_park',
          'gym', 'fitness_center', 'sports_complex', 'sports_club',
          'stadium', 'race_course', 'tennis_court', 'swimming_pool',
          'shopping_mall', 'department_store', 'electronics_store',
          'furniture_store', 'warehouse_store', 'store', 'market',
          'food_store', 'supermarket', 'grocery_store',
          'parking', 'parking_lot', 'parking_garage',
          'bus_station', 'train_station', 'transit_station', 'airport',
          'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
          'sandwich_shop', 'food_court', 'buffet_restaurant', 'diner',
        ]
      },
      eventbrite: {
        eventTypes: ['film_screenings', 'movie_events']
      }
    },
    logic: {
      hardFilter: 'Must be a movie theater',
      hierarchy: {
        broad: 'Watch',
        niche: ['Movies', 'Special Screenings']
      },
      fallbackBehavior: 'If no movie theater found, show nearest cinema.'
    },
    ux: {
      activeColor: '#3B82F6',
      subcategories: ['Movies', 'Special Screenings'],
      contextualPreview: 'New release at the cinema tonight — showtime at 7pm.'
    },
    activityType: 'stationary',
    duration: 'medium',
    compatibleWith: ['drink', 'casual_eats', 'fine_dining', 'first_meet'],
    incompatibleWith: ['nature', 'picnic_park', 'wellness']
  },
  {
    slug: 'live_performance',
    name: 'Live Performance',
    icon: '🎭',
    description: 'Concert halls, theaters, opera houses, and live shows',
    detailedDescription: 'Live entertainment venues — performing arts theaters, concert halls, opera houses, philharmonic halls, and amphitheatres for unforgettable shared experiences.',
    expectedActivities: [
      'Concert halls and live music',
      'Opera houses and performing arts theaters',
      'Amphitheatres and philharmonic halls',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'performing_arts_theater', 'concert_hall', 'opera_house',
          'philharmonic_hall', 'amphitheatre',
        ],
        attributes: ['live', 'performance', 'entertainment'],
        excludedAttributes: [
          'museum', 'art_gallery', 'bar', 'restaurant', 'gym',
        ],
      },
      eventbrite: {
        eventTypes: ['concerts', 'theater', 'opera', 'live_music'],
      },
    },
    logic: {
      hardFilter: 'Must be a live performance venue',
      hierarchy: {
        broad: 'Live Performance',
        niche: ['Concert Halls', 'Theaters', 'Opera Houses', 'Amphitheatres'],
      },
      fallbackBehavior: 'If no live performance venue found, show nearest concert hall or theater.',
    },
    ux: {
      activeColor: '#8B5CF6',
      subcategories: ['Concert Halls', 'Theaters', 'Opera Houses', 'Amphitheatres'],
      contextualPreview: 'Live show at the theater tonight — doors at 7pm.',
    },
    activityType: 'stationary',
    duration: 'medium',
    compatibleWith: ['drink', 'fine_dining', 'casual_eats'],
    incompatibleWith: ['nature', 'picnic_park', 'wellness'],
  },
  {
    slug: 'creative_arts',
    name: 'Creative & Arts',
    icon: '🎨',
    description: 'Art galleries, museums, cultural landmarks, performing arts, comedy clubs, and live music',
    detailedDescription: 'Venues for art lovers and curious minds. Art galleries, museums, history museums, sculpture gardens, cultural centers, performing arts theaters, opera houses, comedy clubs, and live music venues.',
    expectedActivities: [
      'Art galleries, museums, and history museums',
      'Performing arts theaters and opera houses',
      'Comedy clubs and live music venues',
      'Cultural centers and landmarks',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
          'sculpture', 'cultural_center', 'cultural_landmark',
          'performing_arts_theater', 'opera_house', 'auditorium',
          'amphitheatre', 'comedy_club', 'live_music_venue',
        ],
        attributes: ['creative', 'cultural', 'inspiring'],
        excludedAttributes: [
          'fast_food_restaurant', 'bar', 'bowling_alley', 'spa',
          'amusement_park', 'water_park', 'night_club',
          'shopping_mall', 'gym', 'fitness_center',
        ]
      },
      eventbrite: {
        eventTypes: ['art_events', 'museum_nights', 'cultural_events', 'creative_workshops']
      }
    },
    logic: {
      hardFilter: 'Must be a creative or cultural venue',
      hierarchy: {
        broad: 'Creative & Arts',
        niche: ['Art Galleries', 'Museums', 'Performing Arts', 'Comedy & Live Music', 'Cultural Landmarks']
      },
      fallbackBehavior: 'If no gallery or museum found, show nearest performing arts theater or cultural center.'
    },
    ux: {
      activeColor: '#EC4899',
      subcategories: ['Art Galleries', 'Museums', 'Performing Arts', 'Comedy & Live Music', 'Cultural Landmarks'],
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
    description: 'Bowling, arcades, amusement parks, go-karting, dance halls, casinos, and more',
    detailedDescription: 'High-energy, fun-first venues for groups and couples who want to move, compete, and laugh. Bowling alleys, arcades, amusement parks, go-karting, mini golf, ice skating, dance halls, casinos, and cycling parks.',
    expectedActivities: [
      'Bowling, mini golf, ice skating, go-karting',
      'Arcades, paintball, skateboarding',
      'Amusement parks, water parks, roller coasters',
      'Dance halls, karaoke, casinos, cycling parks',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: [
          'amusement_center', 'amusement_park', 'bowling_alley', 'miniature_golf_course',
          'go_karting_venue', 'paintball_center', 'video_arcade', 'skateboard_park',
          'indoor_playground', 'karaoke', 'dance_hall', 'ice_skating_rink',
          'cycling_park', 'roller_coaster', 'water_park', 'ferris_wheel',
          'casino', 'planetarium',
        ],
        attributes: ['active', 'fun', 'group_friendly'],
        excludedAttributes: [
          'shopping_mall', 'department_store', 'art_gallery', 'museum',
          'fast_food_restaurant', 'food_court', 'parking', 'spa',
        ]
      },
      eventbrite: {
        eventTypes: ['recreational_events', 'game_nights', 'group_activities']
      }
    },
    logic: {
      hardFilter: 'Must be an active, game-based, or entertainment venue',
      hierarchy: {
        broad: 'Play',
        niche: ['Bowling', 'Arcades', 'Go-Karting', 'Mini Golf', 'Amusement Parks', 'Ice Skating', 'Dance Halls', 'Casinos']
      },
      fallbackBehavior: 'If no dedicated play venue found, show nearest bowling alley, arcade, or amusement center.'
    },
    ux: {
      activeColor: '#EF4444',
      subcategories: ['Bowling', 'Arcades', 'Go-Karting', 'Mini Golf', 'Amusement Parks', 'Ice Skating', 'Dance Halls', 'Casinos'],
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
    description: 'Spas, massage spas, saunas, and resort hotels for relaxation and rejuvenation',
    detailedDescription: 'Restorative experiences centered on calm and self-care. Spas, massage spas, saunas, and resort hotels for solo or shared relaxation.',
    expectedActivities: [
      'Spas and massage spas',
      'Saunas and steam rooms',
      'Resort hotel wellness packages',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['spa', 'massage_spa', 'massage', 'sauna', 'resort_hotel'],
        attributes: ['relaxing', 'restorative', 'mindful'],
        excludedAttributes: [
          'gym', 'fitness_center', 'night_club', 'casino',
          'bowling_alley', 'amusement_park', 'shopping_mall',
          'doctor', 'hospital', 'medical_clinic',
        ]
      },
      eventbrite: {
        eventTypes: ['wellness_events', 'spa_days', 'mindfulness_workshops']
      }
    },
    logic: {
      hardFilter: 'Must be a wellness or spa venue',
      hierarchy: {
        broad: 'Wellness',
        niche: ['Spas', 'Massage Spas', 'Saunas', 'Resort Wellness']
      },
      fallbackBehavior: 'If no spa found, suggest nearest massage spa, sauna, or resort hotel.'
    },
    ux: {
      activeColor: '#14B8A6',
      subcategories: ['Spas', 'Massage Spas', 'Saunas', 'Resort Wellness'],
      contextualPreview: 'Spa day with sauna access — book a couples package.'
    },
    activityType: 'stationary',
    duration: 'long',
    compatibleWith: ['nature'],
    incompatibleWith: ['play', 'drink', 'watch', 'casual_eats', 'fine_dining']
  },
  {
    slug: 'flowers',
    name: 'Flowers',
    icon: '💐',
    description: 'Florists, flower shops, and fresh bouquets',
    detailedDescription: 'Florists and flower shops for fresh bouquets, arrangements, and surprise gifts. Perfect as a stop before a date or special occasion.',
    expectedActivities: [
      'Florists and flower shops',
      'Fresh bouquets and arrangements',
      'Gift flowers for special occasions',
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['florist', 'grocery_store', 'supermarket'],
        attributes: ['flowers', 'fresh', 'gifts'],
        excludedAttributes: [
          'restaurant', 'bar', 'gym', 'shopping_mall',
        ],
      },
      eventbrite: {
        eventTypes: [],
      },
    },
    logic: {
      hardFilter: 'Must be a florist or store with fresh flowers',
      hierarchy: {
        broad: 'Flowers',
        niche: ['Florists', 'Flower Shops'],
      },
      fallbackBehavior: 'If no florist found, show nearest grocery store with a floral department.',
    },
    ux: {
      activeColor: '#F472B6',
      subcategories: ['Florists', 'Flower Shops'],
      contextualPreview: 'Fresh roses from a local florist — 5 minutes away.',
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['fine_dining', 'first_meet', 'nature', 'picnic_park'],
    incompatibleWith: ['play', 'watch'],
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
    'nature': {
      'first-date': 'Scenic park walk + gelato nearby — low pressure, easy conversation.',
      'romantic': 'Sunset stroll along the waterfront ending at a cozy wine bar.',
      'adventurous': 'Botanical garden stroll with coffee to-go from nearby café.',
      'group-fun': 'City mural walk with food truck rally at the finish line.',
      'picnic-dates': 'Picnic blanket in the botanical garden with a cheese board.',
      'take-a-stroll': 'Nature trail loop with café bookend at the trailhead.'
    },
    'drink': {
      'first-date': 'Speakeasy with soft lighting and quiet booths — great for conversation.',
      'romantic': 'Wine bar with a 6-glass tasting flight and live acoustic music.',
      'adventurous': 'Specialty coffee roastery — perfect for journaling or reading.',
      'group-fun': 'Cocktail lounge with large tables and happy hour pitchers.',
      'picnic-dates': 'Grab-and-go juice bar near the park.',
      'take-a-stroll': 'Coffee shop with a scenic walk to get there.'
    },
    'casual_eats': {
      'first-date': 'Casual ramen shop — low-key and easy for a first meet.',
      'romantic': 'Late-night taco truck crawl for two under string lights.',
      'adventurous': 'Hole-in-the-wall noodle shop — counter seating, quick service.',
      'group-fun': 'Pizza-by-the-slice joint with outdoor benches for the crew.',
      'picnic-dates': 'Deli sandwich pickup before heading to the park.',
      'take-a-stroll': 'Casual café — grab a bite, walk, and come back for dessert.'
    },
    'watch': {
      'first-date': 'Indie cinema showing a cult classic at 7pm.',
      'romantic': 'Drive-in double feature — bring blankets and snacks.',
      'adventurous': 'Arthouse screening — perfect for solo movie lovers.',
      'group-fun': 'Big-screen watch party of the championship game.',
      'picnic-dates': 'Outdoor movie screening with picnic blankets.',
      'take-a-stroll': 'Evening walk to the neighborhood cinema.'
    },
    'creative_arts': {
      'first-date': 'Sip & Paint night with wine included — playful and low-stakes.',
      'romantic': 'Couples pottery class — make something together to keep.',
      'adventurous': 'Saturday candle-making workshop — take home your own creation.',
      'group-fun': 'Escape-room style craft workshop — collaborate on a challenge.',
      'picnic-dates': 'Flower-arranging workshop then picnic with your bouquet.',
      'take-a-stroll': 'Gallery walk with a café stop to sketch what you saw.'
    },
    'play': {
      'first-date': 'Glow-in-the-dark mini golf — fun, flirty, and interactive.',
      'romantic': 'Evening skate date — rent skates and glide under the lights.',
      'adventurous': 'Solo bouldering session — day pass includes gear rental.',
      'group-fun': 'Bowling alley with neon lights — lane reservations for 6.',
      'picnic-dates': 'Frisbee in the park followed by a picnic spread.',
      'take-a-stroll': 'Playground park with a food truck loop.'
    },
    'fine_dining': {
      'first-date': 'Modern bistro with prix fixe menu, $65 per person.',
      'romantic': 'Omakase counter with 10 seats — chef\'s choice, candlelit ambience.',
      'adventurous': 'Seasonal tasting menu at chef\'s counter — perfect for solo foodies.',
      'group-fun': 'Wine-pairing dinner with large communal table.',
      'picnic-dates': 'Charcuterie board to-go from the bistro, eaten parkside.',
      'take-a-stroll': 'Fine dining with a scenic waterfront walk to get there.'
    },
    'wellness': {
      'first-date': 'Couples yoga followed by herbal tea lounge.',
      'romantic': 'Day spa package with sauna + massage for two.',
      'adventurous': 'Sunset yoga in the park — solo mats welcome.',
      'group-fun': 'Wellness retreat day pass — yoga, meditation, and healthy lunch.',
      'picnic-dates': 'Outdoor yoga session then picnic under the trees.',
      'take-a-stroll': 'Mindfulness walk through the gardens with tea afterward.'
    },
    'first_meet': {
      'first-date': 'Cozy café with board games — low-stakes and easy to chat.',
      'romantic': 'Wine-and-cheese tasting in a candlelit cellar.',
      'adventurous': 'Quirky themed café — conversation starters built in.',
      'group-fun': 'Trivia night at the local pub — team up and compete.',
      'picnic-dates': 'Farmers market browse then park bench chat.',
      'take-a-stroll': 'Coffee walk through the neighborhood — keep it casual.'
    },
    'picnic_park': {
      'first-date': 'Picnic blanket by the lake with sandwiches and lemonade.',
      'romantic': 'Sunset picnic with wine, cheese, and fairy lights.',
      'adventurous': 'Solo picnic with a good book at the botanical garden.',
      'group-fun': 'BBQ picnic at the park pavilion — games and grilling.',
      'picnic-dates': 'Full picnic spread at the nicest park in town.',
      'take-a-stroll': 'Picnic spot with a walking trail loop nearby.'
    },
    'live_performance': {
      'first-date': 'Comedy show with great energy — perfect ice breaker.',
      'romantic': 'Orchestra concert followed by a late-night drink.',
      'adventurous': 'Open-mic night — you might even get on stage.',
      'group-fun': 'Concert with the crew — grab floor tickets.',
      'picnic-dates': 'Outdoor amphitheatre show with blankets and snacks.',
      'take-a-stroll': 'Evening walk to the theater district for a live show.'
    },
    'flowers': {
      'first-date': 'Farmers market stroll — sample together, buy flowers.',
      'romantic': 'Pick up a bouquet on the way to surprise your date.',
      'adventurous': 'Artisan florist workshop — arrange your own bouquet.',
      'group-fun': 'Flower market haul then brunch with the crew.',
      'picnic-dates': 'Grab fresh flowers for the picnic spread.',
      'take-a-stroll': 'Flower shop visit on a neighborhood walk.'
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
  type: 'time';
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
    microcopy: 'Adjusts for traffic & transit schedules',
    defaultValues: {
      walk: 10,
      drive: 20,
      transit: 30
    },
    unit: 'minutes'
  },
];

// Travel Constraint Logic Functions
export const getTravelConstraintLogic = (_constraintType: string, travelMode: string) => {
  const logic: Record<string, { filter: string; description: string }> = {
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
    },
  };

  return logic[travelMode] || {
    filter: 'all available venues',
    description: 'Show all available venues'
  };
};

// Human-Friendly Constraint Display
export const getHumanFriendlyConstraint = (value: number) => {
  return `Keep it under ${value} minutes to get there`;
};

// Card Preview Constraint Display
export const getCardPreviewConstraint = (travelTime: string, userLimit: number) => {
  return `${travelTime}, within your ${userLimit} min limit`;
};

// Constraint Validation
export const validateTravelConstraint = (value: number, travelMode: string) => {
  const constraints = travelConstraints[0]; // Always time
  const defaults = constraints.defaultValues[travelMode as keyof typeof constraints.defaultValues];
  const minValue = Math.max(1, defaults * 0.5);
  const maxValue = defaults * 3;

  if (value < minValue) {
    return {
      valid: false,
      message: `Minimum time: ${minValue} ${constraints.unit}`
    };
  }

  if (value > maxValue) {
    return {
      valid: false,
      message: `Maximum time: ${maxValue} ${constraints.unit}`
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
    radius: null,
    title: getHumanFriendlyLocation(location),
    description: `Within ${constraintValue} minutes travel time`
  };
};

export const CURATED_EXPERIENCES = [
  {
    id: 'adventurous',
    displayName: 'Adventurous',
    icon: 'compass-outline',
    color: '#F59E0B',
    description: 'Explore your city — great for adventurous souls',
    isImplemented: true,
  },
  {
    id: 'first-date',
    displayName: 'First Date',
    icon: 'people-outline',
    color: '#6366F1',
    description: 'Low-pressure, memorable first impressions',
    isImplemented: true,
  },
  {
    id: 'romantic',
    displayName: 'Romantic',
    icon: 'heart-outline',
    color: '#EC4899',
    description: 'A curated romantic evening',
    isImplemented: true,
  },
  {
    id: 'group-fun',
    displayName: 'Group Fun',
    icon: 'people-circle-outline',
    color: '#EF4444',
    description: 'Activities everyone will enjoy',
    isImplemented: true,
  },
  {
    id: 'picnic-dates',
    displayName: 'Picnic Dates',
    icon: 'basket-outline',
    color: '#84CC16',
    description: 'Grab supplies, find the perfect spot',
    isImplemented: true,
  },
  {
    id: 'take-a-stroll',
    displayName: 'Take a Stroll',
    icon: 'walk-outline',
    color: '#10B981',
    description: 'A scenic walk bookended by great food',
    isImplemented: true,
  },
] as const;
