# Solo Adventure Category-Based Pairing Implementation

## Overview
Replaced hardcoded solo adventure place-type pairings with a dynamic, category-based system that generates up to 84 possible 3-category combinations.

## Key Changes in `supabase/functions/generate-curated-experiences/index.ts`

### 1. **9 Place Categories Defined**
```typescript
const PLACE_CATEGORIES = {
  'outdoor-nature': [11 place types],
  'food-restaurants': [37 place types],
  'cafes-bars-casual': [16 place types],
  'shopping-markets': [5 place types],
  'arts-culture': [6 place types],
  'entertainment-nightlife': [10 place types],
  'active-sports': [18 place types],
  'wellness-relaxation': [5 place types],
  'creative-workshops': [5 place types],
}
```

### 2. **Dynamic Category Combinations**
- Generates all C(9,3) = **84 possible 3-category combinations**
- New function: `generateCategoryCombinations()` creates every unique combo

### 3. **Parallel Category Fetching**
- New function: `fetchPlacesByCategory(lat, lng, radius)`
- Fetches **10 places from EACH category** in parallel
- Returns: `{ 'outdoor-nature': [10 places], 'food-restaurants': [10 places], ... }`

### 4. **Smart Pairing Logic**
- New function: `resolvePairingFromCategories()`
- For each 3-category combo:
  1. Picks **1 random place from each category** (from the 10 available)
  2. Checks budget compliance
  3. Calculates travel times
  4. Returns card if all conditions pass
- **Only pairs places that actually exist** (no failures for missing place types)

### 5. **Request Flow (Solo Adventures)**
```
1. Receive request with experienceType='solo-adventure'
2. Fetch 10 places from all 9 categories (in parallel)
3. Generate 84 category combinations
4. Shuffle combinations for variety
5. For each combo, try to build a card
6. Return up to 20 successful cards
```

### 6. **Backwards Compatibility**
- Other experience types (first-dates, romantic, friendly, group-fun) still use hardcoded pairings
- Falls back to old `resolvePairing()` logic if not solo-adventure

## Benefits

| Before | After |
|--------|-------|
| Tried 15 hardcoded pairings | Tries 84 dynamic category combinations |
| Failed if any single place type missing | Only pairs places that were found |
| Limited variety in category combinations | All possible 3-category combos attempted |
| Default limit: 15 attempts | Default limit: 20 attempts |
| ~2 successful cards | Expected: 15-20+ successful cards |

## Example Flow

**Input:** User at (40.71°N, 74.01°W) in NYC, 30-min travel radius

**Processing:**
1. Fetch 10 parks, 10 restaurants, 10 bars, ... from each category
2. Try pairing: [outdoor-nature, food-restaurants, entertainment-nightlife]
   - Pick random park (found ✓)
   - Pick random restaurant (found ✓)
   - Pick random comedy club (found ✓)
   - Build card ✓
3. Try pairing: [arts-culture, cafes-bars-casual, active-sports]
   - Pick random museum (found ✓)
   - Pick random coffee shop (found ✓)
   - Pick random bowling alley (found ✓)
   - Build card ✓
4. Continue for all 84 combinations...

**Output:** 15-20+ diverse solo adventure cards

## Logging
Debug logs are added to track:
- Number of places fetched per category
- Number of category combinations generated
- Success rate: "Generated X cards out of Y attempted combinations"

## Testing Notes
- Test with various locations (urban, suburban, rural)
- Verify default limit of 20 works (can adjust if needed)
- Check that when user clicks "Generate Another 20", they get different cards (due to shuffling + random selection)
