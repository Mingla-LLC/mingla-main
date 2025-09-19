// Category to Google Places API types mapping
export const CATEGORY_TO_PLACE_TYPES: Record<string, string[]> = {
  // Take a Stroll
  'stroll': [
    'park',
    'tourist_attraction', 
    'point_of_interest',
    'natural_feature',
    'zoo',
    'aquarium',
    'botanical_garden'
  ],
  
  // Sip & Chill  
  'sip': [
    'bar',
    'cafe', 
    'night_club',
    'wine_bar',
    'coffee_shop',
    'tea_house',
    'hookah_bar'
  ],
  
  // Casual Eats
  'casual_eats': [
    'restaurant',
    'food_court',
    'meal_takeaway',
    'fast_food_restaurant',
    'food_truck',
    'sandwich_shop',
    'pizza_restaurant'
  ],
  
  // Screen & Relax
  'screen_relax': [
    'movie_theater',
    'spa',
    'beauty_salon',
    'massage_therapist',
    'nail_salon'
  ],
  
  // Creative & Hands-On
  'creative': [
    'art_gallery',
    'museum',
    'pottery_studio',
    'craft_store',
    'art_studio',
    'jewelry_store',
    'antique_store'
  ],
  
  // Play & Move
  'play_move': [
    'bowling_alley',
    'gym',
    'sports_complex',
    'recreation_center',
    'tennis_court',
    'basketball_court',
    'golf_course',
    'mini_golf',
    'climbing_gym',
    'skating_rink'
  ],
  
  // Dining Experience  
  'dining': [
    'restaurant',
    'fine_dining_restaurant',
    'steakhouse',
    'seafood_restaurant',
    'italian_restaurant',
    'french_restaurant',
    'sushi_restaurant'
  ],
  
  // Freestyle - union of popular types
  'freestyle': [
    'restaurant',
    'bar',
    'cafe',
    'tourist_attraction',
    'art_gallery',
    'museum',
    'park',
    'movie_theater',
    'bowling_alley',
    'spa'
  ]
};

// Eventbrite category mapping
export const CATEGORY_TO_EVENTBRITE: Record<string, string[]> = {
  'creative': ['103', '104'], // Arts & Culture, Crafts
  'screen_relax': ['105'], // Film & Media
  'dining': ['110'], // Food & Drink  
  'play_move': ['108'], // Sports & Fitness
  'sip': ['110'], // Food & Drink
  'freestyle': ['103', '104', '105', '108', '110', '113'] // Mix of popular categories
};

export function getPlaceTypesForCategory(category: string): string[] {
  return CATEGORY_TO_PLACE_TYPES[category] || ['tourist_attraction'];
}

export function getEventbriteCategories(category: string): string[] {
  return CATEGORY_TO_EVENTBRITE[category] || [];
}