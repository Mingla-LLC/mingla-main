# Implementation Report: Map Avatars Disappear After Background (ORCH-0385)

> **Status:** implemented and verified (tsc)  
> **Date:** 2026-04-11  
> **Files changed:** 2  
> **Lines changed:** ~6  

---

## Summary

Added `['nearby-people']` and `['map-settings']` to the `CRITICAL_QUERY_KEYS` array in `useForegroundRefresh.ts` so both queries are force-invalidated after auth refresh on foreground resume. Also reset the `tracksViewChanges` timer in `ReactNativeMapsProvider.tsx` so new/updated person markers render their avatars after data refresh.

---

## Changes

### useForegroundRefresh.ts

**What it did before:** `CRITICAL_QUERY_KEYS` contained 11 query families (friends, boards, saved cards, pairings, phone invites, subscriptions, calendar, preferences, discover-experiences, map-cards-singles, map-cards-curated). The `nearby-people` and `map-settings` queries were NOT included — they relied solely on `focusManager` auto-refetch, which fires BEFORE auth refresh with a potentially expired JWT.

**What it does now:** `CRITICAL_QUERY_KEYS` contains 13 query families. `['nearby-people']` and `['map-settings']` are included. On foreground resume (both short and long background), these queries are force-invalidated AFTER auth refresh completes, ensuring they refetch with a valid JWT.

**Why:** Root cause of ORCH-0385. Without this, the nearby-people query's focusManager-triggered refetch fails with 401 (expired JWT), enters error state, and is never retried until the 60-second `refetchInterval` — or never, if GPS jitter changes the query key.

**Lines changed:** +2 (two array entries added)

### ReactNativeMapsProvider.tsx

**What it did before:** The `tracksViewChanges` 3-second window fired once on initial component mount (`useEffect(..., [])`) and never reset. After 3 seconds, `tracksViewChanges` was permanently `false`. When new nearby-people data arrived after foreground refresh, new markers could render but their avatar images might not load because the rendering window had long passed.

**What it does now:** The effect depends on `nearbyPeople` instead of `[]`. Every time the nearby-people array reference changes (new data from refetch), `tracksViewChanges` resets to `true` for 3 seconds, allowing avatar images to load for new/updated markers. The cleanup function clears the previous timer to prevent state thrashing.

**Why:** Hardening for ORCH-0385. Ensures that after foreground refresh delivers new people data, the markers visually render correctly with their avatar images.

**Lines changed:** +3 (added `setPeopleTrackChanges(true)`, changed dependency from `[]` to `[nearbyPeople]`, added comment line)

---

## Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| I-SINGLE-REFRESH (ORCH-0236) | ✅ Yes — no new call sites added |
| I-NO-DECK-INVALIDATE | ✅ Yes — deck/curated/session-deck NOT added to CRITICAL_QUERY_KEYS |
| I-RT-BIND-01 | ✅ Yes — no `supabase.realtime.disconnect()` calls |
| I-NEVER-SIGNOUT | ✅ Yes — no auto-sign-out logic |

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ PASS — 0 errors |
| `as const` assertion compiles | ✅ PASS — array accepted with 13 entries |
| `nearbyPeople` available as prop | ✅ PASS — confirmed in `DiscoverMapProviderProps` (types.ts:22) |

## Parity Check

- **Solo mode:** Fixed — `useNearbyPeople` is called regardless of mode
- **Collab mode:** Fixed — same `DiscoverMap` component, same hook
- Parity: ✅ Symmetric

## Cache Safety

- No query keys changed (only added to invalidation list)
- No data shapes changed
- No AsyncStorage impact
- Existing `refetchInterval: 60_000` continues as fallback

## Regression Surface

1. **Foreground refresh timing** — verify other queries in `CRITICAL_QUERY_KEYS` still refresh correctly (adding 2 entries increases loop iteration by 2)
2. **Map marker performance** — `tracksViewChanges` now resets on every data change; verify no excessive re-renders when `refetchInterval` fires every 60s
3. **Map settings** — verify visibility toggle still works after adding `['map-settings']` to invalidation
4. **Activity feed overlay** — receives `nearbyPeople` prop; verify it shows data after resume

## Surprises

None. Implementation matched the spec exactly.

## Discoveries for Orchestrator

None beyond what the investigation already documented (dead `renderCurrentPage()` function, pattern gap in CRITICAL_QUERY_KEYS manual list).
