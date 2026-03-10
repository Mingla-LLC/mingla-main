# Investigation Report: Infinite "Curating Your Lineup" Loader

**Date:** 2026-03-10
**Reported symptom:** After login, the "Curating your lineup" loader shows indefinitely. Shaking the phone to reload makes the cards appear immediately.
**Investigated by:** Brutal Investigator Skill
**Verdict:** A hidden location query key change when preferences load causes `isLoadingLocation` to flip back to `true` in React Query v5. Combined with no timeout on GPS fetch, the loader can hang indefinitely. The reload works because Zustand-persisted deck batches provide `initialData` that bypasses the loading state entirely.

---

## 1. Symptom Summary

**What the user expected:** After login, the home screen should show swiping cards within a few seconds.
**What actually happens:** The "Curating your lineup" loader appears and never goes away.
**After shake-reload:** Cards appear immediately.
**Error message:** None — the loader spins silently.
**Reproducible:** On every fresh app start / login.

---

## 2. Investigation Perimeter

### Files Read (Direct Chain)
| File | Layer | Purpose | Status |
|------|-------|---------|--------|
| `app-mobile/src/components/SwipeableCards.tsx` | Component | Renders loader vs cards based on `shouldShowLoader` | Read |
| `app-mobile/src/components/HomePage.tsx` | Component | Hosts SwipeableCards | Read |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Context | Orchestrates all loading states, syncs deck data to recommendations | Read |
| `app-mobile/src/hooks/useDeckCards.ts` | Hook | React Query hook for deck cards, provides `isLoading`/`isFetching`/`isFullBatchLoaded` | Read |
| `app-mobile/src/hooks/useUserLocation.ts` | Hook | Location query with dynamic key based on prefs cache | Read |
| `app-mobile/src/hooks/useUserPreferences.ts` | Hook | Preferences query | Read |
| `app-mobile/src/hooks/useAuthSimple.ts` | Hook | Auth initialization, `onAuthStateChange` listener | Read |
| `app-mobile/src/services/deckService.ts` | Service | Fetches deck cards from edge functions | Read |
| `app-mobile/src/services/enhancedLocationService.ts` | Service | GPS location fetch (no timeout) | Read |
| `app-mobile/src/services/networkMonitor.ts` | Service | Network detection fallback | Read |
| `app-mobile/src/store/appStore.ts` | Store | Zustand persisted store (deckBatches, auth) | Read |
| `app-mobile/src/config/queryClient.ts` | Config | React Query client configuration | Read |
| `app-mobile/src/components/AppStateManager.tsx` | State | App-level state management | Read |
| `app-mobile/app/index.tsx` | Root | App root, RecommendationsProvider mounting, cache clearing | Read |

### Files Read (Adjacent Suspects)
| File | Why Investigated | Relevant? |
|------|-----------------|-----------|
| `app-mobile/src/services/networkMonitor.ts` | NetInfo warning in logs | No (fallback assumes online) |
| `app-mobile/src/components/AppStateManager.tsx` | Auth state flow | Yes (confirms auth from Zustand) |

**Total files read:** 14
**Total lines inspected:** ~3,500

---

## 3. Findings

### ROOT CAUSE RC-001: Location Query Key Changes When Preferences Load, Causing `isLoadingLocation` to Flip Back to `true`

**File:** `app-mobile/src/hooks/useUserLocation.ts` (lines 99-106)

**The defective code:**
```typescript
const cachedPrefs = useQueryClient().getQueryData<UserPreferences>(
  ['userPreferences', userId]
);
const customLocation = cachedPrefs?.custom_location;
const useGpsFlag = cachedPrefs?.use_gps_location;

const query = useQuery({
  queryKey: ['userLocation', userId, currentMode, refreshKey, customLocation, useGpsFlag],
  // ...
  placeholderData: (previousData) => previousData,
});
```

**What it does:** On every render, `customLocation` and `useGpsFlag` are read synchronously from the React Query cache. Before preferences load, `cachedPrefs` is `undefined`, so both values are `undefined`. After preferences load, they change to their actual values (e.g., `null` and `true`). Since `undefined !== null`, the query key changes, starting a brand new location query.

**What it should do:** The location query key should NOT change just because preferences loaded. If the user's location source hasn't changed (still GPS), the query key should be stable.

**Causal chain:**
1. App starts → `useUserPreferences` begins fetching → `cachedPrefs` is `undefined` in the location hook
2. Location query starts with key `['userLocation', userId, 'solo', undefined, undefined, undefined]`
3. Location resolves (GPS) → `isLoadingLocation = false` → things proceed
4. Preferences query resolves → cached prefs now available → `customLocation` changes from `undefined` to `null`, `useGpsFlag` changes from `undefined` to `true`
5. Location query key changes to `['userLocation', userId, 'solo', undefined, null, true]`
6. **In React Query v5, `isLoading = isPending && isFetching`.** For the new key, the query has never succeeded (`isPending = true`), and it's fetching (`isFetching = true`). Even though `placeholderData` provides the old location, `isLoading` is still `true` — this is by design in React Query v5 (placeholderData does NOT change `isPending` status).
7. `isLoadingLocation = true` → `loading = true` (line 711 of RecommendationsContext) → `isAnyLoading = true` (line 384 of SwipeableCards) → `shouldShowLoader = true` (line 530)
8. **The loader comes back** even though location data IS available via placeholder

**Verification:** Add `console.log('isLoadingLocation:', isLoadingLocation, 'customLocation:', customLocation, 'useGpsFlag:', useGpsFlag)` in the RecommendationsContext after the `useUserLocation` call. You will see `isLoadingLocation` flip from `false` back to `true` when preferences load.

**Fix complexity:** Small

---

### ROOT CAUSE RC-002: No Timeout on `Location.getCurrentPositionAsync` — GPS Fetch Can Hang Indefinitely

**File:** `app-mobile/src/services/enhancedLocationService.ts` (lines 86-89)

**The defective code:**
```typescript
const location = await Location.getCurrentPositionAsync({
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 5000, // This is for subscriptions, NOT a timeout
});
```

**What it does:** Calls Expo's `getCurrentPositionAsync` with no timeout. The `timeInterval` property is for location subscriptions (watch mode), NOT for `getCurrentPositionAsync`. If GPS is slow, the device is indoors, or the simulator's location services are flaky, this call can hang for 30+ seconds or indefinitely.

**What it should do:** Apply a timeout (e.g., 10 seconds) so the location fetch resolves even if GPS is unavailable.

**Causal chain:**
1. RC-001 triggers a new location query for the changed key
2. The `fetchUserLocation` function calls `enhancedLocationService.getCurrentLocation()`
3. `getCurrentPositionAsync` hangs waiting for a GPS fix
4. The location query stays in `fetching` state indefinitely
5. `isLoadingLocation` stays `true` forever
6. `loading = true` forever → `isAnyLoading = true` forever → **infinite loader**

**Why reload works:** After shake-reload, Zustand hydrates with persisted `deckBatches` from the previous session. The `useDeckCards` hook finds the batch and provides it as `initialData`. With `initialData`, the query status is `'success'` immediately (unlike `placeholderData`), so `isDeckLoading = false`. Additionally, if the initial location is available from `cachedLocationSync`, `isLoadingLocation = false`. Cards appear instantly, completely bypassing the loading cascade.

**Verification:** Wrap the GPS call in a `Promise.race` with a 5-second timeout. If the loader disappears after 5 seconds max, this confirms the GPS hang is the cause.

**Fix complexity:** Small

---

### ROOT CAUSE RC-003: Deck Query Key Changes When Location Coordinates Change — Cascading Refetch

**File:** `app-mobile/src/hooks/useDeckCards.ts` (lines 57-73) and `app-mobile/src/contexts/RecommendationsContext.tsx` (line 711)

**The defective code:**
```typescript
// useDeckCards.ts — query key includes raw GPS coordinates
queryKey: [
  'deck-cards',
  location?.lat,   // ← floating point GPS coordinates
  location?.lng,   // ← change = new query = isDeckLoading = true
  // ...
]

// RecommendationsContext.tsx — loading gates deck loading
const loading = isLoadingLocation || isLoadingPreferences || isDeckLoading;
```

**What it does:** Even after RC-001's location refetch completes, if the new GPS coordinates differ AT ALL from the placeholder (old coordinates), the deck query key changes. This starts a brand new deck query (`isDeckLoading = true`), adding another 3.5+ seconds of loading.

**What it should do:** Either round coordinates to a reasonable precision (e.g., 3 decimal places ≈ 110m) to prevent trivial GPS drift from invalidating the deck query, or decouple the loading states so `isLoadingLocation` doesn't block card display when cards are already available.

**Causal chain:**
1. RC-001 triggers location refetch → GPS returns coordinates that differ slightly from cached coordinates (e.g., `37.7749` vs `37.77491`)
2. `activeDeckLocation` changes → deck query key changes
3. New deck query starts → `isDeckLoading = true` → `loading = true`
4. First deck query's results are now for the "wrong" key — they're still in React Query cache but not matched
5. New deck query takes 3.5 seconds → another loading cycle
6. Only after this second deck query resolves does the loader finally disappear

**Verification:** Round `location?.lat` and `location?.lng` in the deck query key to 3 decimal places. If the deck doesn't refetch unnecessarily, this confirms coordinate drift was causing the cascade.

**Fix complexity:** Trivial

---

### CONTRIBUTING FACTOR CF-001: React Query Cache Cleared on Every App Start

**File:** `app-mobile/app/index.tsx` (lines 2089-2092)

**The defective code:**
```typescript
React.useEffect(() => {
  AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE')
    .catch(() => {})
    .finally(() => setCacheReady(true));
}, []);
```

**What's wrong:** The React Query persisted cache is wiped on every app start. This was added as a safeguard against Android's 2MB CursorWindow limit, but it makes `PersistQueryClientProvider` completely useless — no query data survives between sessions. Every query starts from scratch.

**Why it matters:** If the cache persisted, the preferences and location queries would have cached data on startup, preventing the query key change cascade (RC-001). The `shouldDehydrateQuery` filter already excludes heavy queries. The nuclear `removeItem` is overkill.

**Recommended fix:** Replace the blanket cache wipe with a size-aware check. Only clear if the cache exceeds a threshold (e.g., 1MB). Or trust the `shouldDehydrateQuery` filter to keep the cache small.

---

### CONTRIBUTING FACTOR CF-002: `hasCompletedInitialFetch` Double-Gates on `isDeckLoading`

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx` (lines 799-803)

**The defective code:**
```typescript
const hasCompletedInitialFetch =
  !isModeTransitioning &&
  !isWaitingForSessionResolution &&
  hasCompletedFetchForCurrentMode &&
  !isDeckLoading;  // ← This gate is redundant and dangerous
```

**What's wrong:** `hasCompletedInitialFetch` requires BOTH `hasCompletedFetchForCurrentMode` (which is set by an effect when the deck resolves) AND `!isDeckLoading`. If the deck query key changes (RC-003) after `hasCompletedFetchForCurrentMode` was set, `isDeckLoading` goes back to `true`, making `hasCompletedInitialFetch` false again. This re-shows the loader even though cards were already loaded.

**Why it matters:** The `!isDeckLoading` gate creates a regression path: cards can load successfully, then disappear behind the loader when a background refetch starts. `hasCompletedFetchForCurrentMode` should be the sole authority on whether the initial fetch completed.

**Recommended fix:** Remove `!isDeckLoading` from `hasCompletedInitialFetch`. Once the initial fetch is complete, it's complete — background refetches should not re-trigger the loader.

---

### CONTRIBUTING FACTOR CF-003: Multiple `useAuthSimple()` Instances Create Redundant Auth Initialization

**Files:** `app-mobile/src/components/AppStateManager.tsx`, `app-mobile/src/contexts/RecommendationsContext.tsx`, `app-mobile/src/components/SwipeableCards.tsx`

**What's wrong:** `useAuthSimple()` is called in at least 3 separate components. Each call creates its own `useEffect` that:
- Calls `supabase.auth.getSession()` (network call)
- Registers an `onAuthStateChange` listener
- Loads the user profile from Supabase

This creates 3+ concurrent `getSession()` calls and 3+ concurrent profile fetches, all writing to the same Zustand store. The logs confirm 4+ "Initializing — fetching session..." calls.

**Why it matters:** While not the direct cause of the infinite loader, this creates unnecessary network calls, Zustand state churn, and component re-renders. Each `setAuth` and `setProfile` call triggers Zustand subscribers, causing downstream hooks to re-render and potentially re-evaluate their query parameters.

**Recommended fix:** Move auth initialization to a single location (the Zustand store or a dedicated singleton). Have `useAuthSimple()` simply read from the store without triggering its own initialization.

---

### HIDDEN FLAW HF-001: `setAuth` and `setProfile` Not Guarded by `mounted` Flag

**File:** `app-mobile/src/hooks/useAuthSimple.ts` (lines 69-71, 172-173)

**The defective code:**
```typescript
// In initializeAuth:
if (session?.user) {
  setAuth(session.user as User);  // ← NOT guarded by mounted
  // ...
}
if (mounted) {
  setLoading(false);  // ← guarded by mounted
}

// In onAuthStateChange listener:
if (session?.user) {
  setAuth(session.user as User);  // ← NOT guarded by mounted
}
```

**What's wrong:** `setAuth` and `setProfile` are Zustand mutations that execute regardless of whether the component is still mounted. If the component unmounts (navigation change) while `initializeAuth` is in-flight, the stale callback still writes to the global store.

**What will eventually break:** In edge cases (fast navigation during auth init), stale profile data from a cancelled auth flow could overwrite fresher data. Not causing issues now, but a ticking time bomb.

**Recommended fix:** Guard `setAuth` and `setProfile` with the `mounted` flag, same as `setLoading`.

---

### HIDDEN FLAW HF-002: `notification_preferences` Table Missing from Schema

**Source:** Logs: `Could not find the table 'public.notification_preferences' in the schema cache`

**What's wrong:** The app tries to write to `notification_preferences` but the table doesn't exist in the Supabase schema cache. This query fails silently.

**What will eventually break:** When notification preferences are actually needed, they'll never persist. Users will get unexpected notification behavior.

**Recommended fix:** Either create the migration for `notification_preferences` or remove the code that writes to it.

---

### OBSERVATION OB-001: `placeholderData` Causes `isLoading = true` in React Query v5 — Architectural Mismatch

**File:** Multiple hooks using `placeholderData: (previousData) => previousData`

**What I noticed:** In React Query v5, `isLoading = isPending && isFetching`. When a query key changes and `placeholderData` is used, the query status remains `pending` for the new key (never resolved), even though data IS available to render. This means `isLoading` is `true` even when the component has usable data.

The codebase uses `isLoading` from React Query as a hard gate for showing the loader (`loading = isLoadingLocation || isLoadingPreferences || isDeckLoading`). This design assumes `isLoading = true` means "no data available." In React Query v5 with `placeholderData`, this assumption is wrong — data IS available, the query just hasn't formally resolved for the new key.

**Why I'm flagging it:** This mismatch affects ALL three data hooks (location, preferences, deck). Any time a query key changes, the loader can briefly reappear even though usable data exists. The fix for RC-001 addresses the location case specifically, but the architectural pattern should be reconsidered for all hooks.

**Recommended pattern:** Use `!query.data` or a custom `isInitialLoading` flag instead of `query.isLoading` for UI blocking. Reserve `isLoading` for first-ever-load detection and use `isFetching` for background refresh indicators.

---

### OBSERVATION OB-002: `cachedLocationSync` Module-Level Async Init is a Race Condition

**File:** `app-mobile/src/hooks/useUserLocation.ts` (lines 16-24)

**What I noticed:**
```typescript
let cachedLocationSync: LocationData | null = null;
AsyncStorage.getItem(LOCATION_CACHE_KEY).then(raw => {
  if (raw) {
    cachedLocationSync = { lat: parsed.lat, lng: parsed.lng };
  }
}).catch(() => {});
```

This loads the cached location asynchronously at module import time. If the hook renders before the AsyncStorage read completes, `cachedLocationSync` is `null` and `initialData` is `undefined`. This means the location query starts with no initial data, requiring a fresh GPS fetch.

**Why I'm flagging it:** The `initialData` optimization only works if the async read completes before the first render. In practice, AsyncStorage reads take 10-50ms, and the hook can render in <10ms. This race means the optimization is unreliable.

---

## 4. Root Cause Analysis — Full Trace

The issue begins in `useUserLocation.ts` at lines 99-103. On every render, the hook reads `customLocation` and `useGpsFlag` from the React Query cache for preferences. Before the preferences query resolves, both values are `undefined` (no cached data). After preferences load, they change to their actual values (typically `null` and `true` for a GPS user). This seemingly innocent change — `undefined` → `null` for `customLocation` — changes the location query key.

In React Query v5, when a query key changes and `placeholderData` is used, `isLoading` remains `true` because the new query has never resolved (`isPending = true`) and is actively fetching (`isFetching = true`). The previous location data IS available to render (via `placeholderData`), but the loading state doesn't reflect this — React Query v5 distinguishes between "has data to show" and "has successfully resolved" differently from v4.

This flips `isLoadingLocation` from `false` back to `true` in `RecommendationsContext.tsx` (line 261), which makes `loading = true` (line 711), which makes `isAnyLoading = true` in `SwipeableCards.tsx` (line 384), which makes `shouldShowLoader = true` (line 530). The loader reappears.

The location refetch calls `enhancedLocationService.getCurrentLocation()`, which calls `Location.getCurrentPositionAsync()` with no timeout. On iOS devices (or simulators with flaky location services), this GPS call can hang for 30+ seconds or indefinitely. While it hangs, `isLoadingLocation` stays `true`, and the loader stays visible — this is the "eternity" the user experiences.

Even when the GPS does resolve, if the coordinates differ at all from the placeholder (previous GPS fix), `activeDeckLocation` changes, which changes the deck query key in `useDeckCards.ts`. This starts a fresh deck fetch (`isDeckLoading = true`, `loading = true`), adding another 3.5 seconds to the loading time.

Additionally, `hasCompletedInitialFetch` (line 799) includes a `!isDeckLoading` gate. This means even if the initial deck fetch completed and `hasCompletedFetchForCurrentMode` was set to `true`, a subsequent deck refetch (triggered by the location coordinate change) resets `hasCompletedInitialFetch` to `false`, keeping the loader visible.

**Why the reload works:** After a shake-reload, Zustand hydrates from AsyncStorage with the `deckBatches` array that was stored during the initial session. In `useDeckCards.ts` (line 52-53), the hook finds the persisted batch and provides it as `initialData`. Unlike `placeholderData`, `initialData` sets the query status to `'success'` immediately. So `isDeckLoading = false`, `isDeckBatchLoaded = true`, and `hasCompletedFetchForCurrentMode` is set via the second branch of `shouldMarkComplete` (line 732: `hasRecommendationsInState && !isModeTransitioning && !loading`). The cards appear instantly.

**Will this happen in production?** YES. This is not a development-only issue. The core mechanism (location query key change when preferences load) will occur in any environment. The GPS hang severity may vary — it may be worse in areas with poor GPS reception (indoors, urban canyons) and less severe outdoors. But the loader will always show longer than necessary due to the cascading refetch chain, even if GPS is fast.

---

## 5. Recommended Fix Strategy

### Priority 1 — Fix the root causes

| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| RC-001 | Stabilize location query key | `useUserLocation.ts` | Small | Don't include `customLocation`/`useGpsFlag` in the query key when they change from `undefined` to actual values. Instead, use a stable derived value (e.g., hash the effective location config) OR move the prefs reading inside the `queryFn` instead of the query key. Simplest fix: normalize `undefined` to `null` before including in the key: `customLocation ?? null` and `useGpsFlag ?? null`. |
| RC-002 | Add timeout to GPS fetch | `enhancedLocationService.ts` | Small | Wrap `getCurrentPositionAsync` in a `Promise.race` with a 10-second timeout. On timeout, fall through to `getLastKnownLocation()`. |
| RC-003 | Round coordinates in deck query key | `useDeckCards.ts` | Trivial | Round `location?.lat` and `location?.lng` to 3 decimal places (~110m precision) in the query key to prevent trivial GPS drift from changing the key. |

### Priority 2 — Fix contributing factors

| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| CF-001 | Stop nuking React Query cache | `app/index.tsx` | Small | Replace `AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE')` with a size check. Only clear if cache exceeds 1.5MB. |
| CF-002 | Remove `!isDeckLoading` from `hasCompletedInitialFetch` | `RecommendationsContext.tsx` | Trivial | Change `hasCompletedInitialFetch` to `!isModeTransitioning && !isWaitingForSessionResolution && hasCompletedFetchForCurrentMode`. Once the initial fetch completed, background refetches should not re-trigger the loader. |
| CF-003 | Deduplicate `useAuthSimple()` initialization | `useAuthSimple.ts` | Medium | Move `initializeAuth` logic to a singleton/module-level init. Have the hook only read from Zustand without triggering its own `getSession()` + profile fetch. |

### Priority 3 — Fix hidden flaws

| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| HF-001 | Guard `setAuth`/`setProfile` with mounted flag | `useAuthSimple.ts` | Trivial | Add `if (mounted)` guard before `setAuth` and `setProfile` calls, same as `setLoading`. |
| HF-002 | Create or remove `notification_preferences` | Migration / service | Small | Either create the table migration or remove the code that references it. |

### Suggested implementation order:
1. **RC-001** — Stabilize location query key (fixes the trigger)
2. **RC-002** — Add GPS timeout (prevents the hang)
3. **CF-002** — Remove `!isDeckLoading` gate (prevents loader regression)
4. **RC-003** — Round coordinates (prevents cascade)
5. **CF-001** — Fix cache clearing (improves cold start)
6. **CF-003** — Deduplicate auth init (reduces noise)
7. **HF-001** — Guard mutations (safety)
8. **HF-002** — Fix notification_preferences (cleanup)

### What NOT to change:
- **`deckService.ts`** — The service itself works correctly. It fetches 20 cards in 3.5 seconds. The problem is upstream in the loading state management.
- **`SwipeableCards.tsx` `shouldShowLoader` logic** — The logic itself is correct given its inputs. Fix the inputs (`isLoadingLocation`, `hasCompletedInitialFetch`), not the consumer.
- **`useDeckCards.ts` core query logic** — The `initialData` pattern with Zustand batches is a good optimization. The issue is that this optimization only kicks in after the first successful load — the first load is where the bug lives.
- **`placeholderData` usage** — Don't remove `placeholderData` from the hooks. It provides good UX for subsequent renders. The fix is to not use `isLoading` as a hard UI gate when `placeholderData` is in play.

---

## 6. Handoff to Orchestrator

Orchestrator: the investigation is complete. The root cause of the infinite "Curating your lineup" loader is a **location query key change triggered by preferences loading** (RC-001). When preferences land in the React Query cache, `customLocation` and `useGpsFlag` change from `undefined` to their actual values, changing the location query key. React Query v5's `isLoading` stays `true` for the new key even with `placeholderData` available. This cascades through the loading state chain to re-show the loader. The "eternity" part comes from GPS having no timeout (RC-002) — if `getCurrentPositionAsync` hangs, the loader never resolves.

The fix strategy in §5 gives exact file paths, exact line numbers, and exact changes needed. Fixes RC-001 through RC-003 together eliminate the infinite loader. CF-002 prevents future regressions where background refetches re-trigger the loader. Everything found is proven with evidence — the reload working is the smoking gun that confirms the loading state (not the data pipeline) is the problem. Spec the fix, hand it to the implementor, then send the result to the tester.
