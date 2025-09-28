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
    slug: 'stroll',
    name: 'Take a Stroll',
    icon: '🚶‍♀️',
    description: 'Light, scenic activities designed for calm conversation or exploration',
    detailedDescription: 'Always paired with a small treat stop (ice cream, street food, or food truck) nearby. Scenic walking routes, promenades, waterfronts, parks, botanical gardens, urban trails, river walks, coastal walks.',
    expectedActivities: [
      'Scenic walking routes, promenades, waterfronts',
      'Parks, botanical gardens, arboretums',
      'Urban trails, river walks, coastal walks'
    ],
    pairedExperiences: [
      'Ice cream shop',
      'Small chops / snack spot',
      'Food truck'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['park', 'trailhead', 'botanical_garden', 'waterfront', 'tourist_attraction'],
        companionAnchors: ['ice_cream_shop', 'street_food', 'food_truck', 'cafe', 'bakery'],
        attributes: ['scenic', 'outdoor', 'peaceful'],
        excludedAttributes: ['loud', 'crowded', 'commercial']
      },
      eventbrite: {
        eventTypes: ['walking_tours', 'outdoor_guided_strolls'],
        tags: ['food_trucks', 'tastings']
      }
    },
    logic: {
      hardFilter: 'Must start with a stroll anchor',
      pairingRule: 'Always attach at least one snack/food stop within a short radius',
      hierarchy: {
        broad: 'Take a Stroll',
        niche: ['Parks & Gardens', 'Waterfront + Ice Cream', 'Park + Food Truck', 'Botanical Garden + Café', 'Urban Stroll + Bakery']
      },
      fallbackBehavior: 'If no snack shop is found within radius, stretch search slightly. If none at all → still show stroll card, but OpenAI frames suggestion: "Bring along snacks — not much nearby."'
    },
    ux: {
      activeColor: '#4CAF50',
      subcategories: ['Parks & Gardens 🌸', 'Waterfront + Ice Cream 🍦🌊', 'Park + Food Truck 🚚🌳', 'Botanical Garden + Café ☕🌸', 'Urban Stroll + Bakery 🥖🏙️'],
      contextualPreview: 'Scenic riverwalk, just 12 minutes from you — finish with gelato at Dolce Vita nearby.'
    },
    activityType: 'mobile',
    duration: 'medium',
    compatibleWith: ['sip', 'wellness'],
    incompatibleWith: ['dining', 'creative', 'nightlife']
  },
  {
    slug: 'sip',
    name: 'Sip & Chill',
    icon: '🍹',
    description: 'Relaxed, lounge-style experiences focused on drinks and ambience',
    detailedDescription: 'Designed for unhurried conversation and vibe. Works well for first dates, romantic evenings, or low-key group hangs. Cocktail bars, speakeasies, wine bars, brewery tours/tastings, 5-star hotel lounges, tea houses, coffee roasteries.',
    expectedActivities: [
      'Cocktail bars, speakeasies',
      'Wine bars',
      'Brewery tours/tastings',
      '5-star hotel lounges',
      'Tea houses',
      'Coffee roasteries'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['bar', 'cafe', 'brewery', 'night_club'],
        attributes: ['romantic', 'quiet', 'upscale'],
        excludedAttributes: ['loud', 'frat_vibe', 'party']
      },
      eventbrite: {
        eventTypes: ['wine_tastings', 'mixology_classes', 'cocktail_making', 'brewery_events']
      }
    },
    logic: {
      hardFilter: 'Must be a venue or event centered on drinks/relaxation',
      hierarchy: {
        broad: 'Sip & Chill',
        niche: ['Cocktail Bars', 'Wine Bars', 'Breweries', 'Speakeasies', 'Hotel Lounges', 'Coffee & Tea']
      },
      fallbackBehavior: 'If no explicitly tagged upscale bars/cafés, show best available "quiet" options and reframe via OpenAI: "Closest match: casual coffee roastery with cozy seating."'
    },
    ux: {
      activeColor: '#9C27B0',
      subcategories: ['Cocktail Bars', 'Wine Bars', 'Breweries', 'Speakeasies', 'Hotel Lounges', 'Coffee & Tea'],
      contextualPreview: 'Cozy speakeasy with candlelit booths — live jazz set at 8pm.'
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['stroll', 'creative', 'culture'],
    incompatibleWith: ['dining', 'wellness', 'nightlife']
  },
  {
    slug: 'casual_eats',
    name: 'Casual Eats',
    icon: '🍕',
    description: 'Affordable, informal, and often quick food experiences',
    detailedDescription: 'Designed for low-stakes, easygoing outings — whether it\'s a casual first meet-up, a group hang, or a spontaneous solo bite. Tacos, pizza, burgers, noodles, ramen, cafés, delis, diners, food trucks and casual pop-ups.',
    expectedActivities: [
      'Tacos, pizza, burgers, noodles, ramen',
      'Cafés, delis, diners',
      'Food trucks and casual pop-ups'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['fast_food', 'casual_restaurant', 'cafe', 'food_truck', 'diner', 'sandwich_shop'],
        attributes: ['inexpensive', 'affordable'],
        excludedAttributes: ['upscale_only', 'fine_dining']
      },
      eventbrite: {
        eventTypes: ['food_festivals', 'casual_street_food_events', 'pop_up_dining_nights']
      }
    },
    logic: {
      hardFilter: 'Must be food-centered and informal in pricing/setting',
      hierarchy: {
        broad: 'Casual Eats',
        niche: ['Tacos', 'Pizza', 'Burgers', 'Noodles/Ramen', 'Food Trucks', 'Diners/Cafés']
      },
      fallbackBehavior: 'If no explicitly casual venues in range, show nearby mid-tier options reframed via OpenAI: "Closest match: ramen shop with $12 bowls, open late."'
    },
    ux: {
      activeColor: '#FF9800',
      subcategories: ['Tacos', 'Pizza', 'Burgers', 'Noodles/Ramen', 'Food Trucks', 'Diners/Cafés'],
      contextualPreview: 'Taco truck by the park — $3 tacos, open until midnight.'
    },
    activityType: 'stationary',
    duration: 'short',
    compatibleWith: ['stroll', 'culture'],
    incompatibleWith: ['dining', 'wellness', 'nightlife']
  },
  {
    slug: 'screen_relax',
    name: 'Screen & Relax',
    icon: '🎬',
    description: 'Experiences where the focus is on watching, listening, or being entertained while seated',
    detailedDescription: 'Designed for laid-back nights where conversation is lighter and the activity is centered around a shared show or performance. Movie theaters, drive-in cinemas, film screenings & festivals, theater plays & stage shows, comedy shows, watch parties & special screenings.',
    expectedActivities: [
      'Movie theaters (blockbusters, indie, arthouse)',
      'Drive-in cinemas',
      'Film screenings & festivals',
      'Theater plays & stage shows',
      'Comedy shows (stand-up, improv)',
      'Watch parties & special screenings'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['movie_theater', 'performing_arts_theater', 'stadium', 'comedy_club'],
        attributes: ['indoor', 'ticketed_seating'],
        excludedAttributes: ['outdoor_only', 'standing_room']
      },
      eventbrite: {
        eventTypes: ['film_festivals', 'theater_productions', 'comedy_nights', 'cultural_screenings']
      }
    },
    logic: {
      hardFilter: 'Must be a cinema, or an event/venue primarily centered around screening or stage performance',
      hierarchy: {
        broad: 'Screen & Relax',
        niche: ['Movies', 'Theater', 'Comedy', 'Drive-in', 'Watch Parties', 'Special Screenings']
      },
      fallbackBehavior: 'If no dedicated screenings nearby, reframe broader entertainment options via OpenAI: "Closest match: small comedy show at a café tonight."'
    },
    ux: {
      activeColor: '#FF6B35',
      subcategories: ['Movies', 'Theater', 'Comedy', 'Drive-in', 'Watch Parties', 'Special Screenings'],
      contextualPreview: 'Indie cinema screening an award-winning film at 7pm.'
    },
    activityType: 'stationary',
    duration: 'medium',
    compatibleWith: ['casual_eats', 'sip'],
    incompatibleWith: ['stroll', 'creative', 'wellness']
  },
  {
    slug: 'creative',
    name: 'Creative & Hands-On',
    icon: '🎨',
    description: 'Interactive workshops and artistic activities where participants create, craft, or learn by doing',
    detailedDescription: 'Designed for dates or group outings that are playful, memorable, and leave participants with something to take home or a new skill to share. Pottery classes, sip & paint nights, candle making, cooking classes, baking workshops, woodworking, glassblowing, jewelry or craft workshops.',
    expectedActivities: [
      'Pottery classes',
      'Sip & Paint nights',
      'Candle making',
      'Cooking classes',
      'Baking workshops',
      'Woodworking',
      'Glassblowing',
      'Jewelry or craft workshops'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['art_studio', 'cultural_center', 'workshop', 'cooking_school'],
        attributes: ['small_group', 'interactive', 'materials_provided'],
        excludedAttributes: ['lecture_only', 'observation_only']
      },
      eventbrite: {
        eventTypes: ['arts_crafts_events', 'creative_workshops', 'cooking_classes']
      }
    },
    logic: {
      hardFilter: 'Must be interactive, with participants directly engaging in creation or hands-on learning',
      hierarchy: {
        broad: 'Creative & Hands-On',
        niche: ['Pottery', 'Sip & Paint', 'Candle Making', 'Cooking/Baking', 'Woodworking', 'Glassblowing']
      },
      fallbackBehavior: 'If no creative classes nearby, reframe casual alternatives via OpenAI: "Closest match: open studio art night where you can sketch or paint freely."'
    },
    ux: {
      activeColor: '#FFC107',
      subcategories: ['Pottery', 'Sip & Paint', 'Candle Making', 'Cooking/Baking', 'Woodworking', 'Glassblowing'],
      contextualPreview: 'Sip & Paint with wine flights — paint your own canvas while sipping.'
    },
    activityType: 'stationary',
    duration: 'long',
    compatibleWith: ['sip', 'culture'],
    incompatibleWith: ['stroll', 'dining', 'wellness', 'nightlife']
  },
  {
    slug: 'play_move',
    name: 'Play & Move',
    icon: '⚽',
    description: 'Active, energetic, or competitive activities designed for fun, movement, and group interaction',
    detailedDescription: 'Works well for friends, group dates, or playful couples who want to do more than just sit and talk. Bowling, climbing/bouldering, skating, trampoline parks, kayaking, paddleboarding, hiking, mini golf, arcades, escape rooms, go-karts, axe throwing, laser tag, pickleball, basketball, tennis, badminton.',
    expectedActivities: [
      'Bowling',
      'Climbing/bouldering',
      'Skating',
      'Trampoline parks',
      'Kayaking, paddleboarding, hiking',
      'Mini golf',
      'Arcades',
      'Escape rooms',
      'Go-karts',
      'Axe throwing',
      'Laser tag',
      'Pickleball, basketball, tennis, badminton'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['bowling_alley', 'stadium', 'gym', 'amusement_center', 'climbing_gym', 'park', 'sports_complex', 'arcade', 'skating_rink'],
        attributes: ['group_capacity', 'team_based_activities', 'active', 'energetic_setting'],
        excludedAttributes: ['sedentary', 'quiet', 'individual_only']
      },
      eventbrite: {
        eventTypes: ['fitness_events', 'recreational_events', 'tournaments', 'group_hikes', 'activity_nights']
      }
    },
    logic: {
      hardFilter: 'Must involve movement, active play, or competition',
      hierarchy: {
        broad: 'Play & Move',
        niche: ['Bowling', 'Climbing/Bouldering', 'Skating', 'Mini Golf', 'Arcades', 'Escape Rooms', 'Team Sports', 'Adventure Activities']
      },
      fallbackBehavior: 'If no formal activities found, reframe casual alternatives via OpenAI: "Closest match: open public basketball courts at Riverside Park."'
    },
    ux: {
      activeColor: '#F44336',
      subcategories: ['Bowling', 'Climbing/Bouldering', 'Skating', 'Mini Golf', 'Arcades', 'Escape Rooms', 'Team Sports', 'Adventure Activities'],
      contextualPreview: 'Escape room challenge — 1-hour mission for 4–6 players.'
    },
    activityType: 'mixed',
    duration: 'medium',
    compatibleWith: ['casual_eats'],
    incompatibleWith: ['sip', 'dining', 'wellness', 'culture']
  },
  {
    slug: 'dining',
    name: 'Dining Experience',
    icon: '🍽️',
    description: 'Elevated or curated dining experiences where the meal itself is the centerpiece',
    detailedDescription: 'Designed for special occasions, romantic nights, or refined group outings. These are sit-down, reservation-driven, and often multi-course or chef-led. Tasting menus, prix fixe dinners, chef\'s counter, omakase, wine pairing dinners, rooftop dining with views.',
    expectedActivities: [
      'Tasting menus',
      'Prix fixe dinners',
      'Chef\'s counter',
      'Omakase',
      'Wine pairing dinners',
      'Rooftop dining with views'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['restaurant'],
        attributes: ['upscale', 'fine_dining', 'reservation_required', 'romantic_ambience', 'scenic_view', 'wine_program'],
        excludedAttributes: ['casual', 'fast_food', 'counter_service']
      },
      eventbrite: {
        eventTypes: ['ticketed_food_wine_events', 'chef_led_dinners', 'special_pop_up_culinary_experiences']
      }
    },
    logic: {
      hardFilter: 'Must be upscale, curated, or chef-led dining',
      hierarchy: {
        broad: 'Dining Experience',
        niche: ['Tasting Menu', 'Prix Fixe', 'Chef\'s Counter', 'Omakase', 'Wine Pairing', 'Rooftop Dining']
      },
      fallbackBehavior: 'If no explicitly fine-dining options nearby, reframe mid-range venues with upscale attributes via OpenAI: "Closest match: modern bistro with prix fixe menu, $65 per person."'
    },
    ux: {
      activeColor: '#8B0000',
      subcategories: ['Tasting Menu', 'Prix Fixe', 'Chef\'s Counter', 'Omakase', 'Wine Pairing', 'Rooftop Dining'],
      contextualPreview: '7-course chef\'s tasting menu with wine pairing — reservations required.'
    },
    activityType: 'stationary',
    duration: 'long',
    compatibleWith: ['culture', 'nightlife'],
    incompatibleWith: ['stroll', 'sip', 'creative', 'wellness']
  },
  {
    slug: 'wellness',
    name: 'Wellness Dates',
    icon: '🧘‍♀️',
    description: 'Mindful, restorative, and health-centered activities designed to help people relax, recharge, and connect',
    detailedDescription: 'Ideal for self-care solo outings, intimate couple experiences, or small group sessions. Yoga classes, meditation sessions, sound baths, spa & massage packages, hot springs / thermal baths, float tanks / hydrotherapy, healthy dining spots, wellness retreats & day passes, nature-immersion.',
    expectedActivities: [
      'Yoga classes (studio, rooftop, outdoor)',
      'Meditation sessions',
      'Sound baths',
      'Spa & massage packages',
      'Hot springs / thermal baths',
      'Float tanks / hydrotherapy',
      'Healthy dining spots (plant-based, farm-to-table, juice bars)',
      'Wellness retreats & day passes',
      'Nature-immersion (forest bathing, sunrise meditations)'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['yoga_studio', 'spa', 'wellness_center', 'massage_therapist', 'health_food_restaurant', 'retreat'],
        attributes: ['wellness_focused', 'mindful', 'restorative'],
        excludedAttributes: ['loud', 'energetic', 'competitive']
      },
      eventbrite: {
        eventTypes: ['health_wellness_events', 'yoga_in_park', 'mindfulness_workshops', 'nutrition_seminars']
      }
    },
    logic: {
      hardFilter: 'Only show cards explicitly tagged as wellness-focused',
      hierarchy: {
        broad: 'Wellness Dates',
        niche: ['Yoga Classes', 'Meditation Sessions', 'Spa/Hot Springs', 'Sound Baths', 'Wellness Retreats', 'Healthy Dining']
      },
      fallbackBehavior: 'If no structured wellness activities are nearby, suggest calm alternatives reframed via OpenAI: "Closest match: quiet botanical garden walk with tea house nearby."'
    },
    ux: {
      activeColor: '#00BCD4',
      subcategories: ['Yoga Classes', 'Meditation Sessions', 'Spa/Hot Springs', 'Sound Baths', 'Wellness Retreats', 'Healthy Dining'],
      contextualPreview: 'Sunset yoga in the park — mats provided, 6pm start.'
    },
    activityType: 'stationary',
    duration: 'medium',
    compatibleWith: ['stroll'],
    incompatibleWith: ['sip', 'dining', 'creative', 'nightlife']
  },
  {
    slug: 'freestyle',
    name: 'Freestyle',
    icon: '🎪',
    description: 'Wildcard mode where Mingla surfaces anything interesting, quirky, or surprising nearby',
    detailedDescription: 'Designed for adventurous users who want discovery, spontaneity, or a "surprise me" experience. Quirky pop-ups, hybrid experiences (karaoke + cocktails, museum nights with DJs), seasonal/holiday events, street fairs, cultural festivals, block parties, art crawls, immersive pop-ups, surprise AI-curated gems.',
    expectedActivities: [
      'Quirky pop-ups',
      'Hybrid experiences (karaoke + cocktails, museum nights with DJs)',
      'Seasonal/holiday events (pumpkin patches, holiday markets, fireworks shows)',
      'Street fairs, cultural festivals, block parties',
      'Art crawls, immersive pop-ups',
      'Surprise AI-curated gems'
    ],
    apiMapping: {
      googleMaps: {
        coreAnchors: ['tourist_attraction', 'event_venue', 'night_club', 'amusement_center', 'cultural_center'],
        attributes: ['unique', 'special', 'event_driven'],
        excludedAttributes: []
      },
      eventbrite: {
        eventTypes: ['festivals', 'pop_ups', 'community_gatherings', 'nightlife_mash_ups']
      }
    },
    logic: {
      hardFilter: 'None — Freestyle accepts any activity type',
      hierarchy: {
        broad: 'Freestyle',
        niche: ['Seasonal Specials', 'Pop-up Events', 'Experimental/Hybrid']
      },
      fallbackBehavior: 'If no unique events found, system defaults to highlighting a top-ranked card from another category and reframes it as a surprise option: "Closest match: karaoke bar with hidden cocktail lounge inside."'
    },
    ux: {
      activeColor: '#E91E63',
      subcategories: ['Seasonal Specials', 'Pop-up Events', 'Experimental/Hybrid'],
      contextualPreview: 'Pop-up ramen fest — live DJ + food stalls until 11pm.'
    },
    activityType: 'mixed',
    duration: 'medium',
    compatibleWith: [],
    incompatibleWith: []
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
