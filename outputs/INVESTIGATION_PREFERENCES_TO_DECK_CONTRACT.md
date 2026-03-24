# Forensic Investigation: Preferences Sheet → Swipeable Deck Contract

**Date:** 2026-03-24
**Scope:** Does the swipeable deck truly and entirely reflect the preferences the user has chosen?
**Verdict:** The contract is **largely honored** with **two material gaps** and **three minor weaknesses**.

---

## 1. The Full Chain (Verified)

```
PreferencesSheet.tsx → handleApplyPreferences()
  ↓ saves to DB via PreferencesService / updateBoardPreferences
  ↓ invalidates React Query keys: userPreferences, deck-cards, curated-experiences, userLocation

useUserPreferences.ts → reads preferences from DB (60s staleTime)
  ↓
RecommendationsContext.tsx → builds stableDeckParams from userPrefs
  ↓ passes ALL preference fields to useDeckCards()
  ↓
useDeckCards.ts → queryKey includes ALL params → calls deckService.fetchDeck()
  ↓
deckService.ts → resolves pills → calls discover-cards + generate-curated-experiences
  ↓
discover-cards/index.ts → queries card_pool via query_pool_cards RPC
  ↓ filters by: categories, geo-radius, price tiers, budget, datetime/opening hours
  ↓ scores via scoringService.ts (category, tags, popularity, quality, text relevance)
  ↓
cardPoolService.ts → poolCardToApiCard() computes distanceKm + travelTimeMin per card
  ↓ uses haversine() + estimateTravelMin(distKm, travelMode)
  ↓
SwipeableCards.tsx → renders cards with travel mode icon + travel time
```

---

## 2. Preference-by-Preference Verdict

### ✅ Categories (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:87-104` — 12 categories, slug IDs (nature, first_meet, drink, etc.) |
| **Save** | `handleApplyPreferences` L791 — saves `selectedCategories` |
| **Read** | `RecommendationsContext.tsx:308` — `userPrefs.categories` |
| **Hook** | `useDeckCards.ts:91` — categories in query key |
| **Service** | `deckService.ts:256` — maps pill IDs to display names, sends to edge function |
| **Edge** | `discover-cards/index.ts:312` — `resolveCategories(rawCategories)` |
| **SQL** | `query_pool_cards` L146 — `cp.categories && p_categories` (array overlap) |

**Fact:** Categories flow end-to-end. The `CATEGORY_PILL_MAP` in deckService handles all slug/display-name/legacy variants. The SQL uses array overlap (`&&`) so cards matching ANY selected category appear.

### ✅ Experience Types / Intents (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:75-82` — 6 curated types (adventurous, first-date, romantic, etc.) |
| **Save** | `handleApplyPreferences` L795 — saves `finalIntents` |
| **Read** | `RecommendationsContext.tsx:309` — `userPrefs.intents` capped to 1 |
| **Hook** | `useDeckCards.ts:92` — intents in query key |
| **Service** | `deckService.ts:217-223` — intents become curated pills → call `generate-curated-experiences` |
| **Edge** | `generate-curated-experiences/index.ts` — `experienceType` parameter drives card generation |

**Fact:** Intents flow correctly. Radio selection (max 1) is enforced at sheet, context, and service layers.

### ✅ Price Tiers / Budget (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:163` — price tier slugs (chill, comfy, bougie, lavish) |
| **Save** | `handleApplyPreferences` L796-798 — saves `priceTiers` + backward-compat `budgetMax` |
| **Read** | `RecommendationsContext.tsx:410` — `userPrefs.price_tiers` |
| **Hook** | `useDeckCards.ts:93-95` — priceTiers, budgetMin, budgetMax all in query key |
| **Service** | `deckService.ts:278-279` — sends `priceTiers` and `budgetMax` to edge function |
| **Edge** | `discover-cards/index.ts:449` — passes `priceTiers` to `serveCardsFromPipeline` |
| **SQL** | `query_pool_cards` L150-153 — `cp.price_tier = ANY(p_price_tiers)` when tiers provided, else `cp.price_min <= p_budget_max` |

**Fact:** Price filtering is robust. Tier-based filtering takes precedence when tiers are provided. Backward-compat budget fallback exists for legacy data.

### ✅ Date / Time / When to Head Out (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:114-128` — 4 date options (Now/Today/This Weekend/Pick a Date), 4 time slots, exact time picker |
| **Save** | `handleApplyPreferences` L800-803 — saves dateOption, datetime_pref, time_slot, exact_time (normalized) |
| **Read** | `RecommendationsContext.tsx:416-419` — all 4 datetime fields read from userPrefs |
| **Hook** | `useDeckCards.ts:99-102` — all 4 in query key |
| **Service** | `deckService.ts:283-286` — all 4 sent to edge function |
| **Edge** | `discover-cards/index.ts:86-184` — `filterByDateTime()` does live opening-hours check using current day/time, time slots, or exact time |

**Fact:** The datetime filtering is comprehensive. The `filterByDateTime` function:
- "Now" → checks live opening hours against current time
- Time slots → maps to hour ranges (brunch 9-13, afternoon 12-17, dinner 17-21, lateNight 21-24)
- Exact time → parses "4:00 PM" into hour 16 and checks opening hours
- Custom date → uses the date's day-of-week for opening hours check
- Curated cards get cascading hours check (`filterCuratedByStopHours`) that verifies EACH stop is open when you'd arrive

### ✅ Travel Distance / How Far Willing to Travel (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:194-195` — constraintType='time', constraintValue (minutes) |
| **Save** | `handleApplyPreferences` L830-831 — saves `travel_constraint_value` |
| **Read** | `RecommendationsContext.tsx:415` — `userPrefs.travel_constraint_value` |
| **Hook** | `useDeckCards.ts:98` — `travelConstraintValue` in query key |
| **Service** | `deckService.ts:281-282` — sends to edge function |
| **Edge** | `discover-cards/index.ts:403` — `maxDistKm = (travelConstraintValue / 60) * SPEED_KMH[travelMode] * 1.3` → converted to radiusMeters |
| **SQL** | `query_pool_cards` L147-148 — `cp.lat BETWEEN p_lat_min AND p_lat_max` (bounding box) |

**Fact:** Travel constraint drives the geo-filter radius. The formula accounts for travel mode speed (walking=4.5, driving=35, transit=20, biking=14 km/h) with a 1.3x factor for real-world routing.

### ✅ Travel Mode (FULLY HONORED for filtering and time calculation)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:107-112` — 4 modes: walking, biking, transit, driving |
| **Save** | `handleApplyPreferences` L804 — saves `travelMode` |
| **Read** | `RecommendationsContext.tsx:413` — `userPrefs.travel_mode` |
| **Hook** | `useDeckCards.ts:96` — `travelMode` in query key |
| **Service** | `deckService.ts:280` — sent to edge function |
| **Edge** | `discover-cards/index.ts:278,403` — used for radius calc AND passed to `serveCardsFromPipeline` |
| **cardPoolService** | `poolCardToApiCard` L648,739 — `estimateTravelMin(distKm, travelMode)` per card |

**Fact:** Travel mode drives BOTH:
1. The search radius (how far to look for places)
2. The per-card travel time estimate (haversine distance × mode-specific speed × detour factor)

### ✅ Travel Mode Icon on Cards (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **cardPoolService** | `poolCardToApiCard` L756 — returns `travelMode: travelMode || 'walking'` on each card |
| **deckService** | `unifiedCardToRecommendation` L109 — maps `card.travelMode` to Recommendation |
| **SwipeableCards** | L103-113 — `getTravelModeIcon()`: driving→car, transit→bus, biking→bicycle, walking→walk |
| **SwipeableCards** | L1707,1863 — `Icon name={getTravelModeIcon(currentRec.travelMode ?? effectiveTravelMode)}` |

**Fact:** The icon matches the user's travel mode. The card carries `travelMode` from the edge function, and the UI falls back to `effectiveTravelMode` (from preferences) if the card doesn't specify one.

### ✅ Starting Point — GPS vs Custom Location (FULLY HONORED)

| Layer | Evidence |
|-------|----------|
| **Sheet** | `PreferencesSheet.tsx:198-210` — GPS toggle + geocoded custom location with coordinates |
| **Save** | `handleApplyPreferences` L772-774,809-810 — saves `use_gps_location` + `custom_location` |
| **Read** | `useUserLocation.ts:124-128` — reads `cachedPrefs.custom_location` and `use_gps_location` |
| **Location logic** | `useUserLocation.ts:46-75` — if `!useGps && customLocation`: parses coords or geocodes address |
| **Context** | `RecommendationsContext.tsx:250-261` — `userLocationData` feeds into `activeDeckLocation` |
| **Edge** | Location passed as `{ lat, lng }` to discover-cards and generate-curated-experiences |

**Fact:** Custom location is fully respected. The `useUserLocation` hook:
1. Reads `use_gps_location` and `custom_location` from cached preferences
2. If custom: parses "lat,lng" string or geocodes address via HTTP API
3. Falls back to GPS only if custom fails
4. The resolved location becomes the center point for all geo-filtering and distance calculations

---

## 3. Material Gaps Found

### 🔴 GAP 1: Scoring Service Ignores Budget/Price Tier Preference

**Fact:** The `scoringService.ts` scoring function receives `priceTiers` in its `ScoringParams` interface (line 27) but **never uses it in any factor calculation**.

```typescript
// scoringService.ts:149-180
export function scoreCards(cards: any[], params: ScoringParams): ScoredCard[] {
  const keywords = buildKeywords(params.categories);
  return cards.map((card) => {
    const factors: ScoringFactors = {
      categoryMatch: calcCategoryMatch(card, params.categories),
      tagOverlap: calcTagOverlap(card, keywords),
      popularity: calcPopularity(card),
      quality: calcQuality(card),
      textRelevance: calcTextRelevance(card, keywords),
    };
    // ... NO price tier factor
  });
}
```

**Inference:** Cards that exactly match the user's price tier preference are not ranked higher than cards that merely pass the SQL filter. A "chill" user selecting only "chill" tier will see "chill" cards (the SQL enforces this), but those cards won't be ranked by how well they match the budget — they'll be ranked by category match, popularity, and text relevance only.

**Impact:** LOW-MEDIUM. The SQL filter already ensures only matching-tier cards appear. But within those results, there's no budget-proximity ranking. A user who selects "chill + comfy" won't see chill cards ranked higher if they're cheaper — ordering is purely by category/popularity/quality.

**Recommendation:** Add a `priceTierMatch` factor to the scoring algorithm that gives a small boost to cards whose tier exactly matches the user's preferred tiers (rather than just passing the filter).

### 🔴 GAP 2: Solo Mode Ignores Collaboration Preference Fields in useDeckCards Call

**Fact:** In `RecommendationsContext.tsx:406-426`, when in solo mode, the `useDeckCards` call reads ALL preference fields from `userPrefs` (the raw DB row). BUT for collaboration mode (line 339-361), `collabDeckParams` computes aggregated preferences including `priceTiers`, `budgetMin`, `budgetMax`, `travelMode`, `travelConstraintValue`, and `datetimePref` from `aggregateAllPrefs()`.

However, the actual `useDeckCards` call at line 406-426 does this:

```typescript
useDeckCards({
  location: activeDeckLocation,
  categories: activeDeckParams?.categories ?? [],          // ✅ uses collabDeckParams in collab
  intents: activeDeckParams?.intents ?? [],                // ✅ uses collabDeckParams in collab
  priceTiers: userPrefs?.price_tiers ?? [...],             // ❌ ALWAYS reads from solo user's prefs
  budgetMin: userPrefs?.budget_min ?? 0,                   // ❌ ALWAYS reads from solo user's prefs
  budgetMax: userPrefs?.budget_max ?? 1000,                // ❌ ALWAYS reads from solo user's prefs
  travelMode: userPrefs?.travel_mode ?? 'walking',         // ❌ ALWAYS reads from solo user's prefs
  travelConstraintType: 'time',
  travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,  // ❌ ALWAYS reads from solo user's prefs
  datetimePref: userPrefs?.datetime_pref ?? undefined,     // ❌ ALWAYS reads from solo user's prefs
  ...
});
```

**Inference:** In collaboration mode, only `categories` and `intents` use the aggregated group preferences. All other fields (price tiers, budget, travel mode, travel constraint, datetime) use the **current user's solo preferences**, NOT the group's aggregated preferences. This means the deck in collaboration mode filters by YOUR budget and YOUR travel mode, not the group's consensus.

**Impact:** MEDIUM. Collaboration mode partially ignores group preferences for filtering. The aggregated values exist (`collabDeckParams` computes them correctly) but are never passed to `useDeckCards`.

**Note:** For solo mode this is not a problem — solo mode correctly reads all fields from the user's own preferences.

---

## 4. Minor Weaknesses

### 🟡 WEAKNESS 1: matchFactors on Recommendation Are Hardcoded, Not Computed

**Fact:** `unifiedCardToRecommendation` in `deckService.ts:132-138` returns:
```typescript
matchFactors: {
  location: 0.5,
  budget: 0.5,
  category: 1.0,
  time: 0.5,
  popularity: (card.rating ?? 0) > 4 ? 0.8 : 0.5,
}
```

These are static values, not derived from the actual scoring. The real scoring happens in `scoringService.ts` with different factor names (categoryMatch, tagOverlap, popularity, quality, textRelevance). The card carries `scoringFactors` from the edge function, but `unifiedCardToRecommendation` ignores them.

**Impact:** LOW. These matchFactors are displayed in the expanded card modal as a "match breakdown." They show fake/static values instead of real scoring data.

### 🟡 WEAKNESS 2: Curated Cards Don't Go Through Price Tier SQL Filter

**Fact:** The `discover-cards` edge function calls `serveCardsFromPipeline` with `cardType: 'single'` (line 447). Curated cards come through a completely separate path via `generate-curated-experiences`. The curated edge function does NOT filter by price tier at the SQL level — it reads from `card_pool` with `card_type='curated'` but doesn't pass price tier filters.

**Inference:** Single cards respect price tier selection. Curated multi-stop cards may include stops at price levels outside the user's selection.

**Impact:** LOW-MEDIUM. Curated cards are assembled from multiple stops, and individual stop pricing may not align with the user's price tier preference.

### 🟡 WEAKNESS 3: Distance Matrix Not Used — Travel Times Are Estimates

**Fact:** Travel time is computed via `estimateTravelMin()` using haversine (straight-line) distance × mode speed × 1.3 detour factor. The Google Distance Matrix API is NOT called at serve time.

**Inference:** Travel times are estimates, not real routing. A 2km haversine distance for "walking" becomes `2 * 1.3 / 4.5 * 60 = ~35 min` even if the real walking route is shorter or longer. Transit times are especially inaccurate since they don't account for schedules or routes.

**Impact:** LOW. This is a known architectural decision (cost optimization). The estimates are "good enough" for card ranking and display. Real routing would require Distance Matrix API calls per card, which would be expensive.

---

## 5. Summary Verdict

| Preference | Honored? | How |
|------------|----------|-----|
| Categories | ✅ Yes | SQL array overlap filter + category scoring |
| Experience Types (Intents) | ✅ Yes | Separate curated pipeline per intent |
| Price Tiers / Budget | ✅ Yes (filter) / ⚠️ No (ranking) | SQL tier filter works; scoring ignores tiers |
| Date / Time | ✅ Yes | Live opening hours check, time slot ranges, exact time |
| Travel Distance Limit | ✅ Yes | Radius computed from constraint × mode speed |
| Travel Mode | ✅ Yes | Drives radius, per-card travel time, and card icon |
| Starting Point (GPS/Custom) | ✅ Yes | useUserLocation respects custom_location flag |
| Travel Mode Icon | ✅ Yes | getTravelModeIcon() on each card |
| Collaboration Aggregation | ⚠️ Partial | Categories/intents aggregated; budget/travel/datetime use solo prefs |

**Bottom line:** For solo mode, the preferences sheet drives the deck almost perfectly. Every preference you set is read, passed through the chain, and used for filtering. The two gaps are: (1) scoring doesn't boost cards that match your price tier preference (they're filtered but not ranked by it), and (2) in collaboration mode, only categories and intents use the group's aggregated preferences — everything else uses your personal settings.

---

## 6. Files Read (Investigation Manifest)

| File | Lines Read | Purpose |
|------|-----------|---------|
| `app-mobile/src/components/PreferencesSheet.tsx` | 1-900 | What preferences are collected |
| `app-mobile/src/hooks/useDeckCards.ts` | 1-142 | How preferences enter the query |
| `app-mobile/src/services/deckService.ts` | 1-452 | How preferences are sent to edge functions |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 1-450 | How preferences are read and passed |
| `app-mobile/src/hooks/useUserPreferences.ts` | 1-62 | How preferences are fetched from DB |
| `app-mobile/src/hooks/useUserLocation.ts` | 1-152 | How GPS/custom location is resolved |
| `app-mobile/src/components/SwipeableCards.tsx` | 1-50, travel grep | How cards display travel mode |
| `supabase/functions/discover-cards/index.ts` | 1-550 | How edge function filters cards |
| `supabase/functions/generate-curated-experiences/index.ts` | 1-150 | How curated cards are generated |
| `supabase/functions/_shared/cardPoolService.ts` | 1-920 | Pool query, card formatting, travel computation |
| `supabase/functions/_shared/scoringService.ts` | 1-182 | 5-factor scoring algorithm |
| `supabase/functions/_shared/priceTiers.ts` | (grep) | Price tier slug system |
| `supabase/migrations/20260305000001_price_tier_system.sql` | 93-192 | query_pool_cards SQL function |
