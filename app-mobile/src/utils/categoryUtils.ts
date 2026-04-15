/**
 * Category Utilities
 * Provides functions to convert category translation keys to readable names.
 * 10 categories: 8 visible + 2 hidden (Groceries, Flowers). ORCH-0434.
 */
import i18n from '../i18n';

// ORCH-0424: Selection limits removed. intents[] and categories[] are unbounded.
// Do NOT reintroduce caps without a product decision.

/** Hidden category slugs — never shown to users */
// ORCH-0434: Added 'flowers' (hidden from user selection, kept in backend for curated experiences)
export const HIDDEN_CATEGORY_SLUGS = new Set(['groceries', 'flowers']);

/** All valid slugs (10 total: 8 visible + 2 hidden) */
// ORCH-0434: Updated to new canonical slugs.
const VALID_SLUGS = new Set([
  'nature', 'icebreakers', 'drinks_and_music', 'brunch_lunch_casual',
  'upscale_fine_dining', 'movies_theatre', 'creative_arts', 'play',
  'flowers', 'groceries',
]);

/** Visible slugs only (8) — use for user-facing lists */
export const VISIBLE_CATEGORY_SLUGS = [...VALID_SLUGS].filter(
  s => !HIDDEN_CATEGORY_SLUGS.has(s)
);

/**
 * Convert translation key to readable category name.
 * Uses i18n for locale-aware display names, with legacy slug normalization.
 */
export const getReadableCategoryName = (categoryKey: string): string => {
  if (!categoryKey) return 'Experience';

  // ORCH-0434: Legacy slugs now resolve to new canonical slugs.
  const legacyToSlug: Record<string, string> = {
    // Old slugs → new slugs
    'first_meet': 'icebreakers',
    'picnic_park': 'nature',
    'picnic': 'nature',
    'drink': 'drinks_and_music',
    'casual_eats': 'brunch_lunch_casual',
    'fine_dining': 'upscale_fine_dining',
    'watch': 'movies_theatre',
    'live_performance': 'movies_theatre',
    'wellness': 'brunch_lunch_casual',  // orphan fallback
    // Legacy combined/removed categories
    'groceries_flowers': 'flowers',
    'groceries & flowers': 'flowers',
    'Groceries & Flowers': 'flowers',
    'work_business': 'icebreakers',
    'work & business': 'icebreakers',
    'Work & Business': 'icebreakers',
    'Nature': 'nature',
    'Picnic': 'nature',
    'stroll': 'nature',
    'sip': 'drinks_and_music',
    'sip_and_chill': 'drinks_and_music',
    'creative': 'creative_arts',
    'play_move': 'play',
    'dining': 'upscale_fine_dining',
    'casual eats': 'brunch_lunch_casual',
    'fine dining': 'upscale_fine_dining',
    'creative & arts': 'creative_arts',
    'first meet': 'icebreakers',
    // Legacy screen_ prefixed keys
    'screen_nature': 'nature', 'screen_drink': 'drinks_and_music', 'screen_relax': 'movies_theatre',
    'screen_creative': 'creative_arts', 'screen_dining': 'upscale_fine_dining',
    'screen_wellness': 'brunch_lunch_casual', 'screen_play': 'play', 'screen_eat': 'brunch_lunch_casual',
    'screen_social': 'drinks_and_music', 'screen_romantic': 'upscale_fine_dining',
    'screen_family': 'nature', 'screen_business': 'icebreakers',
    'screen_travel': 'nature', 'screen_stroll': 'nature', 'screen_sip': 'drinks_and_music',
    'screen_shop': 'creative_arts', 'screen_learn': 'creative_arts',
    'screen_exercise': 'brunch_lunch_casual', 'screen_culture': 'creative_arts',
    'screen_nightlife': 'play', 'screen_shopping': 'creative_arts',
    'screen_relax_old': 'movies_theatre',
  };

  // Strip legacy "category." prefix
  const stripped = categoryKey.replace(/^category\./, '');

  // Resolve to canonical slug
  const slug = legacyToSlug[stripped] ?? legacyToSlug[categoryKey] ?? stripped;
  const normalizedSlug = slug.replace(/-/g, '_').toLowerCase();

  // Try i18n translation
  const key = `common:category_${normalizedSlug}`;
  const translated = i18n.t(key);
  // If i18n returns the key itself (no translation found), fall back to formatting
  if (translated === key) {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return translated;
};

/**
 * Get category slug from translation key or category name.
 * Works with both English display names, translated names, and raw slugs.
 */
export const getCategorySlug = (categoryKey: string): string => {
  if (!categoryKey) return 'experience';

  // Fast path: already a valid slug
  if (VALID_SLUGS.has(categoryKey)) return categoryKey;

  // ORCH-0434: Updated to new canonical slugs. Old names resolve to new slugs.
  const nameToSlugMap: Record<string, string> = {
    // Current display names → new slugs
    'Nature & Views': 'nature',
    'Icebreakers': 'icebreakers',
    'Drinks & Music': 'drinks_and_music',
    'Brunch, Lunch & Casual': 'brunch_lunch_casual',
    'Upscale & Fine Dining': 'upscale_fine_dining',
    'Movies & Theatre': 'movies_theatre',
    'Creative & Arts': 'creative_arts',
    'Play': 'play',
    'Flowers': 'flowers',
    'Groceries': 'groceries',
    // Old display names → new slugs (backward compat)
    'First Meet': 'icebreakers',
    'Picnic Park': 'nature',
    'Drink': 'drinks_and_music',
    'Casual Eats': 'brunch_lunch_casual',
    'Fine Dining': 'upscale_fine_dining',
    'Watch': 'movies_theatre',
    'Live Performance': 'movies_theatre',
    'Wellness': 'brunch_lunch_casual',
    'Nature': 'nature',
    'Picnic': 'nature',
    'Groceries & Flowers': 'flowers',
    'Work & Business': 'icebreakers',
    'Take a Stroll': 'nature',
    'Sip & Chill': 'drinks_and_music',
    'Screen & Relax': 'movies_theatre',
    'Creative & Hands-On': 'creative_arts',
    'Play & Move': 'play',
    'Dining Experience': 'upscale_fine_dining',
    'Dining Experiences': 'upscale_fine_dining',
    'Wellness Dates': 'brunch_lunch_casual',
    'Freestyle': 'nature',
    'Picnics': 'nature',
    // Old slugs → new slugs
    'first_meet': 'icebreakers',
    'picnic_park': 'nature',
    'picnic': 'nature',
    'drink': 'drinks_and_music',
    'casual_eats': 'brunch_lunch_casual',
    'fine_dining': 'upscale_fine_dining',
    'watch': 'movies_theatre',
    'live_performance': 'movies_theatre',
    'wellness': 'brunch_lunch_casual',
    'groceries_flowers': 'flowers',
    'work_business': 'icebreakers',
    'stroll': 'nature',
    'sip': 'drinks_and_music',
    'sip_and_chill': 'drinks_and_music',
    'creative': 'creative_arts',
    'play_move': 'play',
    'dining': 'upscale_fine_dining',
  };

  // Strip legacy prefix
  const stripped = categoryKey.replace(/^category\./, '').replace(/^screen_/, '');
  return nameToSlugMap[categoryKey] || nameToSlugMap[stripped] || stripped.toLowerCase().replace(/\s+/g, '-');
};

/**
 * Get category icon name (used by the Icon component wrapper)
 */
export const getCategoryIcon = (categoryKey: string): string => {
  if (!categoryKey) return 'compass-outline';
  const slug = getCategorySlug(categoryKey);

  // ORCH-0434: Updated to new canonical slugs.
  const iconMap: Record<string, string> = {
    'nature': 'trees',
    'icebreakers': 'cafe-outline',
    'drinks_and_music': 'wine-outline',
    'brunch_lunch_casual': 'utensils-crossed',
    'upscale_fine_dining': 'chef-hat',
    'movies_theatre': 'film-new',
    'creative_arts': 'color-palette-outline',
    'play': 'game-controller-outline',
    'flowers': 'flower-outline',
    // groceries intentionally omitted — hidden category
  };

  return iconMap[slug] || 'location';
};

/**
 * Normalize a mixed-format category array to deduplicated slug IDs.
 *
 * Handles legacy display names ("Nature"), underscored slugs ("casual_eats"),
 * old removed slugs ("groceries_flowers" → "flowers", "work_business" → dropped),
 * and any other format that getCategorySlug understands. Returns a unique
 * array of visible slug IDs.
 */
export const normalizeCategoryArray = (
  raw: string[],
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const cat of raw) {
    // ORCH-0434: Migrate old slugs to new canonical slugs
    let slug: string;
    const oldToNew: Record<string, string> = {
      'first_meet': 'icebreakers', 'picnic_park': 'nature', 'picnic': 'nature',
      'drink': 'drinks_and_music', 'casual_eats': 'brunch_lunch_casual',
      'fine_dining': 'upscale_fine_dining', 'watch': 'movies_theatre',
      'live_performance': 'movies_theatre', 'wellness': 'brunch_lunch_casual',
      'groceries_flowers': 'flowers', 'work_business': 'icebreakers',
    };
    if (oldToNew[cat]) {
      slug = oldToNew[cat];
    } else {
      // Fast path: already a valid slug
      slug = VALID_SLUGS.has(cat) ? cat : getCategorySlug(cat);
      slug = slug.replace(/-/g, '_');
    }
    if (!seen.has(slug) && VALID_SLUGS.has(slug) && !HIDDEN_CATEGORY_SLUGS.has(slug)) {
      seen.add(slug);
      result.push(slug);
    }
  }
  return result;
};

/**
 * Get category color
 */
export const getCategoryColor = (categoryKey: string): string => {
  if (!categoryKey) return '#6B7280';
  const slug = getCategorySlug(categoryKey);

  // ORCH-0434: Updated to new canonical slugs with matching colors from design spec.
  const colorMap: Record<string, string> = {
    'nature': '#22C55E',              // green
    'drinks_and_music': '#A855F7',    // purple
    'icebreakers': '#F97316',         // orange
    'brunch_lunch_casual': '#EF4444', // red
    'upscale_fine_dining': '#DC2626', // dark red
    'movies_theatre': '#3B82F6',      // blue
    'creative_arts': '#EC4899',       // pink
    'play': '#F59E0B',                // amber
    'flowers': '#F472B6',             // pink-400
  };

  return colorMap[slug] || '#6B7280'; // gray fallback
};
