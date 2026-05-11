# Recurring Failure Patterns — Mingla

Patterns that keep showing up. When you see one during investigation, flag it —
the orchestrator tracks recurrences to justify structural fixes.

---

## Pattern 1: Query Key Drift
**Symptoms:** Stale data after filter change, duplicate API calls, cache misses.
**Root cause:** Hardcoded query key strings instead of factory, or key missing parameters.
**History:** 3→1 saved card keys (Pass 6), 2→1 person card keys, 2→1 blocked user keys,
18 hardcoded keys replaced in consolidation pass.
**Structural fix:** Key factory pattern enforced. Grep proof: zero orphaned literals.
**Still at risk:** Any new hook that creates a query without using the factory.

## Pattern 2: Silent Error Swallowing
**Symptoms:** Operation "succeeds" but data not persisted. User sees empty instead of error.
**Root cause:** `catch () { return null/[]/true }` in service layer.
**History:** 4 services identified as transitional (return fallback on error).
16 mutations got onError in Pass 9A. ~50 non-state-changing mutations documented.
**Structural fix:** ServiceResult<T> return type migration (~60+ call sites).
**Still at risk:** Any service function with try/catch that returns a value in catch.

## Pattern 3: Duplicate State Owners
**Symptoms:** Data contradictions between UI regions, stale data in one view but fresh in another.
**Root cause:** Same data held in Zustand AND React Query, or React Context AND React Query.
**History:** Dead Zustand preferences field removed (Pass 8). userProfile ownership clarified.
**Structural fix:** Authority map (AUTHORITY_MAP_PREFERENCES_PROFILE.md).
**Still at risk:** Any new feature that stores API response in Zustand "for convenience."

## Pattern 4: Missing Parity (Solo/Collab)
**Symptoms:** Feature works in solo mode but breaks in collab, or vice versa.
**Root cause:** Fix applied to one code path but not its sibling.
**History:** Collab time aggregation added separately. Preferences pipeline fixed in
solo first, then collab wired via effective* resolution.
**Structural fix:** Parity check in every implementation report.
**Still at risk:** Every single-mode fix that doesn't check the other mode.

## Pattern 5: Stale Closure in Callbacks
**Symptoms:** Function does nothing, uses old data, or targets wrong entity.
**Root cause:** Missing dependency in useCallback/useEffect, or closure capturing
stale ref value.
**History:** Pull-to-refresh stale closure (user?.id missing from deps). Calendar
refresh was no-op due to same pattern.
**Structural fix:** ESLint exhaustive-deps rule (already enabled but sometimes ignored).
**Still at risk:** Any useCallback/useEffect with complex dependency chains.

## Pattern 6: Race Condition in Preferences→Deck
**Symptoms:** Old cards appear after changing preferences.
**Root cause:** invalidateQueries firing before mutation completes, or old prefsHash
matching new batch request.
**History:** Fixed by removing invalidateQueries race, adding prefsHash to batch
matching, wiring collab prefs via effective* resolution.
**Structural fix:** prefsHash in query key, no inline invalidation.
**Still at risk:** Any change to preferences flow or deck serving that bypasses prefsHash.

## Pattern 7: Fabricated Display Data
**Symptoms:** Users see plausible but fake numbers (ratings, prices, travel times).
**Root cause:** Fallback defaults like `rating ?? 4.0` or `price ?? '$$'`.
**History:** Pass 1 of full card pipeline audit killed fabricated data across 10 files.
Currency wired to all 10 price surfaces.
**Structural fix:** Constitutional principle #9 (no fabricated data). Show "Not available"
or hide element when data is missing.
**Still at risk:** Any new display surface that uses `??` with a display value.

## Pattern 8: Missing Loading/Error/Empty States
**Symptoms:** Blank screen during load, stuck spinner on error, no guidance when empty.
**Root cause:** Component only handles populated state. No conditional rendering for
other states.
**History:** Pass 4 of card pipeline audit added states to ForYou, SavedTab, CalendarTab.
**Structural fix:** Component state machine pattern (always check isLoading, isError, empty).
**Still at risk:** Every new async component.

## Pattern 9: RLS Policy Gaps
**Symptoms:** Data visible to wrong users, or operations failing for correct users.
**Root cause:** Table missing RLS, policy too permissive, or policy missing for an operation.
**History:** board_saved_cards DELETE policy missing (Pass 10).
**Structural fix:** RLS in same migration as table creation.
**Still at risk:** 392+ policies, many unaudited. Every new table.

## Pattern 10: Edge Function Without Auth
**Symptoms:** Unauthenticated access to protected data or operations.
**Root cause:** Edge function missing auth validation at entry.
**History:** Not yet systematically audited across all 72 functions.
**Still at risk:** Every edge function, especially newer ones.

## Pattern 11: Temporal Confusion
**Symptoms:** Wrong opening hours, wrong timezone, 12h/24h mismatch, stale "open now."
**Root cause:** Mixing UTC and local, wrong timezone in comparison, using isOpenNow
cache instead of live check.
**History:** "Now" filter replaced stale isOpenNow with live parseHoursText().
Timezone pipeline unified in Pass 2c.
**Still at risk:** Any time-dependent display or filter.

## Pattern 12: Dead/Stale Code Resurrection
**Symptoms:** Feature doesn't work because the code was never mounted or wired up.
**Root cause:** Code exists in file but is never imported, rendered, or called.
**History:** useSocialRealtime and useForegroundRefresh were dead code (Pass 7).
**Still at risk:** Any hook or component that looks present but isn't mounted.

---

## How to Use This Document

During investigation:
1. When you identify a root cause, check if it matches a recurring pattern
2. If it does: note the pattern ID in the report
3. Note how many times this pattern has recurred
4. This gives the orchestrator ammunition to prioritize structural fixes

In the report:
```
**Recurring pattern?** Yes — Pattern 2 (Silent Error Swallowing), 5th occurrence.
Structural fix (ServiceResult<T> migration) has been deferred twice.
Recommend escalating priority.
```
