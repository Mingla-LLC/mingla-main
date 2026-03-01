# Feature: Groceries & Flowers Category
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Add a new category "Groceries & Flowers" that queries grocery_store and supermarket, styled like Nature (no Policies & Reservations button, no booking).

## Summary
Adds an 11th category — **Groceries & Flowers** — to the Mingla category system. This category surfaces grocery stores, supermarkets, and flower shops via the Google Places API (New) using `grocery_store` and `supermarket` place types. Cards rendered under this category follow the same minimal design as Nature cards: no "Policies & Reservations" button (already gated behind `isFirstMeet` — no code change needed), and no booking/buy-now section (data-driven — grocery stores rarely return booking options).

## User Story
As a user, I want to discover nearby grocery stores, supermarkets, and flower shops so that I can plan shopping errands or pick up flowers as part of a date or outing.

## Category Definition

| Field | Value |
|-------|-------|
| **Slug** | `groceries_flowers` |
| **Display Name** | `Groceries & Flowers` |
| **Emoji** | 🛒 |
| **Ionicon** | `cart-outline` |
| **Color** | `#22C55E` (green-500 — bright fresh green, distinct from Nature's #10B981) |
| **Activity Type** | `stationary` |
| **Duration** | `short` |
| **Place Types** | `grocery_store`, `supermarket` |

## Architecture Impact

### Modified Files (10 files)
1. `app-mobile/src/constants/categories.ts` — add full `Category` object to `categories` array
2. `app-mobile/src/utils/categoryUtils.ts` — add entries to all 4 lookup maps
3. `app-mobile/src/components/PreferencesSheet.tsx` — add to `categories` array + `INTENT_CATEGORY_COMPATIBILITY`
4. `app-mobile/src/components/CollaborationPreferences.tsx` — same as PreferencesSheet
5. `supabase/functions/_shared/categoryPlaceTypes.ts` — add to `MINGLA_CATEGORY_PLACE_TYPES` + `CATEGORY_ALIASES`
6. `supabase/functions/generate-experiences/index.ts` — add to `CATEGORY_MAPPINGS` + `EXCLUDED_TYPES`
7. `supabase/functions/generate-session-experiences/index.ts` — add to `CATEGORY_MAPPINGS` + `EXCLUDED_TYPES`
8. `supabase/functions/discover-experiences/index.ts` — add to `DISCOVER_CATEGORIES` + `PREF_ID_TO_DISCOVER_CATEGORY` + `CATEGORY_TO_PLACE_TYPES`
9. `supabase/functions/recommendations-enhanced/index.ts` — add to `CATEGORY_MAPPINGS`

### New Files
None.

### New DB Tables/Columns
None. The existing `preferences.categories` column (text array) already supports arbitrary category display names. The DB default (`ARRAY['Nature', 'Casual Eats', 'Drink']`) does NOT change — users who want Groceries & Flowers select it manually.

### No UI Changes Required for Card Design
The "Nature-like" card design is **already the default behavior** for any category that isn't First Meet:
- **"Policies & Reservations" button** — only renders when `card.category === 'First Meet'` (in `ActionButtons.tsx` line 627). No code change needed.
- **"Buy Now" button** — only renders when `hasBookingOptions` is true (data-driven). Grocery stores rarely return booking options from Google Places, so this naturally doesn't appear.

## Edge Function Spec

No new edge functions required. Existing functions are extended with the new category mapping:

### Place Type Mapping (all edge functions)
```typescript
'Groceries & Flowers': ['grocery_store', 'supermarket']
```

### Excluded Types (generate-experiences, generate-session-experiences)
```typescript
'groceries_flowers': [
  'bar', 'night_club', 'casino', 'movie_theater', 'video_arcade',
  'bowling_alley', 'fine_dining_restaurant', 'fast_food_restaurant',
  'food_court', 'atm', 'bank', 'parking', 'gas_station', 'airport',
  'car_repair', 'car_dealer', 'storage', 'post_office',
  'government_office', 'courthouse', 'police', 'fire_station',
  'city_hall', 'apartment_building', 'housing_complex'
]
```

### Recommendations-Enhanced Keywords & Activities
```typescript
'groceries_flowers': {
  places: ['grocery_store', 'supermarket'],
  keywords: ['grocery', 'supermarket', 'flowers', 'florist', 'produce', 'fresh', 'market', 'organic', 'bouquet'],
  activities: ['grocery shopping', 'flower shopping', 'market visit', 'fresh produce']
}
```

## Mobile Implementation

### Modified Components
- **`PreferencesSheet.tsx`** — add `{ id: "groceries_flowers", label: "Groceries & Flowers", icon: "cart-outline" }` to `categories` array
- **`CollaborationPreferences.tsx`** — same addition

### Modified Constants
- **`categories.ts`** — add full `Category` object as 11th entry

### Modified Utils
- **`categoryUtils.ts`** — add to `getReadableCategoryName`, `getCategorySlug`, `getCategoryIcon`, `getCategoryColor`

### State Changes
- **Zustand:** None
- **React Query keys affected:** None (existing keys include category dynamically)

## Intent Compatibility

| Intent | Includes Groceries & Flowers? | Rationale |
|--------|-------------------------------|-----------|
| `solo-adventure` | Yes (null = all) | Already allows all categories |
| `first-dates` | No | Not a typical first-date activity |
| `romantic` | No | Not a romantic venue |
| `friendly` | Yes (null = all) | Already allows all categories |
| `group-fun` | No | Not a group activity venue |
| `business` | No | Not a business meeting venue |

**No changes to `INTENT_CATEGORY_COMPATIBILITY`** — the two intents that allow all categories (`solo-adventure`, `friendly`) already use `null` (all). The restrictive intents don't include grocery shopping.

## RLS Policies
No new tables — no RLS changes needed.

## Test Cases
1. **Preferences selection:** Open PreferencesSheet → scroll to see "Groceries & Flowers" pill with cart icon → tap to select → save → verify it persists in preferences
2. **Card generation:** Select "Groceries & Flowers" as sole category → request cards → verify returned places are grocery stores/supermarkets (not restaurants or parks)
3. **Expanded card — no policies button:** Tap on a Groceries & Flowers card → expand → verify NO "Policies & Reservations" button appears
4. **Expanded card — no buy now button:** Verify "Buy Now" button does not appear (unless the store actually has booking data, which is rare)
5. **Intent filtering:** Select "first-dates" intent → verify "Groceries & Flowers" pill is NOT shown. Select "solo-adventure" → verify it IS shown.
6. **Collaboration session:** In collaboration mode → verify "Groceries & Flowers" appears in CollaborationPreferences with same behavior
7. **Edge function resolution:** Call generate-experiences with category "Groceries & Flowers" → verify it resolves to `grocery_store`, `supermarket` place types
8. **Discover tab:** Verify "Groceries & Flowers" appears in discover categories and returns grocery/supermarket results

## Success Criteria
- [ ] "Groceries & Flowers" appears as a selectable pill in PreferencesSheet and CollaborationPreferences
- [ ] Cards returned are grocery stores and supermarkets, not other venue types
- [ ] Expanded cards show the Nature-like minimal layout (no policies button, no booking)
- [ ] All 4+ edge functions correctly resolve the new category to the right place types
- [ ] Intent filtering correctly includes/excludes the category
