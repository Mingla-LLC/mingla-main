# Feature: Picnic Park Cards + Old Picnic → Picnic Date Rename
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Add dedicated "Picnic Park" category card pipeline (clone of Nature pipeline) with 1 place type (`picnic_ground`), plus rename old "Picnic" to "Picnic Date" to prevent collision.

## Summary
Implements a dedicated **Picnic Park** card pipeline, modeled identically on the existing Nature card pipeline. The edge function searches 1 Google Place type (`picnic_ground`), filters by distance/budget/datetime, generates AI descriptions tuned for outdoor picnic settings, and returns flat single-place cards.

Simultaneously, the old "Picnic" category (which fetches companion grocery data and renders a TimelineSection) is **renamed to "Picnic Date"** to prevent collision with the new discover-pipeline cards. The `isPicnicCard` checks in ExpandedCardModal are updated to match `'Picnic Date'` exactly instead of using the loose `includes("picnic")` pattern.

The new Picnic Park cards integrate into the multi-pill round-robin system alongside Nature, First Meet, and curated (Adventurous) pills — all running in parallel via `Promise.all` and interleaved for the user.

## User Story
As a user looking for a picnic spot, I want to see curated single-place cards for picnic grounds nearby so that I can find the perfect outdoor spot — and I want to save it for later or schedule it to my calendar, just like Nature cards.

## Architecture Impact

### New Files
| File | Purpose |
|------|---------|
| `supabase/functions/discover-picnic-park/index.ts` | Edge function — Google Places search for `picnic_ground` type |
| `app-mobile/src/services/picnicParkCardsService.ts` | Mobile service wrapping the edge function call |

### Modified Files
| File | Change |
|------|--------|
| `app-mobile/src/utils/cardConverters.ts` | Add `picnicParkToRecommendation()` converter + import `PicnicParkCard` type |
| `app-mobile/src/services/deckService.ts` | Add Picnic Park pill routing in `resolvePills()`, `fetchDeck()`, `warmDeckPool()` |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Update BOTH `isPicnicCard` checks to match `'Picnic Date'` exactly instead of `includes("picnic")` |
| `app-mobile/src/constants/categories.ts` | Update picnic entry: name `'Picnic'` → `'Picnic Park'`, narrow `coreAnchors` to `['picnic_ground']` |
| `app-mobile/src/components/PreferencesSheet.tsx` | Update picnic category: id/label → `'Picnic Park'` |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Same update as PreferencesSheet if it has a picnic entry |

### New DB Tables/Columns
None — reuses existing `card_pool`, `place_pool`, `user_card_impressions`, `saved_cards`, `calendar_entries` tables.

### External APIs
- Google Places API (New) — Nearby Search for 1 type: `picnic_ground` (cached via `_shared/placesCache.ts`)
- OpenAI GPT-4o-mini — AI description generation (single batch call)
- Card Pool Pipeline — same `_shared/cardPoolService.ts` for pool-first serving

---

## Edge Function Spec

### Function: `discover-picnic-park`
**Trigger:** HTTP POST (via Supabase client `supabase.functions.invoke('discover-picnic-park', { body })`)

**Place Types:**
```typescript
const PICNIC_PARK_TYPES = [
  'picnic_ground',
];
```

**ALWAYS_OPEN_TYPES:** Yes — picnic grounds are typically always accessible (like Nature's parks and beaches):
```typescript
const ALWAYS_OPEN_TYPES = new Set(['picnic_ground']);
```

**Input:**
```typescript
{
  location: { lat: number; lng: number };
  budgetMax?: number;           // default 200
  travelMode?: string;          // default 'walking'
  travelConstraintType?: 'time' | 'distance';  // default 'time'
  travelConstraintValue?: number; // default 30
  datetimePref?: string;        // ISO date string
  dateOption?: string;          // 'now' | 'later'
  timeSlot?: string | null;     // 'brunch' | 'afternoon' | 'dinner' | 'lateNight'
  batchSeed?: number;           // default 0 (pagination offset)
  limit?: number;               // default 20
  warmPool?: boolean;           // background pool warming
}
```

**Output:**
```typescript
{
  cards: PicnicParkCard[];  // Same shape as NatureCard
  total: number;
  source?: 'pool' | 'warm';
}
```

**Card shape** (identical to NatureCard):
```typescript
{
  id: string;              // `picnic-park-${placeId}`
  placeId: string;
  title: string;
  description: string;     // AI-generated for picnic context
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
  placeType: string;       // 'picnic_ground'
  placeTypeLabel: string;  // 'Picnic Ground'
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
}
```

**Logic (mirrors discover-nature):**
1. Pool-first serving via `serveCardsFromPipeline()` with `categories: ['Picnic Park']`
2. If pool insufficient → `batchSearchPlaces()` for 1 type (cached)
3. Deduplicate (only 1 type so minimal duplication)
4. Filter by distance (haversine ≤ maxDistKm)
5. Filter by budget (priceMin ≤ budgetMax)
6. Filter by datetime — `ALWAYS_OPEN_TYPES` includes `picnic_ground` so hours filtering is skipped (picnic grounds are typically always accessible)
7. Stable sort: rating desc → review count desc
8. Offset pagination: `batch = allPlaces.slice(batchSeed * limit, (batchSeed + 1) * limit)`
9. AI descriptions via OpenAI (prompt tuned for picnic/outdoor settings)
10. Store to card pool (fire-and-forget)
11. Record impressions

**AI Description Prompt:**
```
Generate a short, appealing 1-2 sentence description for each picnic spot.
Focus on the scenery, atmosphere, and what makes it a great place for an outdoor picnic.
Be vivid and inviting but concise.
Return a JSON object with key "descriptions" containing an array of strings, one per spot, in the same order.
```

---

## Old Picnic → Picnic Date Rename

### Why this rename is needed NOW
The existing `isPicnicCard` check in ExpandedCardModal uses `card.category?.toLowerCase().includes("picnic")`. Our new "Picnic Park" cards have `category: 'Picnic Park'` which contains "picnic" — this would incorrectly trigger `fetchPicnicData()` (companion grocery fetch) and `TimelineSection` rendering on our simple single-place cards.

### What changes

**ExpandedCardModal.tsx — TWO locations:**

1. **Line 879-883** (inside `fetchPicnicData` function):
```typescript
// BEFORE:
const isPicnicCard =
  card.category?.toLowerCase().includes("picnic") ||
  card.category?.toLowerCase() === "picnics";

// AFTER:
const isPicnicCard =
  card.category === 'Picnic Date';
```

2. **Lines 944-947** (render-time check):
```typescript
// BEFORE:
const isPicnicCard =
  !isCuratedCard &&
  (card.category?.toLowerCase().includes("picnic") ||
    card.category?.toLowerCase() === "picnics");

// AFTER:
const isPicnicCard =
  !isCuratedCard &&
  card.category === 'Picnic Date';
```

This ensures:
- Old Picnic Date cards → trigger companion grocery fetch + TimelineSection (as before)
- New Picnic Park discover cards → behave like Nature (no companion data, no timeline)

---

## Mobile Implementation

### New Service: `picnicParkCardsService.ts`
Exact clone of `natureCardsService.ts`, calling `discover-picnic-park` instead of `discover-nature`.

```typescript
export interface PicnicParkCard { /* identical shape to NatureCard */ }
export interface DiscoverPicnicParkParams { /* identical shape to DiscoverNatureParams */ }

class PicnicParkCardsService {
  async discoverPicnicPark(params: DiscoverPicnicParkParams): Promise<PicnicParkCard[]>
  async warmPicnicParkPool(params: Omit<DiscoverPicnicParkParams, 'limit' | 'batchSeed'>): Promise<void>
}

export const picnicParkCardsService = new PicnicParkCardsService();
```

### New Converter: `picnicParkToRecommendation` (in `cardConverters.ts`)
Same structure as `natureToRecommendation` but with:
- `category: 'Picnic Park'`
- `categoryIcon: 'basket-outline'`
- `experienceType: 'picnic_park'`
- `category` match factor: `1.0`

### Deck Service Changes (`deckService.ts`)

**`resolvePills()`** — add Picnic Park routing (alongside existing Nature and First Meet):
```typescript
for (const cat of cats) {
  if (cat.toLowerCase() === 'nature') {
    pills.push({ id: 'nature', type: 'category' });
  } else if (cat.toLowerCase() === 'first meet') {
    pills.push({ id: 'first_meet', type: 'category' });
  } else if (cat.toLowerCase() === 'picnic park') {
    pills.push({ id: 'picnic_park', type: 'category' });
  } else {
    categoryFilters.push(cat);
  }
}
```

**`fetchDeck()`** — add Picnic Park branch in the pill fetcher:
```typescript
if (pill.type === 'category') {
  if (pill.id === 'first_meet') {
    // ... existing First Meet code ...
  } else if (pill.id === 'picnic_park') {
    const cards = await picnicParkCardsService.discoverPicnicPark({ ... });
    return cards.map(picnicParkToRecommendation);
  }
  // Default: Nature
  const cards = await natureCardsService.discoverNature({ ... });
  return cards.map(natureToRecommendation);
}
```

**`warmDeckPool()`** — add Picnic Park warming:
```typescript
if (pill.id === 'first_meet') {
  // ... existing First Meet warming ...
} else if (pill.id === 'picnic_park') {
  await picnicParkCardsService.warmPicnicParkPool({ ... });
} else {
  await natureCardsService.warmNaturePool({ ... });
}
```

**`deckMode`** — update type to include `'picnic_park'`:
```typescript
deckMode: 'nature' | 'first_meet' | 'picnic_park' | 'curated' | 'mixed';
```

**`deckMode` resolution** — update single-pill detection:
```typescript
const deckMode: DeckResponse['deckMode'] =
  pills.length === 1
    ? (pills[0].type === 'category'
        ? (pills[0].id as DeckResponse['deckMode'])
        : 'curated')
    : 'mixed';
```

### Categories.ts Update
```typescript
// BEFORE:
{
  slug: 'picnic',
  name: 'Picnic',
  ...
  coreAnchors: ['picnic_ground', 'park', 'beach', 'botanical_garden'],
  ...
}

// AFTER:
{
  slug: 'picnic_park',
  name: 'Picnic Park',
  ...
  coreAnchors: ['picnic_ground'],
  description: 'Outdoor picnic grounds — designated areas with tables, shelters, and scenic views',
  detailedDescription: 'Dedicated picnic grounds perfect for an outdoor meal. Tables, benches, shelters, and scenic settings for a relaxed time with friends, family, or a date.',
  ...
}
```

### PreferencesSheet.tsx Update
```typescript
// BEFORE:
{ id: "picnic", label: "Picnic", icon: "basket-outline" },

// AFTER:
{ id: "Picnic Park", label: "Picnic Park", icon: "basket-outline" },
```

### ActionButtons
No changes needed — Picnic Park cards use the same Save + Schedule buttons as Nature. No "Policies & Reservations" button (picnic grounds don't take reservations).

---

## Multi-Pill Round Robin — Full System

After this implementation, the deck service handles **4 pill types** in parallel:

| Pill Type | Source | Edge Function | Place Types |
|-----------|--------|---------------|-------------|
| `nature` | Category | `discover-nature` | 8 types |
| `first_meet` | Category | `discover-first-meet` | 7 types |
| `picnic_park` | Category | `discover-picnic-park` | 1 type |
| `solo-adventure` / `romantic` / etc. | Curated (Intent) | `generate-curated-experiences` | AI multi-stop |

**Example — user selects Nature + First Meet + Picnic Park + solo-adventure:**
```
→ 4 pills resolve: [nature, first_meet, picnic_park, solo-adventure]
→ All 4 fire in parallel via Promise.all
→ perPillLimit = ceil(20/4) = 5 cards per pill
→ Latency = max(nature, first_meet, picnic_park, solo-adventure)
→ Picnic Park finishes fastest (1 type)
→ roundRobinInterleave: [N1, FM1, PP1, A1, N2, FM2, PP2, A2, ...]
→ User sees one of each category per rotation
```

**Graceful degradation:** If any pill fails, others still serve cards. If Picnic Park returns fewer cards (1 type = smaller pool), round-robin skips it once exhausted and continues with remaining pills.

---

## Test Cases

1. **Picnic Park cards appear in deck:** Select only "Picnic Park" category → solo deck shows cards with `category: 'Picnic Park'`, basket icon, AI descriptions about picnic scenery.

2. **Full multi-pill interleaving:** Select Nature + First Meet + Picnic Park + solo-adventure → deck round-robin interleaves all 4 types. User sees one of each per rotation.

3. **Partial selection:** Select Picnic Park + First Meet → 2 pills, round-robin alternates between them.

4. **Save works independently:** Tap expanded Picnic Park card → "Save" → card in Saved tab. No calendar dialog.

5. **Schedule works independently:** Tap "Schedule" → date picker → availability assumed open (ALWAYS_OPEN_TYPES) → saves to calendar → removes from deck.

6. **No "Policies & Reservations":** Expanded Picnic Park card does NOT show "Policies & Reservations" button.

7. **Old Picnic Date unaffected:** If any legacy Picnic Date cards exist in saved cards, they still trigger the companion grocery fetch and TimelineSection when expanded.

8. **No collision:** Expand a Picnic Park card → NO companion grocery fetch triggered, NO TimelineSection rendered. Card renders like a Nature card.

9. **Pool-first serving:** First request → cards + pool store. Second request (same location) → served from pool with 0 API calls.

10. **Graceful degradation:** Picnic Park edge function fails → other pills (Nature, First Meet, curated) still serve cards.

---

## Success Criteria

- [ ] `discover-picnic-park` edge function deployed and returning cards for `picnic_ground` type
- [ ] Picnic Park cards render in solo swipe deck with `category: 'Picnic Park'`, basket icon
- [ ] Multi-pill deck with Nature + First Meet + Picnic Park + curated interleaves correctly
- [ ] Save button saves to Saved tab without triggering schedule
- [ ] Schedule button triggers date/time picker → availability check → calendar
- [ ] No "Policies & Reservations" button on Picnic Park cards
- [ ] `isPicnicCard` checks updated — Picnic Park cards do NOT trigger companion grocery fetch or TimelineSection
- [ ] Old Picnic Date cards (if any exist) still work correctly with companion data
- [ ] `categories.ts` picnic entry renamed to "Picnic Park" with `coreAnchors: ['picnic_ground']`
- [ ] PreferencesSheet shows "Picnic Park" (not "Picnic")
- [ ] AI descriptions are contextually appropriate (picnic/outdoor tone)
- [ ] Pool-first serving works for Picnic Park cards
- [ ] Batch pagination works
- [ ] TypeScript compiles with zero errors
