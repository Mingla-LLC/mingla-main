# Feature: Collaboration Curated Card Parity
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Collaboration preferences sheet should work the same as solo — including curated multi-stop itinerary cards. Currently curated cards only appear in solo mode.

## Summary
Bring collaboration mode to full parity with solo mode for card generation and preferences behavior. Currently, curated experience cards (multi-stop itinerary cards interleaved in the swipe deck) are gated to solo mode only. Additionally, the `CollaborationPreferences.tsx` component diverges from `PreferencesSheet.tsx` in experience types, budget presets, and how intents are saved. After this fix, collaboration participants will see the same card structures (including curated multi-stop cards) generated from the aggregated preferences of all session participants.

## User Story
As a collaboration session participant, I want to see the same curated multi-stop itinerary cards that I see in solo mode, so that the collaboration swipe experience matches the quality and variety of the solo experience — with cards reflecting the merged preferences of all participants.

## Root Causes (3 issues)

### Issue 1: Curated hooks gated to solo mode
**File:** `app-mobile/src/contexts/RecommendationsContext.tsx`
The 5 `useCuratedExperiences()` hook calls are wrapped in an `isSoloMode` conditional. When `currentMode !== "solo"`, curated cards are never fetched and never interleaved.

### Issue 2: CollaborationPreferences diverges from PreferencesSheet
**File:** `app-mobile/src/components/CollaborationPreferences.tsx`
- Missing `solo-adventure` experience type (only 5 intents vs solo's 6)
- Saves only `selectedCategories` to DB — does NOT merge intents into the categories array like solo does (`[...selectedIntents, ...selectedCategories]`)
- Different budget presets ($0-25/$25-75/$75-150/$150+ range-based) vs solo ($25/$50/$100/$150 "up to")

### Issue 3: Curated hooks use solo-only preferences
**File:** `app-mobile/src/contexts/RecommendationsContext.tsx`
Even if the solo gate were removed, the curated experience hooks derive `baseParams` from `userPrefs` (the solo `preferences` table) and `userLocation` (the user's solo location). In collaboration mode, these params should come from aggregated session preferences (merged budget, unioned categories, central location).

## Architecture Impact

### Modified files:
1. `app-mobile/src/components/CollaborationPreferences.tsx` — add solo-adventure intent, fix intent saving, match budget presets
2. `app-mobile/src/contexts/RecommendationsContext.tsx` — remove isSoloMode gate, add session-aware curated params
3. `app-mobile/src/hooks/useCuratedExperiences.ts` — accept optional `sessionId`, include in query key and params
4. `app-mobile/src/services/curatedExperiencesService.ts` — pass `sessionId` to edge function
5. `supabase/functions/generate-curated-experiences/index.ts` — add `session_id` support with preference aggregation + central location

### No new files needed
### No new DB tables/columns needed
### No new edge functions needed

## Detailed Changes

---

### Change 1: CollaborationPreferences.tsx — Match PreferencesSheet behavior

**1a. Add `solo-adventure` experience type**

Current (line ~48-54):
```typescript
const experienceTypes = [
  { id: "first-dates", label: "First Date", icon: "heart-outline" },
  { id: "romantic", label: "Romantic", icon: "heart-outline" },
  { id: "friendly", label: "Friendly", icon: "people-outline" },
  { id: "group-fun", label: "Group Fun", icon: "people-outline" },
  { id: "business", label: "Business", icon: "briefcase-outline" },
];
```

Should be:
```typescript
const experienceTypes = [
  { id: "solo-adventure", label: "Adventure", icon: "compass-outline" },
  { id: "first-dates", label: "First Date", icon: "heart-outline" },
  { id: "romantic", label: "Romantic", icon: "heart-outline" },
  { id: "friendly", label: "Friendly", icon: "people-outline" },
  { id: "group-fun", label: "Group Fun", icon: "people-outline" },
  { id: "business", label: "Business", icon: "briefcase-outline" },
];
```

**1b. Save intents into categories array (matching PreferencesSheet)**

Current save logic only saves `selectedCategories`. Change to merge intents:
```typescript
categories: [...selectedIntents, ...selectedCategories],
```
This matches the solo PreferencesSheet pattern so that experience types (intents) are persisted in the `board_session_preferences.categories` column and can be read back when the edge function aggregates preferences.

**1c. Match budget presets to PreferencesSheet**

Current:
```typescript
const budgetPresets = [
  { label: "$0 - $25", min: 0, max: 25 },
  { label: "$25 - $75", min: 25, max: 75 },
  { label: "$75 - $150", min: 75, max: 150 },
  { label: "$150+", min: 150, max: 500 },
];
```

Should match solo:
```typescript
const budgetPresets = [
  { label: "Up to $25", min: 0, max: 25 },
  { label: "Up to $50", min: 0, max: 50 },
  { label: "Up to $100", min: 0, max: 100 },
  { label: "Up to $150", min: 0, max: 150 },
];
```

**1d. Load intents back from categories on mount**

When loading existing preferences, split the `categories` array into intents and categories using the same `INTENT_IDS` Set pattern that PreferencesSheet uses:
```typescript
const INTENT_IDS = new Set(["solo-adventure", "first-dates", "romantic", "friendly", "group-fun", "business"]);
const loadedIntents = [];
const loadedCategories = [];
savedCategories.forEach((item) => {
  if (INTENT_IDS.has(item)) loadedIntents.push(item);
  else loadedCategories.push(item);
});
```

---

### Change 2: generate-curated-experiences Edge Function — Session support

**Add optional `session_id` parameter to the request body.**

When `session_id` is present:
1. Fetch all `board_session_preferences` rows for that session
2. Aggregate preferences using the same strategy as `generate-session-experiences`:
   - `budget_min` = minimum of all participants' mins
   - `budget_max` = maximum of all participants' maxes
   - `categories` = union of all participants' categories
   - `travel_mode` = most common mode
   - `travel_constraint_type` = most common type
   - `travel_constraint_value` = minimum (most restrictive)
   - `datetime_pref` = earliest
3. Calculate central location = geographic centroid of all participants' locations
4. Extract experience types from aggregated categories using INTENT_IDS filter
5. Use aggregated params for card generation (replacing the individual-user params)

When `session_id` is NOT present (solo mode): behavior unchanged.

```typescript
interface CuratedExperienceRequest {
  // existing fields...
  latitude: number;
  longitude: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
  experienceType: string;
  datetimePref?: string;
  batchSize?: number;
  skipDescriptions?: boolean;
  batchSeed?: number;
  // NEW
  session_id?: string;
}
```

If `session_id` is present, the individual param fields (`latitude`, `longitude`, `budgetMax`, etc.) are IGNORED and the aggregated session preferences are used instead. This keeps the solo path unchanged while adding collaboration support cleanly.

---

### Change 3: curatedExperiencesService.ts — Pass sessionId

Add `sessionId` to the `CuratedExperienceParams` interface and include it in the edge function invocation body.

```typescript
interface CuratedExperienceParams {
  // existing...
  sessionId?: string;  // NEW
}
```

In `generateCuratedExperiences()`:
```typescript
body: {
  ...existingParams,
  session_id: params.sessionId,  // NEW — only present in collaboration mode
}
```

---

### Change 4: useCuratedExperiences.ts — Accept sessionId

Add `sessionId` to the hook params and include it in:
1. The React Query key (so collaboration and solo caches are separate)
2. The service call params

```typescript
interface UseCuratedExperiencesParams {
  // existing...
  sessionId?: string;  // NEW
}
```

Query key becomes:
```typescript
['curatedExperiences', experienceType, 'priority', sessionId ?? 'solo', batchSeed, ...]
```

---

### Change 5: RecommendationsContext.tsx — Enable curated in collaboration mode

**5a. Remove `isSoloMode` gate**

Currently the curated hooks are only called when `isSoloMode`. Remove this gate so they execute in both modes.

**5b. Pass `resolvedSessionId` to curated hooks**

When in collaboration mode, pass `resolvedSessionId` as `sessionId` to each `useCuratedExperiences` call:
```typescript
const curatedSessionId = isCollaborationMode ? resolvedSessionId : undefined;

const { cards: curatedSoloCards, ... } = useCuratedExperiences({
  ...baseParams,
  experienceType: 'solo-adventure',
  sessionId: curatedSessionId,  // NEW
  enabled: soloAdventureEnabled,
});
// ... same for all 5 hooks
```

**5c. Derive experience types from session preferences in collaboration mode**

In collaboration mode, `userPrefs.categories` only has the current user's solo preferences — not the aggregated session preferences. For determining which curated hooks to enable, we need the aggregated intents.

Two options:
- **Option A (recommended)**: Always enable all curated hooks in collaboration mode and let the edge function handle filtering based on aggregated preferences. The edge function already receives `session_id` and can determine which experience types are selected by the session participants.
- **Option B**: Fetch aggregated session preferences client-side and use them to conditionally enable hooks.

**Recommendation: Option A** — it's simpler, avoids client-side aggregation, and the edge function already has the aggregation logic. If no participants selected a given experience type, the edge function returns empty results (fast, no API cost).

Implementation for Option A:
```typescript
// In collaboration mode, enable all curated hooks — the edge function filters by aggregated intents
const soloAdventureEnabled = isSoloMode
  ? (experienceTypes.length === 0 || experienceTypes.includes('solo-adventure'))
  : isCollaborationMode;  // always enabled in collab, edge fn decides

const firstDatesEnabled = isSoloMode
  ? experienceTypes.includes('first-dates')
  : isCollaborationMode;

// ... same pattern for all 5
```

**5d. Interleave curated cards in collaboration mode**

The existing `interleaveCards()` function and `curatedToRecommendation()` transform already work mode-agnostically. No changes needed here — curated cards will naturally flow into the combined card array and get interleaved.

---

## Test Cases

1. **Solo mode unchanged**: Switch to solo mode → see curated multi-stop cards interleaved as before → expanding shows CuratedPlanView with stops timeline. Verify no regression.

2. **Collaboration curated cards appear**: Create a collaboration session with 2 participants → both set preferences including "Adventure" experience type → swipe deck shows curated multi-stop itinerary cards alongside regular cards.

3. **Collaboration preferences round-trip**: Open CollaborationPreferences → select "Adventure" + "Romantic" intents → select Nature, Drink categories → save → reopen → verify intents and categories are correctly loaded back.

4. **Aggregated preferences used**: Session with User A (budget $50, categories: Nature, Drink) and User B (budget $100, categories: Casual Eats, Play) → curated cards should reflect budget up to $100, categories include all four, location is midpoint.

5. **Curated card expand in collaboration**: Swipe right on a curated card in collaboration mode → card saved to board → open board → tap the curated card → ExpandedCardModal shows CuratedPlanView with stops timeline (same as solo).

6. **Empty experience types**: Collaboration session where no participants select any experience types → curated hooks enabled but edge function returns empty → no curated cards → only regular cards shown → no errors.

7. **Budget presets match**: Open CollaborationPreferences → budget options show "Up to $25 / $50 / $100 / $150" (matching solo), NOT "$0-25 / $25-75 / $75-150 / $150+".

## Success Criteria
- [ ] Curated multi-stop itinerary cards appear in collaboration swipe deck
- [ ] Curated cards in collaboration use aggregated session preferences (merged budget, categories, central location)
- [ ] CollaborationPreferences has the same experience types as PreferencesSheet (including Adventure)
- [ ] CollaborationPreferences saves intents into categories array
- [ ] CollaborationPreferences uses matching budget presets
- [ ] CuratedPlanView (stops timeline) renders correctly when expanding curated cards in collaboration
- [ ] Solo mode is completely unchanged (no regression)
- [ ] Curated cards saved from collaboration sessions display correctly on the board
