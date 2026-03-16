/**
 * Category Utilities
 * Provides functions to convert category translation keys to readable names
 */

/** Maximum number of category cards a user can select. */
export const MAX_CATEGORIES = 3;

/** Maximum number of curated/intent cards a user can select (radio behavior). */
export const MAX_INTENTS = 1;

/** Cap an intents array to MAX_INTENTS. Use at every load-from-DB and save boundary. */
export const capIntents = (raw: string[]): string[] => raw.slice(0, MAX_INTENTS);

/**
 * Convert translation key to readable category name
 */
export const getReadableCategoryName = (categoryKey: string): string => {
  if (!categoryKey) return 'Experience';
  // Convert translation keys and old slugs to readable names based on new category system
  const categoryMap: Record<string, string> = {
    // New category slugs -> display names
    'nature': 'Nature',
    'first_meet': 'First Meet',
    'picnic_park': 'Picnic',
    'picnic': 'Picnic',
    'drink': 'Drink',
    'casual_eats': 'Casual Eats',
    'fine_dining': 'Fine Dining',
    'watch': 'Watch',
    'creative_arts': 'Creative & Arts',
    'play': 'Play',
    'wellness': 'Wellness',
    'groceries_flowers': 'Groceries & Flowers',
    'groceries & flowers': 'Groceries & Flowers',
    'Groceries & Flowers': 'Groceries & Flowers',
    'work_business': 'Work & Business',
    'work & business': 'Work & Business',
    'Work & Business': 'Work & Business',
    // Legacy translation keys -> new names
    'category.screen_nature': 'Nature',
    'category.screen_drink': 'Drink',
    'category.screen_relax': 'Watch',
    'category.screen_creative': 'Creative & Arts',
    'category.screen_dining': 'Fine Dining',
    'category.screen_wellness': 'Wellness',
    'category.screen_play': 'Play',
    'category.screen_eat': 'Casual Eats',
    'category.screen_social': 'Drink',
    'category.screen_romantic': 'Fine Dining',
    'category.screen_family': 'Nature',
    'category.screen_business': 'Work & Business',
    'category.screen_travel': 'Nature',
    'category.screen_stroll': 'Nature',
    'category.screen_sip': 'Drink',
    'category.screen_shop': 'Creative & Arts',
    'category.screen_learn': 'Creative & Arts',
    'category.screen_exercise': 'Wellness',
    'category.screen_culture': 'Creative & Arts',
    'category.screen_nightlife': 'Play',
    'category.screen_shopping': 'Creative & Arts',
    // Short keys (without category. prefix)
    'screen_nature': 'Nature',
    'screen_drink': 'Drink',
    'screen_relax': 'Watch',
    'screen_creative': 'Creative & Arts',
    'screen_dining': 'Fine Dining',
    'screen_wellness': 'Wellness',
    'screen_play': 'Play',
    'screen_eat': 'Casual Eats',
    'screen_social': 'Drink',
    'screen_romantic': 'Fine Dining',
    'screen_family': 'Nature',
    'screen_business': 'Work & Business',
    'screen_travel': 'Nature',
    'screen_stroll': 'Nature',
    'screen_sip': 'Drink',
    'screen_shop': 'Creative & Arts',
    'screen_learn': 'Creative & Arts',
    'screen_exercise': 'Wellness',
    'screen_culture': 'Creative & Arts',
    'screen_nightlife': 'Play',
    'screen_shopping': 'Creative & Arts',
    // Old slug -> new name fallbacks
    'stroll': 'Nature',
    'sip': 'Drink',
    'sip_and_chill': 'Drink',
    'screen_relax_old': 'Watch',
    'creative': 'Creative & Arts',
    'play_move': 'Play',
    'dining': 'Fine Dining',
    'casual eats': 'Casual Eats',
    'fine dining': 'Fine Dining',
    'creative & arts': 'Creative & Arts',
    'first meet': 'First Meet'
  };
  
  // Check for exact match first
  if (categoryMap[categoryKey]) {
    return categoryMap[categoryKey];
  }
  
  // If it's already a readable name, return as is
  if (!categoryKey.includes('_') && !categoryKey.includes('.')) {
    return categoryKey;
  }
  
  // Fallback: convert to readable format
  return categoryKey.replace('category.', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

/**
 * Get category slug from translation key or category name
 */
export const getCategorySlug = (categoryKey: string): string => {
  if (!categoryKey) return 'experience';
  const readableName = getReadableCategoryName(categoryKey);
  
  // Map readable names to slugs
  const nameToSlugMap: Record<string, string> = {
    'Nature': 'nature',
    'First Meet': 'first_meet',
    'Picnic': 'picnic_park',
    'Drink': 'drink',
    'Casual Eats': 'casual_eats',
    'Fine Dining': 'fine_dining',
    'Watch': 'watch',
    'Creative & Arts': 'creative_arts',
    'Play': 'play',
    'Wellness': 'wellness',
    'Groceries & Flowers': 'groceries_flowers',
    'Work & Business': 'work_business',
    // Legacy names
    'Take a Stroll': 'nature',
    'Sip & Chill': 'drink',
    'Screen & Relax': 'watch',
    'Creative & Hands-On': 'creative_arts',
    'Play & Move': 'play',
    'Dining Experience': 'fine_dining',
    'Dining Experiences': 'fine_dining',
    'Wellness Dates': 'wellness',
    'Freestyle': 'nature',
    'Picnics': 'picnic_park'
  };
  
  return nameToSlugMap[readableName] || readableName.toLowerCase().replace(/\s+/g, '-');
};

/**
 * Get category icon name (used by the Icon component wrapper)
 */
export const getCategoryIcon = (categoryKey: string): string => {
  if (!categoryKey) return 'compass-outline';
  const slug = getCategorySlug(categoryKey);
  
  const iconMap: Record<string, string> = {
    'nature': 'leaf-outline',
    'first_meet': 'chatbubbles-outline',
    'picnic_park': 'basket-outline',
    'picnic': 'basket-outline',
    'drink': 'wine-outline',
    'casual_eats': 'fast-food-outline',
    'fine_dining': 'restaurant-outline',
    'watch': 'film-outline',
    'creative_arts': 'color-palette-outline',
    'play': 'game-controller-outline',
    'wellness': 'body-outline',
    'groceries_flowers': 'cart-outline',
    'work_business': 'briefcase-outline'
  };

  return iconMap[slug] || 'location';
};

/**
 * Normalize a mixed-format category array to deduplicated slug IDs.
 *
 * Handles legacy display names ("Nature"), underscored slugs ("casual_eats"),
 * and any other format that getCategorySlug understands. Returns a unique
 * array of slug IDs capped at `maxCategories`.
 */
const VALID_SLUGS = new Set([
  'nature', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
  'fine_dining', 'watch', 'creative_arts', 'play', 'wellness',
  'groceries_flowers', 'work_business',
]);

export const normalizeCategoryArray = (
  raw: string[],
  maxCategories: number = 3,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const cat of raw) {
    // Fast path: already a valid slug
    let slug = VALID_SLUGS.has(cat) ? cat : getCategorySlug(cat);
    // getCategorySlug returns hyphenated fallback for unknowns — remap to underscore
    slug = slug.replace(/-/g, '_');
    // "picnic" from getCategorySlug → normalize to "picnic_park" (the canonical slug)
    if (slug === 'picnic') slug = 'picnic_park';
    if (!seen.has(slug) && VALID_SLUGS.has(slug)) {
      seen.add(slug);
      result.push(slug);
    }
    if (result.length >= maxCategories) break;
  }
  return result;
};

/**
 * Get category color
 */
export const getCategoryColor = (categoryKey: string): string => {
  if (!categoryKey) return '#6B7280';
  const slug = getCategorySlug(categoryKey);
  
  const colorMap: Record<string, string> = {
    'nature': '#10B981',       // emerald
    'first_meet': '#6366F1',   // indigo
    'picnic_park': '#84CC16',  // lime
    'picnic': '#84CC16',       // lime (legacy alias)
    'drink': '#F59E0B',        // amber
    'casual_eats': '#F97316',  // orange
    'fine_dining': '#7C3AED',  // violet
    'watch': '#3B82F6',        // blue
    'creative_arts': '#EC4899', // pink
    'play': '#EF4444',         // red
    'wellness': '#14B8A6',      // teal
    'groceries_flowers': '#22C55E', // green-500
    'work_business': '#64748B' // slate
  };

  return colorMap[slug] || '#6B7280'; // gray fallback
};
