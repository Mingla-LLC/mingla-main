# Feature: First Meet Cards + ActionButtons Save/Schedule Split
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Add dedicated "First Meet" category card pipeline (clone of Nature pipeline) with 7 social-venue place types, plus split the combined "Schedule and Save" button into separate Save and Schedule buttons for both Nature and First Meet cards. First Meet additionally gets a "Policies & Reservations" button.

## Summary
Implements a dedicated **First Meet** card pipeline, modeled identically on the existing Nature card pipeline. The edge function searches 7 Google Place types suited for low-pressure social encounters (bookstores, bars, pubs, wine bars, tea houses, coffee shops, planetariums), filters by distance/budget/datetime, generates AI descriptions tuned for social/date settings, and returns flat single-place cards.

Simultaneously, the ActionButtons component is redesigned for **both** Nature and First Meet cards: the combined "Schedule and Save" button is split into two standalone prominent buttons — **Save** (saves to Saved tab only) and **Schedule** (date/time picker → availability check → calendar). First Meet cards additionally display a **"Policies & Reservations"** button that opens the venue's website or Google Maps page in the in-app browser.

## User Story
As a user looking for a first-date or first-meeting venue, I want to see curated single-place cards for bookstores, bars, coffee shops, and similar low-pressure venues so that I can find the perfect spot easily — and I want to separately save a card for later or schedule it to my calendar.

## Architecture Impact

### New Files
| File | Purpose |
|------|---------|
| `supabase/functions/discover-first-meet/index.ts` | Edge function — Google Places search for 7 First Meet types |
| `app-mobile/src/services/firstMeetCardsService.ts` | Mobile service wrapping the edge function call |

### Modified Files
| File | Change |
|------|--------|
| `app-mobile/src/utils/cardConverters.ts` | Add `firstMeetToRecommendation()` converter + export `FirstMeetCard` type alias |
| `app-mobile/src/services/deckService.ts` | Add First Meet pill routing in `resolvePills()` and `fetchDeck()` and `warmDeckPool()` |
| `app-mobile/src/components/expandedCard/ActionButtons.tsx` | Split "Schedule and Save" → separate Save + Schedule buttons; remove Nature save→schedule redirect; add "Policies & Reservations" button for First Meet |
| `app-mobile/src/components/ExpandedCardModal.tsx` | No changes needed — already has `InAppBrowserModal` and `browserUrl`/`browserTitle` state wired up |

### New DB Tables/Columns
None — reuses existing `card_pool`, `place_pool`, `user_card_impressions`, `saved_cards`, `calendar_entries` tables.

### New Edge Functions
`discover-first-meet` — HTTP POST, identical structure to `discover-nature`.

### External APIs
- Google Places API (New) — Nearby Search for 7 types (same caching via `_shared/placesCache.ts`)
- OpenAI GPT-4o-mini — AI description generation (single batch call)
- Card Pool Pipeline — same `_shared/cardPoolService.ts` for pool-first serving

---

## Edge Function Spec

### Function: `discover-first-meet`
**Trigger:** HTTP POST (via Supabase client `supabase.functions.invoke('discover-first-meet', { body })`)

**Place Types:**
```typescript
const FIRST_MEET_TYPES = [
  'book_store',
  'bar',
  'pub',
  'wine_bar',
  'tea_house',
  'coffee_shop',
  'planetarium',
];
```

**No ALWAYS_OPEN_TYPES** — all 7 venue types have real operating hours. Unlike Nature where parks/beaches skip hours filtering, First Meet venues always respect hours filtering.

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
  cards: FirstMeetCard[];  // Same shape as NatureCard
  total: number;
  source?: 'pool' | 'warm';
}
```

**Card shape** (identical to NatureCard):
```typescript
{
  id: string;              // `first-meet-${placeId}`
  placeId: string;
  title: string;
  description: string;     // AI-generated for social/date context
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
  placeType: string;       // e.g., 'coffee_shop'
  placeTypeLabel: string;  // e.g., 'Coffee Shop'
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
}
```

**Logic (mirrors discover-nature):**
1. Pool-first serving via `serveCardsFromPipeline()` with `categories: ['First Meet']`
2. If pool insufficient → `batchSearchPlaces()` for all 7 types in parallel (cached)
3. Merge & deduplicate across types
4. Filter by distance (haversine ≤ maxDistKm)
5. Filter by budget (priceMin ≤ budgetMax)
6. Filter by datetime (opening hours + day-of-week + time slot) — **NO** `ALWAYS_OPEN_TYPES` skip
7. Stable sort: rating desc → review count desc
8. Offset pagination: `batch = allPlaces.slice(batchSeed * limit, (batchSeed + 1) * limit)`
9. AI descriptions via OpenAI (prompt tuned for social/date venues)
10. Store to card pool (fire-and-forget)
11. Record impressions

**AI Description Prompt:**
```
Generate a short, appealing 1-2 sentence description for each venue.
Focus on the atmosphere and why it's a great spot to meet someone new or have a relaxed conversation.
Be warm and inviting but concise.
Return a JSON object with key "descriptions" containing an array of strings, one per venue, in the same order.
```

---

## Mobile Implementation

### New Service: `firstMeetCardsService.ts`
Exact clone of `natureCardsService.ts`, calling `discover-first-meet` instead of `discover-nature`.

```typescript
export interface FirstMeetCard { /* identical shape to NatureCard */ }
export interface DiscoverFirstMeetParams { /* identical shape to DiscoverNatureParams */ }

class FirstMeetCardsService {
  async discoverFirstMeet(params: DiscoverFirstMeetParams): Promise<FirstMeetCard[]>
  async warmFirstMeetPool(params: Omit<DiscoverFirstMeetParams, 'limit' | 'batchSeed'>): Promise<void>
}

export const firstMeetCardsService = new FirstMeetCardsService();
```

### New Converter: `firstMeetToRecommendation` (in `cardConverters.ts`)
Same structure as `natureToRecommendation` but with:
- `category: 'First Meet'`
- `categoryIcon: 'chatbubbles-outline'`
- `experienceType: 'first_meet'`
- `category` match factor: `1.0` (same as Nature)

### Deck Service Changes (`deckService.ts`)

**`resolvePills()`** — add First Meet routing:
```typescript
if (cat.toLowerCase() === 'nature') {
  pills.push({ id: 'nature', type: 'category' });
} else if (cat.toLowerCase() === 'first meet') {
  pills.push({ id: 'first_meet', type: 'category' });
} else {
  categoryFilters.push(cat);
}
```

**`fetchDeck()`** — add First Meet branch in the pill fetcher:
```typescript
if (pill.type === 'category') {
  if (pill.id === 'nature') {
    const cards = await natureCardsService.discoverNature({ ... });
    return cards.map(natureToRecommendation);
  } else if (pill.id === 'first_meet') {
    const cards = await firstMeetCardsService.discoverFirstMeet({ ... });
    return cards.map(firstMeetToRecommendation);
  }
}
```

**`warmDeckPool()`** — add First Meet warming branch:
```typescript
if (pill.id === 'nature') {
  await natureCardsService.warmNaturePool({ ... });
} else if (pill.id === 'first_meet') {
  await firstMeetCardsService.warmFirstMeetPool({ ... });
}
```

**`deckMode`** — update to include `'first_meet'`:
```typescript
type DeckMode = 'nature' | 'first_meet' | 'curated' | 'mixed';
```

### ActionButtons Redesign (`ActionButtons.tsx`)

**Changes (applies to BOTH Nature and First Meet):**

1. **Remove** the `card.category === "Nature"` override in `handleSave` (lines 339-344) that redirects save → schedule.

2. **Split** the current combined "Schedule and Save" button into TWO prominent buttons:

   **Save Button:**
   - Label: "Save"
   - Icon: `bookmark-outline` (or `bookmark` when saved)
   - Action: calls `onSave(card)` — saves to Saved tab only
   - Disabled when already saved

   **Schedule Button:**
   - Label: "Schedule"
   - Icon: `calendar-outline` (or `checkmark-circle` when scheduled)
   - Action: opens date/time picker → availability check → if open: save to Supabase calendar + device calendar, remove from deck → if closed: prompt retry
   - Disabled when already scheduled

3. **Remove** the bookmark icon override that shows `calendar-outline` for Nature (line 793-796). The bookmark icon row is replaced by the new Save button.

4. **Add "Policies & Reservations" button** — shown ONLY for First Meet cards:
   - Condition: `card.category === 'First Meet'`
   - Label: "Policies & Reservations"
   - Icon: `globe-outline`
   - Style: same as curated stops' `policiesButton` style (dark background, white text)
   - Action: opens `card.website` in `InAppBrowserModal` if available, else falls back to `https://www.google.com/maps/place/?q=place_id:${card.placeId}`
   - Uses existing `browserUrl`/`browserTitle` state from ExpandedCardModal (already wired up via props or parent state)

**New button layout (top to bottom):**
```
┌─────────────────────────────────────────┐
│  Opening Hours Section (if available)    │
├─────────────────────────────────────────┤
│  [ Save ]  [ Schedule ]  [ Share ]       │  ← Three action buttons in a row
├─────────────────────────────────────────┤
│  [ Policies & Reservations ]             │  ← First Meet ONLY, full-width
├─────────────────────────────────────────┤
│  [ Buy Now ]                             │  ← If booking options exist
└─────────────────────────────────────────┘
```

**Props change:** ActionButtons needs a way to trigger the in-app browser for "Policies & Reservations". Two approaches:
- **Option A:** Pass `onOpenBrowser?: (url: string, title: string) => void` prop from ExpandedCardModal (which already has `setBrowserUrl`/`setBrowserTitle` state)
- **Option B:** Use `Linking.openURL()` directly (simpler but opens external browser)

**Recommended: Option A** — keeps the in-app browser experience consistent with curated cards.

---

## Test Cases

1. **First Meet cards appear in deck:** Select only "First Meet" category in preferences → solo deck shows cards with `category: 'First Meet'`, icons for coffee shops/bars/bookstores, AI-generated descriptions mentioning social/date atmosphere.

2. **Mixed deck interleaving:** Select both "Nature" and "First Meet" → deck round-robin interleaves both types (Nature cards with leaf icon, First Meet cards with chatbubbles icon).

3. **Save button works independently:** Tap expanded First Meet card → tap "Save" → card appears in Saved tab. Card is NOT removed from deck. No calendar dialog appears.

4. **Schedule button works independently:** Tap expanded First Meet card → tap "Schedule" → date picker appears → select date/time → availability check passes → card saved to Supabase calendar + device calendar → card removed from deck → success toast.

5. **Schedule availability rejection:** Tap "Schedule" → select a time when the bar is closed → alert "This place is closed at the selected date and time" → user taps "Choose Another Time" → picker re-opens.

6. **Policies & Reservations (First Meet only):** Tap expanded First Meet card → "Policies & Reservations" button visible → tap → in-app browser opens with venue's website. Verify this button does NOT appear on Nature cards.

7. **Nature Save button (regression):** Tap expanded Nature card → tap "Save" → card saves to Saved tab only (no schedule dialog). This verifies the old redirect is removed.

8. **Batch pagination:** Swipe through 75% of First Meet cards → next batch pre-fetches → "Generate Another 20" works with offset pagination.

9. **Pool-first serving:** First request populates pool → second request (same location/params) serves from pool with 0 API calls.

10. **Graceful degradation in mixed deck:** First Meet edge function fails → Nature cards still serve → no crash, warning logged.

---

## Success Criteria

- [ ] `discover-first-meet` edge function deployed and returning cards for all 7 place types
- [ ] First Meet cards render correctly in solo swipe deck with correct category/icon
- [ ] Mixed Nature + First Meet deck interleaves correctly
- [ ] Save button saves to Saved tab without triggering schedule (both Nature and First Meet)
- [ ] Schedule button triggers date/time picker → availability check → calendar (both Nature and First Meet)
- [ ] "Policies & Reservations" button appears on First Meet expanded cards and opens in-app browser
- [ ] "Policies & Reservations" button does NOT appear on Nature expanded cards
- [ ] Old "Schedule and Save" combined button no longer exists
- [ ] Old Nature save→schedule redirect removed
- [ ] AI descriptions are contextually appropriate (social/date tone for First Meet, nature/outdoor for Nature)
- [ ] Pool-first serving works for First Meet cards
- [ ] Batch pagination works for First Meet cards
