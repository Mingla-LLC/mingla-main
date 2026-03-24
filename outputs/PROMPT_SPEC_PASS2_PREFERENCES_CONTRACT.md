# Spec Prompt: Pass 2 — Fix the Preferences Contract

**Skill:** Software and Code Architect (Specer Mode)
**Date:** 2026-03-24
**Source:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md (Section 1) + FIX_PREFERENCES_DECK_CONTRACT_SPEC.md (Gap 1) + user-reported race condition
**Scope:** 4 fixes. What you pick is what you get. No stale cards, no dead code, no race conditions.

---

## Context

The preferences → deck pipeline has 4 problems:

1. **Race condition (E1):** PreferencesSheet line 866 `invalidateQueries(["userPreferences"])` triggers a server refetch that races the fire-and-forget DB write. Server returns OLD prefs, overwrites optimistic cache. User sees wrong cards for ~100ms before the real write completes.

2. **Stale batch on cold start (A12):** `useDeckCards.ts` lines 66-70 match cached batches using only `batchSeed + activePills` (categories). If user changed price tiers, travel mode, or datetime prefs since last session, the stale batch from Zustand is served as `initialData`.

3. **Dead code (A13+A14+A15):** `budgetMin` is carried through 4 layers but hardcoded to 0 everywhere. Collab `collabDeckParams` computes aggregated values that are never wired. `aggregateAllPrefs` doesn't aggregate `dateOption`/`timeSlot`/`exactTime`.

4. **Collab prefs not wired (E2):** In collab mode, `useDeckCards` reads budget/travel/datetime from `userPrefs` (current user's solo prefs) instead of `collabDeckParams` (aggregated group prefs). Already specced in FIX_PREFERENCES_DECK_CONTRACT_SPEC.md Gap 1 — reuse that spec.

---

## Fix 2a: Remove Destructive invalidateQueries from PreferencesSheet

**Problem:** `PreferencesSheet.tsx` lines 863-866 invalidate 4 query keys after saving:
```typescript
queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
queryClient.invalidateQueries({ queryKey: ["userLocation"] });
queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
```

The `userPreferences` invalidation races the DB write. The `deck-cards` invalidation is also destructive — it forces a refetch using potentially-stale prefs. `AppHandlers.handleSavePreferences` already handles the transition correctly via optimistic cache update + `preferencesRefreshKey` bump + new query keys.

**Root cause proven from user logs:** `[QUERY] success userPreferences` appears BETWEEN Fetch #1 (correct, from optimistic cache) and Fetch #2 (wrong, from stale server data). `preferences_updated` AppsFlyer event (DB write completion) appears AFTER both fetches.

**Fix:**
- Read `PreferencesSheet.tsx` and find the invalidateQueries block (around lines 863-866)
- Remove ALL 4 invalidation calls
- Add a protective comment explaining WHY they were removed
- Verify that `AppHandlers.handleSavePreferences` already does: (1) optimistic cache update to `["userPreferences", userId]`, (2) `preferencesRefreshKey` bump, (3) deck history reset when prefs hash changes

**Spec this fix with:**
- Exact lines to remove
- The protective comment text
- Verification that AppHandlers covers all 4 invalidated query keys

---

## Fix 2b: Expand initialData Match to Include Non-Category Prefs

**Problem:** `useDeckCards.ts` lines 66-70 match cached batches:
```typescript
const matchingBatch = deckBatches.find(b =>
  b.batchSeed === batchSeed &&
  JSON.stringify(b.activePills) === JSON.stringify(activePills)
);
```

Only checks `batchSeed` + `activePills` (categories/intents). If user changed priceTiers, travelMode, budgetMax, or datetime prefs since last session, the old batch is served as `initialData`.

**Fix:**
- Read `useDeckCards.ts` and the batch storage in Zustand store
- Expand the match to include `priceTiers`, `travelMode`, `travelConstraintValue`, `datetimePref` (or a hash of all preference fields)
- The simplest approach: store the full `prefsHash` (already computed in AppHandlers for deck reset) alongside each batch, and match on that instead of activePills
- If `prefsHash` is already available in the batch object, use it. If not, add it.

**Spec this fix with:**
- What the batch object currently contains (read the Zustand store type)
- What needs to be added
- The new matching logic
- Edge case: first launch with no cached batch (should be unaffected)

---

## Fix 2c: Dead Code Cleanup

**Problem:** Three pieces of dead code in the preferences pipeline:

1. **`budgetMin`** — Carried through `PreferencesSheet` → `AppHandlers` → `RecommendationsContext` → `useDeckCards` → `deckService`. But `deckService.ts:279` never sends it to the edge function, and `discover-cards/index.ts:445` hardcodes it to 0.

2. **`collabDeckParams` aggregated values** — `RecommendationsContext.tsx:340-361` computes `priceTiers`, `budgetMin/Max`, `travelMode`, `travelConstraintValue`, `datetimePref` from `aggregateAllPrefs()`. These are never wired into `useDeckCards` (lines 410-419 always read from `userPrefs`). Moot because collab uses `useSessionDeck`, but confusing.

3. **`aggregateAllPrefs` missing fields** — `dateOption`, `timeSlot`, `exactTime` are saved by PreferencesSheet in collab mode but never aggregated.

**Fix approach:**
- For `budgetMin`: Remove from `useDeckCards` params, `deckService.fetchDeck` params, and the edge function body. Keep in PreferencesSheet and DB (it's a real user preference, just unused for filtering currently). Add a comment: `// budgetMin: stored but not used for card filtering — cards are filtered by priceTiers instead`
- For `collabDeckParams` dead values: Since Fix 2d will wire these correctly, this becomes a non-issue. Just clean up any remaining dead assignments IF Fix 2d supersedes them.
- For `aggregateAllPrefs` missing fields: Add `dateOption`, `timeSlot`, `exactTime` to the aggregation OR document them as solo-only concepts with a comment explaining why.

**Spec this fix with:**
- Exact files and lines for each removal
- Which removals are safe (no downstream consumers) vs need care
- Whether aggregateAllPrefs should aggregate the time fields or document them as solo-only

---

## Fix 2d: Wire Collab Aggregated Prefs (S1 Spec Gap 1)

**Problem:** Already fully specced in `FIX_PREFERENCES_DECK_CONTRACT_SPEC.md` Gap 1.

In collab mode, `useDeckCards` reads budget/travel/datetime from `userPrefs` (current user's solo prefs) instead of the aggregated group prefs. The aggregation exists (`collabDeckParams`) but isn't wired.

**Fix:** Implement exactly as specced in FIX_PREFERENCES_DECK_CONTRACT_SPEC.md Gap 1:
- Mode-aware `effective*` resolution block (lines from the spec)
- Verify `aggregateAllPrefs` includes `priceTiers`
- Expose `collabTravelMode` for SwipeableCards icon

**Spec this fix by:**
- Reusing the existing spec verbatim
- Verifying the spec's line numbers still match current code (Pass 1 changed some files)
- Adding any adjustments needed due to Pass 1 changes

---

## Files Expected to Change

| File | Fixes |
|------|-------|
| `PreferencesSheet.tsx` | 2a (remove invalidations) |
| `useDeckCards.ts` | 2b (expand match), 2c (remove budgetMin param) |
| `deckService.ts` | 2c (remove budgetMin from fetchDeck) |
| `RecommendationsContext.tsx` | 2d (wire collab prefs) |
| `sessionPrefsUtils.ts` | 2c/2d (aggregation fixes) |
| Zustand store | 2b (if batch needs prefsHash field) |

---

## Scope Boundaries (DO NOT)

- Do NOT change any edge function (budgetMin removal is client-side only — edge function already ignores it)
- Do NOT change the scoring algorithm
- Do NOT change the save/schedule flow
- Do NOT touch any component rendering (that was Pass 1)
- Do NOT change query keys or staleTime settings
- Do NOT modify the DB schema

---

## Output Format

Write spec to `outputs/SPEC_PASS2_PREFERENCES_CONTRACT.md` with:
- Behavior before/after for each fix
- Exact code changes (which lines, what changes)
- Edge cases
- Test criteria
- Verification that AppHandlers already covers the invalidation removal (Fix 2a)

**CRITICAL:** Read the actual current code before speccing. Pass 1 changed some of these files. Line numbers from the investigation may have shifted.
**CRITICAL:** Read FIX_PREFERENCES_DECK_CONTRACT_SPEC.md for Fix 2d — reuse that spec, don't reinvent.
**CRITICAL:** Separate facts from inferences. Do NOT include a summary paragraph.
