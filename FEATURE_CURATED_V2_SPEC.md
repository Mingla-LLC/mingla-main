# Feature: Category-Based Curated Experiences v2
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Replace keyword-based curated pairings with Mingla category-driven pairings

## Summary
Overhaul the curated experiences engine so that every multi-stop itinerary is built from Mingla's
own category system instead of hardcoded Google Place type triplets. Seven curated types replace
the old six (`solo-adventure`, `first-dates`, `romantic`, `friendly`, `group-fun`, `business`).
Two types (Picnic Dates, Take A Stroll) have unique sequential-proximity and bookend logic.
All card UI, expanded views, swipe mechanics, and pool integration remain unchanged.

## User Story
As a Mingla user, I want curated multi-stop experiences that pair places from recognizable
Mingla categories (Nature, Play, Fine Dining, etc.) so that each itinerary feels intentional
and aligned with the category system I already understand from the preferences screen.

---

## New Intent IDs (kebab-case, canonical)

| Old ID | New ID | Display Name |
|--------|--------|-------------|
| `solo-adventure` | `adventurous` | Adventurous |
| `first-dates` | `first-date` | First Date |
| `romantic` | `romantic` | Romantic |
| `friendly` | `friendly` | Friendly |
| `group-fun` | `group-fun` | Group Fun |
| `business` | _(removed)_ | — |
| _(new)_ | `picnic-dates` | Picnic Dates |
| _(new)_ | `take-a-stroll` | Take a Stroll |

---

## Curated Type -> Category Pool Map

```
CURATED_TYPE_CATEGORIES = {
  'adventurous':   ['Nature', 'First Meet', 'Casual Eats', 'Fine Dining', 'Creative & Arts', 'Play'],
  'first-date':    ['Fine Dining', 'Watch', 'Nature', 'First Meet', 'Creative & Arts', 'Play'],
  'romantic':      ['Fine Dining', 'Creative & Arts', 'Wellness'],
  'friendly':      ['Play', 'Creative & Arts', 'Watch', 'Fine Dining', 'Casual Eats', 'Nature'],
  'group-fun':     ['Play', 'Watch', 'Casual Eats'],
  'picnic-dates':  ['Groceries & Flowers', 'Picnic'],
  'take-a-stroll': ['Casual Eats', 'Nature'],
}
```

### Standard Types (adventurous, first-date, romantic, friendly, group-fun)
- Pool size > 3: pick 3 random categories per card (C(n,3) combos, shuffled)
- Pool size = 3: fixed combo, variety comes from different places within each category
- Each stop = 1 place from 1 category
- Result: 3-stop itinerary

### Picnic Dates (sequential proximity, 2 stops)
1. Nearby Search for **Groceries & Flowers** types (`grocery_store`, `supermarket`) near user
2. Pick nearest result = Stop 1
3. Using Stop 1's lat/lng as new center, Nearby Search for **Picnic** types (`park`, `garden`, `botanical_garden`, `beach`, `national_park`, `state_park`)
4. Pick nearest result = Stop 2
5. Result: 2-stop card (Stop 1: "Start Here", Stop 2: "End With")

### Take A Stroll (bookend pattern, 3 stops)
1. Nearby Search for **Nature** types near user
2. Pick nearest result = Nature spot
3. Using Nature spot's lat/lng, Nearby Search for **Casual Eats** types
4. Pick nearest result = Casual Eats spot
5. Timeline order: Casual Eats -> Nature -> Casual Eats (same place)
6. Stop 3 is a **clone** of the Casual Eats stop with `stopNumber: 3`, `stopLabel: 'End With'`
7. Result: 3-stop card where Stop 1 and Stop 3 share the same `placeId`

---

## Architecture Impact

### Modified Files (13 files)
| File | Change Scope |
|------|-------------|
| `supabase/functions/_shared/categoryPlaceTypes.ts` | Update `INTENT_IDS` set |
| `supabase/functions/generate-curated-experiences/index.ts` | **Major rewrite** — new generation logic |
| `app-mobile/src/constants/categories.ts` | Update `CURATED_EXPERIENCES` array |
| `app-mobile/src/utils/cardConverters.ts` | Update `INTENT_IDS` set |
| `app-mobile/src/services/curatedExperiencesService.ts` | Update `experienceType` union |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Update `experienceType` union |
| `app-mobile/src/services/deckService.ts` | Update intent mapping + fallback |
| `app-mobile/src/components/PreferencesSheet.tsx` | Update `experienceTypes`, compatibility matrix |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Mirror PreferencesSheet changes |
| `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` | Expand icon/label mapping |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Minor — update experienceType references |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Update collaboration mode intent |
| `app-mobile/src/types/curatedExperience.ts` | No structural change (experienceType is already `string`) |

### New Files: None
### New DB Tables: None
### New Migrations: None

---

## Edge Function Rewrite: `generate-curated-experiences/index.ts`

### What Gets REMOVED
- `PLACE_CATEGORIES` and `ADVENTURE_SUPER_CATEGORIES` (super-category definitions)
- `USER_CATEGORY_TO_PLACE_TYPES`, `buildAllowedPlaceTypes()`, `placeMatchesAllowedTypes()`
- All `PAIRINGS_BY_TYPE` maps (SOLO_ADVENTURE, FIRST_DATES, ROMANTIC, FRIENDLY, GROUP_FUN)
- `PLACE_TYPE_SEARCH_CONFIG` (50+ individual type configs)
- Turbo Pipeline: `fetchPlacesBySuperCategory()`, `buildTriadsFromSuperCategories()`
- `buildSingleStopCards()` (single-stop fallback)
- `enrichPoolWithNicheTypes()` (niche background enrichment)
- `fetchPlacesByCategory()`, `fetchPlacesByCategoryWithCache()`
- `resolvePairingFromCategories()`, `resolvePairing()`
- Both main handler branches (turbo pipeline + fallback pipeline)

### What Gets KEPT (unchanged)
- Imports, CORS headers, environment variables
- `aggregateSessionPreferences()` (collaboration mode)
- `STOP_DURATION_MINUTES` map (place type -> minutes)
- Price level helpers (`priceLevelToRange`, `priceLevelToLabel`)
- `searchNearby()` and `searchByText()` (base search functions)
- Helper functions: `scorePlace`, `topPlace`, `getPhotoUrl`, `parseOpeningHours`,
  `haversineKm`, `isPlaceOpenAt`, `estimateTravelMinutes`, `generateStopDescriptions`
- Pool integration: `upsertPlaceToPool`, `insertCardToPool`, `recordImpressions`

### What Gets ADDED

#### 1. Import shared category mapping
```typescript
import {
  MINGLA_CATEGORY_PLACE_TYPES,
  resolveCategory,
} from '../_shared/categoryPlaceTypes.ts';
```

#### 2. CURATED_TYPE_CATEGORIES map
```typescript
const CURATED_TYPE_CATEGORIES: Record<string, string[]> = {
  'adventurous':   ['Nature', 'First Meet', 'Casual Eats', 'Fine Dining', 'Creative & Arts', 'Play'],
  'first-date':    ['Fine Dining', 'Watch', 'Nature', 'First Meet', 'Creative & Arts', 'Play'],
  'romantic':      ['Fine Dining', 'Creative & Arts', 'Wellness'],
  'friendly':      ['Play', 'Creative & Arts', 'Watch', 'Fine Dining', 'Casual Eats', 'Nature'],
  'group-fun':     ['Play', 'Watch', 'Casual Eats'],
  'picnic-dates':  ['Groceries & Flowers', 'Picnic'],
  'take-a-stroll': ['Casual Eats', 'Nature'],
};
```

#### 3. CURATED_TYPE_LABELS map (for categoryLabel on cards)
```typescript
const CURATED_TYPE_LABELS: Record<string, string> = {
  'adventurous': 'Adventurous',
  'first-date': 'First Date',
  'romantic': 'Romantic',
  'friendly': 'Friendly',
  'group-fun': 'Group Fun',
  'picnic-dates': 'Picnic Dates',
  'take-a-stroll': 'Take a Stroll',
};
```

#### 4. Updated TAGLINES_BY_TYPE
```typescript
const TAGLINES_BY_TYPE: Record<string, string[]> = {
  'adventurous': [
    'Explore the unexpected — your next discovery awaits',
    'Three stops, endless possibilities',
    'Chart your own path through the city',
    'For the curious soul who loves to wander',
  ],
  'first-date': [
    'A thoughtful route for a great first impression',
    'Three stops to break the ice',
    'An effortless plan for getting to know someone',
    'Low pressure, high adventure',
  ],
  'romantic': [
    'A curated route for two',
    'Three stops to make the night unforgettable',
    'Romance awaits around every corner',
    'Set the mood with a plan worth sharing',
  ],
  'friendly': [
    'A day out worth catching up over',
    'Three stops, good company, great vibes',
    'The kind of plan friends remember',
    'Explore together, no planning needed',
  ],
  'group-fun': [
    'Rally the crew — adventure is calling',
    'Three stops of pure group energy',
    'Good times are better together',
    'A plan the whole squad will love',
  ],
  'picnic-dates': [
    'Grab supplies, find the perfect spot',
    'A picnic plan from store to park',
    'Simple pleasures, perfect together',
    'Your curated picnic, start to finish',
  ],
  'take-a-stroll': [
    'Eat, walk, eat — the perfect loop',
    'A scenic stroll bookended by great food',
    'Nature and bites, perfectly paired',
    'The casual combo that never gets old',
  ],
};
```

#### 5. TEXT_SEARCH_TYPES set (niche types needing text search instead of Nearby)
```typescript
const TEXT_SEARCH_TYPES = new Set([
  'sip_and_paint', 'pottery', 'cooking_classes', 'woodworking_class',
  'jewelry_making_studio', 'sewing_class', 'glass_blowing_studio',
  'diy_workshop', 'perfume_lab', 'flower_arranging_studio',
  'bakery_workshop', 'coffee_roastery', 'comedy_club',
  'chef_led_restaurant', 'upscale_restaurant',
  'float_tank_center', 'cold_plunge_facility',
  'adventure_park', 'roller_coaster', 'ferris_wheel',
  'rock_climbing_gym', 'batting_cages', 'laser_tag',
  'paintball', 'billiards_hall', 'dart_bar',
  'board_game_cafe', 'virtual_reality_center', 'go_kart_track',
]);
```

#### 6. `fetchPlacesForCategory()` — batch fetch per category
```
Input:  categoryName (string), location, radius
Logic:
  1. placeTypes = MINGLA_CATEGORY_PLACE_TYPES[categoryName]
  2. Split into nearbyTypes (not in TEXT_SEARCH_TYPES) and textTypes
  3. Nearby Search with includedTypes = nearbyTypes (max 10, randomly sampled if more)
  4. If results < 5 and textTypes exist, do 1-2 text searches for random textTypes
  5. Combine, dedupe by place ID, sort by scorePlace() descending
Output: Place[] (up to 20 per category)
```

#### 7. `generateStandardCards()` — for adventurous, first-date, romantic, friendly, group-fun
```
Input:  experienceType, location, budget, travel constraints, limit
Logic:
  1. pool = CURATED_TYPE_CATEGORIES[experienceType]
  2. Fetch places for ALL categories in pool (parallel Promise.all)
     -> categoryPlaces: Record<categoryName, Place[]>
  3. Generate category combos:
     - If pool.length > 3: all C(n,3) combos, shuffled
     - If pool.length === 3: single combo repeated `limit` times
  4. For each combo, build a card:
     a. For each of the 3 categories, pick top available place (not yet used globally)
     b. Build 3 stops: Stop 1 "Start Here", Stop 2 "Then", Stop 3 "End With"
     c. Validate: total budget <= budgetMax, travel within constraints
     d. If valid, add to results
  5. Return up to `limit` cards
Output: CuratedExperienceCard[]

API calls: ~1-2 per category in pool (parallel) = 3-12 total
```

#### 8. `generatePicnicCards()` — sequential proximity
```
Input:  location, budget, travel constraints, limit
Logic:
  1. Nearby Search for Groceries & Flowers types near user (radius from travel constraint)
     -> groceryPlaces[] sorted by distance ascending (nearest first)
  2. For each grocery place (up to limit):
     a. Nearby Search for Picnic types near grocery's lat/lng (radius: 3km)
     b. Pick nearest park
     c. Build 2-stop card:
        - Stop 1: grocery (Start Here)
        - Stop 2: park (End With)
     d. Validate budget + travel
  3. Return cards
Output: CuratedExperienceCard[] (2 stops each)

API calls: 1 (groceries) + N (parks near each grocery, can batch if nearby)
```

#### 9. `generateStrollCards()` — bookend pattern
```
Input:  location, budget, travel constraints, limit
Logic:
  1. Nearby Search for Nature types near user
     -> naturePlaces[] sorted by distance ascending
  2. For each nature place (up to limit):
     a. Nearby Search for Casual Eats types near nature's lat/lng (radius: 2km)
     b. Pick nearest casual eats
     c. Build 3-stop card:
        - Stop 1: casual eats (Start Here)
        - Stop 2: nature (Then)
        - Stop 3: CLONE of casual eats (End With) — same placeId, stopNumber=3, stopLabel='End With'
     d. Travel times:
        - Stop 1->2: casual eats to nature
        - Stop 2->3: nature back to casual eats (same distance as 1->2)
     e. Validate budget + travel
  3. Return cards
Output: CuratedExperienceCard[] (3 stops, stop 1 == stop 3)

API calls: 1 (nature) + N (casual eats near each nature spot)
```

#### 10. Updated main handler
```
Replaces both turbo pipeline and fallback pipeline with single unified flow:

1. Parse request (experienceType, location, budget, travel, batchSeed, etc.)
2. Validate experienceType is in CURATED_TYPE_CATEGORIES
3. Session aggregation if session_id provided
4. Route to generator:
   - 'picnic-dates'   -> generatePicnicCards()
   - 'take-a-stroll'  -> generateStrollCards()
   - everything else  -> generateStandardCards()
5. Fire-and-forget: pool storage (upsertPlaceToPool, insertCardToPool, recordImpressions)
6. Return { cards, metadata }
```

---

## Mobile Implementation

### Constants: `categories.ts` (CURATED_EXPERIENCES)
Replace the current array with:
```typescript
export const CURATED_EXPERIENCES = [
  { id: 'adventurous',   displayName: 'Adventurous',   icon: 'compass-outline',        color: '#F59E0B', description: 'Explore your city — great for adventurous souls',         isImplemented: true },
  { id: 'first-date',    displayName: 'First Date',    icon: 'people-outline',          color: '#6366F1', description: 'Low-pressure, memorable first impressions',               isImplemented: true },
  { id: 'romantic',      displayName: 'Romantic',       icon: 'heart-outline',           color: '#EC4899', description: 'A curated romantic evening',                              isImplemented: true },
  { id: 'friendly',      displayName: 'Friendly',       icon: 'people-outline',          color: '#3B82F6', description: 'Casual hangouts with close friends',                      isImplemented: true },
  { id: 'group-fun',     displayName: 'Group Fun',      icon: 'people-circle-outline',   color: '#EF4444', description: 'Activities everyone will enjoy',                          isImplemented: true },
  { id: 'picnic-dates',  displayName: 'Picnic Dates',   icon: 'basket-outline',          color: '#84CC16', description: 'Grab supplies, find the perfect spot',                    isImplemented: true },
  { id: 'take-a-stroll', displayName: 'Take a Stroll',  icon: 'walk-outline',            color: '#10B981', description: 'A scenic walk bookended by great food',                   isImplemented: true },
] as const;
```

### PreferencesSheet.tsx
```typescript
// Replace experienceTypes (line 66-73)
const experienceTypes = [
  { id: "adventurous",   label: "Adventurous",   icon: "compass-outline" },
  { id: "first-date",    label: "First Date",    icon: "people-outline" },
  { id: "romantic",      label: "Romantic",       icon: "heart-outline" },
  { id: "friendly",      label: "Friendly",       icon: "people-outline" },
  { id: "group-fun",     label: "Group Fun",      icon: "people-circle-outline" },
  { id: "picnic-dates",  label: "Picnic Dates",   icon: "basket-outline" },
  { id: "take-a-stroll", label: "Take a Stroll",  icon: "walk-outline" },
];

// Replace INTENT_CATEGORY_COMPATIBILITY (line 131-151)
const INTENT_CATEGORY_COMPATIBILITY: Record<string, string[] | null> = {
  "adventurous":   null, // All categories allowed
  "first-date":    ["fine_dining", "watch", "nature", "first_meet", "creative_arts", "play"],
  "romantic":      ["fine_dining", "creative_arts", "wellness"],
  "friendly":      null, // All categories allowed
  "group-fun":     ["play", "watch", "casual_eats"],
  "picnic-dates":  ["groceries_flowers", "picnic_park"],
  "take-a-stroll": ["casual_eats", "nature"],
};
```

### CollaborationPreferences.tsx
Mirror the exact same `experienceTypes` and `INTENT_CATEGORY_COMPATIBILITY` changes.

### cardConverters.ts
```typescript
// Replace INTENT_IDS (line 705-707)
export const INTENT_IDS = new Set([
  'adventurous', 'first-date', 'romantic', 'friendly', 'group-fun',
  'picnic-dates', 'take-a-stroll',
]);
```

### curatedExperiencesService.ts
```typescript
// Update experienceType union (line 5)
experienceType: 'adventurous' | 'first-date' | 'romantic' | 'friendly' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
```

### useCuratedExperiences.ts
Update the `experienceType` param type to match the new union.

### deckService.ts
- Update the fallback default from `'solo-adventure'` to `'adventurous'`
- Ensure curated pill creation works with new intent IDs (should work automatically
  since `separateIntentsAndCategories()` uses the `INTENT_IDS` set from cardConverters)

### categoryPlaceTypes.ts (shared)
```typescript
// Replace INTENT_IDS (line 194-201)
export const INTENT_IDS = new Set([
  'adventurous',
  'first-date',
  'romantic',
  'friendly',
  'group-fun',
  'picnic-dates',
  'take-a-stroll',
]);
```

### CuratedExperienceSwipeCard.tsx
Expand the icon mapping (currently only checks 'nature'):
```typescript
const CURATED_ICON_MAP: Record<string, string> = {
  'Adventurous':   'compass-outline',
  'First Date':    'people-outline',
  'Romantic':      'heart-outline',
  'Friendly':      'people-outline',
  'Group Fun':     'people-circle-outline',
  'Picnic Dates':  'basket-outline',
  'Take a Stroll': 'walk-outline',
};
const categoryIcon = CURATED_ICON_MAP[categoryLabel] || 'compass-outline';
```

### ExpandedCardModal.tsx
- Update the `category` prop passed to `TimelineSection` for curated cards to use
  `curatedCard.categoryLabel` instead of `curatedCard.experienceType`

### RecommendationsContext.tsx
- Update the collaboration-mode `useCuratedExperiences` call from
  `experienceType: 'solo-adventure'` to `experienceType: 'adventurous'`

---

## Test Cases

1. **Adventurous card generation:** Select "Adventurous" intent, verify 3-stop cards where each
   stop comes from a different category in [Nature, First Meet, Casual Eats, Fine Dining,
   Creative & Arts, Play]. Verify variety across cards (different category combos).

2. **Romantic fixed pool:** Select "Romantic", verify every card has exactly Fine Dining +
   Creative & Arts + Wellness stops. Variety comes from different places within those categories.

3. **Picnic Dates sequential proximity:** Select "Picnic Dates", verify 2-stop cards where
   Stop 1 is a grocery/supermarket and Stop 2 is a park/garden NEAR the grocery (not near user).

4. **Take A Stroll bookend:** Select "Take a Stroll", verify 3-stop cards where Stop 1 and
   Stop 3 are the SAME casual eats place (same placeId), and Stop 2 is a nature spot.
   Timeline: eat -> walk -> eat.

5. **Group Fun minimal pool:** Select "Group Fun", verify cards only contain Play + Watch +
   Casual Eats stops. No other categories appear.

6. **Intent ID migration:** Verify old intent IDs (`solo-adventure`, `first-dates`, `business`)
   no longer appear anywhere in the codebase. All references use new IDs.

7. **Card UI unchanged:** Verify curated cards render identically — image strip, stop badges,
   category badge with correct icon, "See Full Plan" CTA, expanded CuratedPlanView timeline.

8. **Collaboration mode:** Create a board session, verify curated experiences still generate
   correctly using aggregated preferences.

---

## Success Criteria

- [ ] All 7 curated types generate valid cards from their category pools
- [ ] Picnic Dates produces 2-stop cards with sequential proximity logic
- [ ] Take A Stroll produces 3-stop bookend cards (stop 1 == stop 3)
- [ ] Standard types with 6-category pools show variety across cards (different combos)
- [ ] Old intent IDs fully removed from codebase
- [ ] Card UI (swipe + expanded) renders identically to current curated cards
- [ ] Budget and travel constraints still enforced
- [ ] Pool storage (card_pool, user_card_impressions) still works
- [ ] Collaboration mode works with new intent IDs
- [ ] No regressions in regular (non-curated) category cards
