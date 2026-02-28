# Implementation Report: Category System Overhaul v2

**Date:** 2026-02-28
**Branch:** Seth-Features
**Spec:** `FEATURE_CATEGORY_OVERHAUL_SPEC.md`

---

## Summary

Replaced the old 9-category experience system with a new 10-category system across the entire Mingla codebase. Every file that referenced the old category slugs, names, or place-type mappings has been updated.

---

## Old Categories → New Categories

| Old Slug / Name | New Slug | New Display Name |
|---|---|---|
| `stroll` / Take a Stroll | `nature` | Nature |
| `sip` / Sip & Chill | `drink` | Drink |
| `casual_eats` / Casual Eats | `casual_eats` | Casual Eats *(unchanged)* |
| `screen_relax` / Screen & Relax | `watch` | Watch |
| `creative` / Creative & Hands-On | `creative_arts` | Creative & Arts |
| `picnics` / Picnics | `picnic` | Picnic |
| `play_move` / Play & Move | `play` | Play |
| `dining` / Dining Experiences | `fine_dining` | Fine Dining |
| `wellness` / Wellness Dates | `wellness` | Wellness *(unchanged)* |
| *(new)* | `first_meet` | First Meet |

---

## Files Changed

### 1. `supabase/migrations/20260228000001_update_categories.sql` *(CREATED)*
- Migrates `preferences.categories` column: remaps all old category names to new names, resets invalid/empty arrays to new default `['Nature', 'Casual Eats', 'Drink']`.
- Migrates `experiences.category` column: `CASE` statement remapping all old slug values to new slugs.

### 2. `app-mobile/src/constants/categories.ts`
- Replaced the `categories` array (9 old entries) with 10 new `Category` objects.
- Each new entry has: `slug`, `name`, `icon` (emoji), `description`, `detailedDescription`, `expectedActivities`, `apiMapping.googleMaps.coreAnchors`, `logic.hierarchy`, `ux.activeColor`, `compatibleWith`, `incompatibleWith`, `activityType`, `duration`.
- No changes to the `Category` interface or utility functions.

### 3. `app-mobile/src/utils/categoryUtils.ts`
- Updated all 4 lookup maps:
  - `getReadableCategoryName()`: new slug → display name mappings + legacy slug → new name fallbacks
  - `getCategorySlug()`: new display name → slug + legacy name → new slug fallbacks
  - `getCategoryIcon()`: new slugs → Ionicons names (`leaf-outline`, `chatbubbles-outline`, `basket-outline`, `wine-outline`, `fast-food-outline`, `restaurant-outline`, `film-outline`, `color-palette-outline`, `game-controller-outline`, `body-outline`)
  - `getCategoryColor()`: new slugs → hex colors matching spec (`#10B981`, `#6366F1`, `#84CC16`, `#F59E0B`, `#F97316`, `#7C3AED`, `#3B82F6`, `#EC4899`, `#EF4444`, `#14B8A6`)

### 4. `app-mobile/src/components/PreferencesSheet.tsx`
- Replaced local `categories` array with 10 new entries using new slugs as IDs.
- Replaced `INTENT_CATEGORY_COMPATIBILITY` map with new intent → new-slug arrays:
  - `first-dates`: nature, first_meet, drink, watch, creative_arts, picnic
  - `romantic`: first_meet, drink, picnic, fine_dining, wellness, nature
  - `group-fun`: play, creative_arts, casual_eats, watch, drink
  - `business`: first_meet, drink, fine_dining
  - `solo-adventure` / `friendly`: null (no restriction)
- Updated `shouldHide` budget section prop: `"Stroll"` → `"nature"`

### 5. `app-mobile/src/components/CollaborationPreferences.tsx`
- Same two edits as `PreferencesSheet.tsx`: `categories` array and `INTENT_CATEGORY_COMPATIBILITY`.
- Budget section hide: `selectedCategories[0] === "Stroll"` → `selectedCategories[0] === "nature"`

### 6. `supabase/functions/generate-experiences/index.ts`
- Replaced `CATEGORY_MAPPINGS` (was ~478 lines of repeated old-category key variants) with a compact 10-category version keyed on new slugs plus common display-name variants.
- Replaced `EXCLUDED_TYPES` (was ~1530 lines of repeated old-category key variants) with a compact 10-category version via Node.js string replacement (file too large for Edit tool).
- Stage 2 budget filter: renamed `isStrollCard` → `isNatureCard`; added `categoryKey === "nature"` check; retained legacy stroll fallbacks for old DB records.
- Stage 3.5 hard filter: same `isNatureCard` rename; added `beach`, `national_park`, `state_park`, `wildlife_park` to `validAnchorTypes`.

### 7. `supabase/functions/generate-session-experiences/index.ts`
- Replaced `CATEGORY_MAPPINGS` (old 9-category, many key variants) with new 10-category compact version via Node.js string replacement.
- Replaced `EXCLUDED_TYPES` (old, large block) with new 10-category compact version via same approach.
- Stage 2 budget filter: renamed `isStrollCard` → `isNatureCard`; added `categoryKey === "nature"` check.

### 8. `supabase/functions/discover-experiences/index.ts`
- Replaced `DISCOVER_CATEGORIES` array: 9 old display names → 10 new display names.
- Replaced `CATEGORY_TO_PLACE_TYPES`: 9 old category keys → 10 new category keys with updated Google Places types per spec.
- Featured card filter: `"Dining Experiences"` → `"Fine Dining"` (2 occurrences + log string).
- `generateFallbackDescription()`: all 9 old category string keys → 10 new keys.
- `generateFallbackHighlights()`: same.

### 9. `supabase/functions/recommendations-enhanced/index.ts`
- Replaced `CATEGORY_MAPPINGS` object: renamed old slugs (`play_move` → `play`, `dining` → `fine_dining`, `screen_relax` → `watch`, `creative` → `creative_arts`, `sip` → `drink`, `stroll` → `nature`); added new categories `first_meet`, `picnic`, `wellness`; updated Google Places types in `places` arrays.
- Replaced local `categoryKeywords` scoring map: same slug renames + new entries.
- Context-aware boost arrays: `["dining", "sip", "screen_relax"]` → `["fine_dining", "drink", "watch"]`; `["sip", "casual_eats", "screen_relax"]` → `["drink", "casual_eats", "watch"]`.

---

## Google Places Types per Category

| Category | Core `includedTypes` |
|---|---|
| `nature` | park, botanical_garden, hiking_area, national_park, state_park, beach, zoo, wildlife_park |
| `first_meet` | bookstore, bar, pub, wine_bar, tea_house, coffee_shop, planetarium |
| `picnic` | picnic_ground, park, beach, botanical_garden |
| `drink` | bar, pub, wine_bar, tea_house, coffee_shop |
| `casual_eats` | sandwich_shop, fast_food_restaurant, pizza_restaurant, hamburger_restaurant, ramen_restaurant, noodle_restaurant, sushi_restaurant, american_restaurant, mexican_restaurant, chinese_restaurant, japanese_restaurant, korean_restaurant, thai_restaurant, vietnamese_restaurant, indian_restaurant, diner, food_court |
| `fine_dining` | fine_dining_restaurant, steak_house, french_restaurant, greek_restaurant, italian_restaurant |
| `watch` | movie_theater, comedy_club |
| `creative_arts` | art_gallery, museum, planetarium, karaoke, coffee_roastery |
| `play` | bowling_alley, amusement_park, water_park, video_arcade, karaoke, casino, trampoline_park, mini_golf_course, ice_skating_rink, skate_park, escape_room, adventure_park |
| `wellness` | spa, sauna, hot_spring |

---

## Notes

- **Legacy fallbacks retained:** The `isNatureCard` checks in both `generate-experiences` and `generate-session-experiences` keep the old `"stroll"` / `"take a stroll"` string checks as fallbacks. These handle existing database `experiences.category` records that haven't been migrated yet. Once the SQL migration is applied, these fallbacks become dead code but cause no harm.
- **Backwards-compatibility variants:** `CATEGORY_MAPPINGS` in the generation functions includes multiple key variants per category (e.g. `"casual eats"`, `"Casual Eats"`, `"casual-eats"`, `casualeats`) to handle any existing records or API calls using mixed casing or separators.
- **Node.js replacement scripts:** The large `EXCLUDED_TYPES` blocks were replaced using `fix_session_categories.js` (a temporary helper script in the repo root) because the blocks exceeded the Edit tool's practical size limit. These helper scripts can be deleted after review.

---

## To Deploy

1. Run the SQL migration: `supabase/migrations/20260228000001_update_categories.sql`
2. Deploy all 4 updated Edge Functions: `generate-experiences`, `generate-session-experiences`, `discover-experiences`, `recommendations-enhanced`
3. Publish new app build with updated `categories.ts`, `categoryUtils.ts`, `PreferencesSheet.tsx`, `CollaborationPreferences.tsx`
