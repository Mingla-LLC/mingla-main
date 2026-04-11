/**
 * Category Utilities
 * Provides functions to convert category translation keys to readable names.
 * 13 categories: 12 visible + 1 hidden (Groceries).
 */
import i18n from '../i18n';

/** Maximum number of category cards a user can select. */
export const MAX_CATEGORIES = 3;

/** Maximum number of curated/intent cards a user can select (radio behavior). */
export const MAX_INTENTS = 1;

/** Cap an intents array to MAX_INTENTS. Use at every load-from-DB and save boundary. */
export const capIntents = (raw: string[]): string[] => raw.slice(0, MAX_INTENTS);

/** Hidden category slugs — never shown to users */
export const HIDDEN_CATEGORY_SLUGS = new Set(['groceries']);

/** All valid slugs (13 total) */
const VALID_SLUGS = new Set([
  'nature', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
  'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
  'wellness', 'flowers', 'groceries',
]);

/** Visible slugs only (12) — use for user-facing lists */
export const VISIBLE_CATEGORY_SLUGS = [...VALID_SLUGS].filter(
  s => !HIDDEN_CATEGORY_SLUGS.has(s)
);

/**
 * Convert translation key to readable category name.
 * Uses i18n for locale-aware display names, with legacy slug normalization.
 */
export const getReadableCategoryName = (categoryKey: string): string => {
  if (!categoryKey) return 'Experience';

  // Normalize legacy slugs to canonical slugs first
  const legacyToSlug: Record<string, string> = {
    'picnic': 'picnic_park',
    'groceries_flowers': 'flowers',
    'groceries & flowers': 'flowers',
    'Groceries & Flowers': 'flowers',
    'work_business': 'first_meet',
    'work & business': 'first_meet',
    'Work & Business': 'first_meet',
    'Nature': 'nature',
    'Picnic': 'picnic_park',
    'stroll': 'nature',
    'sip': 'drink',
    'sip_and_chill': 'drink',
    'creative': 'creative_arts',
    'play_move': 'play',
    'dining': 'fine_dining',
    'casual eats': 'casual_eats',
    'fine dining': 'fine_dining',
    'creative & arts': 'creative_arts',
    'first meet': 'first_meet',
    // Legacy screen_ prefixed keys
    'screen_nature': 'nature', 'screen_drink': 'drink', 'screen_relax': 'watch',
    'screen_creative': 'creative_arts', 'screen_dining': 'fine_dining',
    'screen_wellness': 'wellness', 'screen_play': 'play', 'screen_eat': 'casual_eats',
    'screen_social': 'drink', 'screen_romantic': 'fine_dining',
    'screen_family': 'nature', 'screen_business': 'first_meet',
    'screen_travel': 'nature', 'screen_stroll': 'nature', 'screen_sip': 'drink',
    'screen_shop': 'creative_arts', 'screen_learn': 'creative_arts',
    'screen_exercise': 'wellness', 'screen_culture': 'creative_arts',
    'screen_nightlife': 'play', 'screen_shopping': 'creative_arts',
    'screen_relax_old': 'watch',
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

  // Direct name-to-slug mapping (English display names + legacy names)
  const nameToSlugMap: Record<string, string> = {
    'Nature & Views': 'nature',
    'First Meet': 'first_meet',
    'Picnic Park': 'picnic_park',
    'Drink': 'drink',
    'Casual Eats': 'casual_eats',
    'Fine Dining': 'fine_dining',
    'Watch': 'watch',
    'Live Performance': 'live_performance',
    'Creative & Arts': 'creative_arts',
    'Play': 'play',
    'Wellness': 'wellness',
    'Flowers': 'flowers',
    'Groceries': 'groceries',
    // Legacy names
    'Nature': 'nature',
    'Picnic': 'picnic_park',
    'Groceries & Flowers': 'flowers',
    'Work & Business': 'first_meet',
    'Take a Stroll': 'nature',
    'Sip & Chill': 'drink',
    'Screen & Relax': 'watch',
    'Creative & Hands-On': 'creative_arts',
    'Play & Move': 'play',
    'Dining Experience': 'fine_dining',
    'Dining Experiences': 'fine_dining',
    'Wellness Dates': 'wellness',
    'Freestyle': 'nature',
    'Picnics': 'picnic_park',
    // Legacy slugs
    'picnic': 'picnic_park',
    'groceries_flowers': 'flowers',
    'work_business': 'first_meet',
    'stroll': 'nature',
    'sip': 'drink',
    'sip_and_chill': 'drink',
    'creative': 'creative_arts',
    'play_move': 'play',
    'dining': 'fine_dining',
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

  const iconMap: Record<string, string> = {
    'nature': 'trees',
    'first_meet': 'handshake',
    'picnic_park': 'tree-pine',
    'picnic': 'tree-pine',
    'drink': 'wine-outline',
    'casual_eats': 'utensils-crossed',
    'fine_dining': 'chef-hat',
    'watch': 'film-new',
    'live_performance': 'musical-notes-outline',
    'creative_arts': 'color-palette-outline',
    'play': 'game-controller-outline',
    'wellness': 'heart-pulse',
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
 * array of visible slug IDs capped at `maxCategories`.
 */
export const normalizeCategoryArray = (
  raw: string[],
  maxCategories: number = 3,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const cat of raw) {
    // Migrate old slugs
    let slug: string;
    if (cat === 'groceries_flowers') {
      slug = 'flowers';
    } else if (cat === 'work_business') {
      continue; // removed category, skip
    } else {
      // Fast path: already a valid slug
      slug = VALID_SLUGS.has(cat) ? cat : getCategorySlug(cat);
      // getCategorySlug returns hyphenated fallback for unknowns — remap to underscore
      slug = slug.replace(/-/g, '_');
      // "picnic" from getCategorySlug → normalize to "picnic_park"
      if (slug === 'picnic') slug = 'picnic_park';
    }
    if (!seen.has(slug) && VALID_SLUGS.has(slug) && !HIDDEN_CATEGORY_SLUGS.has(slug)) {
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
    'live_performance': '#8B5CF6', // violet-500
    'creative_arts': '#EC4899', // pink
    'play': '#EF4444',         // red
    'wellness': '#14B8A6',      // teal
    'flowers': '#F472B6',       // pink-400
  };

  return colorMap[slug] || '#6B7280'; // gray fallback
};
