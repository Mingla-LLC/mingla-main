# FIX SPEC: Preferences → Deck Contract Gaps

**Date:** 2026-03-24
**Source:** [INVESTIGATION_PREFERENCES_TO_DECK_CONTRACT.md](INVESTIGATION_PREFERENCES_TO_DECK_CONTRACT.md)
**Scope:** Fix 2 material gaps + 1 minor weakness. No scope creep.

---

## Gap 1: Collaboration Mode Ignores Aggregated Preferences

### Problem

In `RecommendationsContext.tsx:406-426`, the `useDeckCards` call reads `priceTiers`, `budgetMin`, `budgetMax`, `travelMode`, `travelConstraintValue`, `datetimePref`, `dateOption`, `timeSlot`, and `exactTime` from `userPrefs` (the **current user's solo preferences**) regardless of mode.

The `collabDeckParams` object (line 340-361) correctly computes aggregated values from `aggregateAllPrefs()`, but only `categories` and `intents` are wired through `activeDeckParams`.

### Root Cause

When the unified `useDeckCards` call was written, `activeDeckParams` was designed to carry only categories/intents (the "pill" fields). The remaining preference fields were hardcoded to read from `userPrefs` — correct for solo, broken for collab.

### Fix

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx`

**Change 1: Expand `collabDeckParams` to carry ALL preference fields (already done at L340-361, but not wired)**

The aggregated object already has `priceTiers`, `budgetMin`, `budgetMax`, `travelMode`, `travelConstraintType`, `travelConstraintValue`, `datetimePref`. These are computed correctly by `aggregateAllPrefs()`.

**Change 2: Wire aggregated fields into the `useDeckCards` call**

Replace lines 406-426 with mode-aware field resolution:

```typescript
// ── Mode-aware preference resolution ────────────────────────────────
// In solo mode: read from userPrefs (current user's DB preferences).
// In collab mode: read from collabDeckParams (aggregated group consensus).
// Categories and intents already come from activeDeckParams — this extends
// the same pattern to budget, travel, and datetime fields.

const effectivePriceTiers = isCollaborationMode && collabDeckParams?.priceTiers
  ? collabDeckParams.priceTiers
  : userPrefs?.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'];

const effectiveBudgetMin = isCollaborationMode && collabDeckParams
  ? collabDeckParams.budgetMin
  : userPrefs?.budget_min ?? 0;

const effectiveBudgetMax = isCollaborationMode && collabDeckParams
  ? collabDeckParams.budgetMax
  : userPrefs?.budget_max ?? 1000;

const effectiveTravelMode = isCollaborationMode && collabDeckParams
  ? collabDeckParams.travelMode
  : userPrefs?.travel_mode ?? 'walking';

const effectiveTravelConstraintValue = isCollaborationMode && collabDeckParams
  ? collabDeckParams.travelConstraintValue
  : userPrefs?.travel_constraint_value ?? 30;

const effectiveDatetimePref = isCollaborationMode && collabDeckParams
  ? collabDeckParams.datetimePref
  : userPrefs?.datetime_pref ?? undefined;

// dateOption, timeSlot, exactTime: collab aggregation doesn't compute these
// (they're solo-only UI concepts). For collab, pass defaults so the edge
// function falls back to datetimePref-based filtering.
const effectiveDateOption = isCollaborationMode ? 'now' : (userPrefs?.date_option ?? 'now');
const effectiveTimeSlot = isCollaborationMode ? null : (userPrefs?.time_slot ?? null);
const effectiveExactTime = isCollaborationMode ? null : (userPrefs?.exact_time ?? null);

const {
  cards: soloDeckCards,
  deckMode: soloDeckMode,
  activePills: soloActivePills,
  isLoading: isSoloDeckLoading,
  isFetching: isSoloDeckFetching,
  isFullBatchLoaded: isSoloDeckBatchLoaded,
  hasMore: soloDeckHasMore,
  error: soloDeckError,
} = useDeckCards({
  location: activeDeckLocation,
  categories: activeDeckParams?.categories ?? [],
  intents: activeDeckParams?.intents ?? [],
  priceTiers: effectivePriceTiers,
  budgetMin: effectiveBudgetMin,
  budgetMax: effectiveBudgetMax,
  travelMode: effectiveTravelMode,
  travelConstraintType: 'time' as const,
  travelConstraintValue: effectiveTravelConstraintValue,
  datetimePref: effectiveDatetimePref,
  dateOption: effectiveDateOption,
  timeSlot: effectiveTimeSlot,
  exactTime: effectiveExactTime,
  batchSeed,
  enabled: isSoloMode &&
    !!activeDeckLocation &&
    activeDeckParams !== null &&
    isDeckParamsStable &&
    !isWaitingForSessionResolution,
});
```

**Change 3: Expose `collabTravelMode` for SwipeableCards icon**

The context already exposes `collabTravelMode` (line 101 in the interface). Verify it's set from `collabDeckParams.travelMode`:

```typescript
// Already should be wired. Verify this line exists:
const collabTravelMode = isCollaborationMode && collabDeckParams
  ? collabDeckParams.travelMode
  : null;
```

**Change 4: Update `aggregateAllPrefs` to include `priceTiers`**

**File:** `app-mobile/src/utils/sessionPrefsUtils.ts`

Check if `aggregateAllPrefs` already computes `priceTiers`. If not, add:

```typescript
// Price tiers: union of all participants' tiers (widest range)
const allTiers = new Set<string>();
rows.forEach(r => {
  if (Array.isArray(r.price_tiers)) r.price_tiers.forEach((t: string) => allTiers.add(t));
});
const priceTiers = allTiers.size > 0
  ? [...allTiers]
  : ['chill', 'comfy', 'bougie', 'lavish']; // default if no participant set tiers
```

### Invariant

> In collaboration mode, every preference field sent to `useDeckCards` MUST come from the aggregated group preferences, not the current user's solo preferences.

**Enforced by:** Code review + the typed `collabDeckParams` object. If a new preference field is added, it must be added to both `aggregateAllPrefs` and the `effective*` resolution block.

### Test Cases

1. **Solo mode unchanged:** Solo user with custom preferences → deck filters match their preferences (no regression)
2. **Collab budget aggregation:** User A has budget max $50, User B has budget max $200 → deck uses $200 (max)
3. **Collab travel mode majority:** 2 users pick "walking", 1 picks "driving" → deck uses "walking"
4. **Collab travel constraint:** User A has 30 min, User B has 15 min → deck uses 15 min (min)
5. **Collab price tiers union:** User A has [chill, comfy], User B has [bougie] → deck uses [chill, comfy, bougie]
6. **Collab datetime:** User A picks 6PM, User B picks 8PM → deck uses earliest (6PM)
7. **Travel mode icon in collab:** Verify card icons show the group's majority travel mode, not the current user's

---

## Gap 2: Scoring Service Ignores Price Tier Preference

### Problem

`scoringService.ts` receives `priceTiers` in `ScoringParams` but never uses it. Cards that match the user's tier preference get the same score as cards that merely pass the SQL filter.

### Root Cause

The scoring algorithm was designed with 5 factors (category, tags, popularity, quality, text relevance). Price tier was added to the params interface when tier filtering was introduced, but no corresponding factor was implemented.

### Fix

**File:** `supabase/functions/_shared/scoringService.ts`

**Change 1: Add `priceTierMatch` factor**

```typescript
// Add to ScoringFactors interface (line 16):
export interface ScoringFactors {
  categoryMatch: number;
  tagOverlap: number;
  popularity: number;
  quality: number;
  textRelevance: number;
  priceTierMatch: number;      // NEW: 0 or 1
}

// Add to WEIGHTS (line 37):
const WEIGHTS = {
  categoryMatch: 3.0,
  tagOverlap: 1.6,
  popularity: 0.6,
  quality: 0.4,
  textRelevance: 1.3,
  priceTierMatch: 0.8,         // NEW: moderate boost for tier match
} as const;

// Update MAX_SCORE (line 45):
const MAX_SCORE = WEIGHTS.categoryMatch + WEIGHTS.tagOverlap + WEIGHTS.popularity
  + WEIGHTS.quality + WEIGHTS.textRelevance + WEIGHTS.priceTierMatch; // 7.7
```

**Change 2: Implement `calcPriceTierMatch`**

```typescript
function calcPriceTierMatch(card: any, priceTiers: string[]): number {
  if (priceTiers.length === 0) return 0.5; // No preference → neutral score
  const cardTier = card.priceTier || card.price_tier || '';
  return priceTiers.includes(cardTier) ? 1.0 : 0.0;
}
```

**Change 3: Wire into `scoreCards`**

```typescript
// In scoreCards (line 157), add to factors:
const factors: ScoringFactors = {
  categoryMatch: calcCategoryMatch(card, params.categories),
  tagOverlap: calcTagOverlap(card, keywords),
  popularity: calcPopularity(card),
  quality: calcQuality(card),
  textRelevance: calcTextRelevance(card, keywords),
  priceTierMatch: calcPriceTierMatch(card, params.priceTiers),  // NEW
};

// Update rawScore calculation:
const rawScore =
  factors.categoryMatch * WEIGHTS.categoryMatch +
  factors.tagOverlap * WEIGHTS.tagOverlap +
  factors.popularity * WEIGHTS.popularity +
  factors.quality * WEIGHTS.quality +
  factors.textRelevance * WEIGHTS.textRelevance +
  factors.priceTierMatch * WEIGHTS.priceTierMatch;               // NEW
```

### Why Weight 0.8?

- Category match (3.0) is the dominant signal — it determines the pool
- Price tier (0.8) is a secondary signal — it re-ranks within the pool
- At 0.8, a tier-matched card scores ~10% higher than a non-matched card of equal quality
- This is enough to bubble preferred-tier cards up without completely suppressing others

### Invariant

> Cards whose `priceTier` is in the user's `priceTiers` array MUST score higher than cards whose tier is not, all else being equal.

**Enforced by:** The scoring algorithm. Since SQL already filters to matching tiers, this factor primarily affects mixed-tier queries (e.g., user selects both "chill" and "comfy" — chill cards should rank slightly higher if user historically prefers chill).

### Test Cases

1. **Single tier selected:** User picks [chill] → all served cards have priceTierMatch=1.0 (SQL already filters)
2. **Multiple tiers:** User picks [chill, comfy] → both score priceTierMatch=1.0
3. **No tiers (legacy):** priceTiers=[] → all cards get priceTierMatch=0.5 (neutral, no boost)
4. **Score ordering:** Two cards identical except tier: card A matches user's tier, card B doesn't → A ranks higher

---

## Gap 3 (Minor): matchFactors Hardcoded on Recommendation

### Problem

`deckService.ts:132-138` returns static matchFactors instead of the real scoring data.

### Fix

**File:** `app-mobile/src/services/deckService.ts`

In `unifiedCardToRecommendation`, replace the hardcoded matchFactors with the real scoring data from the edge function:

```typescript
// Replace lines 132-138:
matchFactors: card.scoringFactors
  ? {
      location: 0.5,  // Not computed in scoring — keep static
      budget: card.scoringFactors.priceTierMatch ?? 0.5,
      category: card.scoringFactors.categoryMatch ?? 0.5,
      time: 0.5,      // Not computed in scoring — keep static
      popularity: card.scoringFactors.popularity ?? 0.5,
    }
  : {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: (card.rating ?? 0) > 4 ? 0.8 : 0.5,
    },
```

### Test Cases

1. Cards with scoringFactors from edge function → matchFactors reflect real scores
2. Cards without scoringFactors (legacy/cached) → fallback to static values (no regression)

---

## Implementation Order

1. **Gap 2 first** (scoring) — backend-only change, no mobile changes, no risk of breaking collab
2. **Gap 3 next** (matchFactors) — mobile-only change, uses Gap 2's output
3. **Gap 1 last** (collab wiring) — most complex, touches RecommendationsContext, needs collab testing

---

## Files Modified (Complete List)

| # | File | Change |
|---|------|--------|
| 1 | `supabase/functions/_shared/scoringService.ts` | Add priceTierMatch factor + weight |
| 2 | `app-mobile/src/services/deckService.ts` | Wire real scoringFactors into matchFactors |
| 3 | `app-mobile/src/contexts/RecommendationsContext.tsx` | Mode-aware preference resolution for useDeckCards |
| 4 | `app-mobile/src/utils/sessionPrefsUtils.ts` | Verify/add priceTiers to aggregateAllPrefs |

---

## Source of Truth

- **User preferences:** `preferences` table (solo) / `board_session_preferences` table (collab)
- **Aggregated collab preferences:** computed at runtime by `aggregateAllPrefs()` — NOT stored
- **Card scoring:** computed at serve-time by `scoringService.ts` — NOT stored on card_pool
- **Travel time:** computed at serve-time by `estimateTravelMin()` — NOT stored on card_pool

---

## Verification Queries

After implementation, verify:

```sql
-- Verify scoring includes price tier factor
-- (run generate-single-cards, then discover-cards and check response)
-- Each card in response should have scoringFactors.priceTierMatch = 0 or 1

-- Verify collab aggregation
-- Create a board session with 2 participants having different travel modes
-- Check that discover-cards receives the majority-vote travel mode
```

**Mobile verification:**
1. Open PreferencesSheet in solo mode → set travel mode to "driving" → confirm cards show car icon
2. Open PreferencesSheet in collab mode → both users set different budgets → confirm deck uses wider range
3. Expand a card → verify matchFactors show real values (not all 0.5)
