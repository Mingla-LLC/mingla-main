# Feature: Category System Overhaul (v2)
**Date:** 2026-02-28
**Status:** Planned
**Branch:** Seth-Features

---

## Summary

Replace the current 9-category experience system (Take a Stroll, Sip & Chill, Casual Eats, Screen & Relax, Creative & Hands-On, Picnics, Play & Move, Dining Experiences, Wellness Dates, Freestyle) with a new 10-category system that is more precise, better aligned with the Google Places API (New) type taxonomy, and clearer for users. The new categories are: **Nature, First Meet, Picnic, Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness.** These changes propagate across the swipe engine, preferences sheet, discover page, collaboration sessions, onboarding, and the generate-experiences edge function.

---

## User Story

As a Mingla user, I want to choose from clearly defined experience categories (like "Drink", "Fine Dining", or "Nature") so that the app generates exactly the kinds of cards that match my mood — and my friends' moods when planning together.

---

## New Category Definitions

| Slug | Display Name | Emoji | Ionicon | Color |
|------|-------------|-------|---------|-------|
| `nature` | Nature | 🌿 | `leaf-outline` | `#10B981` |
| `first_meet` | First Meet | 🤝 | `chatbubbles-outline` | `#6366F1` |
| `picnic` | Picnic | 🧺 | `basket-outline` | `#84CC16` |
| `drink` | Drink | 🍹 | `wine-outline` | `#F59E0B` |
| `casual_eats` | Casual Eats | 🍔 | `fast-food-outline` | `#F97316` |
| `fine_dining` | Fine Dining | 🍽️ | `restaurant-outline` | `#7C3AED` |
| `watch` | Watch | 🎬 | `film-outline` | `#3B82F6` |
| `creative_arts` | Creative & Arts | 🎨 | `color-palette-outline` | `#EC4899` |
| `play` | Play | 🎯 | `game-controller-outline` | `#EF4444` |
| `wellness` | Wellness | 🧘 | `body-outline` | `#14B8A6` |

---

## Google Places API (New) Type Mappings

> **Note on non-standard types:** Some user-requested types are not in the official Google Places API (New) taxonomy. These are marked with `[TEXT]` — they require text search (`searchText`) rather than type-based nearby search (`searchNearby`). The existing edge function uses `includedTypes` in Nearby Search; for non-standard types, the API will silently ignore them. The CATEGORY_MAPPINGS include them but the edge function will only return results for recognized types. This is acceptable behavior — unrecognized types produce empty buckets and the function falls back to other types in the array.

### Nature
```
park, botanical_garden, hiking_area, national_park, state_park, beach, zoo, wildlife_park
```
*Excluded:* bar, night_club, casino, movie_theater, bowling_alley, fine_dining_restaurant

### First Meet
```
bookstore, bar, pub, wine_bar, tea_house, coffee_shop, planetarium
```
*Excluded:* amusement_park, water_park, bowling_alley, spa, massage

### Picnic
```
picnic_ground, park, beach, botanical_garden
```
*Excluded:* dog_park, amusement_park, water_park, bar, night_club, casino, movie_theater

### Drink
```
bar, pub, wine_bar, tea_house, coffee_shop
```
*Excluded:* fine_dining_restaurant, spa, amusement_park

### Casual Eats
```
buffet_restaurant, brunch_restaurant, diner, fast_food_restaurant, food_court,
hamburger_restaurant, pizza_restaurant, ramen_restaurant, sandwich_shop, sushi_restaurant,
afghani_restaurant, african_restaurant, american_restaurant, asian_restaurant,
barbecue_restaurant, brazilian_restaurant, breakfast_restaurant, indian_restaurant,
indonesian_restaurant, japanese_restaurant, korean_restaurant, lebanese_restaurant,
mediterranean_restaurant, mexican_restaurant, middle_eastern_restaurant, seafood_restaurant,
spanish_restaurant, thai_restaurant, turkish_restaurant, vegan_restaurant,
vegetarian_restaurant, vietnamese_restaurant, chinese_restaurant
```
*Excluded:* fine_dining_restaurant, bar, night_club, spa

### Fine Dining
```
fine_dining_restaurant, steak_house, french_restaurant, greek_restaurant, italian_restaurant
```
> chef_led_restaurant and upscale_restaurant are NOT official Google Places API types.
> They are omitted — fine_dining_restaurant covers this segment.

*Excluded:* fast_food_restaurant, food_court, bar, bowling_alley, amusement_park

### Watch
```
movie_theater, comedy_club
```
> cinema is mapped to movie_theater in Google Places API.
*Excluded:* spa, botanical_garden, park, restaurant

### Creative & Arts
```
art_gallery, museum, planetarium, karaoke, coffee_roastery
```
> pottery, sip_and_paint, cooking_classes, woodworking_class, jewelry_making_studio,
> sewing_class, glass_blowing_studio, diy_workshop, perfume_lab, flower_arranging_studio,
> bakery_workshop are NOT official Google Places API types. They are stored in a
> TEXT_SEARCH_TERMS array in the edge function for future text-search support.

*Excluded:* fast_food_restaurant, bar, bowling_alley, spa

### Play
```
bowling_alley, amusement_park, water_park, video_arcade, karaoke, casino,
trampoline_park, mini_golf_course, ice_skating_rink, skate_park, escape_room, adventure_park
```
> roller_coaster, ferris_wheel, rock_climbing_gym, batting_cages, laser_tag_center,
> paintball_center, billiards_hall, dart_bar, board_game_cafe, virtual_reality_center,
> go_kart_track are NOT standard Google Places API types. The API will ignore unrecognized
> types; the valid types above will still produce results.

*Excluded:* spa, massage, botanical_garden, fine_dining_restaurant

### Wellness
```
spa, sauna, hot_spring
```
> massage, turkish_bath, float_tank_center, public_bath, cold_plunge_facility are NOT
> official Google Places API types. They will be stored in TEXT_SEARCH_TERMS for future support.

*Excluded:* bar, night_club, casino, bowling_alley, amusement_park, fast_food_restaurant

---

## Category Compatibility Matrix

Used by the Collaboration system to reconcile different users' preferences.

| Category | Compatible With | Incompatible With |
|----------|----------------|-------------------|
| nature | picnic, wellness, creative_arts | watch, fine_dining, play |
| first_meet | drink, watch, creative_arts | wellness, picnic |
| picnic | nature, drink, casual_eats | fine_dining, watch, wellness |
| drink | first_meet, casual_eats, fine_dining, watch, play, creative_arts, picnic | wellness, nature |
| casual_eats | drink, watch, play, picnic | wellness, fine_dining |
| fine_dining | drink, watch | casual_eats, picnic, play, nature |
| watch | drink, casual_eats, fine_dining, first_meet | nature, picnic, wellness |
| creative_arts | drink, first_meet, nature, play | wellness, fine_dining |
| play | drink, casual_eats, creative_arts | wellness, fine_dining, nature |
| wellness | nature | play, drink, watch, casual_eats, fine_dining |

---

## Intent → Category Compatibility (PreferencesSheet)

Maps the 6 experience intent types to which categories make sense for them.
`null` means all categories are allowed.

| Intent | Allowed Categories |
|--------|--------------------|
| solo-adventure | `null` (all) |
| first-dates | Nature, First Meet, Drink, Watch, Creative & Arts, Picnic |
| romantic | First Meet, Drink, Picnic, Fine Dining, Wellness, Nature |
| friendly | `null` (all) |
| group-fun | Play, Creative & Arts, Casual Eats, Watch, Drink |
| business | First Meet, Drink, Fine Dining |

---

## Architecture Impact

### Modified Files

| File | Change |
|------|--------|
| `app-mobile/src/constants/categories.ts` | Full rewrite — 10 new Category objects |
| `app-mobile/src/utils/categoryUtils.ts` | Update all slug/icon/color maps to new slugs |
| `app-mobile/src/components/PreferencesSheet.tsx` | Update `categories` array + `INTENT_CATEGORY_COMPATIBILITY` |
| `supabase/functions/generate-experiences/index.ts` | Replace `CATEGORY_MAPPINGS` + `EXCLUDED_TYPES` entirely |
| `supabase/functions/recommendations-enhanced/index.ts` | Update any category mappings (search file for old category names) |
| `supabase/functions/discover-experiences/index.ts` | Update any category mappings |
| `supabase/functions/generate-session-experiences/index.ts` | Update any category mappings |
| `app-mobile/src/components/OnboardingFlow.tsx` | Update intent-to-category mapping (search for old category IDs) |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Update any hardcoded categories |
| `app-mobile/src/components/DiscoverScreen.tsx` | Update any hardcoded categories |
| `supabase/schema.sql` | Update default for `preferences.categories` |

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260228000001_update_categories.sql` | DB migration — update defaults + migrate existing user data |

### No New Tables or Columns Needed

The schema already has:
- `preferences.categories text[]` — stores array of category IDs
- `experiences.category text` — stores single category per experience

---

## Database Migration

```sql
-- Migration: Category System Overhaul v2
-- Date: 2026-02-28
-- Replaces old 9-category system with new 10-category system

BEGIN;

-- 1. Update default value for new users
ALTER TABLE public.preferences
  ALTER COLUMN categories SET DEFAULT ARRAY['Nature', 'Casual Eats', 'Drink'];

-- 2. Migrate existing user preferences (old name -> new name)
UPDATE public.preferences
SET categories = (
  SELECT array_agg(DISTINCT new_name)
  FROM unnest(categories) AS old_cat
  JOIN (VALUES
    ('Stroll',                'Nature'),
    ('stroll',                'Nature'),
    ('Take a Stroll',         'Nature'),
    ('take a stroll',         'Nature'),
    ('take_a_stroll',         'Nature'),
    ('Sip & Chill',           'Drink'),
    ('sip',                   'Drink'),
    ('sip & chill',           'Drink'),
    ('sip_and_chill',         'Drink'),
    ('Casual Eats',           'Casual Eats'),
    ('casual_eats',           'Casual Eats'),
    ('casual eats',           'Casual Eats'),
    ('screenRelax',           'Watch'),
    ('Screen & Relax',        'Watch'),
    ('screen_relax',          'Watch'),
    ('screen & relax',        'Watch'),
    ('Creative & Hands-On',   'Creative & Arts'),
    ('creative',              'Creative & Arts'),
    ('creative_and_hands_on', 'Creative & Arts'),
    ('Picnics',               'Picnic'),
    ('picnics',               'Picnic'),
    ('picnic',                'Picnic'),
    ('Play & Move',           'Play'),
    ('play_move',             'Play'),
    ('play & move',           'Play'),
    ('play_and_move',         'Play'),
    ('Dining Experiences',    'Fine Dining'),
    ('dining',                'Fine Dining'),
    ('dining_experiences',    'Fine Dining'),
    ('Dining Experience',     'Fine Dining'),
    ('Wellness Dates',        'Wellness'),
    ('wellness',              'Wellness'),
    ('wellness_dates',        'Wellness'),
    ('wellness dates',        'Wellness'),
    ('Freestyle',             'Nature'),
    ('freestyle',             'Nature')
  ) AS mapping(old_name, new_name) ON lower(old_cat) = lower(old_name)
  WHERE new_name IS NOT NULL
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;

-- 3. Handle users with unmapped or null categories (give them safe defaults)
UPDATE public.preferences
SET categories = ARRAY['Nature', 'Casual Eats', 'Drink']
WHERE categories IS NULL OR array_length(categories, 1) = 0;

-- 4. Migrate experiences.category values
UPDATE public.experiences
SET category = CASE lower(category)
  WHEN 'stroll'                THEN 'nature'
  WHEN 'take a stroll'         THEN 'nature'
  WHEN 'take_a_stroll'         THEN 'nature'
  WHEN 'sip'                   THEN 'drink'
  WHEN 'sip & chill'           THEN 'drink'
  WHEN 'sip_and_chill'         THEN 'drink'
  WHEN 'casual_eats'           THEN 'casual_eats'
  WHEN 'casual eats'           THEN 'casual_eats'
  WHEN 'screenrelax'           THEN 'watch'
  WHEN 'screen & relax'        THEN 'watch'
  WHEN 'screen_relax'          THEN 'watch'
  WHEN 'creative'              THEN 'creative_arts'
  WHEN 'creative & hands-on'   THEN 'creative_arts'
  WHEN 'creative_and_hands_on' THEN 'creative_arts'
  WHEN 'picnics'               THEN 'picnic'
  WHEN 'play_move'             THEN 'play'
  WHEN 'play & move'           THEN 'play'
  WHEN 'play_and_move'         THEN 'play'
  WHEN 'dining'                THEN 'fine_dining'
  WHEN 'dining experiences'    THEN 'fine_dining'
  WHEN 'dining_experiences'    THEN 'fine_dining'
  WHEN 'wellness dates'        THEN 'wellness'
  WHEN 'wellness_dates'        THEN 'wellness'
  WHEN 'freestyle'             THEN 'nature'
  ELSE category
END
WHERE category IS NOT NULL;

COMMIT;
```

---

## Edge Function: generate-experiences — New CATEGORY_MAPPINGS

The full replacement for the `CATEGORY_MAPPINGS` object. Each category has multiple key format variations to handle whatever string format arrives from the client (slug, display name, hyphenated, etc.).

### Nature
Keys: `nature`, `"Nature"`, `"nature-outdoor"`
Types: `park, botanical_garden, hiking_area, national_park, state_park, beach, zoo, wildlife_park`

### First Meet
Keys: `first_meet`, `"first meet"`, `"First Meet"`, `"first-meet"`, `firstmeet`
Types: `bookstore, bar, pub, wine_bar, tea_house, coffee_shop, planetarium`

### Picnic
Keys: `picnic`, `"Picnic"`
Types: `picnic_ground, park, beach, botanical_garden`

### Drink
Keys: `drink`, `"Drink"`
Types: `bar, pub, wine_bar, tea_house, coffee_shop`

### Casual Eats
Keys: `casual_eats`, `"casual eats"`, `"Casual Eats"`, `"casual-eats"`, `casualeats`
Types: `buffet_restaurant, brunch_restaurant, diner, fast_food_restaurant, food_court, hamburger_restaurant, pizza_restaurant, ramen_restaurant, sandwich_shop, sushi_restaurant, afghani_restaurant, african_restaurant, american_restaurant, asian_restaurant, barbecue_restaurant, brazilian_restaurant, breakfast_restaurant, indian_restaurant, indonesian_restaurant, japanese_restaurant, korean_restaurant, lebanese_restaurant, mediterranean_restaurant, mexican_restaurant, middle_eastern_restaurant, seafood_restaurant, spanish_restaurant, thai_restaurant, turkish_restaurant, vegan_restaurant, vegetarian_restaurant, vietnamese_restaurant, chinese_restaurant`

### Fine Dining
Keys: `fine_dining`, `"fine dining"`, `"Fine Dining"`, `"fine-dining"`, `finedining`
Types: `fine_dining_restaurant, steak_house, french_restaurant, greek_restaurant, italian_restaurant`

### Watch
Keys: `watch`, `"Watch"`
Types: `movie_theater, comedy_club`

### Creative & Arts
Keys: `creative_arts`, `"creative & arts"`, `"Creative & Arts"`, `"creative-arts"`, `creativearts`, `"creative arts"`
Types: `art_gallery, museum, planetarium, karaoke, coffee_roastery`

### Play
Keys: `play`, `"Play"`
Types: `bowling_alley, amusement_park, water_park, video_arcade, karaoke, casino, trampoline_park, mini_golf_course, ice_skating_rink, skate_park, escape_room, adventure_park`

### Wellness
Keys: `wellness`, `"Wellness"`
Types: `spa, sauna, hot_spring`

---

## New EXCLUDED_TYPES

```typescript
const EXCLUDED_TYPES: { [key: string]: string[] } = {
  nature: [
    "bar", "night_club", "casino", "movie_theater", "video_arcade",
    "bowling_alley", "fine_dining_restaurant", "fast_food_restaurant",
    "food_court", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office", "government_office",
    "courthouse", "police", "fire_station", "city_hall",
    "apartment_building", "housing_complex"
  ],
  first_meet: [
    "amusement_park", "water_park", "bowling_alley", "spa", "sauna",
    "massage", "fine_dining_restaurant", "fast_food_restaurant", "food_court",
    "night_club", "casino", "parking", "atm", "bank", "gas_station"
  ],
  picnic: [
    "dog_park", "cycling_park", "amusement_park", "park_and_ride",
    "water_park", "bar", "night_club", "casino", "movie_theater",
    "video_arcade", "atm", "bank", "parking", "gas_station", "airport",
    "car_repair", "car_dealer", "storage", "post_office", "government_office",
    "courthouse", "police", "fire_station", "city_hall", "apartment_building"
  ],
  drink: [
    "fine_dining_restaurant", "spa", "sauna", "massage", "amusement_park",
    "water_park", "bowling_alley", "atm", "bank", "parking", "gas_station",
    "airport", "car_repair"
  ],
  casual_eats: [
    "fine_dining_restaurant", "bar", "night_club", "spa", "amusement_park",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police"
  ],
  fine_dining: [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "video_arcade", "night_club",
    "atm", "bank", "parking", "gas_station", "car_repair"
  ],
  watch: [
    "spa", "sauna", "botanical_garden", "park", "beach", "restaurant",
    "atm", "bank", "parking", "gas_station", "government_office"
  ],
  creative_arts: [
    "fast_food_restaurant", "food_court", "bar", "bowling_alley",
    "amusement_park", "water_park", "spa", "sauna", "night_club",
    "atm", "bank", "parking", "gas_station", "government_office"
  ],
  play: [
    "spa", "sauna", "massage", "botanical_garden", "fine_dining_restaurant",
    "atm", "bank", "parking", "gas_station", "airport", "car_repair",
    "government_office", "courthouse", "police", "fire_station", "city_hall"
  ],
  wellness: [
    "bar", "night_club", "casino", "bowling_alley", "amusement_park",
    "water_park", "video_arcade", "fast_food_restaurant", "food_court",
    "atm", "bank", "parking", "gas_station", "government_office", "airport"
  ],
};
```

---

## Mobile Implementation — File-by-File Changes

### `app-mobile/src/constants/categories.ts`
**Action:** Full rewrite.
- Remove all 9 old Category objects.
- Add 10 new Category objects using the same `Category` interface (interface itself does not change).
- Each object must include: slug, name, icon (emoji), description, detailedDescription, expectedActivities, apiMapping (googleMaps.coreAnchors, googleMaps.attributes, eventbrite), logic (hardFilter, hierarchy, fallbackBehavior), ux (activeColor, subcategories, contextualPreview), compatibleWith, incompatibleWith, activityType, duration.
- Keep all existing utility functions (`getCategoryBySlug`, `areCategoriesCompatible`, `getAvailableCategories`, etc.) unchanged — they work by reading from the `categories` array.

### `app-mobile/src/utils/categoryUtils.ts`
**Action:** Update all three lookup maps.
- `getReadableCategoryName()` — replace all old translation key → name mappings with new ones:
  - `'category.screen_nature'` → `'Nature'`
  - `'category.screen_drink'` → `'Drink'`
  - `'category.screen_relax'` → `'Watch'`
  - `'category.screen_creative'` → `'Creative & Arts'`
  - `'category.screen_dining'` → `'Fine Dining'`
  - `'category.screen_wellness'` → `'Wellness'`
  - `'category.screen_play'` → `'Play'`
  - `'nature'` / `'stroll'` / etc. → `'Nature'`
- `getCategorySlug()` — update `nameToSlugMap` with new name→slug pairs
- `getCategoryIcon()` — update `iconMap` with new slug→Ionicon pairs
- `getCategoryColor()` — update `colorMap` with new slug→hex pairs

### `app-mobile/src/components/PreferencesSheet.tsx`
**Action:** Two targeted edits.
1. Replace `categories` array (lines 83–101) with new 10-category array.
2. Replace `INTENT_CATEGORY_COMPATIBILITY` (lines 133–154) with updated compatibility map using new category IDs.

### `supabase/functions/generate-experiences/index.ts`
**Action:** Replace `CATEGORY_MAPPINGS` object and `EXCLUDED_TYPES` object entirely.

### Other edge functions (search and update)
Search each of the following for the strings `"stroll"`, `"sip"`, `"wellness dates"`, `"play & move"`, `"dining"`, `"creative"`:
- `supabase/functions/recommendations-enhanced/index.ts`
- `supabase/functions/discover-experiences/index.ts`
- `supabase/functions/generate-session-experiences/index.ts`

Update any matches to use the new category slugs/names.

### `app-mobile/src/components/OnboardingFlow.tsx`
Search for category IDs used in the intent-to-category mapping (around lines 186–228). Update old category IDs to new ones matching the new PreferencesSheet IDs.

---

## Test Cases

1. **Preferences Sheet — categories render correctly**
   Open PreferencesSheet. Verify 10 new categories appear: Nature, First Meet, Picnic, Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness. Verify old categories (Take a Stroll, Sip & Chill, Screen & Relax, etc.) are gone.

2. **Intent filtering — Romantic intent filters categories**
   Open PreferencesSheet with intent = "romantic". Verify only First Meet, Drink, Picnic, Fine Dining, Wellness, and Nature are selectable (all others grayed out or hidden).

3. **Swipe engine — cards generate for Nature**
   Select only "Nature" in preferences. Trigger card generation. Verify returned cards are for parks, botanical gardens, beaches, hiking areas, zoos — not restaurants, bars, or movie theaters.

4. **Swipe engine — cards generate for Fine Dining**
   Select only "Fine Dining". Trigger card generation. Verify cards are for fine_dining_restaurant, steak_house, french_restaurant, etc. — not fast food or bars.

5. **Collaboration session — category selection works**
   Create a collaboration session. Verify the 10 new categories appear in CollaborationPreferences. Verify compatibility warnings appear when incompatible categories are selected (e.g., Wellness + Play).

6. **Database migration — no broken preferences**
   After running the migration, query `SELECT DISTINCT unnest(categories) FROM preferences;`. Verify no old category names remain. Verify no null category arrays exist.

7. **Discover page — category filter chips reflect new categories**
   Open Discover page. Verify category filter chips show new category names, not old ones.

---

## Success Criteria

- [ ] Old categories (Take a Stroll, Sip & Chill, Screen & Relax, etc.) appear nowhere in the app UI
- [ ] All 10 new categories appear correctly in: PreferencesSheet, Onboarding, CollaborationPreferences, DiscoverScreen
- [ ] Card generation via `generate-experiences` edge function returns correct place types for each new category
- [ ] The database migration runs without errors and all user preferences contain only new category names
- [ ] Compatibility matrix correctly enables/disables categories in solo and collaboration modes based on intent selection
- [ ] Existing experience cards in the DB are migrated to new category slugs
- [ ] No TypeScript compilation errors across any modified files
