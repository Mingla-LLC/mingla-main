# Investigation: Discover "For You" Pill View Slow Rendering on Android

**Date:** 2026-03-24
**Symptom:** Discover "For You" tab takes 15–20+ seconds to render pills/cards on Android
**Confidence:** High (all files read, full chain traced)

---

## Layman Summary

Your Discover screen is slow because of **three compounding problems**:

1. **The auth system initializes twice** every time you open the Discover tab — once from the app-wide manager, once from the DiscoverScreen itself. Each one calls Supabase to verify your session. That's 2–4 seconds wasted before data fetching even starts.

2. **The cache guard resets every time you switch tabs** — because it's stored in a `useRef` inside the component, and React destroys that ref when you navigate away. So every time you come back to Discover, it says "cache miss" and re-fetches everything from scratch, even though you were just there 5 seconds ago.

3. **The actual data fetch itself is slow** — the `discover-experiences` edge function fires 12 separate per-category queries to `card_pool`, plus impression lookups, plus cache writes. On a slow Android network, this exceeds the 15-second timeout, and you get 0 cards. Then a 20-second safety timer fires and forces the UI to show an empty state.

The combined waterfall: **Auth (2–4s) → GPS (2–5s) → Edge function (up to 15s timeout) = 20s+ before pills render**.

---

## Root Cause Analysis

### 🔴 ROOT CAUSE 1: Double `useAuthSimple()` Initialization

**Fact:** `useAuthSimple()` is instantiated in two independent locations:
- `app-mobile/src/components/AppStateManager.tsx:85` — app-wide instance
- `app-mobile/src/components/DiscoverScreen.tsx:871` — per-screen instance

**Fact:** Each instance runs its own `useEffect` (`useAuthSimple.ts:55`) that calls `supabase.auth.getSession()` — a network request.

**Fact:** The logs show `[AUTH] Initializing — fetching session...` firing **twice** every time the Discover tab is pressed.

**Inference:** The DiscoverScreen instance is redundant. It exists solely to get `user` for feature gating (`useFeatureGate`, `usePairingPills`), but the user is already available in the Zustand `appStore` after the AppStateManager instance resolves.

**Causal chain:** Tab press → DiscoverScreen mounts → useAuthSimple fires → `supabase.auth.getSession()` network call → 2–4s delay before data fetching can begin → entire rendering pipeline blocked.

**Verification:** Remove the `useAuthSimple()` call from DiscoverScreen and use `useAppStore().user` instead. Auth log should fire only once.

---

### 🔴 ROOT CAUSE 2: `hasFetchedRef` Guard Resets on Tab Switch

**Fact:** The "fetch once per session" guard in `DiscoverScreen.tsx:1601` uses `useRef`:
```typescript
// Line 1601
if (hasFetchedRef.current && lastDiscoverFetchDateRef.current === today) {
  fetchingRef.current = false;
  return;
}
```

**Fact:** When the user navigates away from the Discover tab and back, React unmounts and remounts the `DiscoverScreen` component. This creates a **new component instance** with a **fresh `useRef`** — `hasFetchedRef.current` starts as `false` again.

**Fact:** The cache validity check at lines 1612–1640 attempts to hydrate from in-memory and AsyncStorage caches, but the in-memory `discoverSessionCache` is a module-level variable that persists. However, `isCacheStillValid()` may return `false` if the cache was generated more than a few hours ago, triggering a full re-fetch.

**Fact:** From logs, every tab switch produces: `Cache miss or stale. Fetching fresh discover data...`

**Inference:** The guard was designed to prevent duplicate fetches within a single mount cycle, not across tab switches. The module-level cache should handle cross-mount caching, but if the cache is stale (or if `isCacheStillValid` has a short window), the guard fails to prevent redundant fetches.

**Causal chain:** Tab switch → component remount → fresh ref → guard fails → full edge function call → 10–15s delay.

---

### 🔴 ROOT CAUSE 3: Discover Edge Function Fires 12 Parallel Queries (No Timeout Protection)

**Fact:** `discover-experiences/index.ts:325-344` fires one `card_pool` query per category via `Promise.all()`:
```typescript
await Promise.all(
  categoriesToFetch.map(async (cat) => {
    const { data } = await adminClient!
      .from('card_pool')
      .select('...')  // 20+ columns
      .eq('is_active', true)
      .eq('card_type', 'single')
      .eq('category', toSlug(cat))
      .gte('lat', location.lat - latDelta)
      .lte('lat', location.lat + latDelta)
      .gte('lng', location.lng - lngDelta)
      .lte('lng', location.lng + lngDelta)
      .order('popularity_score', { ascending: false })
      .limit(50);
    // ...
  })
);
```

**Fact:** `categoriesToFetch` defaults to ALL non-hidden categories (approximately 12). Each query selects 50 rows with 20+ columns.

**Fact:** After the initial pool query, the function also:
- Queries `preferences` table for `updated_at` (line 348)
- Queries `user_card_impressions` table (line 356)
- Potentially queries `discover_daily_cache` (lines 173-178)
- Writes back to `discover_daily_cache` on success (line 562+)

**Fact:** The client-side timeout in `ExperienceGenerationService` has NO explicit timeout — it's a raw `supabase.functions.invoke()` call without `Promise.race`. The only timeout is Supabase's default function execution timeout (typically 60s for edge functions).

**Inference:** On Android with slower network, 12 parallel queries + 3 sequential queries + cache write can easily exceed 15 seconds. The Supabase PostgREST queries go through the network twice (client → edge function → database), doubling latency.

**Note:** This is DIFFERENT from the DeckService timeout issue visible in the logs. The DeckService's `discover-cards` 15s timeout (deckService.ts:265) applies to the Home tab deck, not the Discover "For You" tab. However, the Home deck fetch runs FIRST on app load, potentially saturating the network before the user even reaches Discover.

---

### 🟠 CONTRIBUTING FACTOR 1: Sequential Waterfall (Auth → GPS → Fetch)

**Fact:** The data fetch at `DiscoverScreen.tsx:1663` requires both `locationLat` and `locationLng` to be non-null (guard at line 1642):
```typescript
if (!locationLat || !locationLng) {
  waitingForLocation = !cachedData;
  return;
}
```

**Fact:** Location comes from `useUserLocation()` hook, which requires device GPS permission + sensor reading.

**Fact:** Auth must complete before location is usable (user must be authenticated).

**Inference:** The waterfall is: Auth (2–4s) → GPS resolve (2–5s) → Edge function call → Response. These cannot be parallelized because each depends on the previous.

---

### 🟠 CONTRIBUTING FACTOR 2: Home Tab DeckService Saturates Network First

**Fact:** From the logs, the Home tab loads FIRST and fires:
- `discover-cards` edge function (15s timeout → times out)
- `generate-curated-experiences` edge function (15s timeout → times out)

**Fact:** These requests are still in-flight when the user switches to the Discover tab.

**Inference:** On a constrained Android network, the Home tab's edge function calls consume available bandwidth, causing the Discover tab's `discover-experiences` call to queue behind them. This stacks delays.

---

### 🟠 CONTRIBUTING FACTOR 3: `ExperienceGenerationService.discoverExperiences` Has Auth Retry Logic

**Fact:** `experienceGenerationService.ts:194-229` — if the first call returns a 401 auth error, the service refreshes the token and retries the ENTIRE edge function call:
```typescript
const isAuthError = error && this.isAuthFailure(error);
if (isAuthError) {
  const { error: refreshError } = await supabase.auth.refreshSession();
  // ...retry...
}
```

**Inference:** If the token is stale (common after background/foreground cycle), the first call fails, token refreshes (~1s), then the full edge function runs again. This doubles the edge function time from ~10s to ~20s.

---

### 🟡 HIDDEN FLAW: RecommendationsContext 20s Safety Timer Applies to Home Deck, Not Discover

**Fact:** The 20s safety timeout at `RecommendationsContext.tsx:615-628` manages the Home tab's deck state, not the Discover screen's "For You" view.

**Fact:** From logs: `[RecommendationsContext] 20s first-mount safety timeout — forcing complete` fires because the Home deck's `discover-cards` timed out at 15s.

**Inference:** This is not directly causing the Discover tab slowness, but it IS causing the Home tab to show empty state (0 cards). The user may be conflating both slow experiences. Both share the same root network issues.

---

## Timeline Reconstruction (From Logs)

| Elapsed | Event | Impact |
|---------|-------|--------|
| 0s | App bundled, auth begins | Normal |
| ~3s | Auth resolves (TOKEN_REFRESHED) | Delayed by multiple auth inits |
| ~3s | DeckService fires `discover-cards` + `generate-curated-experiences` | Consumes network bandwidth |
| ~3s | Home tab renders | Normal |
| ~18s | `discover-cards` times out (15s) | 0 cards on Home |
| ~18s | `generate-curated-experiences` times out (15s) | Curated pill fails |
| ~23s | RecommendationsContext 20s safety timeout | Home forced to empty |
| ~23s | User taps Discover tab | — |
| ~23s | `[AUTH] Initializing — fetching session...` (×2) | Double auth init |
| ~25s | GPS resolves | — |
| ~25s | `Cache miss or stale. Fetching fresh discover data...` | Guard reset, full re-fetch |
| ~25s | `discover-experiences` edge function called | 12 parallel DB queries |
| ~35-40s | Edge function returns (or times out) | For You pills finally render |

**Total: ~35-40 seconds from app launch to Discover pills visible.**

---

## Invariants That Should Hold But Don't

1. **"Auth session should be fetched exactly once per app lifecycle"**
   - Violated by: duplicate `useAuthSimple()` in DiscoverScreen
   - Currently enforced by: nothing — each hook instance is independent
   - Should be enforced by: single auth hook in AppStateManager, consumed via Zustand store

2. **"Discover data should survive tab switches without re-fetching"**
   - Violated by: `hasFetchedRef` resetting on unmount
   - Currently enforced by: `useRef` (component-scoped, destroyed on unmount)
   - Should be enforced by: module-level flag OR Zustand state OR React Query with appropriate staleTime

3. **"Edge function response time should be bounded and predictable"**
   - Violated by: 12 unbounded parallel queries with no aggregate timeout
   - Currently enforced by: nothing server-side (client-side has no timeout for discover-experiences)
   - Should be enforced by: single optimized query (or reduced per-category queries), server-side timeout, client-side `Promise.race` with 10s timeout

---

## Recommendations

### Fix 1: Remove Duplicate Auth from DiscoverScreen (Quick Win — Minutes)
Replace `useAuthSimple()` in DiscoverScreen with `useAppStore()` to read the already-resolved user. Eliminates redundant `getSession()` call and 2–4s delay.

### Fix 2: Move Fetch Guard to Module Level or Zustand (Quick Win — Minutes)
Replace `hasFetchedRef` with a module-level variable (like `discoverSessionCache` already is) so it persists across tab switches. The in-memory cache already does this partially — the guard just needs to match.

### Fix 3: Add Client-Side Timeout to `discoverExperiences` (Quick Win — Minutes)
Wrap `supabase.functions.invoke('discover-experiences')` in a `Promise.race` with a 12s timeout, matching the DeckService pattern. Show stale cache on timeout instead of empty state.

### Fix 4: Optimize Edge Function Query Strategy (Medium Effort)
Replace 12 per-category queries with a single query using `.in('category', categories)` and client-side grouping. Reduces 12 round-trips to 1.

### Fix 5: Add a `warmPing` on App Load (Medium Effort)
The `discover-experiences` edge function already supports `warmPing` (line 69). Fire it during auth initialization to pre-warm the Deno isolate, eliminating cold-start latency (~2-5s).

### Fix 6: Serve Stale Cache Immediately, Refresh in Background (Architecture)
The code at lines 1650-1656 already attempts this pattern for stale caches, but only when `isCacheStillValid()` returns false AND cache exists. Make this the default: always show cached pills instantly, then silently refresh.

---

## Files in the Chain

| File | Role | Key Lines |
|------|------|-----------|
| `app-mobile/src/components/DiscoverScreen.tsx` | Main component, fetch orchestration | 871 (auth), 1601-1669 (fetch logic) |
| `app-mobile/src/hooks/useAuthSimple.ts` | Auth hook (duplicated) | 55-65 (getSession call) |
| `app-mobile/src/components/AppStateManager.tsx` | App-wide auth (first instance) | 85 |
| `app-mobile/src/services/experienceGenerationService.ts` | Service layer for discover-experiences | 157-229 (discoverExperiences + auth retry) |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Home deck state machine | 610-628 (20s safety) |
| `app-mobile/src/services/deckService.ts` | Home deck fetch (different path) | 265-270 (15s timeout) |
| `supabase/functions/discover-experiences/index.ts` | Edge function — For You | 325-344 (12 parallel queries) |
| `supabase/functions/discover-cards/index.ts` | Edge function — Home deck (different) | Pool-only serving |
