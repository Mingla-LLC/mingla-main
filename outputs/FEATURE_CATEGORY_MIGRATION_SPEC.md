# Feature: Category System Migration (12 → 13 Categories)
**Date:** 2026-03-20
**Status:** Planned
**Mode:** Feature Spec

---

## 2. Summary

Migrate from 12 app categories to 13: split "Groceries & Flowers" into "Flowers" (visible) and "Groceries" (hidden), add "Live Performance" (visible, split from Watch), rename "Nature" → "Nature & Views" and "Picnic" → "Picnic Park" (display name only — slug stays). Remove "Work & Business" entirely. The result is 12 visible categories + 1 hidden (Groceries). All backend edge functions, mobile app constants, and the `query_pool_cards` SQL function must be updated atomically.

## 3. Design Principle

**"Categories are a display-name layer over a stable slug layer."** Slugs are the source of truth for storage (card_pool.categories, user preferences, query keys). Display names are derived and can change freely. New categories require new slugs; renamed categories keep their slugs.

## 4. Source of Truth Definition

| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| Category slugs (valid set) | `categoryPlaceTypes.ts` → `ALL_CATEGORY_NAMES` (backend) + `categoryUtils.ts` → `VALID_SLUGS` (mobile) | N/A | N/A | N/A |
| Category → Google types | `seedingCategories.ts` (seeding) + `categoryPlaceTypes.ts` (card serving) | N/A | No | N/A |
| Category display names | `categoryUtils.ts` → `getReadableCategoryName()` (mobile) | Slug | No | N/A |
| User's selected categories | `profiles.categories` (TEXT[]) | N/A | React Query 5min | N/A |
| Card category tags | `card_pool.categories` (TEXT[]) | place_pool at generation time | No | Yes (re-generate) |
| Hidden category list | `categoryPlaceTypes.ts` → `HIDDEN_CATEGORIES` (new export) | N/A | N/A | N/A |

## 5. Success Criteria

1. Mobile app shows exactly 12 category pills: Nature & Views, First Meet, Picnic Park, Drink, Casual Eats, Fine Dining, Watch, Live Performance, Creative & Arts, Play, Wellness, Flowers. "Groceries" never appears.
2. `generate-single-cards` generates cards for all 13 categories including Groceries.
3. `discover-cards` and all card-serving functions exclude Groceries cards from regular results.
4. `generate-curated-experiences` can query Groceries cards from card_pool for picnic-date stops.
5. All existing cards with old category names (Nature, Picnic, Groceries & Flowers) continue to resolve correctly via aliases.
6. User preferences stored as old slugs (e.g., `groceries_flowers`) still work via alias resolution.
7. No breaking changes to the admin dashboard (out of scope for this spec).

## 6. Non-Goals

1. Admin dashboard category updates (separate spec).
2. Curated experience generation changes (separate spec).
3. Schema changes to card_pool or place_pool (category is TEXT[], no migration needed).
4. Photo pipeline changes.
5. Backfilling old cards with new category names (aliases handle this).

---

## 7. The 13 Categories — Before & After

### Before (12 categories)

| # | Slug | Display Name | Visible |
|---|------|-------------|---------|
| 1 | nature | Nature | Yes |
| 2 | first_meet | First Meet | Yes |
| 3 | picnic_park | Picnic Park | Yes |
| 4 | drink | Drink | Yes |
| 5 | casual_eats | Casual Eats | Yes |
| 6 | fine_dining | Fine Dining | Yes |
| 7 | watch | Watch | Yes |
| 8 | creative_arts | Creative & Arts | Yes |
| 9 | play | Play | Yes |
| 10 | wellness | Wellness | Yes |
| 11 | groceries_flowers | Groceries & Flowers | Yes |
| 12 | work_business | Work & Business | Yes |

### After (13 categories)

| # | Slug | Display Name | Visible | Notes |
|---|------|-------------|---------|-------|
| 1 | nature | Nature & Views | Yes | Renamed display only |
| 2 | first_meet | First Meet | Yes | Same |
| 3 | picnic_park | Picnic Park | Yes | Same (was "Picnic" in some places) |
| 4 | drink | Drink | Yes | Same |
| 5 | casual_eats | Casual Eats | Yes | Same |
| 6 | fine_dining | Fine Dining | Yes | Same |
| 7 | watch | Watch | Yes | Now movie theaters only |
| 8 | live_performance | Live Performance | Yes | **NEW** — split from Watch |
| 9 | creative_arts | Creative & Arts | Yes | Same |
| 10 | play | Play | Yes | Same |
| 11 | wellness | Wellness | Yes | Same |
| 12 | flowers | Flowers | Yes | **NEW** — split from Groceries & Flowers |
| 13 | groceries | Groceries | **HIDDEN** | **NEW** — never shown to users |

### Removed

| Slug | Why |
|------|-----|
| groceries_flowers | Split into `flowers` + `groceries` |
| work_business | Removed from system — not a date category |

---

## 8. Backend Changes — Edge Functions

### 8.1 `_shared/categoryPlaceTypes.ts`

**Current state:** 12 categories in `MINGLA_CATEGORY_PLACE_TYPES`, extensive alias maps, helper functions.

**Changes:**

#### 8.1.1 Update `MINGLA_CATEGORY_PLACE_TYPES`

Replace the entire map. Remove `Groceries & Flowers` and `Work & Business`. Add `Nature & Views` (renamed from `Nature`), `Live Performance`, `Flowers`, `Groceries`.

```typescript
export const MINGLA_CATEGORY_PLACE_TYPES: Record<string, string[]> = {
  'Nature & Views': [
    'beach', 'botanical_garden', 'garden', 'hiking_area', 'national_park',
    'nature_preserve', 'park', 'scenic_spot', 'state_park', 'observation_deck',
    'tourist_attraction',
  ],
  'First Meet': [
    'book_store', 'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
    'juice_shop', 'bistro', 'wine_bar', 'lounge_bar',
  ],
  'Picnic Park': [
    'picnic_ground', 'park',
  ],
  'Drink': [
    'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'pub', 'brewery',
    'beer_garden', 'brewpub',
  ],
  'Casual Eats': [
    'restaurant', 'bistro', 'brunch_restaurant', 'breakfast_restaurant', 'diner',
    'cafe', 'coffee_shop', 'sandwich_shop', 'pizza_restaurant',
    'hamburger_restaurant', 'mexican_restaurant', 'mediterranean_restaurant',
    'thai_restaurant', 'vegetarian_restaurant',
  ],
  'Fine Dining': [
    'fine_dining_restaurant', 'french_restaurant', 'italian_restaurant',
    'steak_house', 'seafood_restaurant', 'wine_bar',
  ],
  'Watch': [
    'movie_theater',
  ],
  'Live Performance': [
    'performing_arts_theater', 'concert_hall', 'opera_house',
    'philharmonic_hall', 'amphitheatre',
  ],
  'Creative & Arts': [
    'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
    'performing_arts_theater', 'cultural_center', 'cultural_landmark',
    'sculpture',
  ],
  'Play': [
    'amusement_center', 'bowling_alley', 'miniature_golf_course',
    'go_karting_venue', 'paintball_center', 'video_arcade', 'karaoke',
    'amusement_park',
  ],
  'Wellness': [
    'spa', 'massage_spa', 'sauna', 'wellness_center', 'yoga_studio',
  ],
  'Flowers': [
    'florist', 'grocery_store', 'supermarket',
  ],
  'Groceries': [
    'grocery_store', 'supermarket',
  ],
};
```

#### 8.1.2 Add `HIDDEN_CATEGORIES` export

```typescript
/** Categories that exist in the system but are never shown to users */
export const HIDDEN_CATEGORIES: Set<string> = new Set(['Groceries']);

/** Visible categories only — use for user-facing lists */
export const VISIBLE_CATEGORY_NAMES = ALL_CATEGORY_NAMES.filter(
  c => !HIDDEN_CATEGORIES.has(c)
);
```

#### 8.1.3 Update `CATEGORY_ALIASES`

Add aliases for new categories and backward compatibility:

```typescript
const CATEGORY_ALIASES: Record<string, string> = {
  // ── New canonical slug → display name ──────────────────────────
  'nature': 'Nature & Views',
  'nature_views': 'Nature & Views',
  'nature-views': 'Nature & Views',
  'nature & views': 'Nature & Views',
  'nature_and_views': 'Nature & Views',
  'first_meet': 'First Meet',
  'first-meet': 'First Meet',
  'firstmeet': 'First Meet',
  'picnic_park': 'Picnic Park',
  'picnic-park': 'Picnic Park',
  'picnic park': 'Picnic Park',
  'picnic': 'Picnic Park',        // ← legacy "Picnic" resolves to "Picnic Park"
  'drink': 'Drink',
  'casual_eats': 'Casual Eats',
  'casual-eats': 'Casual Eats',
  'casualeats': 'Casual Eats',
  'casual eats': 'Casual Eats',
  'fine_dining': 'Fine Dining',
  'fine-dining': 'Fine Dining',
  'finedining': 'Fine Dining',
  'fine dining': 'Fine Dining',
  'watch': 'Watch',
  'live_performance': 'Live Performance',
  'live-performance': 'Live Performance',
  'live performance': 'Live Performance',
  'liveperformance': 'Live Performance',
  'creative_arts': 'Creative & Arts',
  'creative-arts': 'Creative & Arts',
  'creativearts': 'Creative & Arts',
  'creative & arts': 'Creative & Arts',
  'play': 'Play',
  'wellness': 'Wellness',
  'flowers': 'Flowers',
  'groceries': 'Groceries',

  // ── Backward compat: old combined category ─────────────────────
  'groceries_flowers': 'Flowers',   // ← old slug resolves to Flowers (visible)
  'groceries & flowers': 'Flowers',
  'groceries-flowers': 'Flowers',
  'groceriesflowers': 'Flowers',

  // ── Removed categories → best match ────────────────────────────
  'work_business': 'First Meet',    // ← Work removed; coworking-like → First Meet
  'work-business': 'First Meet',
  'workbusiness': 'First Meet',
  'work & business': 'First Meet',
  'work and business': 'First Meet',
  'work_and_business': 'First Meet',

  // ── Old "Nature" display name → new display name ───────────────
  'Nature': 'Nature & Views',
  'Picnic': 'Picnic Park',
  'Groceries & Flowers': 'Flowers',
  'Work & Business': 'First Meet',

  // ── Legacy category names from prior systems ───────────────────
  'sip & chill': 'Drink',
  'sip_and_chill': 'Drink',
  'sip-and-chill': 'Drink',
  'sip&chill': 'Drink',
  'sip_&_chill': 'Drink',
  'sipchill': 'Drink',
  'stroll': 'Nature & Views',
  'take a stroll': 'Nature & Views',
  'take-a-stroll': 'Nature & Views',
  'take_a_stroll': 'Nature & Views',
  'dining experiences': 'Fine Dining',
  'dining_experiences': 'Fine Dining',
  'dining-experiences': 'Fine Dining',
  'dining': 'Fine Dining',
  'screen & relax': 'Watch',
  'screen_and_relax': 'Watch',
  'screen-and-relax': 'Watch',
  'screen&relax': 'Watch',
  'screenrelax': 'Watch',
  'screen_&_relax': 'Watch',
  'creative & hands-on': 'Creative & Arts',
  'creative_and_hands_on': 'Creative & Arts',
  'creative-and-hands-on': 'Creative & Arts',
  'creative&hands-on': 'Creative & Arts',
  'creativehandson': 'Creative & Arts',
  'play & move': 'Play',
  'play_and_move': 'Play',
  'play-and-move': 'Play',
  'play&move': 'Play',
  'playmove': 'Play',
  'play_&_move': 'Play',
  'picnics': 'Picnic Park',
  'wellness dates': 'Wellness',
  'wellness_dates': 'Wellness',
  'freestyle': 'Nature & Views',
  'sip': 'Drink',
  'play_move': 'Play',
  'screen_relax': 'Watch',
  'creative': 'Creative & Arts',
};
```

#### 8.1.4 Update `CATEGORY_EXCLUDED_PLACE_TYPES`

Replace the full map. Key changes:
- `Nature` → `Nature & Views`
- `Picnic` → `Picnic Park`
- `Watch` narrowed (movie theaters only)
- Add `Live Performance` exclusions
- Add `Flowers` exclusions
- Add `Groceries` exclusions
- Remove `Groceries & Flowers` and `Work & Business`

Use the existing exclusion lists from seedingCategories.ts as the basis for each category's `excludedPrimaryTypes`, then keep the broader retail/utility exclusion lists.

#### 8.1.5 Update `CATEGORY_TEXT_KEYWORDS`

```typescript
export const CATEGORY_TEXT_KEYWORDS: Partial<Record<string, string[]>> = {
  'Fine Dining': [
    'fine dining restaurant',
    'upscale restaurant',
    'tasting menu restaurant',
  ],
  'Wellness': [
    'day spa',
    'resort hotel spa',
    'hot spring spa',
  ],
};
```
No changes needed — Fine Dining and Wellness stay the same.

#### 8.1.6 Update `CATEGORY_MIN_PRICE_TIER`

No changes — Fine Dining keeps its `bougie` minimum.

#### 8.1.7 Update `INTENT_IDS`

No changes needed.

#### 8.1.8 Update `ALL_CATEGORY_NAMES`

Already derived from `Object.keys(MINGLA_CATEGORY_PLACE_TYPES)` — auto-updates.

---

### 8.2 `_shared/seedingCategories.ts`

**Changes:**
1. Update `live_performance.appCategory` from `'Creative & Arts'` to `'Live Performance'`
2. Update `live_performance.appCategorySlug` from `'creative_arts'` to `'live_performance'`
3. Update `nature_views.appCategory` from `'Nature'` to `'Nature & Views'`
4. Update `picnic_park.appCategory` from `'Picnic'` to `'Picnic Park'`
5. Update `flowers.appCategory` from `'Groceries & Flowers'` to `'Flowers'`
6. Update `flowers.appCategorySlug` from `'groceries_flowers'` to `'flowers'`
7. Update `groceries.appCategory` from `'Groceries & Flowers'` to `'Groceries'`
8. Update `groceries.appCategorySlug` from `'groceries_flowers'` to `'groceries'`

---

### 8.3 `generate-single-cards/index.ts`

**File:** `supabase/functions/generate-single-cards/index.ts`

**Changes:**

1. Update `CATEGORY_FALLBACK_DESCRIPTIONS`:
```typescript
const CATEGORY_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'Nature & Views': 'A beautiful [placeType] perfect for outdoor exploration.',
  'Drink': 'A popular [placeType] spot with great ambiance for drinks.',
  'Casual Eats': 'A well-loved [placeType] serving delicious casual fare.',
  'Fine Dining': 'An upscale [placeType] offering a refined dining experience.',
  'First Meet': 'A welcoming [placeType] ideal for a first meeting.',
  'Picnic Park': 'A lovely [placeType] perfect for a relaxing picnic outing.',
  'Watch': 'An exciting [placeType] for a fun movie experience.',
  'Live Performance': 'An exciting [placeType] for live entertainment.',
  'Creative & Arts': 'An inspiring [placeType] for creative exploration.',
  'Play': 'A thrilling [placeType] for fun and adventure.',
  'Wellness': 'A serene [placeType] for relaxation and wellness.',
  'Flowers': 'A lovely [placeType] for fresh flowers and bouquets.',
  'Groceries': 'A convenient [placeType] for all your essentials.',
};
```

2. Groceries cards ARE generated (the function iterates ALL_CATEGORY_NAMES, which includes Groceries). No special exclusion logic needed here — cards are created for the pool; filtering happens at serve time.

---

### 8.4 `discover-cards/index.ts`

**File:** `supabase/functions/discover-cards/index.ts`

**Changes:**

1. Update any hardcoded category references to use new names.
2. Add Groceries exclusion to the categories passed to `query_pool_cards`:

```typescript
// Before calling query_pool_cards, filter out hidden categories
import { HIDDEN_CATEGORIES } from '../_shared/categoryPlaceTypes.ts';

const userCategories = resolveCategories(rawCategories)
  .filter(c => !HIDDEN_CATEGORIES.has(c));
```

This ensures that even if a user somehow has "Groceries" in their preferences, discover-cards won't serve those cards.

---

### 8.5 `discover-experiences/index.ts`

**File:** `supabase/functions/discover-experiences/index.ts`

**Changes:**

1. Update `PREF_ID_TO_DISCOVER_CATEGORY`:
```typescript
const PREF_ID_TO_DISCOVER_CATEGORY: Record<string, string> = {
  nature: "Nature & Views",
  first_meet: "First Meet",
  picnic_park: "Picnic Park",
  picnic: "Picnic Park",           // legacy compat
  drink: "Drink",
  casual_eats: "Casual Eats",
  fine_dining: "Fine Dining",
  watch: "Watch",
  live_performance: "Live Performance",
  creative_arts: "Creative & Arts",
  play: "Play",
  wellness: "Wellness",
  flowers: "Flowers",
  groceries_flowers: "Flowers",    // legacy compat
  // groceries intentionally omitted — hidden category
};
```

2. Update `HERO_CATEGORIES_RESOLVED` default to use new names:
```typescript
let HERO_CATEGORIES_RESOLVED = ["Fine Dining", "Play"];
```
(No change needed — these names didn't change.)

---

### 8.6 `get-personalized-cards/index.ts`

**Changes:**
1. `DEFAULT_PAD_CATEGORY` stays `"Fine Dining"` — no change.
2. The function uses `resolveCategory()` which will auto-resolve via aliases. No code changes needed IF the alias map is updated correctly.

---

### 8.7 `get-holiday-cards/index.ts`

**Changes:**
Same as 8.6 — relies on `resolveCategory()`. No changes needed.

---

### 8.8 `get-person-hero-cards/index.ts`

**File:** `supabase/functions/get-person-hero-cards/index.ts`

**Changes:**

1. Update `INTENT_CATEGORY_MAP`:
```typescript
const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ["first_meet", "drink", "picnic_park", "wellness", "nature"],
  adventurous: [
    "nature", "play", "creative_arts", "casual_eats", "drink",
    "first_meet", "picnic_park", "watch", "live_performance",
    "wellness", "flowers",
  ],
  friendly: ["play", "casual_eats", "drink", "nature", "creative_arts",
    "picnic_park", "watch", "live_performance"],
};
```

Key changes: `picnic` → `picnic_park`, removed `groceries_flowers` and `work_business`, added `live_performance`.

---

### 8.9 `_shared/cardPoolService.ts`

**Changes:**
1. No structural changes needed — it imports from `categoryPlaceTypes.ts` which will be updated.
2. Verify it passes `GLOBAL_EXCLUDED_PLACE_TYPES` correctly (currently does).

---

### 8.10 `query_pool_cards` SQL Function

**File:** Latest migration (currently `20260320000001_add_dog_park_exclusion.sql`)

**Changes needed: NEW MIGRATION**

Add Groceries category exclusion to `query_pool_cards`. Currently the function filters by `cp.categories && p_categories`, so if Groceries is never passed in `p_categories`, Groceries cards are automatically excluded.

**However**, the empty-categories case (`p_categories = '{}'`) would include ALL cards including Groceries. Fix:

```sql
-- Add to the WHERE clause in all 3 filtered CTEs:
AND NOT ('Groceries' = ANY(cp.categories) AND array_length(cp.categories, 1) = 1)
```

This excludes cards that are ONLY tagged as Groceries. Cards tagged as both Groceries and another category still appear (unlikely but safe).

**Full migration:**

```sql
-- Migration: exclude_groceries_from_discovery
-- Ensures Groceries-only cards never appear in regular card serving.
-- Groceries cards are only served through curated experience endpoints.

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  -- [same signature as current]
)
RETURNS TABLE (card JSONB, total_unseen BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_unseen BIGINT;
  v_use_tiers BOOLEAN := (array_length(p_price_tiers, 1) IS NOT NULL AND array_length(p_price_tiers, 1) > 0);
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park'];
  -- Hidden categories: cards tagged ONLY with these are excluded from regular queries
  v_hidden_categories TEXT[] := ARRAY['Groceries'];
BEGIN
  -- [same body but add this line to all 3 filtered CTEs after the existing conditions:]
  -- Exclude cards that are ONLY tagged with hidden categories
  AND NOT (cp.categories <@ v_hidden_categories)
  -- [rest unchanged]
END;
$$;
```

The condition `NOT (cp.categories <@ v_hidden_categories)` means "card's categories are NOT a subset of hidden categories." A card tagged `['Groceries']` is excluded. A card tagged `['Groceries', 'Picnic Park']` is not excluded (edge case, shouldn't exist, but safe).

---

## 9. Mobile Implementation

### 9.1 `app-mobile/src/constants/categories.ts`

**Changes:**

1. Remove the `groceries_flowers` category object entirely
2. Remove the `work_business` category object entirely
3. Rename `nature` object: `name: 'Nature'` → `name: 'Nature & Views'`, update descriptions
4. Split Watch: narrow `watch` to movie theaters only, add new `live_performance` object
5. Add new `flowers` category object
6. Update `compatibleWith`/`incompatibleWith` arrays across all categories to reference new slugs
7. Update `getCategoryExperienceTypeCombinations` — remove `groceries_flowers` and `work_business` keys, add `live_performance` and `flowers` keys
8. Remove the `'Friendly'` curated experience from `CURATED_EXPERIENCES` if not already handled

**New category objects:**

```typescript
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
    activeColor: '#8B5CF6', // violet-500
    subcategories: ['Concert Halls', 'Theaters', 'Opera Houses', 'Amphitheatres'],
    contextualPreview: 'Live show at the theater tonight — doors at 7pm.',
  },
  activityType: 'stationary',
  duration: 'medium',
  compatibleWith: ['drink', 'fine_dining', 'casual_eats'],
  incompatibleWith: ['nature', 'picnic_park', 'wellness'],
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
    activeColor: '#F472B6', // pink-400
    subcategories: ['Florists', 'Flower Shops'],
    contextualPreview: 'Fresh roses from a local florist — 5 minutes away.',
  },
  activityType: 'stationary',
  duration: 'short',
  compatibleWith: ['fine_dining', 'first_meet', 'nature', 'picnic_park'],
  incompatibleWith: ['play', 'watch'],
},
```

### 9.2 `app-mobile/src/utils/categoryUtils.ts`

**Changes:**

1. Update `VALID_SLUGS`:
```typescript
const VALID_SLUGS = new Set([
  'nature', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
  'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
  'wellness', 'flowers', 'groceries',
]);
```

2. Update `getReadableCategoryName()` categoryMap:
```typescript
const categoryMap: Record<string, string> = {
  // New canonical slugs
  'nature': 'Nature & Views',
  'first_meet': 'First Meet',
  'picnic_park': 'Picnic Park',
  'picnic': 'Picnic Park',
  'drink': 'Drink',
  'casual_eats': 'Casual Eats',
  'fine_dining': 'Fine Dining',
  'watch': 'Watch',
  'live_performance': 'Live Performance',
  'creative_arts': 'Creative & Arts',
  'play': 'Play',
  'wellness': 'Wellness',
  'flowers': 'Flowers',
  'groceries': 'Groceries',

  // Legacy compat
  'groceries_flowers': 'Flowers',
  'work_business': 'First Meet',
  // ... keep all other legacy mappings, update targets as needed
};
```

3. Update `getCategoryIcon()`:
```typescript
const iconMap: Record<string, string> = {
  'nature': 'leaf-outline',
  'first_meet': 'chatbubbles-outline',
  'picnic_park': 'basket-outline',
  'drink': 'wine-outline',
  'casual_eats': 'fast-food-outline',
  'fine_dining': 'restaurant-outline',
  'watch': 'film-outline',
  'live_performance': 'musical-notes-outline',
  'creative_arts': 'color-palette-outline',
  'play': 'game-controller-outline',
  'wellness': 'body-outline',
  'flowers': 'flower-outline',
  // groceries intentionally omitted — hidden category
};
```

4. Update `getCategoryColor()`:
```typescript
const colorMap: Record<string, string> = {
  'nature': '#10B981',
  'first_meet': '#6366F1',
  'picnic_park': '#84CC16',
  'drink': '#F59E0B',
  'casual_eats': '#F97316',
  'fine_dining': '#7C3AED',
  'watch': '#3B82F6',
  'live_performance': '#8B5CF6',
  'creative_arts': '#EC4899',
  'play': '#EF4444',
  'wellness': '#14B8A6',
  'flowers': '#F472B6',
};
```

5. Add `HIDDEN_CATEGORY_SLUGS`:
```typescript
export const HIDDEN_CATEGORY_SLUGS = new Set(['groceries']);
export const VISIBLE_CATEGORY_SLUGS = [...VALID_SLUGS].filter(
  s => !HIDDEN_CATEGORY_SLUGS.has(s)
);
```

6. Update `normalizeCategoryArray()` to migrate old slugs:
```typescript
export function normalizeCategoryArray(raw: string[], maxCategories = MAX_CATEGORIES): string[] {
  const migrated = raw.map(slug => {
    if (slug === 'groceries_flowers') return 'flowers';
    if (slug === 'work_business') return 'first_meet';
    return slug;
  });
  const valid = migrated.filter(s => VALID_SLUGS.has(s) && !HIDDEN_CATEGORY_SLUGS.has(s));
  return [...new Set(valid)].slice(0, maxCategories);
}
```

### 9.3 `app-mobile/src/components/PreferencesSheet.tsx`

**Changes:**

1. Update `categories` array (lines 87-104):
```typescript
const categories = [
  { id: "nature", label: "Nature & Views", icon: "leaf-outline" },
  { id: "first_meet", label: "First Meet", icon: "chatbubbles-outline" },
  { id: "picnic_park", label: "Picnic Park", icon: "basket-outline" },
  { id: "drink", label: "Drink", icon: "wine-outline" },
  { id: "casual_eats", label: "Casual Eats", icon: "fast-food-outline" },
  { id: "fine_dining", label: "Fine Dining", icon: "restaurant-outline" },
  { id: "watch", label: "Watch", icon: "film-outline" },
  { id: "live_performance", label: "Live Performance", icon: "musical-notes-outline" },
  { id: "creative_arts", label: "Creative & Arts", icon: "color-palette-outline" },
  { id: "play", label: "Play", icon: "game-controller-outline" },
  { id: "wellness", label: "Wellness", icon: "body-outline" },
  { id: "flowers", label: "Flowers", icon: "flower-outline" },
];
```

Note: 12 items. Groceries and Work & Business removed.

### 9.4 `PreferencesSheet/PreferencesSections.tsx`

**Changes:**

1. Update `CATEGORY_DESCRIPTIONS`:
```typescript
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  nature: "Trails, parks, gardens, scenic views — fresh air and good scenery",
  first_meet: "Cafés, bookstores, tea houses — low-pressure first meetings",
  picnic_park: "Parks and picnic grounds for outdoor dining",
  drink: "Cocktail bars, cozy cafés, neighborhood pubs",
  casual_eats: "Burgers, ramen, tacos, pizza — easygoing food outings",
  fine_dining: "Steakhouses, French, seafood — elevated dining experiences",
  watch: "Movie theaters for a fun shared evening",
  live_performance: "Concert halls, theaters, opera — live entertainment",
  creative_arts: "Art galleries, museums, cultural landmarks",
  play: "Arcades, bowling, escape rooms — bring your competitive side",
  wellness: "Spas, massage, saunas — rest and recharge",
  flowers: "Florists and flower shops for fresh bouquets",
};
```

### 9.5 Other Mobile Files to Check

Search for any hardcoded references to these strings and update:
- `'Groceries & Flowers'` → remove or map to `'Flowers'`
- `'groceries_flowers'` → `'flowers'` where it's a new selection; backward compat where reading existing data
- `'work_business'` → remove
- `'Work & Business'` → remove
- `'Nature'` (as display name) → `'Nature & Views'` in display contexts
- `'Picnic'` (as display name) → `'Picnic Park'` in display contexts

### 9.6 State Classification

| State | Source of Truth | Derived? | Cached? | Where Stored |
|-------|----------------|----------|---------|-------------|
| Available categories list | `categories.ts` array | No | No | Code constant |
| User selected categories | `profiles.categories` (Supabase) | No | React Query 5min | Server + RQ cache |
| Category display name | `categoryUtils.ts` | Yes (from slug) | No | Computed |
| Category icon | `categoryUtils.ts` | Yes (from slug) | No | Computed |
| Category color | `categoryUtils.ts` | Yes (from slug) | No | Computed |

---

## 10. Migration Plan

### 10.1 Backward Compatibility Strategy

**No destructive migration needed.** The category field in both `card_pool` and `place_pool` is TEXT[]. Old values (`Nature`, `Picnic`, `Groceries & Flowers`) will continue to exist in the database.

**Resolution strategy:** The updated `CATEGORY_ALIASES` map in `categoryPlaceTypes.ts` handles all old → new name resolution:
- `'Nature'` → `'Nature & Views'`
- `'Picnic'` → `'Picnic Park'`
- `'Groceries & Flowers'` → `'Flowers'`

**This means:**
- Old cards tagged `['Nature']` will be resolved to `'Nature & Views'` when `resolveCategories()` is called
- `query_pool_cards` SQL matches by array overlap (`&&`), so we need the SQL to use the same resolved names OR the old names must still match

**Critical issue:** `query_pool_cards` matches `cp.categories && p_categories` using the EXACT strings stored in the database. If the database has `['Nature']` but we pass `['Nature & Views']`, it WON'T match.

**Solution:** The card-serving edge functions resolve user preference slugs to display names before calling `query_pool_cards`. Since old cards have old display names, we need a data backfill OR we need to pass BOTH old and new names.

### 10.2 Data Backfill Migration

```sql
-- Migration: backfill_category_names_13
-- Updates category display names in card_pool to match the new 13-category system.
-- Safe: only updates the text values, doesn't change structure.

-- Nature → Nature & Views
UPDATE public.card_pool
SET categories = array_replace(categories, 'Nature', 'Nature & Views')
WHERE 'Nature' = ANY(categories);

-- Picnic → Picnic Park
UPDATE public.card_pool
SET categories = array_replace(categories, 'Picnic', 'Picnic Park')
WHERE 'Picnic' = ANY(categories);

-- Groceries & Flowers → split
-- Cards with "Groceries & Flowers" that are from florist places → "Flowers"
-- Cards with "Groceries & Flowers" that are from grocery places → "Groceries"
-- Since we can't easily distinguish, tag them as BOTH Flowers and Groceries
-- (the hidden category filter will exclude Groceries-only from regular serving)
UPDATE public.card_pool
SET categories = array_replace(categories, 'Groceries & Flowers', 'Flowers')
WHERE 'Groceries & Flowers' = ANY(categories)
  AND place_pool_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.place_pool pp
    WHERE pp.id = card_pool.place_pool_id
      AND pp.primary_type = 'florist'
  );

UPDATE public.card_pool
SET categories = array_replace(categories, 'Groceries & Flowers', 'Groceries')
WHERE 'Groceries & Flowers' = ANY(categories)
  AND place_pool_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.place_pool pp
    WHERE pp.id = card_pool.place_pool_id
      AND pp.primary_type = 'florist'
  );

-- Catch any remaining (no place_pool_id) — default to Flowers
UPDATE public.card_pool
SET categories = array_replace(categories, 'Groceries & Flowers', 'Flowers')
WHERE 'Groceries & Flowers' = ANY(categories);

-- Work & Business → remove (deactivate these cards, they shouldn't be served)
UPDATE public.card_pool
SET is_active = false
WHERE 'Work & Business' = ANY(categories)
  AND NOT EXISTS (
    SELECT 1 FROM unnest(categories) AS cat
    WHERE cat NOT IN ('Work & Business')
  );

-- For cards with Work & Business AND other categories, just remove Work & Business
UPDATE public.card_pool
SET categories = array_remove(categories, 'Work & Business')
WHERE 'Work & Business' = ANY(categories);

-- Also update place_pool category field if it exists
UPDATE public.place_pool
SET category = 'Nature & Views'
WHERE category = 'Nature';

UPDATE public.place_pool
SET category = 'Picnic Park'
WHERE category = 'Picnic';

-- Groceries & Flowers places → check primary_type
UPDATE public.place_pool
SET category = 'Flowers'
WHERE category = 'Groceries & Flowers'
  AND primary_type = 'florist';

UPDATE public.place_pool
SET category = 'Groceries'
WHERE category = 'Groceries & Flowers'
  AND primary_type != 'florist';

-- Catch remaining
UPDATE public.place_pool
SET category = 'Flowers'
WHERE category = 'Groceries & Flowers';

UPDATE public.place_pool
SET category = CASE
  WHEN category = 'Work & Business' THEN 'First Meet'
  ELSE category
END
WHERE category = 'Work & Business';

-- Also backfill user preferences
UPDATE public.profiles
SET categories = (
  SELECT array_agg(
    CASE
      WHEN cat = 'groceries_flowers' THEN 'flowers'
      WHEN cat = 'work_business' THEN NULL  -- remove, don't replace
      ELSE cat
    END
  )
  FROM unnest(categories) AS cat
  WHERE cat != 'work_business'
)
WHERE categories && ARRAY['groceries_flowers', 'work_business'];
```

### 10.3 Rollback Plan

- **Is this migration destructive?** Partially — we're renaming strings in place. But the original values can be restored.
- **Rollback:** Reverse the `array_replace` calls. The old code with old aliases will still work.
- **Dual-read window:** Not needed — aliases handle both old and new names.

---

## 11. Implementation Order

**Step 1: SQL Data Backfill Migration**
- File: `supabase/migrations/[next]_category_migration_13.sql`
- Includes: card_pool category renaming, place_pool category renaming, user preferences migration, query_pool_cards update with Groceries exclusion
- Verify: Run verification queries from §13

**Step 2: Backend — `_shared/categoryPlaceTypes.ts`**
- Full rewrite of the category map, aliases, and exclusion lists
- Add `HIDDEN_CATEGORIES` and `VISIBLE_CATEGORY_NAMES` exports
- Verify: Import in a test script and confirm all old slugs resolve correctly

**Step 3: Backend — `_shared/seedingCategories.ts`**
- Update appCategory and appCategorySlug for 5 entries
- Verify: All 13 configs map to correct app categories

**Step 4: Backend — Card-serving edge functions**
- Update in order: `generate-single-cards`, `discover-cards`, `discover-experiences`, `get-person-hero-cards`
- Each function: update hardcoded category references, add Groceries filtering where needed
- Verify: Deploy and test each endpoint

**Step 5: Mobile — Constants and utilities**
- Update `categories.ts`, `categoryUtils.ts`
- Verify: All category slugs resolve, hidden categories excluded from visible lists

**Step 6: Mobile — UI components**
- Update `PreferencesSheet.tsx`, `PreferencesSections.tsx`
- Verify: 12 pills shown, correct labels and icons, Groceries not visible

**Step 7: Integration test**
- Full user flow: open preferences → select "Flowers" → save → discover cards → only Flowers cards appear
- Verify: "Live Performance" cards appear in discover
- Verify: Groceries cards never appear in any user-facing flow
- Verify: Old user with `groceries_flowers` preference → sees Flowers cards

---

## 12. Test Cases

| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
| 1 | Old "Nature" cards resolve | `resolveCategory("Nature")` | `"Nature & Views"` | Backend |
| 2 | Old "Picnic" cards resolve | `resolveCategory("Picnic")` | `"Picnic Park"` | Backend |
| 3 | Old "Groceries & Flowers" resolves | `resolveCategory("Groceries & Flowers")` | `"Flowers"` | Backend |
| 4 | Slug `groceries_flowers` resolves | `resolveCategory("groceries_flowers")` | `"Flowers"` | Backend |
| 5 | Slug `work_business` resolves | `resolveCategory("work_business")` | `"First Meet"` | Backend |
| 6 | New slug `live_performance` resolves | `resolveCategory("live_performance")` | `"Live Performance"` | Backend |
| 7 | New slug `flowers` resolves | `resolveCategory("flowers")` | `"Flowers"` | Backend |
| 8 | New slug `groceries` resolves | `resolveCategory("groceries")` | `"Groceries"` | Backend |
| 9 | Groceries excluded from discover | `discover-cards` with empty prefs | No Groceries cards | Backend |
| 10 | Groceries cards generated | `generate-single-cards` with Groceries | Cards created | Backend |
| 11 | PreferencesSheet shows 12 pills | Open preferences | 12 pills, no Groceries, no Work | Mobile |
| 12 | Live Performance has icon | Check pill render | `musical-notes-outline` icon | Mobile |
| 13 | Flowers has icon | Check pill render | `flower-outline` icon | Mobile |
| 14 | Old user preferences migrate | User with `['groceries_flowers']` | Becomes `['flowers']` | SQL |
| 15 | Query pool cards excludes Groceries | `p_categories = '{}'` | No Groceries-only cards | SQL |
| 16 | Watch narrowed to movies only | Generate Watch cards | Only movie_theater types | Backend |
| 17 | Nature & Views display name | `getReadableCategoryName('nature')` | `"Nature & Views"` | Mobile |
| 18 | Backward compat — all legacy slugs | All old slugs from alias map | Each resolves to valid new name | Backend |

---

## 13. Verification Queries

### Integrity Checks
```sql
-- No cards with old category names remaining
SELECT COUNT(*) FROM public.card_pool
WHERE categories && ARRAY['Nature', 'Picnic', 'Groceries & Flowers', 'Work & Business'];
-- Expected: 0

-- No places with old category names remaining
SELECT COUNT(*) FROM public.place_pool
WHERE category IN ('Nature', 'Picnic', 'Groceries & Flowers', 'Work & Business');
-- Expected: 0

-- No user profiles with old category slugs
SELECT COUNT(*) FROM public.profiles
WHERE categories && ARRAY['groceries_flowers', 'work_business'];
-- Expected: 0

-- Groceries cards exist but are not active (or are active for curated use)
SELECT COUNT(*), is_active FROM public.card_pool
WHERE 'Groceries' = ANY(categories)
GROUP BY is_active;
-- Expected: some active (for curated picnic), none showing in discover

-- All 13 categories have cards
SELECT unnest(categories) AS cat, COUNT(*) FROM public.card_pool
WHERE is_active = true
GROUP BY cat
ORDER BY cat;
-- Expected: 13 rows (or 12 if no Groceries cards yet)
```

### Runtime Behavior Checks
- [ ] `discover-cards` returns 200, no Groceries cards in results
- [ ] `discover-experiences` returns 200, maps old preference IDs correctly
- [ ] `generate-single-cards` creates cards for all 13 categories
- [ ] `get-person-hero-cards` expands intents to new category slugs
- [ ] PreferencesSheet renders 12 pills
- [ ] Selecting "Flowers" stores `flowers` slug in profiles.categories
- [ ] Old user with `groceries_flowers` → sees Flowers cards (alias resolved)

---

## 14. Common Mistakes to Avoid

1. **Forgetting SQL backfill:** If you update edge functions to use "Nature & Views" but the database still has "Nature" cards, query_pool_cards won't match. Run the data migration FIRST.

2. **Case-sensitive alias lookup:** The alias map lowercases input before lookup. But `resolveCategory()` also checks the EXACT display name first. "Nature" will match the old key if it still exists in `MINGLA_CATEGORY_PLACE_TYPES`. After the map is updated, "Nature" won't be a key → falls through to alias → `"Nature & Views"`. This is correct.

3. **Groceries in empty-prefs case:** When `p_categories = '{}'`, query_pool_cards returns ALL categories. The Groceries exclusion must be in SQL, not just in the edge function. See §8.10.

4. **Mobile slug vs display name confusion:** Mobile stores SLUGS (`nature`, `flowers`), backend resolves to DISPLAY NAMES (`Nature & Views`, `Flowers`). Don't mix them.

5. **`flower-outline` icon may not exist in Ionicons:** Verify. Alternative: `rose-outline` or use emoji `💐` with a custom renderer.

6. **`musical-notes-outline` icon:** Verify this exists in the Ionicons set used by the app. Alternative: `musical-note-outline`.

7. **PreferencesSheet hardcoded array:** The categories array in PreferencesSheet.tsx is hardcoded, not derived from categories.ts. Both must be updated independently.

---

## 15. Handoff to Implementor

Implementor: this is your single source of truth. §3 is the design principle — slugs are stable, display names are the changeable layer. §4 defines what is authoritative vs derived. Execute in order from §11. The SQL migration (Step 1) MUST run before backend changes are deployed, otherwise the query_pool_cards function won't match cards with old names against new display names.

Key attention areas:
- The data backfill in §10.2 is the most critical piece — test it against a copy of production data first
- The Groceries exclusion in query_pool_cards (§8.10) must use the `<@` operator, not a simple `= ANY` check
- Every edge function hardcoded list was identified in §8 — check each one
- Mobile has TWO parallel category definitions (categories.ts + PreferencesSheet hardcoded) — both must change

Produce IMPLEMENTATION_REPORT.md referencing each section, hand to tester. Not done until tester's report is green.
