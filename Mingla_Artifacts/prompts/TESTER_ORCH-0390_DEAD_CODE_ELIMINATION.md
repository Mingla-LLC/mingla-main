# Testing: Dead Code Elimination (ORCH-0390)

## Mission

Verify that all dead code deletions are safe — nothing was removed that is actually used, TypeScript compiles clean, no imports are broken, no runtime references remain, and no regressions were introduced in adjacent behavior.

## Context

We performed a comprehensive dead code sweep across the Mingla monorepo. 17 files were deleted, 4 exports removed from living files, 4 edge function directories deleted, 3 stale comments cleaned, and a migration was created to drop 3 dead RPC functions. This is a subtraction-only change — no new behavior, no new code, just removal.

The risk is: did we delete something that IS actually used but our grep searches missed? A false positive in dead code detection means a runtime crash or missing UI.

## Implementation Reference

Chat-based implementation (no report file). Changes made:

### Deleted Files (13 mobile)
1. `app-mobile/src/services/aiSummaryService.ts`
2. `app-mobile/src/services/personalizedCardsService.ts`
3. `app-mobile/src/hooks/useRealtimeSession.ts`
4. `app-mobile/src/utils/animations.ts`
5. `app-mobile/src/components/board/BoardPreferencesForm.tsx`
6. `app-mobile/src/components/board/InviteCodeDisplay.tsx`
7. `app-mobile/src/components/board/InviteLinkShare.tsx`
8. `app-mobile/src/components/board/InviteMethodSelector.tsx`
9. `app-mobile/src/components/board/QRCodeDisplay.tsx`
10. `app-mobile/src/components/FriendSelectionModal.tsx`
11. `app-mobile/src/components/onboarding/LanguagePickerModal.tsx`
12. `app-mobile/src/components/PersonCuratedCard.tsx`
13. `app-mobile/src/components/SingleCardDisplay.tsx`

### Deleted Edge Functions (4 directories)
14. `supabase/functions/admin-feedback/`
15. `supabase/functions/get-google-maps-key/`
16. `supabase/functions/search-users/`
17. `supabase/functions/backfill-place-websites/`

### Dead Exports Removed from Living Files
18. `shuffleArray()` removed from `app-mobile/src/utils/cardConverters.ts`
19. `canAccessCuratedCards()`, `canSetCustomStartingPoint()`, `canPair()` removed from `app-mobile/src/constants/tierLimits.ts`

### Comments Cleaned
20. Dead `useAppState` comment removed from `app-mobile/src/components/ShareModal.tsx`
21. Stale WhatsApp import comment updated in `app-mobile/src/components/OnboardingFlow.tsx`
22. NavigationContext.tsx stubs updated to honest "Stub" labels with underscore-prefixed unused params

### Migration Added
23. `supabase/migrations/20260411200001_drop_dead_rpc_functions.sql` — drops `cleanup_old_location_history()`, `cleanup_stale_impressions()`, `cleanup_stale_presence()`

## Test Matrix

### SC-1: No broken imports in mobile app
- Grep the ENTIRE `app-mobile/` codebase for any import referencing any of the 13 deleted files
- Search patterns: `aiSummaryService`, `personalizedCardsService`, `useRealtimeSession`, `animations` (from utils/), `BoardPreferencesForm`, `InviteCodeDisplay`, `InviteLinkShare`, `InviteMethodSelector`, `QRCodeDisplay`, `FriendSelectionModal` (but NOT FriendSelectionModal from connections/), `LanguagePickerModal`, `PersonCuratedCard`, `SingleCardDisplay`
- Expected: ZERO import references to any deleted file
- CRITICAL: `FriendSelectionModal` — verify there is NOT a second file with this name that IS used. The deleted one was `app-mobile/src/components/FriendSelectionModal.tsx`. Check if `connections/` has a different friend selection component.

### SC-2: No broken imports for removed exports
- Grep for `shuffleArray` across entire codebase — expected: ZERO references
- Grep for `canAccessCuratedCards` — expected: ZERO references
- Grep for `canSetCustomStartingPoint` — expected: ZERO references
- Grep for `canPair` — expected: ZERO (but watch for partial matches like `canPairWith` — those are different functions)

### SC-3: TypeScript compiles clean
- Run `cd app-mobile && npx tsc --noEmit`
- Expected: zero errors
- Any new errors introduced by the deletion = FAIL

### SC-4: Living file exports still work
- Verify `cardConverters.ts` still exports: `normalizeDateTime`, `roundRobinInterleave`, `curatedToRecommendation`, `computePrefsHash`
- Verify `tierLimits.ts` still exports: `TierLimits` (interface), `TIER_LIMITS` (const), `getTierLimits`, `getSessionLimit`
- Verify each of these IS still imported somewhere

### SC-5: Edge function deletion safety
- Grep entire repo for `admin-feedback` (as string, not as substring) — expected: ZERO invoke calls
- Grep for `get-google-maps-key` — expected: ZERO invoke calls
- Grep for `search-users` — expected: ZERO invoke calls (watch for partial match with other search functions)
- Grep for `backfill-place-websites` — expected: ZERO invoke calls

### SC-6: Migration is valid SQL
- Read `supabase/migrations/20260411200001_drop_dead_rpc_functions.sql`
- Verify: uses `DROP FUNCTION IF EXISTS` (safe — won't error if function already gone)
- Verify: drops exactly 3 functions (cleanup_old_location_history, cleanup_stale_impressions, cleanup_stale_presence)
- Verify: does NOT drop `cleanup_expired_places_cache` (already dropped in prior migration 20260315000004)

### SC-7: Comment cleanup correctness
- Read `ShareModal.tsx` — verify the dead `useAppState` line is gone and no functional code was damaged
- Read `OnboardingFlow.tsx` around line 22 — verify the WhatsApp comment is clean (not a broken import)
- Read `NavigationContext.tsx` around lines 55-65 — verify stubs compile (underscore-prefixed params, honest comment)

## Regression Checks

### R-1: Card deck still works
- Verify `cardConverters.ts` imports resolve in: `RecommendationsContext.tsx`, `AppHandlers.tsx`, `OnboardingFlow.tsx`, `useDeckCards.ts`, `deckService.ts`, `sessionDeckService.ts`

### R-2: Tier gating still works
- Verify `tierLimits.ts` imports resolve in all consuming files
- Grep for `getTierLimits` and `getSessionLimit` — verify they're still imported and used

### R-3: Board components still render
- Verify the board/ directory still has its OTHER components (the ones NOT deleted)
- List remaining files in `app-mobile/src/components/board/` — should include active components like `InviteParticipantsModal.tsx`, `ManageBoardModal.tsx`, etc.

### R-4: Share modal still renders
- Read `ShareModal.tsx` top 40 lines — verify imports are clean, component still exports

### R-5: Onboarding still renders
- Read `OnboardingFlow.tsx` imports section — verify no dangling references

## Anti-Patterns
- Do NOT trust that "grep found nothing" means safe — check dynamic imports (`import()`) too
- Do NOT skip the FriendSelectionModal disambiguation — there may be a similarly named component elsewhere
- Do NOT mark PASS on TypeScript alone — grep for runtime string references too (e.g., `require()`, dynamic paths)

## Output
`Mingla_Artifacts/outputs/QA_ORCH-0390_DEAD_CODE_ELIMINATION_REPORT.md` with:
- Each SC and R test: scenario, expected, actual, PASS/FAIL
- Any dead code we MISSED (bonus findings welcome)
- Verdict: PASS or NEEDS REWORK
