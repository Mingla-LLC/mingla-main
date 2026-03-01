# Feature: Dedicated Category Card Systems (Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness)
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Extend the First Meet / Picnic Park dedicated-edge-function pattern to all remaining swipe categories, with each category's user-specified Google Place types and the same "Policies & Reservations" button in the expanded card.

## Summary

Currently, only **Nature**, **First Meet**, and **Picnic Park** have dedicated `discover-*` edge functions with pool-first serving, AI descriptions, and the "Policies & Reservations" in-app browser button. The remaining 7 categories (Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness) still fall through to the legacy `new-generate-experience-` pipeline or get routed to curated pills.

This feature creates **7 new dedicated edge functions** and their corresponding mobile service + converter layers, following the identical architecture pattern established by `discover-first-meet` and `discover-picnic-park`. Each edge function uses its own category-specific place types (as specified by the user) and plugs into the existing card pool pipeline (`serveCardsFromPipeline` → `place_pool` → `card_pool` → `user_card_impressions`). The expanded card view's "Policies & Reservations" button is extended to all categories (not just First Meet).

## User Story

As a Mingla user, I want every category I select (Drink, Casual Eats, Fine Dining, Watch, Creative & Arts, Play, Wellness) to show high-quality, AI-enriched venue cards with ratings, opening hours, travel time, and a "Policies & Reservations" button — the same experience I already get with First Meet cards.

---

## Architecture Impact

### New Files (14 total)

**Edge Functions (7):**
| File | Category | Place Types Count |
|------|----------|-------------------|
| `supabase/functions/discover-drink/index.ts` | Drink | 5 |
| `supabase/functions/discover-casual-eats/index.ts` | Casual Eats | 33 |
| `supabase/functions/discover-fine-dining/index.ts` | Fine Dining | 3 |
| `supabase/functions/discover-watch/index.ts` | Watch | 3 |
| `supabase/functions/discover-creative-arts/index.ts` | Creative & Arts | 16 |
| `supabase/functions/discover-play/index.ts` | Play | 25 |
| `supabase/functions/discover-wellness/index.ts` | Wellness | 8 |

**Mobile Services (7):**
| File | Exports |
|------|---------|
| `app-mobile/src/services/drinkCardsService.ts` | `DrinkCard`, `drinkCardsService` |
| `app-mobile/src/services/casualEatsCardsService.ts` | `CasualEatsCard`, `casualEatsCardsService` |
| `app-mobile/src/services/fineDiningCardsService.ts` | `FineDiningCard`, `fineDiningCardsService` |
| `app-mobile/src/services/watchCardsService.ts` | `WatchCard`, `watchCardsService` |
| `app-mobile/src/services/creativeArtsCardsService.ts` | `CreativeArtsCard`, `creativeArtsCardsService` |
| `app-mobile/src/services/playCardsService.ts` | `PlayCard`, `playCardsService` |
| `app-mobile/src/services/wellnessCardsService.ts` | `WellnessCard`, `wellnessCardsService` |

### Modified Files (5)

| File | Change |
|------|--------|
| `app-mobile/src/services/deckService.ts` | Add 7 new pill branches in `resolvePills()`, `fetchDeck()`, `warmDeckPool()` |
| `app-mobile/src/utils/cardConverters.ts` | Add 7 new `*ToRecommendation()` converter functions |
| `app-mobile/src/components/expandedCard/ActionButtons.tsx` | Change `isFirstMeet` gate to show Policies & Reservations for ALL categories |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | Update `MINGLA_CATEGORY_PLACE_TYPES` to match user's specified types |
| `app-mobile/src/constants/categories.ts` | Update `coreAnchors` arrays to match user's specified types |

### No New DB Tables

All 7 new edge functions reuse the **existing** card pool tables (`place_pool`, `card_pool`, `user_card_impressions`) and the shared `cardPoolService.ts` / `placesCache.ts` pipeline. No migrations needed.

---

## Category → Place Types Mapping (User-Specified)

### Drink
```typescript
const DRINK_TYPES = [
  'bar',
  'pub',
  'wine_bar',
  'tea_house',
  'coffee_shop',
];
```

### Casual Eats
```typescript
const CASUAL_EATS_TYPES = [
  'buffet_restaurant',
  'brunch_restaurant',
  'diner',
  'fast_food_restaurant',
  'food_court',
  'hamburger_restaurant',
  'pizza_restaurant',
  'ramen_restaurant',
  'sandwich_shop',
  'sushi_restaurant',
  'afghani_restaurant',
  'african_restaurant',
  'american_restaurant',
  'asian_restaurant',
  'barbecue_restaurant',
  'brazilian_restaurant',
  'breakfast_restaurant',
  'indian_restaurant',
  'indonesian_restaurant',
  'japanese_restaurant',
  'korean_restaurant',
  'lebanese_restaurant',
  'mediterranean_restaurant',
  'mexican_restaurant',
  'middle_eastern_restaurant',
  'seafood_restaurant',
  'spanish_restaurant',
  'thai_restaurant',
  'turkish_restaurant',
  'vegan_restaurant',
  'vegetarian_restaurant',
  'vietnamese_restaurant',
  'chinese_restaurant',
  'steak_house',
  'french_restaurant',
  'greek_restaurant',
  'italian_restaurant',
];
```

### Fine Dining
```typescript
const FINE_DINING_TYPES = [
  'fine_dining_restaurant',
  'chef_led_restaurant',
  'upscale_restaurant',
];
```

### Watch
```typescript
const WATCH_TYPES = [
  'movie_theater',
  'cinema',
  'comedy_club',
];
```

### Creative & Arts
```typescript
const CREATIVE_ARTS_TYPES = [
  'art_gallery',
  'museum',
  'planetarium',
  'karaoke',
  'pottery',
  'sip_and_paint',
  'cooking_classes',
  'woodworking_class',
  'jewelry_making_studio',
  'sewing_class',
  'glass_blowing_studio',
  'diy_workshop',
  'perfume_lab',
  'flower_arranging_studio',
  'bakery_workshop',
  'coffee_roastery',
];
```

### Play
```typescript
const PLAY_TYPES = [
  'bowling_alley',
  'amusement_park',
  'water_park',
  'planetarium',
  'video_arcade',
  'karaoke',
  'casino',
  'roller_coaster',
  'ferris_wheel',
  'trampoline_park',
  'rock_climbing_gym',
  'mini_golf_course',
  'ice_skating_rink',
  'skate_park',
  'batting_cages',
  'laser_tag_center',
  'paintball_center',
  'escape_room',
  'billiards_hall',
  'dart_bar',
  'board_game_cafe',
  'virtual_reality_center',
  'adventure_park',
  'go_kart_track',
];
```

### Wellness
```typescript
const WELLNESS_TYPES = [
  'spa',
  'massage',
  'sauna',
  'hot_spring',
  'turkish_bath',
  'float_tank_center',
  'public_bath',
  'cold_plunge_facility',
];
```

---

## Edge Function Spec (Template — Identical for All 7)

Each edge function follows the **exact same** architecture as `discover-first-meet/index.ts` (543 lines). The only differences are:
1. The `*_TYPES` constant (place types array)
2. The category name in card IDs and log messages
3. The card pool `categories` field

**Function name:** `discover-{category-slug}` (e.g., `discover-drink`, `discover-casual-eats`)
**Trigger:** HTTP POST (invoked from mobile via `supabase.functions.invoke()`)

**Input:**
```typescript
{
  location: { lat: number; lng: number };
  budgetMax: number;
  travelMode: 'walking' | 'driving' | 'transit' | 'bicycling';
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed?: number;       // Offset-based pagination
  limit?: number;           // Default 20
  warmPool?: boolean;       // Fire-and-forget warm mode
}
```

**Output:**
```typescript
{
  cards: CategoryCard[];
  fromPool: number;
  fromApi: number;
  totalPoolSize: number;
}
```

**Logic (identical to discover-first-meet):**
1. Parse request body + extract JWT user ID
2. **Pool-first attempt:** call `serveCardsFromPipeline()` with the category name
3. If pool has ≥ 75% of limit → return pool cards (0 API cost)
4. **Fallback:** `batchSearchPlaces()` for each place type
5. Merge + deduplicate by Google Place ID
6. Filter: distance/budget/time-slot/opening-hours
7. Sort: rating DESC, review count DESC
8. OpenAI batch description generation (GPT-4o-mini, ~$0.001/batch)
9. Build card objects with: photos, rating, reviewCount, priceRange, openingHours, website, placeId
10. **Fire-and-forget:** `upsertPlaceToPool()` + `insertCardToPool()` + `recordImpressions()`
11. Offset pagination: `offset = batchSeed * limit`
12. Return JSON response

---

## Mobile Implementation

### New Services (7 files — identical structure)

Each follows the `picnicParkCardsService.ts` pattern (66 lines):

```typescript
// Template: app-mobile/src/services/{category}CardsService.ts
import { supabase } from './supabase';

export interface {Category}Card {
  id: string;
  placeId: string;
  title: string;
  description: string;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceLevelLabel: string;
  priceMin: number;
  priceMax: number;
  address: string;
  openingHours: Record<string, string>;
  isOpenNow: boolean;
  website: string | null;
  lat: number;
  lng: number;
  placeType: string;
  placeTypeLabel: string;
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
}

export interface Discover{Category}Params {
  location: { lat: number; lng: number };
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed?: number;
  limit?: number;
}

class {Category}CardsService {
  async discover{Category}(params: Discover{Category}Params): Promise<{Category}Card[]> {
    const { data, error } = await supabase.functions.invoke('discover-{slug}', {
      body: params,
    });
    if (error) throw error;
    return (data?.cards ?? []) as {Category}Card[];
  }

  async warm{Category}Pool(params: Omit<Discover{Category}Params, 'limit' | 'batchSeed'>): Promise<void> {
    try {
      await supabase.functions.invoke('discover-{slug}', {
        body: { ...params, warmPool: true, limit: 40 },
      });
    } catch {
      // Silent — non-critical background operation
    }
  }
}

export const {category}CardsService = new {Category}CardsService();
```

### Modified: cardConverters.ts

Add 7 new converter functions, each identical in structure to `firstMeetToRecommendation()` but with the correct `category`, `categoryIcon`, and `experienceType`:

| Converter | category | categoryIcon | experienceType |
|-----------|----------|-------------|----------------|
| `drinkToRecommendation` | `'Drink'` | `'wine-outline'` | `'drink'` |
| `casualEatsToRecommendation` | `'Casual Eats'` | `'fast-food-outline'` | `'casual_eats'` |
| `fineDiningToRecommendation` | `'Fine Dining'` | `'restaurant-outline'` | `'fine_dining'` |
| `watchToRecommendation` | `'Watch'` | `'film-outline'` | `'watch'` |
| `creativeArtsToRecommendation` | `'Creative & Arts'` | `'color-palette-outline'` | `'creative_arts'` |
| `playToRecommendation` | `'Play'` | `'game-controller-outline'` | `'play'` |
| `wellnessToRecommendation` | `'Wellness'` | `'body-outline'` | `'wellness'` |

### Modified: deckService.ts

**`resolvePills()`** — add 7 new normalized name checks:
```typescript
else if (normalized === 'drink') pills.push({ id: 'drink', type: 'category' });
else if (normalized === 'casual eats') pills.push({ id: 'casual_eats', type: 'category' });
else if (normalized === 'fine dining') pills.push({ id: 'fine_dining', type: 'category' });
else if (normalized === 'watch') pills.push({ id: 'watch', type: 'category' });
else if (normalized === 'creative & arts' || normalized === 'creative arts') pills.push({ id: 'creative_arts', type: 'category' });
else if (normalized === 'play') pills.push({ id: 'play', type: 'category' });
else if (normalized === 'wellness') pills.push({ id: 'wellness', type: 'category' });
```

**`fetchDeck()`** — add 7 new `else if (pill.id === '...')` branches in the category handler.

**`warmDeckPool()`** — add 7 new warm branches.

**`DeckResponse.deckMode`** — expand union type to include all new category slugs.

### Modified: ActionButtons.tsx

Change the gate from First Meet only → ALL categories:

```diff
- const isFirstMeet = card.category === 'First Meet';
+ const showPoliciesButton = Boolean(card.website || (card as any).placeId);
```

Replace:
```diff
- {isFirstMeet && (
+ {showPoliciesButton && (
```

This shows the Policies & Reservations button on **any** card that has a website or placeId — which all dedicated-edge-function cards will have.

### Modified: categoryPlaceTypes.ts

Update `MINGLA_CATEGORY_PLACE_TYPES` to match the user's specified types for each category (see mapping above). Also update `CATEGORY_ALIASES` if needed.

### Modified: categories.ts

Update `coreAnchors` arrays in the Category objects to match the user's specified place types.

---

## Important Design Decisions

### 1. Google Place Types Validity
Many of the user-specified types (e.g., `chef_led_restaurant`, `upscale_restaurant`, `sip_and_paint`, `cooking_classes`, `woodworking_class`, `jewelry_making_studio`, `sewing_class`, `glass_blowing_studio`, `diy_workshop`, `perfume_lab`, `flower_arranging_studio`, `bakery_workshop`, `float_tank_center`, `cold_plunge_facility`, `roller_coaster`, `ferris_wheel`, `batting_cages`, `laser_tag_center`, `paintball_center`, `billiards_hall`, `dart_bar`, `board_game_cafe`, `virtual_reality_center`, `go_kart_track`, `cinema`) are **NOT valid Google Places API (New) types**.

**Strategy:** Include them in the `TYPES` array anyway. When `batchSearchPlaces()` queries Google with an invalid type, Google returns 0 results (no error). The valid types in the array will still return results. Over time, if Google adds these types, they'll automatically start working.

**Alternative for non-Google types:** Use `textSearch` with these as keyword queries instead of `searchNearby` with `includedTypes`. The edge function should attempt `searchNearby` first for valid types, then fall back to `searchText` for keyword-based types.

### 2. Casual Eats Has 37 Types — API Cost Consideration
Searching 37 types individually would make 37 API calls. **Mitigation:**
- The `batchSearchPlaces()` shared cache means each (type, location, radius) combo is cached for 24h
- After first search, subsequent requests hit cache (0 API cost)
- The card pool further reduces API calls to near-zero for returning users
- Consider chunking: search top 10 most popular types first, background-warm the rest

### 3. No DB Migration Required
All edge functions write to the existing `card_pool` table using the `categories` JSONB array field. The new category names ("Drink", "Casual Eats", etc.) are just new values in that array — no schema change needed.

---

## Test Cases

1. **Drink pill → cards served:** Select only "Drink" in preferences → swipe deck shows bar/pub/wine_bar/tea_house/coffee_shop venues with ratings, photos, prices, opening hours, and "Policies & Reservations" button
2. **Casual Eats with budget filter:** Set budget to $25 → only PRICE_LEVEL_FREE and PRICE_LEVEL_INEXPENSIVE restaurants appear
3. **Fine Dining pool-first:** After first load, close app, reopen → Fine Dining cards load from pool (0 API calls, < 200ms)
4. **Watch + Play mixed deck:** Select both "Watch" and "Play" → deck interleaves movie theater/cinema/comedy club cards with bowling/arcade/escape room cards in round-robin order
5. **Creative & Arts non-Google types:** Types like `sip_and_paint` return 0 results from Google → edge function gracefully handles empty results and still returns cards from valid types like `art_gallery`, `museum`
6. **Wellness Policies & Reservations:** Tap a spa card → expand → tap "Policies & Reservations" → in-app browser opens spa website
7. **Pool warming:** App launch triggers `warmDeckPool()` → all active category pools pre-warmed in parallel (fire-and-forget, silent failure OK)
8. **Batch pagination:** Swipe through 20 Casual Eats cards → "Load more" → next 20 cards via `batchSeed: 1` (offset-based)

## Success Criteria

- [ ] All 7 new edge functions deployed and returning cards for valid place types
- [ ] All 7 new mobile services invoke their edge functions correctly
- [ ] deckService resolves all 10 category pills (Nature + First Meet + Picnic + 7 new) to dedicated edge functions — no categories fall through to curated
- [ ] Policies & Reservations button appears on ALL category cards (not just First Meet)
- [ ] Card pool pipeline works: second request for same category/location returns from pool (0 API)
- [ ] Round-robin interleaving works with any combination of categories
- [ ] Non-existent Google Place types don't cause errors (graceful empty results)
- [ ] categoryPlaceTypes.ts and categories.ts constants updated to match user's specified types
