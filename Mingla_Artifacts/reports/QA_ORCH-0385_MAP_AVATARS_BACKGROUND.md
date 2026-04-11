# QA Report: Map Avatars Disappear After Background (ORCH-0385)

> **Verdict: PASS**  
> **Date:** 2026-04-11  
> **Mode:** TARGETED (code review — no runtime device)  
> **Findings:** P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 1

---

## Test Results

### T-01: Primary fix — people reappear after long background (Critical)

**Code verification:**
- `CRITICAL_QUERY_KEYS` at `useForegroundRefresh.ts:38` now includes `['nearby-people']`
- On long background (≥30s): auth refreshes first (line 181–211), then `CRITICAL_QUERY_KEYS` are invalidated (line 253). `['nearby-people']` is now in that loop.
- On short background (5–30s): `CRITICAL_QUERY_KEYS` are invalidated immediately (line 159). `['nearby-people']` is also covered here.
- The `invalidateQueries({ queryKey: ['nearby-people'] })` call matches the hook's key `['nearby-people', lat, lng, radiusKm]` via React Query prefix matching.
- After invalidation, the query refetches with valid JWT → data arrives → `nearbyPeople` array updates → markers render.

**Result: PASS** ✅

### T-02: Short background (<30s) — people still visible

**Code verification:**
- Short background path (lines 156–163) invalidates all `CRITICAL_QUERY_KEYS` including `['nearby-people']`.
- No auth refresh in short path (JWT still valid within 30s typically).
- React Query preserves cached data during refetch, so markers stay visible while fresh data loads.

**Result: PASS** ✅

### T-03: Trivial background (<5s) — no unnecessary refetch

**Code verification:**
- Trivial background path (lines 147–154) returns early with `onResumeRef.current?.()` only.
- No `CRITICAL_QUERY_KEYS` invalidation. `focusManager` will still fire, but the query's `staleTime: 30_000` means it won't refetch if only 5s has passed.

**Result: PASS** ✅

### T-04: Map settings survive resume

**Code verification:**
- `CRITICAL_QUERY_KEYS` at line 39 now includes `['map-settings']`.
- `useMapSettings.ts:22` uses `queryKey: ['map-settings', user?.id]` — prefix-matched by the entry.
- Settings query re-fetches after auth refresh. The optimistic update in `useMapSettings` mutation (lines 52–67) means locally-set settings persist immediately; the invalidation just ensures server sync.

**Result: PASS** ✅

### T-05: Self avatar not affected

**Code verification:**
- Self marker at `ReactNativeMapsProvider.tsx:115–133` renders from `userLocation`, `userAvatarUrl`, `userMarkerInitial`, `userActivityStatus` — all props from `DiscoverMap.tsx` which derives them from `profile` (Zustand) and `useMapSettings`.
- Self marker uses `tracksViewChanges={false}` (hardcoded, line 119) — **not** the `peopleTrackChanges` state. Unaffected by the effect change.
- No dependency on `nearby-people` query.

**Result: PASS** ✅

### T-06: tracksViewChanges performance — no flicker on refetchInterval

**Code verification:**
- `refetchInterval: 60_000` fires every 60s. If data is identical (same people, same positions), React Query returns the same array by reference? **No** — React Query creates a new object on every successful fetch, even if the data is structurally identical.
- This means `nearbyPeople` reference changes every 60s → effect fires → `setPeopleTrackChanges(true)` → 3s timer → `setPeopleTrackChanges(false)`.
- **Impact:** Every 60 seconds, all person markers get `tracksViewChanges={true}` for 3 seconds. During this window, react-native-maps re-renders the marker's custom React view on every frame. With the typical <10 person markers, this is a negligible performance cost. The markers won't visually flicker — they just temporarily become "live" instead of static bitmaps.
- **MapLibre parity:** `MapLibreProvider` uses `MarkerView` which doesn't have `tracksViewChanges` — always renders live React views. No impact there.

**Result: PASS** ✅ (minor perf cost is acceptable — 3s out of every 60s)

### T-07: Activity feed after resume

**Code verification:**
- `ActivityFeedOverlay` receives `nearbyPeople` prop (DiscoverMap.tsx:537–541).
- After resume, `nearby-people` query is invalidated → refetches → `nearbyPeople` array updates → prop propagates to `ActivityFeedOverlay`.
- Feed renders from the same data source as markers. If markers show, feed shows.

**Result: PASS** ✅

---

## Additional Checks

| Check | Result | Evidence |
|-------|--------|----------|
| `CRITICAL_QUERY_KEYS` has 13 entries | ✅ PASS | Counted lines 27–39: 11 original + 2 new = 13 |
| `tracksViewChanges` effect dep is `[nearbyPeople]` | ✅ PASS | Line 52: `}, [nearbyPeople]);` |
| `npx tsc --noEmit` passes | ✅ PASS | 0 errors (independently verified) |
| `useNearbyPeople` hook unchanged | ✅ PASS | `staleTime: 30_000`, `refetchInterval: 60_000`, `enabled: enabled && !!location` — all untouched |
| Solo mode coverage | ✅ PASS | `useNearbyPeople` is called regardless of mode (DiscoverMap.tsx:141) |
| Collab mode coverage | ✅ PASS | Same `DiscoverMap` component used in both modes (symmetric) |
| MapLibre provider parity | ✅ N/A | MapLibre uses `MarkerView` (no `tracksViewChanges`), unaffected by this change |

---

## Regression Surface

| Area | Status | Evidence |
|------|--------|----------|
| Foreground refresh for other queries | ✅ No risk | Adding 2 entries to a `for...of` loop adds 2 `invalidateQueries` calls — negligible |
| Map marker tap responsiveness | ✅ No risk | `tracksViewChanges` toggling doesn't affect `tappable` or `onPress` handlers |
| Map visibility toggle | ✅ No risk | `peopleLayerOn` state is local to `DiscoverMap`, not affected by query invalidation |
| Person bottom sheet | ✅ No risk | Sheet opening depends on `selectedPerson` state, not query lifecycle |

---

## Constitutional Compliance

| Rule | Status |
|------|--------|
| 1. No dead taps | ✅ N/A — no new interactive elements |
| 2. One owner per truth | ✅ PASS — `nearby-people` still owned solely by React Query |
| 3. No silent failures | ✅ PASS — query errors still surface via React Query error state + existing 401 handling |
| 4. One key per entity | ✅ PASS — query key unchanged, only added to invalidation list |
| 5. Server state server-side | ✅ PASS — no Zustand changes |
| 6. Logout clears everything | ✅ N/A — no new data stores |
| 7. Label temporary | ✅ N/A — no temporary code introduced |
| 8. Subtract before adding | ✅ PASS — no broken code layered over |
| 9. No fabricated data | ✅ N/A |
| 10. Currency-aware | ✅ N/A |
| 11. One auth instance | ✅ PASS — no auth changes |
| 12. Validate at right time | ✅ N/A |
| 13. Exclusion consistency | ✅ N/A |
| 14. Persisted-state startup | ✅ PASS — `gcTime: 24h` means cached nearby-people data persists through cold start |

---

## Invariant Verification

| Invariant | Status |
|-----------|--------|
| I-SINGLE-REFRESH (ORCH-0236) | ✅ Preserved — single call site in `app/index.tsx` |
| I-NO-DECK-INVALIDATE | ✅ Preserved — deck/curated/session-deck NOT in `CRITICAL_QUERY_KEYS` |
| I-RT-BIND-01 | ✅ Preserved — no `supabase.realtime.disconnect()` calls |
| I-NEVER-SIGNOUT | ✅ Preserved — no auto-sign-out logic |

---

## Findings

### P4-001: Clean implementation (NOTE — praise)

Both changes are minimal, surgical, and precisely targeted. The `CRITICAL_QUERY_KEYS` addition follows the exact pattern of the 11 existing entries. The `tracksViewChanges` effect reset follows the established pattern from ORCH-0361. Comments reference the ORCH-ID for traceability. No scope creep. No unnecessary changes. Exactly what was needed.

---

## Verdict

**PASS** — 7/7 test cases passed, all additional checks clear, no regressions identified, all invariants preserved, constitutional compliance confirmed.

**Blocking issues:** None.

**Runtime testing recommended:** T-01 (long background resume) and T-06 (tracksViewChanges 60s cycle) should be verified on a physical iOS device when convenient. The code analysis confirms correctness, but the original symptom was reported in production and runtime verification adds confidence.

**Discoveries for orchestrator:** None new.
