# Fix Spec: Discover "For You" Sub-1-Second Response

**Date:** 2026-03-24
**Root cause:** `discover-experiences` edge function makes 5 sequential await points (including 12 parallel per-category queries) instead of 1 bulk query. Combined with cold-start latency, this exceeds client timeouts.
**Goal:** Return 12 cards in <1 second on warm isolate, <3 seconds on cold start.

---

## Constitution Compliance

| Principle | How This Spec Obeys It |
|-----------|----------------------|
| **1. No dead taps** | Client shows skeleton pills immediately, fetches in background |
| **2. One owner per truth** | Remove duplicate `useAuthSimple()` from DiscoverScreen — auth owned by AppStateManager only |
| **5. Server state stays server-side** | Replace custom AsyncStorage cache with React Query (staleTime/gcTime) |
| **8. Subtract before adding** | Remove 12 per-category queries, remove custom cache system, remove duplicate auth — don't add workarounds |

---

## Change 1: Consolidate 12 Queries Into 1 (Edge Function)

**File:** `supabase/functions/discover-experiences/index.ts`
**Lines:** 316–344

**Current code (12 parallel queries):**
```typescript
await Promise.all(
  categoriesToFetch.map(async (cat) => {
    const { data } = await adminClient!
      .from('card_pool')
      .select('id, google_place_id, title, category, ...')
      .eq('is_active', true)
      .eq('card_type', 'single')
      .eq('category', toSlug(cat))
      .gte('lat', location.lat - latDelta)
      .lte('lat', location.lat + latDelta)
      .gte('lng', location.lng - lngDelta)
      .lte('lng', location.lng + lngDelta)
      .order('popularity_score', { ascending: false })
      .limit(50);
    if (data && data.length > 0) {
      allPoolCards = allPoolCards.concat(data);
    }
  })
);
```

**New code (1 query):**
```typescript
const categorySlugs = categoriesToFetch.map(toSlug);

const { data: allPoolCards_raw } = await adminClient
  .from('card_pool')
  .select('id, google_place_id, title, category, image_url, images, rating, review_count, price_min, price_max, price_tier, lat, lng, opening_hours, address, website, description, highlights, base_match_score, popularity_score')
  .eq('is_active', true)
  .eq('card_type', 'single')
  .in('category', categorySlugs)
  .gte('lat', location.lat - latDelta)
  .lte('lat', location.lat + latDelta)
  .gte('lng', location.lng - lngDelta)
  .lte('lng', location.lng + lngDelta)
  .order('popularity_score', { ascending: false })
  .limit(categoriesToFetch.length * 50);

let allPoolCards: any[] = allPoolCards_raw || [];
```

**Why:** One PostgREST round-trip instead of twelve. Same result set — the per-category `findBestForCategory()` logic downstream already groups by category slug. The `ORDER BY popularity_score DESC` ensures the best card per category is found first.

**Performance impact:** ~200ms instead of ~500ms for this step.

---

## Change 2: Parallelize Auth + Cache Lookup (Edge Function)

**File:** `supabase/functions/discover-experiences/index.ts`
**Lines:** 154–270

**Current code (sequential):**
```typescript
// Step 1: Auth (AWAIT)
const { data: authData } = await authClient.auth.getUser(token);
userId = authData.user?.id || null;

// Step 2: Cache lookup (AWAIT) — blocked by step 1
const { data: cachedRows } = await adminClient
  .from("discover_daily_cache")
  .select("...")
  .eq("user_id", userId)
  ...
```

Auth must complete before cache lookup because cache is keyed by `userId`. This is correct — no change here. But we CAN parallelize the auth call with the pool query by restructuring:

**New approach — early-return on cache, single-query pool:**

```typescript
// Step 1: Auth (AWAIT — unavoidable, need userId)
const { data: authData } = await authClient.auth.getUser(token);
userId = authData.user?.id || null;

if (userId) {
  adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Step 2+3: Cache lookup AND pool query IN PARALLEL
  const [cacheResult, poolResult, prefResult, impResult] = await Promise.all([
    // Cache lookup
    adminClient
      .from("discover_daily_cache")
      .select("id, cards, featured_card, generated_location, expires_at, all_place_ids, previous_batch_place_ids, us_date_key")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    // Pool query (single consolidated query from Change 1)
    adminClient
      .from('card_pool')
      .select('id, google_place_id, title, category, image_url, images, rating, review_count, price_min, price_max, price_tier, lat, lng, opening_hours, address, website, description, highlights, base_match_score, popularity_score')
      .eq('is_active', true)
      .eq('card_type', 'single')
      .in('category', categorySlugs)
      .gte('lat', location.lat - latDelta)
      .lte('lat', location.lat + latDelta)
      .gte('lng', location.lng - lngDelta)
      .lte('lng', location.lng + lngDelta)
      .order('popularity_score', { ascending: false })
      .limit(categoriesToFetch.length * 50),
    // Preferences timestamp
    adminClient
      .from('preferences')
      .select('updated_at')
      .eq('profile_id', userId)
      .maybeSingle(),
    // Impressions
    adminClient
      .from('user_card_impressions')
      .select('card_pool_id')
      .eq('user_id', userId),
  ]);

  // If cache hit → return immediately (existing logic, unchanged)
  const cachedRows = cacheResult.data;
  if (cachedRows && cachedRows.length > 0) {
    // ... existing cache hit logic (lines 182-268) ...
  }

  // Otherwise, use poolResult + prefResult + impResult
  // ... existing filtering/scoring logic ...
}
```

**Why:** Currently the function does: auth → cache → pool → prefs → impressions (5 sequential awaits). This restructures to: auth → (cache + pool + prefs + impressions in parallel). That's 2 sequential awaits instead of 5.

**Performance impact on warm isolate:**
- Before: auth(150ms) + cache(150ms) + pool(300ms) + prefs(100ms) + impressions(100ms) = **~800ms**
- After: auth(150ms) + max(cache, pool, prefs, impressions)(~300ms) = **~450ms**

**Caveat:** The impressions query currently uses `prefUpdatedAt` from the preferences query (`.gte('created_at', prefUpdatedAt)`). To parallelize, we fetch ALL impressions and filter in JS, or we drop the `prefUpdatedAt` filter from the impressions query (which only affects impression-scoped filtering — a minor behavioral change that should be explicitly decided).

**Simpler alternative:** Keep prefs → impressions sequential, but parallelize cache + pool:
```
auth → Promise.all(cache, pool) → prefs → impressions
```
This is 4 sequential awaits → 3, still a meaningful improvement with zero behavioral change.

---

## Change 3: Remove Duplicate Auth from DiscoverScreen (Client)

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Line:** 871

**Current:**
```typescript
const { user } = useAuthSimple();
```

**New:**
```typescript
const { user } = useAppStore();
```

**Why:** `useAuthSimple()` fires `supabase.auth.getSession()` on mount — a network call. The user is already resolved by AppStateManager's `useAuthSimple()` instance and stored in Zustand. Reading from Zustand is synchronous (0ms). Constitution Principle 2: one owner per truth.

**Also update the import:** Remove `useAuthSimple` from imports (line 29), add `useAppStore` if not already imported.

**Verification:** After change, `[AUTH] Initializing — fetching session...` should appear exactly ONCE in logs on app boot, never on tab switch.

---

## Change 4: Fire warmPing on App Boot (Client)

**File:** `app-mobile/src/components/AppStateManager.tsx`
**Location:** Inside the component, after auth initializes

**Add:**
```typescript
// Pre-warm edge function isolates during auth init (fire-and-forget)
useEffect(() => {
  const warmFunctions = ['discover-experiences', 'discover-cards'];
  warmFunctions.forEach(fn => {
    supabase.functions.invoke(fn, { body: { warmPing: true } }).catch(() => {});
  });
}, []);
```

**Why:** The `discover-experiences` and `discover-cards` edge functions already support `warmPing` (lines 68-73 and 267-272 respectively). A `warmPing` boots the Deno isolate without running business logic. By firing this during auth initialization (which is already waiting on network), the isolate is warm by the time the real request arrives.

**Performance impact:** Eliminates 2-5 second cold-start penalty on first edge function call.

**Alternative considered:** There's already a `keep-warm` edge function (`supabase/functions/keep-warm/index.ts`) that warms 6 functions. But calling it requires an extra edge function invocation (itself subject to cold start). Direct warm pings from the client are faster and more reliable.

---

## Change 5: Add Client-Side Timeout to discoverExperiences (Client)

**File:** `app-mobile/src/services/experienceGenerationService.ts`
**Lines:** 186-192

**Current (no timeout):**
```typescript
({ data, error } = await supabase.functions.invoke(
  "discover-experiences",
  { body }
));
```

**New (10s timeout):**
```typescript
let fetchTimer: ReturnType<typeof setTimeout> | undefined;
const timeoutPromise = new Promise<never>((_, reject) => {
  fetchTimer = setTimeout(() => {
    reject(new Error('discover-experiences timed out after 10s'));
  }, 10000);
});

try {
  ({ data, error } = await Promise.race([
    supabase.functions.invoke("discover-experiences", { body }),
    timeoutPromise,
  ]));
} finally {
  clearTimeout(fetchTimer);
}
```

**Why:** Currently `discoverExperiences` has zero timeout protection. If the edge function hangs, the client waits forever. The DeckService already uses this exact pattern (deckService.ts:265-270) with a 15s timeout. 10 seconds is appropriate here because:
- Warm isolate should respond in <1s (after Changes 1+2)
- Cold isolate with warmPing (Change 4) should respond in <3s
- 10s provides generous headroom without leaving the user staring at a blank screen

---

## Change 6: Show Skeleton Pills Immediately (Client)

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Location:** The rendering section where pills/grid are displayed

**Current behavior:** When `discoverLoading` is true AND no cache exists, the component shows a loading spinner or empty state. The user sees nothing useful.

**New behavior:** Render 12 skeleton pill placeholders (shimmer cards) immediately on mount, BEFORE any data arrives. When data loads, crossfade from skeleton to real pills.

**Implementation:** Add a skeleton grid component that renders when `discoverLoading && recommendations.length === 0`:

```typescript
// In the render section, replace the empty loading state:
{discoverLoading && recommendations.length === 0 && (
  <DiscoverSkeletonGrid count={12} />
)}
```

The `DiscoverSkeletonGrid` component renders 12 shimmer placeholder cards matching the exact dimensions and layout of real cards. This is a standard React Native pattern using `Animated` opacity cycling.

**Why:** Constitution Principle 1 — "Show UI first, fetch after." The user sees immediate visual feedback that content is loading. The perceived wait time drops dramatically even if actual fetch time is unchanged.

---

## Expected Performance After All Changes

### Warm Isolate (Second+ Request)
| Step | Before | After |
|------|--------|-------|
| Auth (getUser) | 150ms | 150ms |
| Cache lookup | 150ms (sequential) | 150ms (parallel with pool) |
| Pool query | 500ms (12 queries) | 200ms (1 query, parallel with cache) |
| Prefs + Impressions | 200ms (sequential) | 200ms (sequential after parallel block) |
| **Total** | **~1,000ms** | **~550ms** |

### Cold Isolate (First Request)
| Step | Before | After |
|------|--------|-------|
| Deno cold start | 2-5s | 0s (warmPing during auth) |
| Auth + queries | ~1,000ms | ~550ms |
| **Total** | **~3-6s** | **~550ms** |

### Client-Side
| Step | Before | After |
|------|--------|-------|
| Duplicate auth init | 2-4s | 0s (removed) |
| UI visible | 15-20s (loading spinner) | 0s (skeleton pills) |
| Real data visible | 15-20s+ | ~1-2s |

---

## Migration Plan

### Deploy Order
1. **Change 1 + 2** (edge function) — deploy first. Zero client impact, backward compatible. The response format is identical.
2. **Change 3 + 4** (client: remove duplicate auth, add warmPing) — next app build. No server dependency.
3. **Change 5** (client: timeout) — same build as 3+4.
4. **Change 6** (client: skeleton UI) — can ship with 3+4+5 or separately.

### Rollback
- Changes 1+2: Revert edge function deployment. No data migration needed.
- Changes 3-6: Revert app build. No server dependency.

### Testing

**Change 1 (single query):**
- Verify same cards returned for Raleigh, NC location (lat: 35.79, lng: -78.74)
- Verify per-category coverage is maintained (best card per category, not top-N across all)
- Verify empty pool returns empty response (not error)
- Check edge function logs for response time — should show <500ms on warm

**Change 2 (parallel queries):**
- Verify cache hit still returns early (short-circuit before pool result is used)
- Verify impressions are correctly filtered (same cards excluded as before)

**Change 3 (remove duplicate auth):**
- Verify `[AUTH] Initializing — fetching session...` appears exactly once on app boot
- Verify Discover tab still has access to `user` object for feature gating
- Verify `usePairingPills(user?.id)` and `useIncomingPairRequests(user?.id)` still work

**Change 4 (warmPing):**
- Verify edge function logs show `warmPing` requests on app boot
- Verify first real request to `discover-experiences` responds in <3s (no cold start)

**Change 5 (client timeout):**
- Simulate slow edge function (add 15s delay in dev)
- Verify client gets timeout error after 10s, not infinite hang
- Verify auth-retry logic still works (401 → refresh → retry, each attempt has its own 10s window)

**Change 6 (skeleton UI):**
- Verify skeleton pills render on first frame of Discover tab
- Verify crossfade to real pills when data arrives
- Verify skeleton disappears when cache provides instant data

---

## Files Touched

| File | Change |
|------|--------|
| `supabase/functions/discover-experiences/index.ts` | Changes 1, 2 — single query, parallel awaits |
| `app-mobile/src/components/DiscoverScreen.tsx` | Changes 3, 6 — remove useAuthSimple, add skeleton |
| `app-mobile/src/components/AppStateManager.tsx` | Change 4 — add warmPing on boot |
| `app-mobile/src/services/experienceGenerationService.ts` | Change 5 — add 10s timeout |
| `app-mobile/src/components/DiscoverSkeletonGrid.tsx` | Change 6 — new component (skeleton pills) |
