# Feature: Infinite Loader Elimination

**Date:** 2026-03-10
**Status:** Planned
**Requested by:** Fix the infinite "Curating your lineup" loader that hangs indefinitely after login, forcing users to shake-reload to see cards.

---

## 1. Summary

The home screen loader hangs indefinitely because three independent defects cascade into a single symptom: (1) the location query key changes when preferences load — flipping `isLoadingLocation` back to `true` in React Query v5, (2) the GPS fetch has no timeout so `isLoadingLocation` can stay `true` forever, and (3) raw floating-point coordinates in the deck query key cause unnecessary refetches on trivial GPS drift. Two contributing factors amplify the problem: the React Query cache is nuked on every app start (destroying persisted preferences/location that would prevent the key change), and `hasCompletedInitialFetch` includes a `!isDeckLoading` gate that re-shows the loader during background refetches. This spec fixes all five defects plus two hidden flaws, achieving 100% predictable loading behavior.

## 2. User Story

As a Mingla user, I want the home screen cards to appear within 3–5 seconds of opening the app so that I never see an infinite loader or need to shake-reload.

## 3. Success Criteria

1. **Cold start (first login ever):** Cards appear within 5 seconds. The loader never hangs past 10 seconds under any GPS condition (indoors, flaky signal, simulator).
2. **Warm start (app relaunch after previous session):** Cards appear within 2 seconds using persisted cache data.
3. **Preferences load timing:** When preferences query resolves after location query, `isLoadingLocation` does NOT flip back to `true`. The location query key remains stable.
4. **GPS timeout:** If GPS cannot resolve within 10 seconds, the app falls back to last known location or cached location. The loader does NOT hang.
5. **Coordinate drift:** Minor GPS drift (< 110m) does NOT trigger a deck refetch. The query key is stable for the same approximate location.
6. **Background refetch immunity:** Once cards are displayed, background refetches of location or deck data do NOT re-show the "Curating your lineup" loader.
7. **Cache persistence:** On app restart, the React Query persisted cache is available (not nuked). Lightweight queries (preferences, location) survive across sessions.
8. **Auth initialization:** `useAuthSimple()` does NOT fire redundant `getSession()` calls from multiple mount points. `setAuth`/`setProfile` are guarded by the `mounted` flag.
9. **Mode transitions:** Switching between solo and collaboration modes still shows the loader correctly during the transition, then clears it when new cards arrive.
10. **Shake-reload still works:** Shake-reload continues to refresh all data as before.

---

## 4. Database Changes

### 4.1 New Tables

None.

### 4.2 Modified Tables

None.

### 4.3 RLS Policy Summary

No changes.

---

## 5. Edge Functions

No edge function changes.

---

## 6. Mobile Implementation

### 6.1 Files to Modify

This is a pure mobile-layer fix. Seven files are modified. Zero new files are created.

---

#### 6.1.1 `app-mobile/src/hooks/useUserLocation.ts` — FIX RC-001: Stabilize Location Query Key

**Root cause:** `customLocation` and `useGpsFlag` are read from the React Query cache on every render. Before preferences load, both are `undefined`. After, they become `null` and `true`. Since `undefined !== null`, the query key changes, starting a brand new location query. In React Query v5, `isLoading = isPending && isFetching` — the new key has never resolved, so `isLoading = true` even though `placeholderData` provides usable location data.

**Fix:** Normalize `undefined` to stable default values before including them in the query key. `customLocation ?? null` ensures both "no cache yet" and "no custom location set" produce the same key segment (`null`). `useGpsFlag ?? true` ensures both "no cache yet" and "default GPS mode" produce the same key segment (`true`).

**Why `?? null` and `?? true` specifically:** The default behavior when preferences haven't loaded is GPS mode with no custom location. The `fetchUserLocation` function already treats `useGpsFlag !== false` as "use GPS" (line 47), so `undefined` and `true` are functionally identical. Normalizing them to the same value prevents the key from changing when the actual behavior hasn't changed.

**What to change in the hook function (lines 98–113):**

Replace:
```typescript
  // Read current preferences from React Query cache to get location fields
  const cachedPrefs = useQueryClient().getQueryData<UserPreferences>(
    ['userPreferences', userId]
  );
  const customLocation = cachedPrefs?.custom_location;
  const useGpsFlag = cachedPrefs?.use_gps_location;

  const query = useQuery({
    queryKey: ['userLocation', userId, currentMode, refreshKey, customLocation, useGpsFlag],
    queryFn: () => fetchUserLocation(userId, currentMode, refreshKey, customLocation, useGpsFlag),
    enabled: true, // Always enabled, handles userId check internally
    staleTime: Infinity, // Location doesn't go stale unless mode/refreshKey/location prefs change
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    placeholderData: (previousData) => previousData,
    initialData: cachedLocationSync ?? undefined,
  });
```

With:
```typescript
  // Read current preferences from React Query cache to get location fields.
  // CRITICAL: Normalize undefined → stable defaults so the query key does NOT change
  // when preferences load. Before prefs load, cachedPrefs is undefined, so both values
  // are undefined. After prefs load, they become null/true. Normalizing prevents this
  // transition from changing the query key and triggering a redundant location refetch.
  const cachedPrefs = useQueryClient().getQueryData<UserPreferences>(
    ['userPreferences', userId]
  );
  const customLocation = cachedPrefs?.custom_location ?? null;
  const useGpsFlag = cachedPrefs?.use_gps_location ?? true;

  const query = useQuery({
    queryKey: ['userLocation', userId, currentMode, refreshKey, customLocation, useGpsFlag],
    queryFn: () => fetchUserLocation(userId, currentMode, refreshKey, customLocation, useGpsFlag),
    enabled: true,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    initialData: cachedLocationSync ?? undefined,
  });
```

**Conflict analysis:**

- **DiscoverScreen.tsx (line 1084):** Calls `useUserLocation(user?.id, "solo", undefined)`. This consumer only reads `data`, not `isLoading`. The fix changes the query key stability — since DiscoverScreen uses the same hook with the same cache, it benefits from the same stable key. No conflict.
- **CollaborationPreferences.tsx:** Only references `useUserLocation` in a comment about cache freshness. Not a consumer. No conflict.
- **ProfilePage.tsx / ProfileHeroSection.tsx:** Grep returned no matches. Not consumers. No conflict.
- **RecommendationsContext.tsx (line 263):** Primary consumer. Reads `isLoading` as `isLoadingLocation`. This is the exact callsite the fix targets. After the fix, `isLoadingLocation` will NOT flip back to `true` when preferences load. This is the desired behavior.
- **Prefetch query key in RecommendationsContext (lines 599–614):** Uses `activeDeckLocation.lat` and `activeDeckLocation.lng` directly. These are derived from the location query's `data` field, not from the query key. The fix does not change `data` — it only prevents unnecessary refetches. No conflict.

**Edge case: user HAS a custom location set (non-GPS user):**
- Before prefs load: `customLocation = null`, `useGpsFlag = true` → fetches via GPS (correct default)
- After prefs load: `customLocation = "37.7749, -122.4194"`, `useGpsFlag = false` → key changes (correctly) → fetches custom location
- This is the **desired** key change — the user's actual location source changed. The fix only prevents the spurious `undefined → null` / `undefined → true` transition, not legitimate preference changes.

**Edge case: user explicitly sets `use_gps_location = false` in DB but has no custom_location:**
- Before prefs: `customLocation = null`, `useGpsFlag = true`
- After prefs: `customLocation = null`, `useGpsFlag = false` → key changes (correctly) → `fetchUserLocation` falls through to GPS anyway (line 47: `useGps = useGpsFlag !== false` = `false`, but then line 49: `!useGps && customLocation` = `false` since `customLocation` is `null`, falls to GPS on line 78)
- Key change triggers refetch but the result is the same GPS location. Acceptable — this is a rare misconfiguration edge case and the one refetch is harmless.

---

#### 6.1.2 `app-mobile/src/services/enhancedLocationService.ts` — FIX RC-002: Add GPS Timeout

**Root cause:** `Location.getCurrentPositionAsync()` has no timeout. The `timeInterval: 5000` parameter is for location subscriptions (watch mode), not for single-shot position requests. If GPS is slow, indoors, or the simulator's location services are flaky, this call hangs indefinitely.

**Fix:** Wrap `getCurrentPositionAsync` in a `Promise.race` with a 10-second timeout. On timeout, fall back to `getLastKnownLocation()`. Return `null` only if both fail.

**What to change in the `getCurrentLocation` method (lines 70–129):**

Replace:
```typescript
  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      // First check if location services are enabled
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        // Location services disabled - try last known location silently
        return await this.getLastKnownLocation();
      }

      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        // Try to get last known location if permission denied
        return await this.getLastKnownLocation();
      }

      // Now safe to get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
      });

      const locationData: LocationData = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || undefined,
        altitude: location.coords.altitude || undefined,
        heading: location.coords.heading || undefined,
        speed: location.coords.speed || undefined,
        timestamp: location.timestamp,
      };

      this.lastLocation = locationData;
      return locationData;
    } catch (error: any) {
      // Check if location services are disabled or unavailable
      const errorMessage = error?.message || String(error) || "";
      const isLocationServiceError =
        errorMessage.includes("location services") ||
        errorMessage.includes("unavailable") ||
        errorMessage.includes("Location services are not enabled") ||
        errorMessage.includes("Current location is unavailable");

      if (isLocationServiceError) {
        // Try to get last known location as fallback (silently)
        try {
          const lastKnown = await this.getLastKnownLocation();
          if (lastKnown) {
            return lastKnown;
          }
        } catch {
          // Ignore errors when getting last known location
        }
        // Return null silently - don't log expected errors
        return null;
      }

      // Only log unexpected errors
      console.error("Error getting current location:", error);
      return null;
    }
  }
```

With:
```typescript
  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        return await this.getLastKnownLocation();
      }

      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        return await this.getLastKnownLocation();
      }

      // Wrap GPS fetch in a 10-second timeout. getCurrentPositionAsync has no
      // built-in timeout — timeInterval is for subscriptions only. Without this,
      // the call can hang indefinitely indoors or on flaky simulators.
      const GPS_TIMEOUT_MS = 10_000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('GPS_TIMEOUT')), GPS_TIMEOUT_MS);
      });

      const location = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        timeoutPromise,
      ]);

      const locationData: LocationData = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || undefined,
        altitude: location.coords.altitude || undefined,
        heading: location.coords.heading || undefined,
        speed: location.coords.speed || undefined,
        timestamp: location.timestamp,
      };

      this.lastLocation = locationData;
      return locationData;
    } catch (error: any) {
      const errorMessage = error?.message || String(error) || "";

      // GPS timeout or location service error — fall back silently
      const isExpectedError =
        errorMessage === 'GPS_TIMEOUT' ||
        errorMessage.includes("location services") ||
        errorMessage.includes("unavailable") ||
        errorMessage.includes("Location services are not enabled") ||
        errorMessage.includes("Current location is unavailable");

      if (isExpectedError) {
        try {
          const lastKnown = await this.getLastKnownLocation();
          if (lastKnown) {
            return lastKnown;
          }
        } catch {
          // Ignore
        }
        return null;
      }

      console.error("Error getting current location:", error);
      return null;
    }
  }
```

**Conflict analysis:**

- **`useUserLocation.ts` (lines 35, 79):** Calls `enhancedLocationService.getCurrentLocation()`. The return type is unchanged (`Promise<LocationData | null>`). The timeout adds a guaranteed upper bound to execution time. No conflict.
- **`DiscoverScreen.tsx`:** Uses `enhancedLocationService.getCurrentLocation()` for its own location fetching (separate from the hook). Benefits from the same timeout. No conflict.
- **`startLocationTracking` method (line 156):** Uses `watchPositionAsync`, NOT `getCurrentPositionAsync`. The fix only touches `getCurrentLocation`. No conflict.
- **`getLastKnownLocation` method (line 132):** Used as the timeout fallback target. The method is unchanged. `maxAge: 300000` (5 minutes) is appropriate — if the last known location is stale, it returns `this.lastLocation` (in-memory cache). No conflict.

**Drift analysis — will 10 seconds be too short?**
- Expo's `Location.Accuracy.Balanced` targets ~100m accuracy. On modern phones, this resolves in 1–5 seconds outdoors. Indoors, it may never resolve at Balanced accuracy — the timeout prevents this from blocking the UI. 10 seconds is generous for outdoor use and protective for indoor use. The fallback to `getLastKnownLocation` ensures the user still gets a position (their last outdoor fix).

**Removed:** `timeInterval: 5000` — this parameter is meaningless for `getCurrentPositionAsync` and misleads developers into thinking it's a timeout.

---

#### 6.1.3 `app-mobile/src/hooks/useDeckCards.ts` — FIX RC-003: Round Coordinates in Query Key

**Root cause:** The deck query key includes raw floating-point GPS coordinates (`location?.lat`, `location?.lng`). When the location refetch returns coordinates that differ by even 0.00001 (≈1.1m), the query key changes, starting a fresh deck fetch. This adds 3.5+ seconds to the loading time for no user-visible benefit.

**Fix:** Round coordinates to 3 decimal places (~110m precision) in the query key only. The `queryFn` still uses the full-precision coordinates for the actual API call.

**What to change (lines 56–73):**

Replace:
```typescript
  const query = useQuery<DeckResponse>({
    queryKey: [
      'deck-cards',
      location?.lat,
      location?.lng,
```

With:
```typescript
  // Round coordinates to 3 decimal places (~110m) in the query key to prevent
  // trivial GPS drift from invalidating the deck cache. Full-precision coords
  // are still passed to queryFn for accurate API results.
  const roundedLat = location ? Math.round(location.lat * 1000) / 1000 : null;
  const roundedLng = location ? Math.round(location.lng * 1000) / 1000 : null;

  const query = useQuery<DeckResponse>({
    queryKey: [
      'deck-cards',
      roundedLat,
      roundedLng,
```

**Conflict analysis:**

- **Prefetch query key in RecommendationsContext (lines 599–614):** Uses `activeDeckLocation.lat` and `activeDeckLocation.lng` without rounding. This means the prefetch key will NOT match the rounded query key, making prefetched data invisible to the query. **This IS a conflict.** The prefetch query key MUST also use rounded coordinates. See §6.1.4 below.
- **Zustand `deckBatches` → `initialData` (lines 52–54):** `initialData` is matched by `batchSeed`, not coordinates. The rounding doesn't affect `initialData` lookup. No conflict.
- **`isFullBatchLoaded` (line 101):** Derived from `query.isLoading`, `query.isFetching`, and `query.data`. Not coordinate-dependent. No conflict.
- **Cards cache in `RecommendationsContext`:** The `currentCacheKeyRef` is never constructed from coordinates. No conflict.

**Precision justification:** 3 decimal places = 0.001° latitude ≈ 111m. At the equator, 0.001° longitude ≈ 111m. At 60° latitude, 0.001° longitude ≈ 55m. This means two GPS readings within ~110m of each other will produce the same deck query key. Since Mingla's travel constraint minimum is walking/30min (~2km radius), a 110m precision difference is negligible for card relevance.

---

#### 6.1.4 `app-mobile/src/contexts/RecommendationsContext.tsx` — FIX RC-003 (ripple), CF-002, Loading States

This file has three distinct changes. Apply all three.

**CHANGE 1: Round coordinates in prefetch query key (lines 599–614)**

The prefetch query key MUST match the rounded deck query key from §6.1.3, otherwise prefetched data is orphaned in a different cache entry.

Replace:
```typescript
      queryClient.prefetchQuery({
        queryKey: [
          'deck-cards',
          activeDeckLocation.lat, activeDeckLocation.lng,
```

With:
```typescript
      const prefetchLat = Math.round(activeDeckLocation.lat * 1000) / 1000;
      const prefetchLng = Math.round(activeDeckLocation.lng * 1000) / 1000;
      queryClient.prefetchQuery({
        queryKey: [
          'deck-cards',
          prefetchLat, prefetchLng,
```

**Why:** If the prefetch key uses raw coordinates and the query key uses rounded coordinates, React Query treats them as different queries. The prefetched data would never be used, wasting a network call and eliminating the optimization entirely.

---

**CHANGE 2: Remove `!isDeckLoading` from `hasCompletedInitialFetch` (line 799–803)**

**Root cause (CF-002):** `hasCompletedInitialFetch` requires `!isDeckLoading`. If the deck query key changes after the initial fetch completed (e.g., coordinate drift, background refetch), `isDeckLoading` flips back to `true`, making `hasCompletedInitialFetch` false. This re-shows the loader even though cards are already displayed.

**Fix:** `hasCompletedFetchForCurrentMode` is the sole authority on whether the initial fetch completed. Once it's `true`, it stays `true` until a mode transition explicitly resets it. Background refetches must NOT re-trigger the loader.

Replace:
```typescript
  const hasCompletedInitialFetch =
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    hasCompletedFetchForCurrentMode &&
    !isDeckLoading;
```

With:
```typescript
  // Once the initial fetch completed for the current mode, background refetches
  // (location re-resolution, coordinate drift) must NOT re-show the loader.
  // hasCompletedFetchForCurrentMode is the sole authority — it is reset only on
  // explicit mode transitions (line 688), not on background query key changes.
  const hasCompletedInitialFetch =
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    hasCompletedFetchForCurrentMode;
```

**Conflict analysis:**

- **SwipeableCards.tsx (line 532):** `shouldShowLoader = isAnyLoading || (!hasCompletedInitialFetch && availableRecommendations.length === 0)`. After the fix, `hasCompletedInitialFetch` becomes `true` earlier (as soon as initial fetch completes, without waiting for subsequent refetches). The `isAnyLoading` path still shows the loader during initial loading. The `!hasCompletedInitialFetch` path shows the loader only when the initial fetch hasn't completed AND there are no cards. This is the correct behavior.
- **`loading` variable (line 711):** Still `isLoadingLocation || isLoadingPreferences || isDeckLoading`. After RC-001 fix, `isLoadingLocation` won't flip back. After RC-003 fix, `isDeckLoading` won't flip back on drift. But even if a legitimate refetch makes `loading = true`, `shouldShowLoader` won't activate because `hasCompletedInitialFetch` is `true` and `availableRecommendations.length > 0` (cards are already displayed). This is the correct behavior — `isAnyLoading` being true only matters when combined with no cards to show.

**Wait — will removing `!isDeckLoading` break the initial load?**

No. Here's the initial load sequence after all fixes:
1. App starts → `isLoadingLocation = true`, `isLoadingPreferences = true` → `loading = true` → `isAnyLoading = true` → `shouldShowLoader = true` ✓ (loader shows)
2. Location resolves → `isLoadingLocation = false`
3. Preferences resolve → `isLoadingPreferences = false` → location query key does NOT change (RC-001 fix)
4. Deck query starts → `isDeckLoading = true` → `loading = true` → `isAnyLoading = true` → `shouldShowLoader = true` ✓ (loader still shows)
5. Deck resolves → `isDeckBatchLoaded = true` → `isDeckLoading = false` → `loading = false`
6. Mark-complete effect fires: `shouldMarkComplete = (queryEnabled && queryFinished && hasQueryResult)` = `true` → `hasCompletedFetchForCurrentMode = true`
7. `hasCompletedInitialFetch = !false && !false && true` = `true`
8. `shouldShowLoader = false || (!true && ...)` = `false` ✓ (loader hides)

The initial load is protected by `isAnyLoading` (via `loading`), which stays `true` until all three data sources resolve. The `hasCompletedInitialFetch` removal of `!isDeckLoading` only affects SUBSEQUENT refetches, not the initial load.

---

**CHANGE 3: Fix `loading` to not block on background refetches when cards are available**

After careful analysis, the current `loading` computation (line 711) is actually fine as-is because `shouldShowLoader` in SwipeableCards already gates on `isAnyLoading || (!hasCompletedInitialFetch && availableRecommendations.length === 0)`. With the CF-002 fix above, once initial fetch completes:

- `isAnyLoading = true` but `hasCompletedInitialFetch = true` → `shouldShowLoader = isAnyLoading = true`

Wait — this IS a problem. `shouldShowLoader = isAnyLoading || (...)`. If `isAnyLoading = true`, the loader shows regardless of `hasCompletedInitialFetch`. But `isAnyLoading` includes `loading`, which includes `isDeckLoading`. So a legitimate deck refetch (e.g., user opens preferences, changes category, comes back) would show the loader even though the old cards are still visible via `placeholderData`.

**But that's the CORRECT behavior for preference changes.** When the user explicitly changes preferences, the old cards are stale and the loader should show while new cards load. The problem is ONLY when `isDeckLoading` goes true due to background key changes (coordinate drift, etc.), not user-initiated changes.

After RC-001 + RC-003 fixes, the only scenarios where `isDeckLoading` goes true are:
1. Initial load → loader should show ✓
2. User changes preferences → `refreshKey` changes → loader should show ✓
3. Mode transition → loader should show ✓
4. Batch transition → `isBatchTransitioning` handles this separately ✓

Coordinate drift and preference-load key changes are eliminated by RC-001 and RC-003. So the current `isAnyLoading` logic becomes correct after those fixes. No additional change needed here.

---

#### 6.1.5 `app-mobile/app/index.tsx` — FIX CF-001: Stop Nuking React Query Cache

**Root cause:** `AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE')` wipes the entire React Query persisted cache on every app start. This was a safeguard against Android's 2MB CursorWindow limit, but the `shouldDehydrateQuery` filter already excludes heavy queries (savedCards, curated-experiences, recommendations). The nuclear wipe makes PersistQueryClientProvider useless — no query data survives between sessions.

**Why it matters for the infinite loader:** If preferences and location persisted across sessions, they'd be available in the cache on startup. `useUserLocation` would read `customLocation = null` and `useGpsFlag = true` from the persisted cache immediately (instead of `undefined`), and the query key would never change. The RC-001 fix eliminates this dependency, but preserving the cache improves cold-start performance significantly.

**Fix:** Replace the blanket wipe with a size check. Only clear if the cache exceeds 1.5MB (below Android's 2MB CursorWindow limit).

**What to change (lines 2084–2097):**

Replace:
```typescript
export default function App() {
  // Gate: clear corrupted/oversized React Query persisted cache BEFORE provider mounts
  // PersistQueryClientProvider crashes on mount if the cache exceeds Android's 2MB CursorWindow
  const [cacheReady, setCacheReady] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE')
      .catch(() => {})
      .finally(() => setCacheReady(true));
  }, []);

  if (!cacheReady) {
    return null; // Brief blank frame while clearing corrupted cache
  }
```

With:
```typescript
export default function App() {
  // Gate: clear oversized React Query persisted cache BEFORE provider mounts.
  // PersistQueryClientProvider crashes on mount if the cache exceeds Android's 2MB CursorWindow.
  // Only clear if the cache actually exceeds the safety threshold (1.5MB).
  // The shouldDehydrateQuery filter already excludes heavy queries, so the cache
  // should stay small. Preserving it enables instant startup with cached prefs/location.
  const [cacheReady, setCacheReady] = React.useState(false);

  React.useEffect(() => {
    const MAX_CACHE_BYTES = 1_500_000; // 1.5MB — below Android's 2MB CursorWindow limit
    AsyncStorage.getItem('REACT_QUERY_OFFLINE_CACHE')
      .then((cached) => {
        if (cached && cached.length > MAX_CACHE_BYTES) {
          return AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        }
      })
      .catch(() => {})
      .finally(() => setCacheReady(true));
  }, []);

  if (!cacheReady) {
    return null;
  }
```

**Conflict analysis:**

- **`PersistQueryClientProvider` (line 2100):** Reads the same AsyncStorage key. If the cache exists and is under 1.5MB, it will be loaded and hydrated into React Query. The `shouldDehydrateQuery` filter ensures only lightweight queries are persisted. No conflict.
- **`maxAge: 24 * 60 * 60 * 1000` (line 2104):** Stale data is automatically evicted by the persist provider. The size check is an additional safety net. No conflict.
- **Android CursorWindow:** The 2MB limit is per SQLite row. AsyncStorage on Android uses SQLite. Our 1.5MB threshold provides a 500KB safety margin. The `shouldDehydrateQuery` filter excludes the heaviest queries, so in practice the cache should be well under 500KB (preferences + location + deck-cards metadata). No risk of hitting the limit.
- **iOS:** No CursorWindow limit. This change is harmless on iOS — the size check will almost always pass, and the cache will be preserved.

**Edge case: corrupted cache (invalid JSON):**
- `PersistQueryClientProvider` already handles JSON parse errors internally — it discards the cache and starts fresh. No additional handling needed.

---

#### 6.1.6 `app-mobile/src/hooks/useAuthSimple.ts` — FIX HF-001: Guard Zustand Mutations with Mounted Flag

**Root cause:** `setAuth()` and `setProfile()` are Zustand mutations that execute regardless of whether the component is still mounted. If the component unmounts during `initializeAuth()` (e.g., fast navigation), stale data is written to the global store.

**Fix:** Guard all `setAuth` and `setProfile` calls with the `mounted` flag, same as `setLoading`.

**What to change:**

**In `initializeAuth` (line 69–71):** Replace:
```typescript
        if (session?.user) {
          logger.auth('Session found', { userId: session.user.id, email: session.user.email });
          setAuth(session.user as User);
```

With:
```typescript
        if (session?.user) {
          logger.auth('Session found', { userId: session.user.id, email: session.user.email });
          if (mounted) setAuth(session.user as User);
```

**In `initializeAuth` profile success (line 143):** Replace:
```typescript
            } else if (profile) {
              logger.auth('Profile loaded', { displayName: profile.display_name, onboarding: profile.has_completed_onboarding });
              setProfile(profile);
            }
```

With:
```typescript
            } else if (profile) {
              logger.auth('Profile loaded', { displayName: profile.display_name, onboarding: profile.has_completed_onboarding });
              if (mounted) setProfile(profile);
            }
```

**In `initializeAuth` profile creation (line 135):** Replace:
```typescript
                  if (createError) {
                    console.error("Error creating profile:", createError);
                  } else {
                    setProfile(newProfile);
                  }
```

With:
```typescript
                  if (createError) {
                    console.error("Error creating profile:", createError);
                  } else {
                    if (mounted) setProfile(newProfile);
                  }
```

**In `initializeAuth` no session (line 151):** Replace:
```typescript
        } else {
          logger.auth('No session — user not authenticated');
          setAuth(null);
        }
```

With:
```typescript
        } else {
          logger.auth('No session — user not authenticated');
          if (mounted) setAuth(null);
        }
```

**In `onAuthStateChange` callback (lines 172–208):** Replace:
```typescript
      if (session?.user) {
        setAuth(session.user as User);

        // Load profile
        try {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();

          if (profileError) {
            console.error("Error loading profile:", profileError);

            // If profile not found, validate user still exists
            if (profileError.code === "PGRST116") {
              const {
                data: { user: authUser },
                error: userError,
              } = await supabase.auth.getUser();

              if (userError || !authUser || authUser.id !== session.user.id) {
                await supabase.auth.signOut();
                setAuth(null);
                clearUserData();
              }
            }
          } else if (profile) {
            setProfile(profile);
          }
        } catch (profileError) {
          console.error("Error loading profile:", profileError);
        }
      } else {
        setAuth(null);
        clearUserData();
      }
```

With:
```typescript
      if (session?.user) {
        if (mounted) setAuth(session.user as User);

        try {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();

          if (profileError) {
            console.error("Error loading profile:", profileError);

            if (profileError.code === "PGRST116") {
              const {
                data: { user: authUser },
                error: userError,
              } = await supabase.auth.getUser();

              if (userError || !authUser || authUser.id !== session.user.id) {
                await supabase.auth.signOut();
                if (mounted) {
                  setAuth(null);
                  clearUserData();
                }
              }
            }
          } else if (profile) {
            if (mounted) setProfile(profile);
          }
        } catch (profileError) {
          console.error("Error loading profile:", profileError);
        }
      } else {
        if (mounted) {
          setAuth(null);
          clearUserData();
        }
      }
```

**Conflict analysis:**

- **Multiple `useAuthSimple()` consumers (AppStateManager, RecommendationsContext, SwipeableCards):** Each mounts its own `useEffect` with its own `mounted` flag. The guard prevents stale writes from unmounted instances. The first instance to complete will write to Zustand; subsequent writes from still-mounted instances are idempotent (same user, same profile). No conflict.
- **`clearUserData()` (line 196 in onAuthStateChange):** Also a Zustand mutation. Now guarded by `mounted`. This is correct — if the component unmounted, the sign-out flow should not clear user data from a stale callback.

**Note on CF-003 (deduplicating auth initialization):** The investigation report recommends moving auth init to a singleton. This spec does NOT include that change because it's a larger refactor with higher risk and the mounted guard eliminates the immediate safety issue. CF-003 can be addressed in a follow-up spec if needed.

---

### 6.2 State Changes

**Zustand:** No changes.

**React Query keys affected:**
- `['userLocation', ...]` — key stabilized by RC-001 (no more `undefined` segments)
- `['deck-cards', ...]` — key stabilized by RC-003 (rounded coordinates)
- `['userPreferences', ...]` — no change, but persisted cache now survives app restart (CF-001)

---

## 7. Implementation Order

**Step 1: Fix RC-001 — Stabilize location query key.**
Modify `app-mobile/src/hooks/useUserLocation.ts` per §6.1.1. Add `?? null` and `?? true` to the two cache reads.
**Verify:** Add `console.log('LOCATION KEY:', customLocation, useGpsFlag)` after the normalization lines. Start the app. When preferences load, verify the log does NOT show a change from the first render. Both renders should log `null, true`.

**Step 2: Fix RC-002 — Add GPS timeout.**
Modify `app-mobile/src/services/enhancedLocationService.ts` per §6.1.2. Add `Promise.race` with 10-second timeout.
**Verify:** In a simulator, disable location services. Start the app. The loader should resolve within 10 seconds (falling back to last known location or null). It must NOT hang indefinitely.

**Step 3: Fix CF-002 — Remove `!isDeckLoading` from `hasCompletedInitialFetch`.**
Modify `app-mobile/src/contexts/RecommendationsContext.tsx` line 799–803 per §6.1.4 (Change 2).
**Verify:** After cards load, add a `console.log('hasCompletedInitialFetch:', hasCompletedInitialFetch, 'isDeckLoading:', isDeckLoading)` in SwipeableCards. Trigger a background refetch (e.g., by invalidating the deck query via React Query devtools). Verify `hasCompletedInitialFetch` stays `true` even while `isDeckLoading` briefly goes `true`.

**Step 4: Fix RC-003 — Round coordinates in deck query key.**
Modify `app-mobile/src/hooks/useDeckCards.ts` per §6.1.3.
Then modify `app-mobile/src/contexts/RecommendationsContext.tsx` prefetch key per §6.1.4 (Change 1).
**Verify:** Log the deck query key in useDeckCards. Trigger two location updates with slightly different coordinates (e.g., 37.7749 then 37.77491). Verify the query key does NOT change.

**Step 5: Fix CF-001 — Size-based cache clearing.**
Modify `app-mobile/app/index.tsx` per §6.1.5.
**Verify:** Start the app, let it load fully. Kill the app. Restart it. Verify that preferences and location load from cache instantly (check React Query devtools or add logging in the hooks to see if `queryFn` fires immediately or if cached data is available first). On Android, verify no CursorWindow crash.

**Step 6: Fix HF-001 — Guard auth mutations.**
Modify `app-mobile/src/hooks/useAuthSimple.ts` per §6.1.6.
**Verify:** This is a safety fix. Normal operation should be unchanged. Verify login still works, profile still loads, and sign-out still clears user data.

**Step 7: Integration test.**
Perform the full test matrix from §8.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | Cold start — fresh login | Sign in with Google on a fresh install | Cards appear within 5 seconds. No infinite loader. | Full stack |
| 2 | Cold start — GPS unavailable | Sign in with location services disabled | Cards appear within 12 seconds (10s GPS timeout + 2s fallback). Location falls back to last known or null. If null, "no matches" error shows (not infinite loader). | enhancedLocationService + useUserLocation |
| 3 | Warm start — app relaunch | Open app after previous successful session | Cards appear within 2 seconds. React Query cache provides preferences and location instantly. | index.tsx + all hooks |
| 4 | Preferences load after location | Start app, observe console logs | Location query key logs the same `customLocation` and `useGpsFlag` values before AND after preferences load. No key change. | useUserLocation |
| 5 | GPS drift between fetches | Trigger two location fetches with coordinates differing by < 0.001 | Deck query key does NOT change. No deck refetch triggered. | useDeckCards |
| 6 | GPS drift > 110m | Trigger two location fetches with coordinates differing by > 0.001 | Deck query key changes. Deck refetch triggered (correct behavior). | useDeckCards |
| 7 | Background deck refetch | After cards load, invalidate `deck-cards` query | Loader does NOT reappear. Cards stay visible. New data replaces old data silently when ready. | RecommendationsContext + SwipeableCards |
| 8 | Preference change | Change categories in preferences, return to home | Loader shows briefly while new cards load. New cards appear. Old cards replaced. | RecommendationsContext |
| 9 | Mode transition | Switch from solo to collaboration mode | Loader shows during transition. New cards appear for collab session. | RecommendationsContext |
| 10 | Batch transition | Swipe through 20 cards, trigger next batch | Batch transition loader shows. Next batch appears within 20 seconds. No infinite hang. | RecommendationsContext |
| 11 | Shake reload | Shake device after cards are loaded | All data refreshes. Cards reappear quickly from Zustand cache. | Full stack |
| 12 | Custom location user (non-GPS) | User has `use_gps_location = false` and `custom_location = "37.7749, -122.4194"` | After prefs load, location query key changes ONCE (correctly — from GPS default to custom). Cards load at the custom location. No infinite loader. | useUserLocation |
| 13 | Android CursorWindow safety | Start app 10+ times on Android, accumulating cache | App never crashes. Cache stays under 1.5MB. If cache exceeds limit, it's cleared before mount. | index.tsx |
| 14 | Prefetch key alignment | Swipe to 12th card (trigger prefetch), then swipe through remaining cards and trigger next batch | Next batch loads instantly from prefetch cache (no network wait). Prefetched data matches the query key. | useDeckCards + RecommendationsContext |
| 15 | Auth unmount safety | Navigate away from home screen rapidly during auth init | No stale `setAuth`/`setProfile` writes. No console warnings about state updates on unmounted components. | useAuthSimple |

---

## 9. Common Mistakes to Avoid

1. **Forgetting to round coordinates in the prefetch query key:** The deck query key in `useDeckCards.ts` and the prefetch query key in `RecommendationsContext.tsx` MUST use the same rounding. If they don't match, prefetched data is stored under a different key and never used. → **Correct approach:** Both use `Math.round(coord * 1000) / 1000`.

2. **Using `initialData` instead of `placeholderData` to "fix" the loading state:** `initialData` sets query status to `success` immediately, which would hide the loader — but it also sets `dataUpdatedAt` to the current time, making the query "fresh" even though the data might be stale. This suppresses necessary refetches. → **Correct approach:** Keep `placeholderData` for smooth transitions. Fix the loading state cascade upstream (query key stability + `hasCompletedInitialFetch` gate).

3. **Adding a `!query.data` check to replace `isLoading` everywhere:** While `!query.data` would technically work to detect "no data available," it breaks the semantic contract of React Query's loading states and makes the code harder to reason about. Other hooks and components rely on `isLoading` having its standard meaning. → **Correct approach:** Fix the root causes that make `isLoading` flip unexpectedly, not the consumer logic.

4. **Setting the GPS timeout too low (< 5 seconds):** In areas with poor GPS reception, a very short timeout would cause most location fetches to fall back to last known location, which could be stale. This degrades card relevance for users who travel. → **Correct approach:** 10 seconds is the right balance — long enough for outdoor GPS to resolve at Balanced accuracy, short enough to prevent UI hangs.

5. **Guarding `setAuth(null)` with `mounted` but forgetting `clearUserData()`:** Both mutations must be guarded together. If `setAuth(null)` is guarded but `clearUserData()` is not, a sign-out from an unmounted component would clear user data without clearing the auth state, leaving an inconsistent store. → **Correct approach:** Guard both together in the same `if (mounted)` block.

---

## 10. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec. Every file path, code change, and verification step in this document is intentional and exact — follow them precisely. If something in this spec is unclear or seems wrong, stop and ask before improvising. When you are finished, produce your IMPLEMENTATION_REPORT.md referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.
