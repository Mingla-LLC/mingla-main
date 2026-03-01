# Bugfix: Category Pill Resolution — Deck Shows Wrong Cards
**Date:** 2026-03-01
**Status:** Planned
**Severity:** Critical — user sees completely wrong cards regardless of category selection

## Summary

The solo swipe deck ignores the user's category selections and shows only "Adventurous" (solo-adventure curated) cards. Root cause is a string format mismatch in `deckService.ts resolvePills()`: PreferencesSheet saves category IDs as snake_case (`first_meet`, `casual_eats`) but resolvePills compares against space-separated lowercase (`first meet`, `picnic park`). When the comparison fails, the category falls through to `categoryFilters`, no dedicated pill is created, and the solo-adventure intent pill (or the empty-pills fallback) dominates the deck. A secondary issue is the Picnic Park ID using display-name format (`"Picnic Park"`) instead of snake_case, and `roundRobinInterleave()` lacking deduplication.

## Bug Trace — Full Pipeline

### What the user sees
- Select **only** "First Meet" → sees only adventure cards
- Select **only** "Picnic Park" → sees only adventure cards
- Select any combination → adventure cards dominate

### Why it happens

**Step 1 — PreferencesSheet saves categories to DB**

`PreferencesSheet.tsx:817`:
```typescript
categories: [...selectedIntents, ...selectedCategories]
```
Example saved array: `["solo-adventure", "first_meet"]` or `["solo-adventure", "Picnic Park"]`

**Step 2 — deckService receives the array**

`RecommendationsContext.tsx:219` passes `userPrefs.categories` to `useDeckCards` → `deckService.fetchDeck()` → `resolvePills()`.

**Step 3 — resolvePills() fails to match**

`deckService.ts:62-73`:
```typescript
for (const cat of cats) {
  if (cat.toLowerCase() === 'nature') {             // "nature" ✅
    pills.push({ id: 'nature', type: 'category' });
  } else if (cat.toLowerCase() === 'first meet') {  // "first_meet" → "first_meet" ≠ "first meet" ❌
    pills.push({ id: 'first_meet', type: 'category' });
  } else if (cat.toLowerCase() === 'picnic park') { // "Picnic Park" → "picnic park" ✅ (by coincidence)
    pills.push({ id: 'picnic_park', type: 'category' });
  } else {
    categoryFilters.push(cat); // first_meet lands here — WRONG
  }
}
```

| Category ID saved | `.toLowerCase()` | Comparison target | Match? |
|---|---|---|---|
| `"nature"` | `"nature"` | `'nature'` | ✅ |
| `"first_meet"` | `"first_meet"` | `'first meet'` | ❌ |
| `"Picnic Park"` | `"picnic park"` | `'picnic park'` | ✅ (coincidence) |

**Step 4 — Fallback kicks in**

When `first_meet` misses, `categoryFilters = ["first_meet"]`. If the user has no intent selected → `pills.length === 0` → fallback pushes `solo-adventure` curated pill (line 81-83). If the user has `solo-adventure` intent selected → that intent's curated pill is the only pill.

Either way: **all cards are adventurous**.

For Picnic Park: the comparison works, BUT `discover-picnic-park` edge function may fail (not deployed / error) → empty result → only the solo-adventure intent pill survives → adventure cards.

**Step 5 — No deduplication**

`roundRobinInterleave()` in `cardConverters.ts:27-39` has no `placeId` dedup. Same Google Place in multiple pills → duplicate React keys.

## Architecture Impact

- **Modified files (3):**
  - `app-mobile/src/services/deckService.ts` — normalize category strings in resolvePills
  - `app-mobile/src/utils/cardConverters.ts` — add dedup to roundRobinInterleave
  - `app-mobile/src/components/PreferencesSheet.tsx` — fix Picnic Park ID to snake_case
  - `app-mobile/src/components/CollaborationPreferences.tsx` — same Picnic Park ID fix

- **No new files**
- **No DB changes**
- **No edge function changes**

## Fix Details

### Fix 1: Normalize category strings in resolvePills — `deckService.ts`

**Before** (line 62-73):
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

**After:**
```typescript
for (const cat of cats) {
  const normalized = cat.replace(/_/g, ' ').toLowerCase();
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

**Why:** `"first_meet".replace(/_/g, ' ').toLowerCase()` → `"first meet"` ✅. Handles both `first_meet` (snake_case) and `"Picnic Park"` (display name) and `"picnic_park"` (after ID fix). One line addition.

### Fix 2: Dedup in roundRobinInterleave — `cardConverters.ts`

**Before** (line 27-39):
```typescript
export function roundRobinInterleave(pillResults: Recommendation[][]): Recommendation[] {
  const result: Recommendation[] = [];
  const maxLen = Math.max(0, ...pillResults.map(p => p.length));
  for (let round = 0; round < maxLen; round++) {
    for (let p = 0; p < pillResults.length; p++) {
      if (round < pillResults[p].length) {
        result.push(pillResults[p][round]);
      }
    }
  }
  return result;
}
```

**After:**
```typescript
export function roundRobinInterleave(pillResults: Recommendation[][]): Recommendation[] {
  const result: Recommendation[] = [];
  const seen = new Set<string>();
  const maxLen = Math.max(0, ...pillResults.map(p => p.length));
  for (let round = 0; round < maxLen; round++) {
    for (let p = 0; p < pillResults.length; p++) {
      if (round < pillResults[p].length) {
        const card = pillResults[p][round];
        const dedupeKey = (card as any).placeId ?? card.id;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          result.push(card);
        }
      }
    }
  }
  return result;
}
```

**Why:** Same Google Place can qualify for multiple categories → two cards with identical `placeId`. First pill to claim a place wins. Curated cards (no `placeId`) fall through to `card.id` which is always unique.

### Fix 3: Picnic Park ID consistency — `PreferencesSheet.tsx` + `CollaborationPreferences.tsx`

**PreferencesSheet.tsx line 87:**
```diff
- { id: "Picnic Park", label: "Picnic Park", icon: "basket-outline" },
+ { id: "picnic_park", label: "Picnic Park", icon: "basket-outline" },
```

**PreferencesSheet.tsx INTENT_CATEGORY_COMPATIBILITY (lines 138, 140):**
```diff
  "first-dates": [
    "nature",
    "first_meet",
    "drink",
    "watch",
    "creative_arts",
-   "Picnic Park",
+   "picnic_park",
  ],
- romantic: ["first_meet", "drink", "Picnic Park", "fine_dining", "wellness", "nature"],
+ romantic: ["first_meet", "drink", "picnic_park", "fine_dining", "wellness", "nature"],
```

**CollaborationPreferences.tsx — identical changes:**
- Line 69: `"Picnic Park"` → `"picnic_park"`
- Line 120: `"Picnic Park"` → `"picnic_park"`
- Line 122: `"Picnic Park"` → `"picnic_park"`

**Why:** Every other category uses snake_case. `"Picnic Park"` as an ID only worked by coincidence. After the normalizer fix (Fix 1), `"picnic_park"` → `"picnic park"` matches correctly. Aligns with `categories.ts` canonical slug `picnic_park`.

## How Round-Robin Works After Fix

| Scenario | Pills Created | Deck Content |
|---|---|---|
| Only "First Meet" selected (no intent) | `[first_meet]` | First Meet venue cards only |
| Only "Picnic Park" selected (no intent) | `[picnic_park]` | Picnic Park venue cards only |
| Only "Nature" selected (no intent) | `[nature]` | Nature venue cards only |
| "First Meet" + "Adventurous" intent | `[first_meet, solo-adventure]` | Round-robin mix: FM, Adv, FM, Adv... |
| "Nature" + "First Meet" + "Picnic Park" | `[nature, first_meet, picnic_park]` | Round-robin mix: N, FM, PP, N, FM, PP... |
| All 3 categories + 2 intents | `[nature, first_meet, picnic_park, solo-adventure, romantic]` | Round-robin of all 5 |
| No categories, no intents | `[solo-adventure]` (fallback) | Adventurous curated cards |
| Only intents, no categories | `[intent1, intent2, ...]` | Curated cards per intent |

**Single pill:** works — just returns that pill's cards in order.
**Multiple pills:** round-robin interleaves fairly. If one pill fails, graceful degradation — other pills still serve.

## Test Cases

1. **First Meet only, no intent:** Select only "First Meet" in PreferencesSheet, deselect all intents. Deck should show ONLY First Meet venue cards (chatbubbles icon, "First Meet" category label). Zero adventure cards.

2. **Picnic Park only, no intent:** Select only "Picnic Park", deselect all intents. Deck should show ONLY Picnic Park venue cards (basket icon). Zero adventure cards.

3. **First Meet + Adventurous intent:** Select "Adventurous" intent + "First Meet" category. Deck should alternate: First Meet venue → Adventurous curated → First Meet → Adventurous → ...

4. **Multiple categories, no intent:** Select "Nature" + "First Meet" + "Picnic Park". Deck should round-robin all three: N, FM, PP, N, FM, PP...

5. **Duplicate place dedup:** When the same Google Place appears in both Nature and First Meet results, only one card appears (first pill wins). No duplicate React key warnings.

6. **Empty fallback:** Deselect everything (no intents, no categories). Should fall back to solo-adventure curated cards.

## Success Criteria

- [ ] Selecting ONLY "First Meet" shows First Meet cards, not adventure cards
- [ ] Selecting ONLY "Picnic Park" shows Picnic Park cards, not adventure cards
- [ ] Selecting multiple categories round-robins them correctly
- [ ] Single category works (no errors, no fallback to adventure)
- [ ] No duplicate React key warnings in console
- [ ] Existing users with `"Picnic Park"` saved in DB still resolve correctly (normalizer handles both formats)
