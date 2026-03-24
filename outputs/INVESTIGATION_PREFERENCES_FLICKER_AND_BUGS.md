# Investigation: Preferences Change Flicker + Hidden Bugs

**Date:** 2026-03-24
**Symptom:** After changing preferences and closing the sheet, user briefly sees cards from OLD preferences before correct cards appear (~700-1000ms flicker).

---

## Finding 1 — ROOT CAUSE: `placeholderData` Shows Stale Cards During Fetch

**Severity:** 🔴 Root Cause
**Confidence:** HIGH — verified in code

**What you see:** You change your preferences (e.g., remove "Nature," add "Fine Dining"), close the sheet, and for about a second you still see Nature cards before the Fine Dining cards appear.

**Why it happens:**

In [useDeckCards.ts:115](app-mobile/src/hooks/useDeckCards.ts#L115):
```typescript
placeholderData: (previousData) => previousData,
```

This React Query option tells the system: "While fetching new data, keep showing the OLD data." It's meant to prevent blank screens, but the problem is the old data contains cards from your *previous* preferences — so you see wrong-category cards for the ~700ms the new fetch takes.

**The sequence:**
1. You save preferences → sheet closes instantly (line 814)
2. `handleSavePreferences` in [AppHandlers.tsx:635](app-mobile/src/components/AppHandlers.tsx#L635) optimistically updates the preferences cache
3. `resetDeckHistory` clears the Zustand deck batches → `deckBatches = []`, `currentDeckBatchIndex = -1`
4. New query key is computed (new categories/intents) → React Query starts fetching
5. **But `placeholderData` returns the OLD deck response** → old cards render for ~700ms
6. New fetch returns → correct cards replace the stale ones

**Why it's wrong:** `placeholderData` is appropriate for *pagination* (show batch 1 while loading batch 2), not for *preference changes* where the entire dataset is invalidated. Old cards from deselected categories are not a valid placeholder.

**Invariant violated:** "After a preference change, the user must never see cards from deselected categories."

**What enforces it now:** Nothing. `placeholderData` unconditionally returns previous data regardless of whether the query key change was a batch increment or a full preference change.

---

## Finding 2 — CONTRIBUTING FACTOR: Double Fetch (Wasted API Call)

**Severity:** 🟠 Contributing Factor
**Confidence:** HIGH — visible in logs

**What you see in logs:**
```
[DeckService] Input categories: []
[DeckService] Resolved pills: [{"id":"first-date","type":"curated"}]
...
[DeckService] Input categories: ["casual_eats","drink","nature"]
[DeckService] Resolved pills: [...casual_eats, drink, nature, adventurous]
```

Two separate edge function calls fire on every preference change. The first one has wrong/empty categories.

**Why it happens:**

The preference save in [AppHandlers.tsx](app-mobile/src/components/AppHandlers.tsx) does three things in rapid succession:
1. **Line 635:** Sets optimistic cache → `queryClient.setQueryData(["userPreferences", user.id], ...)`
2. **Line 658:** Resets deck history → `resetDeckHistory(newHashStr)` clears Zustand
3. **Line 663:** Bumps refresh key → `setPreferencesRefreshKey(prev => prev + 1)`

Then PreferencesSheet (line 862-866) fires additional invalidations including `["userPreferences"]`.

This creates a race:
- **Render 1:** Zustand store reset triggers re-render. `stableDeckParams` recalculates with the optimistic preferences, but `useUserLocation` (which depends on `refreshKey`) hasn't resolved yet. The location changes → new query key → **Fetch #1 fires** with whatever params are available.
- **Render 2:** `useUserLocation` resolves, preferences query settles after invalidation. New stable params → new query key → **Fetch #2 fires** with correct params.

**Cost:** One wasted edge function call per preference change (~700ms server time + bandwidth).

---

## Finding 3 — CONTRIBUTING FACTOR: Invalidation Fires Even on Save Failure

**Severity:** 🟠 Contributing Factor
**Confidence:** HIGH — verified in code

In [PreferencesSheet.tsx:862-866](app-mobile/src/components/PreferencesSheet.tsx#L862-L866):
```typescript
} catch (error) {
    console.warn("[PreferencesSheet] Background save failed:", error);
    toastManager.error("Preferences couldn't save — they'll reset next time.", 4000);
}

// Invalidate all preference-dependent queries so the UI reflects saved changes.
queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
queryClient.invalidateQueries({ queryKey: ["userLocation"] });
queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
```

The four `invalidateQueries` calls are **outside** the try/catch. They run even when the save throws. If the DB write fails, the optimistic cache is already set, but the invalidation of `["userPreferences"]` triggers a server refetch that will return the OLD (pre-save) preferences from the DB. This creates a brief flash of new preferences → revert to old preferences — the opposite of the normal flicker.

**Invariant violated:** "Query invalidation should only fire after a confirmed successful write."

---

## Finding 4 — CONTRIBUTING FACTOR: Redundant Invalidation (PreferencesSheet vs AppHandlers)

**Severity:** 🟡 Hidden Flaw
**Confidence:** HIGH — verified in code

Two layers both try to invalidate deck queries after a preference change:

1. **AppHandlers.tsx line 663:** `setPreferencesRefreshKey(prev => prev + 1)` → triggers the refresh handler in [RecommendationsContext.tsx:571-595](app-mobile/src/contexts/RecommendationsContext.tsx#L571-L595), which resets `batchSeed`, clears dismissed cards, etc.
2. **PreferencesSheet.tsx line 865:** `queryClient.invalidateQueries({ queryKey: ["deck-cards"] })` → directly invalidates React Query cache.

These two mechanisms fight each other:
- The `refreshKey` path resets state cleanly and relies on the new query key (from changed params) to trigger a fresh fetch.
- The `invalidateQueries` path forces a refetch of the CURRENT query key, which may be the stale one from the previous render.

This is why you get the double fetch: one from the query key change (correct), one from the explicit invalidation (redundant and potentially stale).

---

## Finding 5 — HIDDEN BUG: `isRefreshingAfterPrefChange` Doesn't Guard the Sync Effect

**Severity:** 🟡 Hidden Flaw
**Confidence:** HIGH — verified in code

In [RecommendationsContext.tsx:794](app-mobile/src/contexts/RecommendationsContext.tsx#L794):
```typescript
} else if (deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching
           && !isBatchTransitioning && !isSlowBatchLoad && !isModeTransitioning) {
    setRecommendations(prev => prev.length === 0 ? prev : EMPTY_CARDS);
}
```

This "genuinely empty" branch does NOT check `isRefreshingAfterPrefChange`. During the window between:
- Deck history reset (Zustand clears batches → `deckCards = []`)
- New fetch completion (`deckCards = [new cards]`)

...there's a render where `deckCards.length === 0` AND `isDeckBatchLoaded` is true (from the old query completing) AND `isDeckFetching` is false (new query hasn't started yet in this render). All guards pass → `setRecommendations(EMPTY_CARDS)` fires → user sees a blank deck for a frame.

This is masked by `placeholderData` (Finding 1), which keeps old cards visible. But if `placeholderData` is fixed (which it should be), this bug would surface as a blank flash.

**Fix dependency:** This must be fixed TOGETHER with Finding 1. The guard at line 794 needs `&& !isRefreshingAfterPrefChange`.

---

## Finding 6 — COSMETIC BUG: "chevron-down-outline" Icon Warnings

**Severity:** 🔵 Observation
**Confidence:** HIGH — visible in logs

```
WARN  [Icon] Unknown icon name: "chevron-down-outline"
```

This fires 6-9 times every time ExpandedCardModal opens. The icon set being used (likely Ionicons or MaterialCommunityIcons) doesn't include `"chevron-down-outline"` — it's probably `"chevron-down"` without the `-outline` suffix, or it needs to use a different icon library.

**Impact:** Console noise only. No visual breakage (React Native renders nothing for unknown icons, so wherever this chevron should appear, it's invisible).

**Files to check:** Components inside ExpandedCardModal that reference `"chevron-down-outline"`.

---

## Finding 7 — OBSERVATION: `handleSavePreferences` Silently Catches DB Write Failures

**Severity:** 🟡 Hidden Flaw (previously documented)
**Confidence:** HIGH — verified in code

[AppHandlers.tsx:670-671](app-mobile/src/components/AppHandlers.tsx#L670-L671):
```typescript
PreferencesService.updateUserPreferences(user.id, dbPreferences)
    .catch((e: any) => console.warn('[handleSavePreferences] Background DB write failed:', e));
```

The DB write is fire-and-forget. If it fails:
- User sees the optimistic (correct) preferences locally
- Server still has old preferences
- Next app restart → preferences revert silently
- No user-visible error (PreferencesSheet shows its own toast, but AppHandlers doesn't)

This was previously documented in MEMORY.md as a known issue. It's still unfixed.

---

## Recommended Fix Strategy

**Primary fix (addresses the flicker):**

1. **Suppress `placeholderData` during preference transitions.** When the query key changes because of a preference change (not a batch increment), `placeholderData` should return `undefined` instead of `previousData`. This will show a loading state instead of stale cards.

   Implementation: Track whether the query key change was from a preference change (via `isRefreshingAfterPrefChange`). Pass this to `useDeckCards` so it can conditionally return `undefined` from `placeholderData`.

2. **Add `!isRefreshingAfterPrefChange` to the sync effect guard at line 794.** Prevents the empty-state flash during transitions.

3. **Move invalidation inside the try block** in PreferencesSheet.tsx (lines 862-866). Only invalidate on successful save.

**Secondary fix (eliminates double fetch):**

4. **Remove the `deck-cards` and `userPreferences` invalidation from PreferencesSheet.tsx entirely.** AppHandlers already handles this via optimistic cache update + refreshKey bump. The explicit invalidation is redundant and causes the double fetch.

**Cosmetic fix:**

5. **Fix "chevron-down-outline" to the correct icon name** in ExpandedCardModal components.

---

## Solo vs Collab Parity Check

The flicker affects **solo mode only** because:
- Collaboration mode uses `useSessionDeck` (not `useDeckCards`) — different data path
- Collaboration preferences go through `updateBoardPreferences` (line 846), not `handleSavePreferences`
- The `placeholderData` issue is in `useDeckCards.ts` which only serves solo mode

However, collaboration mode has its own equivalent risk: if `useSessionDeck` also uses `placeholderData: (previousData) => previousData`, the same flicker would occur there. **This should be verified.**

---

## Files Involved

| File | Lines | Role |
|------|-------|------|
| `app-mobile/src/components/PreferencesSheet.tsx` | 814, 819-868 | Close + fire-and-forget save + invalidation |
| `app-mobile/src/components/AppHandlers.tsx` | 565-684 | `handleSavePreferences` — optimistic cache, resetDeckHistory, refreshKey |
| `app-mobile/src/hooks/useDeckCards.ts` | 115 | `placeholderData: (previousData) => previousData` — ROOT CAUSE |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 307-337 | `stableDeckParams` memo |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 571-595 | Refresh key handler |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 755-805 | Deck→recommendations sync effect |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 794 | Empty-state guard (missing `isRefreshingAfterPrefChange`) |
