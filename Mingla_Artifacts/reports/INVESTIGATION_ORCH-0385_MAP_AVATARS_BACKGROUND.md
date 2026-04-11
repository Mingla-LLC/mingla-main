# Investigation Report: Map Avatars Disappear After Background (ORCH-0385)

> **Status:** root cause proven  
> **Confidence:** High  
> **Date:** 2026-04-11  
> **Related:** ORCH-0300 (same architectural pattern), ORCH-0361 (separate — initial load)

---

## Layman Summary

When you leave the app and come back, the map tries to reload the people around you. But it does this **before** your login session is refreshed — so the server rejects the request ("who are you?"). The system then refreshes your session and reloads all the important data... but the nearby-people list isn't on that "important data" list. So it stays broken until a background timer retries 60 seconds later — if it retries at all (GPS jitter can prevent even that).

---

## Symptom Summary

| Field | Value |
|-------|-------|
| **Expected** | After returning from background, map shows user avatar + friends + strangers within 1-2 seconds |
| **Actual** | All people markers disappear. Map renders fine but is empty of people. Sometimes recovers after ~60s, sometimes stays empty |
| **Trigger** | Leave app for >30 seconds (long enough for JWT to go stale or expire), return to discover map |
| **Frequency** | Intermittent — depends on background duration and GPS coordinate stability |

---

## Investigation Manifest

| # | File | Layer | Why Read |
|---|------|-------|----------|
| 1 | `app-mobile/src/components/map/DiscoverMap.tsx` | Component | Entry point — how nearby people are consumed and rendered |
| 2 | `app-mobile/src/hooks/useNearbyPeople.ts` | Hook | React Query config — staleTime, gcTime, enabled, queryKey |
| 3 | `app-mobile/src/hooks/useForegroundRefresh.ts` | Hook | Resume handler — which queries get refreshed on foreground |
| 4 | `app-mobile/src/config/queryClient.ts` | Config | focusManager wiring, default gcTime/staleTime, retry logic |
| 5 | `app-mobile/src/components/AppStateManager.tsx` | Component | App state management (confirmed: foreground refresh moved to index.tsx) |
| 6 | `app-mobile/src/components/DiscoverScreen.tsx` | Component | Parent — how userLocation and isTabVisible/paused are derived |
| 7 | `app-mobile/app/index.tsx` | Entry | Tab mounting, isTabVisible prop wiring |
| 8 | `app-mobile/src/hooks/useMapSettings.ts` | Hook | Map settings query — checked for related staleness |
| 9 | `app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx` | Component | Marker rendering, tracksViewChanges lifecycle |

---

## Findings

### 🔴 ROOT CAUSE: `['nearby-people']` missing from foreground refresh `CRITICAL_QUERY_KEYS`

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useForegroundRefresh.ts:26-38` |
| **Exact code** | `const CRITICAL_QUERY_KEYS = [friendsKeys.all, boardKeys.all, savedCardKeys.all, pairingKeys.prefix, phoneInviteKeys.all, subscriptionKeys.all, ['calendarEntries'], ['userPreferences'], ['discover-experiences'], ['map-cards-singles'], ['map-cards-curated']] as const;` |
| **What it does** | Defines which query families get force-invalidated on foreground resume. `['nearby-people']` is not in this list. |
| **What it should do** | Include `['nearby-people']` so the query is re-fetched with fresh JWT after auth completes. |
| **Causal chain** | 1. App enters background → `supabase.auth.stopAutoRefresh()` called → JWT expires after TTL (typically 1h).<br>2. App returns to foreground → `focusManager.setFocused(true)` fires IMMEDIATELY (queryClient.ts:17).<br>3. nearby-people query is stale (staleTime=30s < background duration) → React Query auto-refetches.<br>4. Refetch uses EXPIRED JWT → edge function returns 401 → `retry` returns `false` for auth errors (queryClient.ts:188).<br>5. Query enters error state.<br>6. 500ms later, `useForegroundRefresh` completes auth refresh → invalidates `CRITICAL_QUERY_KEYS` → **nearby-people NOT included** → NOT re-fetched with valid JWT.<br>7. Next refetch attempt is `refetchInterval: 60_000` (60 seconds later) — if it fires at all. |
| **Verification** | Add `['nearby-people']` to `CRITICAL_QUERY_KEYS`. Background app for >60s. Return. People should appear within 2s instead of 60s. |

### 🟠 CONTRIBUTING FACTOR: `focusManager` fires before auth refresh

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/config/queryClient.ts:16-21` |
| **Exact code** | `focusManager.setEventListener((handleFocus) => { const subscription = AppState.addEventListener('change', (state) => { handleFocus(state === 'active'); }); ... });` |
| **What it does** | Fires `focused=true` immediately when AppState changes to 'active', causing all stale queries to refetch with whatever JWT is currently in memory (possibly expired). |
| **What it should do** | This behavior is actually correct by design — `useForegroundRefresh`'s `CRITICAL_QUERY_KEYS` invalidation after auth refresh is the intended "second pass" fix. The problem is that nearby-people is missing from that second pass. |
| **Causal chain** | focusManager fires refetch → expired JWT → 401 → error state. The auth grace period (enterAuth401GracePeriod) correctly prevents these burst 401s from triggering forced sign-out, but doesn't prevent the query from failing. |

### 🟠 CONTRIBUTING FACTOR: GPS-based query key instability on resume

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useNearbyPeople.ts:29` |
| **Exact code** | `queryKey: ['nearby-people', location?.latitude?.toFixed(2), location?.longitude?.toFixed(2), radiusKm]` |
| **What it does** | Includes GPS coordinates (bucketed to 2 decimal places ≈ 1.1km) in the query key. On resume, GPS re-fetches (DiscoverScreen.tsx:1193 resets the one-shot ref). If coordinates change across a `.toFixed(2)` boundary, the query key changes. |
| **What it should do** | This design is intentional (re-query when user moves significantly). But combined with the root cause, a key change means there is NO cached data for the new key → `data` defaults to `[]` (DiscoverMap.tsx:141) → all markers vanish immediately. With a stable key, React Query preserves old data even on refetch failure. |
| **Causal chain** | GPS jitter across boundary → new query key → no cache → fetch with expired JWT → 401 → error state with no data → `nearbyPeople = []` → empty map. Key jitter can also prevent `refetchInterval` from accumulating — if the key changes again, the 60s timer resets. |

### 🟡 HIDDEN FLAW: `tracksViewChanges` one-shot timer never resets

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx:45-49` |
| **Exact code** | `const [peopleTrackChanges, setPeopleTrackChanges] = useState(true); useEffect(() => { const timer = setTimeout(() => setPeopleTrackChanges(false), 3000); return () => clearTimeout(timer); }, []);` |
| **What it does** | Sets `tracksViewChanges=true` for 3 seconds on initial mount, then permanently `false`. Component never unmounts (always-mounted tab system). |
| **What it should do** | Reset the timer when `nearbyPeople` data changes (new data from refetch or foreground refresh), so new/updated markers get a rendering window. |
| **Impact** | Does NOT cause the disappearance bug (new markers with new keys still render initially). BUT prevents visual updates to existing markers — if a friend changes their avatar or activity status, the map marker stays frozen. |

### 🟡 HIDDEN FLAW: `['map-settings']` also missing from `CRITICAL_QUERY_KEYS`

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useForegroundRefresh.ts:26-38` (same as root cause) |
| **What it does** | Map settings (visibility_level, activity_status) are not refreshed on foreground resume. |
| **Impact** | If the user changed visibility settings from another device or the settings were modified server-side, the map wouldn't reflect the change until `staleTime` (5 min) expires and a focus refetch succeeds. Lower severity than nearby-people because settings rarely change externally. |

### 🔵 OBSERVATION: Dead code — `renderCurrentPage()` switch never called

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/app/index.tsx:1753` |
| **What it does** | Defines a `renderCurrentPage()` function with full switch/case rendering including a standalone DiscoverScreen. This function is defined but never invoked — the always-mounted tab system at line 2038+ is the actual rendering path. |
| **Impact** | Dead code. Potential confusion during investigation. No runtime effect. (May have been caught by ORCH-0384 dead code sweep but survived because it's inside a component function, not a standalone file.) |

---

## Five-Layer Cross-Check

| Layer | Finding |
|-------|---------|
| **Docs** | `useForegroundRefresh` comments explicitly list excluded queries (deck/curated/session-deck) with rationale. `nearby-people` is simply ABSENT — no comment explaining exclusion. This was an **omission**, not a decision. |
| **Schema** | No schema issues. `get-nearby-people` edge function and `user_map_locations` / `nearby_people` view are correctly structured. |
| **Code** | Root cause confirmed: `CRITICAL_QUERY_KEYS` missing `['nearby-people']`. `focusManager` fires before auth refresh. GPS key instability amplifies the problem. |
| **Runtime** | On resume after long background: focusManager triggers stale refetch → 401 → error state. Auth refresh follows but doesn't re-invalidate nearby-people. `refetchInterval` is the only recovery path (60s delay). |
| **Data** | React Query cache: if query key is stable, old data persists through error (markers stay). If query key changes (GPS jitter), no cache → `[]` → markers vanish. |

---

## Blast Radius

### Direct Impact
- **Self avatar on map** — NOT affected. The self marker is rendered from `profile` data (Zustand store), not from the `nearby-people` query. Self marker always shows.
- **Friend markers** — AFFECTED. Friends are returned by `get-nearby-people` and rendered from that query.
- **Stranger markers** — AFFECTED. Same query source as friends.
- **Activity feed overlay** — AFFECTED. `ActivityFeedOverlay` receives `nearbyPeople` as a prop (DiscoverMap.tsx:537). If `nearbyPeople = []`, the feed shows no activity.

### Solo vs Collab Parity
- **Solo mode** — AFFECTED. The `useNearbyPeople` hook is called regardless of mode.
- **Collab mode** — AFFECTED equally. Same DiscoverMap component, same hook.
- **Parity:** Symmetric — both modes affected identically. ✅

### Related Patterns
- This is the **exact same pattern** as ORCH-0300 (app freshness architecture flaw). ORCH-0300 identified that content queries were excluded from foreground refresh based on a false "expensive API" assumption. `nearby-people` was similarly omitted.
- `['map-settings']` has the same gap (hidden flaw above).
- Any future map-related queries added without updating `CRITICAL_QUERY_KEYS` will have the same problem.

### Invariant Violations
- **No silent failures** (Constitutional Rule 3): The 401 error is logged but produces no user-visible feedback. The map silently shows no people with no indication that data failed to load.

---

## Causal Chain (Complete)

```
User backgrounds app (>30s)
  │
  ├─ supabase.auth.stopAutoRefresh() — JWT eventually expires
  │
  └─ User returns to foreground
       │
       ├─ focusManager.setFocused(true) — IMMEDIATE
       │   │
       │   └─ nearby-people query is stale (staleTime=30s)
       │       │
       │       └─ Auto-refetch fires with EXPIRED JWT
       │           │
       │           ├─ 401 error from get-nearby-people
       │           │
       │           └─ retry returns false (auth error)
       │               │
       │               ├─ IF query key unchanged: data preserved (old markers visible)
       │               │
       │               └─ IF query key changed (GPS jitter): data=undefined → default []
       │                   │
       │                   └─ nearbyPeople=[] → ALL MARKERS DISAPPEAR
       │
       ├─ 500ms debounce → useForegroundRefresh auth sequence
       │   │
       │   ├─ Auth refresh succeeds (new JWT)
       │   │
       │   └─ Invalidates CRITICAL_QUERY_KEYS
       │       │
       │       └─ nearby-people NOT in list → NOT re-invalidated
       │
       └─ 60s later: refetchInterval fires
           │
           ├─ IF query key stable: success → markers reappear
           │
           └─ IF GPS re-fetched again: key may differ → yet another fresh query
```

---

## Verification Steps

1. **Confirm root cause:** Add `['nearby-people']` to `CRITICAL_QUERY_KEYS`. Background app for 2+ minutes. Return. Verify people appear within 2-3 seconds.

2. **Confirm GPS jitter contribution:** Log the query key on resume. Check if `.toFixed(2)` values change between background and foreground. If they do, this explains the "sometimes" nature.

3. **Confirm focusManager timing:** Add a log in the nearby-people `queryFn` that prints the JWT expiry. On resume, the first call should show an expired JWT.

---

## Fix Strategy (Direction Only — Not a Spec)

1. **Primary fix:** Add `['nearby-people']` to `CRITICAL_QUERY_KEYS` in `useForegroundRefresh.ts`. This ensures the query is re-invalidated AFTER auth refresh, with a valid JWT.

2. **Secondary fix:** Also add `['map-settings']` to prevent related staleness.

3. **Consideration:** The `tracksViewChanges` timer should reset when `nearbyPeople` data reference changes, so markers visually update after a data refresh. This is a separate improvement from the disappearance fix.

---

## Discoveries for Orchestrator

1. **Dead code:** `renderCurrentPage()` function at `app-mobile/app/index.tsx:1753` — defined but never called. Contains duplicate DiscoverScreen, HomePage definitions from the pre-always-mounted-tabs era. Should be cleaned up.

2. **Pattern gap:** Any new query added to the map domain must be explicitly added to `CRITICAL_QUERY_KEYS`. There is no architectural safeguard — it's a manual list. This is the same class of omission as ORCH-0300.
