# Implementation Report: Collaboration Curated Card Parity
**Date:** 2026-03-01
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `supabase/functions/generate-curated-experiences/index.ts` | Generated curated multi-stop itinerary cards for solo mode only | ~900 lines |
| `app-mobile/src/services/curatedExperiencesService.ts` | Service wrapper for the edge function, no session awareness | ~28 lines |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | React Query hook for curated cards, no session support | ~128 lines |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Orchestrated all card fetching; curated hooks gated to `isSoloMode` | ~775 lines |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Collaboration preferences UI; missing Adventure intent, different budget presets, didn't save intents into categories | ~900+ lines |

### Pre-existing Behavior
- Curated multi-stop itinerary cards only appeared in solo mode
- Collaboration swipe deck showed only regular single-place cards
- CollaborationPreferences was missing the "Adventure" experience type
- CollaborationPreferences saved only `selectedCategories` to DB (not intents)
- CollaborationPreferences used range-based budget presets ($0-25, $25-75, $75-150, $150+) instead of solo's "Up to" presets
- Loading intents from DB used `experience_types` field instead of splitting from `categories`

---

## What Changed

### New Files Created
None.

### Files Modified
| File | Change Summary |
|------|---------------|
| `supabase/functions/generate-curated-experiences/index.ts` | Added `aggregateSessionPreferences()` helper and `session_id` request parameter. When session_id present, aggregates all participants' preferences and uses them instead of individual params. Returns empty if experience type not selected by any participant. |
| `app-mobile/src/services/curatedExperiencesService.ts` | Added `sessionId` to `GenerateCuratedParams`. Maps camelCase `sessionId` to snake_case `session_id` in edge function body. |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Added `sessionId` to params interface. Included `sessionId ?? 'solo'` in React Query key for cache separation. `sessionId` flows through `restParams` spread to service automatically. |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Removed `isSoloMode` gate on curated hooks. Added `curatedSessionId` derived from `resolvedSessionId`. All 5 curated hooks now pass `sessionId` and enable in both solo and collaboration mode. Added `curated-experiences` query invalidation on mode transition. |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Added "Adventure" (`solo-adventure`) to experience types list. Changed budget presets to match solo ("Up to $25/50/100/150"). Save now merges `[...selectedIntents, ...selectedCategories]` into categories. Loading splits categories back into intents/categories using `INTENT_IDS` Set. Added `curated-experiences` cache invalidation on save. |

### Database Changes
None — no new tables or columns required.

### Edge Functions
| Function | New / Modified | Endpoint |
|----------|---------------|----------|
| `generate-curated-experiences` | Modified | POST /generate-curated-experiences |

### State Changes
- React Query keys modified: `curated-experiences` key now includes `sessionId ?? 'solo'` segment
- Cache invalidation added: `curated-experiences` invalidated on mode transition and collaboration preference save

---

## Implementation Details

### Architecture Decisions

1. **Server-side aggregation (Option A)**: All preference aggregation happens in the edge function when `session_id` is provided. The client always enables all 5 curated hooks in collaboration mode and lets the edge function return empty `[]` for unselected experience types. This avoids client-side aggregation complexity and keeps the collaboration data flow clean.

2. **`const` → `let` in serve handler**: The destructured request variables in the edge function were changed from `const` to `let` so they can be overwritten by session aggregation results. When `session_id` is absent, behavior is identical to before.

3. **Query key cache separation**: Adding `sessionId ?? 'solo'` to the React Query key ensures solo and collaboration curated cards never share a cache entry, preventing stale data when switching modes.

4. **Backwards-compatible intent loading**: The `CollaborationPreferences` loading logic falls back to `experience_types` column for older saved data, then splits `categories` for new data format.

### Aggregation Strategy (edge function)
When `session_id` is present:
- **Budget**: widest range (min of all mins, max of all maxes)
- **Categories**: union of all participants' selections
- **Experience types**: union (extracted from categories via INTENT_IDS)
- **Travel mode**: majority vote
- **Travel constraint**: most restrictive (minimum value)
- **Datetime**: earliest
- **Location**: geographic centroid of all participant coordinates

---

## Success Criteria Verification
- [x] Curated multi-stop itinerary cards appear in collaboration swipe deck — enabled via removed solo gate + sessionId passthrough
- [x] Curated cards in collaboration use aggregated session preferences — edge function aggregates when session_id present
- [x] CollaborationPreferences has the same experience types as PreferencesSheet (including Adventure) — solo-adventure added
- [x] CollaborationPreferences saves intents into categories array — `[...selectedIntents, ...selectedCategories]`
- [x] CollaborationPreferences uses matching budget presets — "Up to $25/50/100/150"
- [x] CuratedPlanView renders correctly when expanding curated cards in collaboration — no changes needed, works mode-agnostically
- [x] Solo mode is completely unchanged — solo path preserved with same enabled conditions
- [x] Curated cards saved from collaboration sessions display correctly on board — no changes needed to board/expand flow
