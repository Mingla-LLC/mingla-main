/**
 * Category Utilities
 * Provides functions to convert category translation keys to readable names
 */

/**
 * Convert translation key to readable category name
 */
export const getReadableCategoryName = (categoryKey: string): string => {
  // Convert translation keys to readable names based on actual category slugs
  const categoryMap: Record<string, string> = {
    // Full translation keys
    'category.screen_relax': 'Sip & Chill',
    'category.screen_eat': 'Dining Experience',
    'category.screen_drink': 'Sip & Chill',
    'category.screen_play': 'Social & Nightlife',
    'category.screen_shop': 'Market & Shopping',
    'category.screen_learn': 'Creative & Hands-On',
    'category.screen_exercise': 'Health & Wellness',
    'category.screen_culture': 'Arts & Culture',
    'category.screen_nature': 'Take a Stroll',
    'category.screen_social': 'Social & Nightlife',
    'category.screen_romantic': 'Dining Experience',
    'category.screen_family': 'Take a Stroll',
    'category.screen_business': 'Dining Experience',
    'category.screen_travel': 'Take a Stroll',
    'category.screen_wellness': 'Health & Wellness',
    'category.screen_stroll': 'Take a Stroll',
    'category.screen_sip': 'Sip & Chill',
    'category.screen_dining': 'Dining Experience',
    'category.screen_creative': 'Creative & Hands-On',
    'category.screen_shopping': 'Market & Shopping',
    'category.screen_nightlife': 'Social & Nightlife',
    // Short keys (without category. prefix)
    'screen_relax': 'Sip & Chill',
    'screen_eat': 'Dining Experience',
    'screen_drink': 'Sip & Chill',
    'screen_play': 'Social & Nightlife',
    'screen_shop': 'Market & Shopping',
    'screen_learn': 'Creative & Hands-On',
    'screen_exercise': 'Health & Wellness',
    'screen_culture': 'Arts & Culture',
    'screen_nature': 'Take a Stroll',
    'screen_social': 'Social & Nightlife',
    'screen_romantic': 'Dining Experience',
    'screen_family': 'Take a Stroll',
    'screen_business': 'Dining Experience',
    'screen_travel': 'Take a Stroll',
    'screen_wellness': 'Health & Wellness',
    'screen_stroll': 'Take a Stroll',
    'screen_sip': 'Sip & Chill',
    'screen_dining': 'Dining Experience',
    'screen_creative': 'Creative & Hands-On',
    'screen_shopping': 'Market & Shopping',
    'screen_nightlife': 'Social & Nightlife'
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
  const readableName = getReadableCategoryName(categoryKey);
  
  // Map readable names to slugs
  const nameToSlugMap: Record<string, string> = {
    'Sip & Chill': 'sip',
    'Dining Experience': 'dining',
    'Social & Nightlife': 'nightlife',
    'Market & Shopping': 'shopping',
    'Creative & Hands-On': 'creative',
    'Health & Wellness': 'wellness',
    'Arts & Culture': 'culture',
    'Take a Stroll': 'stroll'
  };
  
  return nameToSlugMap[readableName] || readableName.toLowerCase().replace(/\s+/g, '-');
};

/**
 * Get category icon name for Ionicons
 */
export const getCategoryIcon = (categoryKey: string): string => {
  const slug = getCategorySlug(categoryKey);
  
  const iconMap: Record<string, string> = {
    'stroll': 'walk',
    'sip': 'cafe',
    'dining': 'restaurant',
    'creative': 'brush',
    'shopping': 'bag',
    'wellness': 'fitness',
    'culture': 'library',
    'nightlife': 'wine'
  };
  
  return iconMap[slug] || 'location';
};

/**
 * Get category color
 */
export const getCategoryColor = (categoryKey: string): string => {
  const slug = getCategorySlug(categoryKey);
  
  const colorMap: Record<string, string> = {
    'stroll': '#10B981', // green
    'sip': '#F59E0B', // amber
    'dining': '#EF4444', // red
    'creative': '#8B5CF6', // purple
    'shopping': '#3B82F6', // blue
    'wellness': '#06B6D4', // cyan
    'culture': '#EC4899', // pink
    'nightlife': '#6366F1' // indigo
  };
  
  return colorMap[slug] || '#6B7280'; // gray fallback
};
