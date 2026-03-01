# Bugfix: First Meet Returns Wrong Cards + Duplicate React Keys
**Date:** 2026-03-01
**Status:** Planned
**Severity:** High — core card pipeline broken for First Meet category

## Summary

Two related bugs in the multi-pill deck pipeline:

1. **First Meet returns Nature/Adventure cards** — When only "First Meet" is selected, the category slug `"first_meet"` (underscore) fails to match the comparison string `"first meet"` (space) in `deckService.resolvePills()`. This causes the category to fall through to `categoryFilters` instead of creating a dedicated pill, then the fallback `solo-adventure` curated pill kicks in, serving random adventure cards.

2. **React key collision on Google Place IDs** — `roundRobinInterleave()` combines cards from multiple pills without deduplication. When the same Google Place appears in both the card pool and a dedicated pill (e.g., a café appears in both Nature and First Meet results), the final deck contains two cards with the same `id` (raw Google Place ID), causing React's "Encountered two children with the same key" error.

## User Story
As a user who selects only "First Meet", I want to see venues appropriate for first meetings (cafés, bars, tea houses, bookstores) — not nature trails or random adventure itineraries.

## Root Cause Analysis

### Bug #1: Category Slug Mismatch

**The pipeline:**
```
PreferencesSheet saves → DB stores → RecommendationsContext reads → deckService.resolvePills()
```

**PreferencesSheet.tsx:84-87** defines categories with **slug IDs**:
```typescript
{ id: "nature",      label: "Nature" }       // slug
{ id: "first_meet",  label: "First Meet" }   // slug (underscore)
{ id: "Picnic Park", label: "Picnic Park" }  // display name (inconsistent!)
```

**PreferencesSheet.tsx:817** saves both intents and categories to DB:
```typescript
categories: [...selectedIntents, ...selectedCategories]
// Result: ["first_meet"] — the slug ID, NOT the display name
```

**deckService.ts:62-72** compares against **display names with spaces**:
```typescript
for (const cat of cats) {
  if (cat.toLowerCase() === 'nature')        // "nature" === "nature" ✓
  else if (cat.toLowerCase() === 'first meet')  // "first_meet" !== "first meet" ✗ BUG!
  else if (cat.toLowerCase() === 'picnic park') // "picnic park" === "picnic park" ✓
  else categoryFilters.push(cat);               // first_meet falls here
}
```

**Result:** No pill is created for First Meet → `pills.length === 0` → fallback to `solo-adventure` curated pill → user sees adventure cards.

**Why Nature and Picnic Park work:**
- `"nature".toLowerCase() === "nature"` ✓ (slug matches)
- `"Picnic Park".toLowerCase() === "picnic park"` ✓ (because Picnic Park's id IS `"Picnic Park"`, not a slug — a separate inconsistency)

### Bug #2: Duplicate Place IDs Across Pills

**roundRobinInterleave()** in `cardConverters.ts:27-39` blindly combines card arrays:
```typescript
export function roundRobinInterleave(pillResults: Recommendation[][]): Recommendation[] {
  const result: Recommendation[] = [];
  // ... NO deduplication by placeId
  result.push(pillResults[p][round]);  // pushes regardless of duplicates
}
```

When multiple pills return cards for the same Google Place (e.g., a café that qualifies as both "First Meet" and "Casual Eats"), the interleaved deck contains two `Recommendation` objects with the same `id` value (the raw Google Place ID like `ChIJI9ojzqLxrIkR0oMW3Ccfhtg`).

This causes:
- React key collision warnings during render
- Potential double-removal when swiping (since `removedCards.has(rec.id)` would match both)
- Wasted deck slots showing duplicate venues

## Architecture Impact
- **Modified files:**
  - `app-mobile/src/services/deckService.ts` — fix slug comparison in `resolvePills()`
  - `app-mobile/src/utils/cardConverters.ts` — add deduplication in `roundRobinInterleave()`
  - `app-mobile/src/components/PreferencesSheet.tsx` — normalize Picnic Park id to `picnic_park` for consistency

- **No new files, tables, edge functions, or external APIs needed**

## Fix Details

### Fix 1: deckService.ts — Handle both slug and display name formats

**File:** `app-mobile/src/services/deckService.ts`
**Lines:** 62-72

Replace the string comparisons with a normalizer that handles both `"first_meet"` (slug) and `"First Meet"` (display name):

```typescript
for (const cat of cats) {
  const normalized = cat.toLowerCase().replace(/_/g, ' ');
  if (normalized === 'nature') {
    pills.push({ id: 'nature', type: 'category' });
  } else if (normalized === 'first meet') {
    pills.push({ id: 'first_meet', type: 'category' });
  } else if (normalized === 'picnic park') {
    pills.push({ id: 'picnic_park', type: 'category' });
  } else {
    categoryFilters.push(cat);
  }
}
```

The key change: `cat.toLowerCase().replace(/_/g, ' ')` normalizes both `"first_meet"` → `"first meet"` and `"First Meet"` → `"first meet"`.

### Fix 2: cardConverters.ts — Deduplicate in roundRobinInterleave

**File:** `app-mobile/src/utils/cardConverters.ts`
**Lines:** 27-39

Add `placeId`-based deduplication:

```typescript
export function roundRobinInterleave(pillResults: Recommendation[][]): Recommendation[] {
  const result: Recommendation[] = [];
  const seenPlaceIds = new Set<string>();
  const maxLen = Math.max(0, ...pillResults.map(p => p.length));

  for (let round = 0; round < maxLen; round++) {
    for (let p = 0; p < pillResults.length; p++) {
      if (round < pillResults[p].length) {
        const card = pillResults[p][round];
        const dedupeKey = card.placeId || card.id;
        if (!seenPlaceIds.has(dedupeKey)) {
          seenPlaceIds.add(dedupeKey);
          result.push(card);
        }
      }
    }
  }
  return result;
}
```

### Fix 3: PreferencesSheet.tsx — Normalize Picnic Park id (optional, consistency)

**File:** `app-mobile/src/components/PreferencesSheet.tsx`
**Line:** 87

Change:
```typescript
{ id: "Picnic Park", label: "Picnic Park", icon: "basket-outline" },
```
To:
```typescript
{ id: "picnic_park", label: "Picnic Park", icon: "basket-outline" },
```

This makes all category IDs use consistent snake_case slugs. The `deckService` fix (replacing underscores with spaces) handles both formats, so this is a consistency improvement.

**Warning:** If existing users have `"Picnic Park"` stored in their DB preferences, the new slug `"picnic_park"` will still work because of the normalizer in Fix 1. No migration needed.

## Test Cases

1. **First Meet only** — Select only "First Meet" in preferences → swipe deck should show cafés, bars, tea houses, bookstores (NOT nature trails or adventure itineraries)
2. **First Meet + Nature** — Select both → deck should interleave First Meet venues and Nature spots, with no duplicate places
3. **Picnic Park only** — Verify Picnic Park still works after slug normalization
4. **All categories** — Select multiple categories → no duplicate React key warnings in console
5. **Solo-adventure intent + First Meet** — Verify both pills fire independently and interleave correctly

## Success Criteria
- [ ] Selecting only "First Meet" produces cafés, bars, tea houses — zero nature/adventure cards
- [ ] No "Encountered two children with the same key" React warnings in console
- [ ] Existing Nature and Picnic Park pill behavior unchanged
- [ ] Mixed category selections produce correctly interleaved, deduplicated decks
