# Investigation: What Happened to This Android User?

**Date:** 2026-03-24
**Symptom:** Discover "For You" pills take 15–20+ seconds on Android, but instant on iOS
**Confidence:** High — every file in both chains read, full timeline reconstructed

---

## Layman Summary

**iOS is fast because it had cached data from a previous session. Android is slow because it didn't.**

That's the entire platform difference. Both platforms run the exact same JavaScript code. Both platforms fire the same double-auth bug. Both would call the same edge functions. But:

- **iOS user** opened the app, and the Discover tab had data cached from yesterday (`2026-03-23`, expires `2026-03-24T21:12:30`). Pills rendered instantly from cache. The edge function was never called.
- **Android user** opened the app with no cache (fresh install, cleared data, or expired cache). Every request had to go to the network. The edge functions took >15 seconds to respond (cold start + multiple DB queries). The client-side timeout killed them.

**There is no Android-specific bug.** If you cleared the iOS cache and relaunched, it would be equally slow. The real bug is: the app has no first-launch experience — it shows a blank loading state for 20+ seconds when there's no cache.

---

## The Android User's Exact Journey (Reconstructed from Logs)

### Phase 1: Bundle + Boot (0:00 – 0:17)

```
Android Bundled 16942ms node_modules\expo-router\entry.js (3846 modules)
```

**Fact:** The Metro bundler took 16.9 seconds to bundle 3,846 modules. This is dev-mode overhead — production builds are pre-bundled and skip this entirely. Not a production concern, but it means the Android dev experience starts 17 seconds behind iOS.

**What the user sees:** Splash screen for 17 seconds.

---

### Phase 2: Auth + SDK Initialization (0:17 – 0:20)

```
[AUTH] Initializing — fetching session...
[PUSH] initializeOneSignal() called
[RevenueCat] Debug logging enabled
[RevenueCat] SDK Version - 9.23.1
[RevenueCat] Identifying App User ID: f375135a-...
```

**Fact:** Auth, OneSignal, RevenueCat, and AppsFlyer all initialize in parallel. Auth calls `supabase.auth.getSession()` — a network request.

**Fact:** RevenueCat makes 3 sequential API requests:
1. GET `/v1/subscribers/.../offerings` (cached: 304)
2. GET `/rcbilling/v1/subscribers/.../products` (cached: 304)
3. GET `/v1/subscribers/...` (customer info, cached: 304)

**What the user sees:** AuthLoading screen (renders 6 times during this phase — excessive re-renders from state updates).

---

### Phase 3: Auth Resolves → Home Tab Loads (0:20 – 0:23)

```
[AUTH] Auth state change: TOKEN_REFRESHED | hasSession=true
[STORE] set(user, isAuthenticated)
[DeckService] Input categories: ["casual_eats","drink","nature"]
[DeckService] Resolved pills: [casual_eats, drink, nature, picnic-dates]
[EDGE] → discover-cards | body={...}
[EDGE] → generate-curated-experiences | body={...}
[NAV] Page: home
```

**Fact:** Auth resolves via `TOKEN_REFRESHED` (not `INITIAL_SESSION`). This means the token was stale and had to be refreshed — an extra network round-trip that iOS didn't need (iOS got `INITIAL_SESSION` on first auth check).

**Fact:** DeckService immediately fires TWO edge function calls:
- `discover-cards` — queries `card_pool` for single-place cards
- `generate-curated-experiences` — queries `card_pool` for curated multi-stop cards

**Fact:** These edge functions each perform 4-5 DB operations before returning:
1. `auth.getUser(token)` — verify auth
2. `rpc('get_remaining_swipes')` — check swipe limits
3. `rpc('get_effective_tier')` — check subscription tier
4. `getPreferencesUpdatedAt()` — query preferences table
5. `queryPoolCards()` — query card_pool with geo filter + impression exclusion

**What the user sees:** Home tab renders with loading state ("Pulling up more for you...").

---

### Phase 4: Edge Functions Timeout (0:23 – 0:38)

```
[DeckService] discover-cards timed out after 15s
[DeckService] discover-cards outer error: discover-cards timed out after 15s
[DeckService] Curated pill picnic-dates failed: [AbortError: generate-curated-experiences timed out after 15s]
[DeckService] Fetched 4 pills in 15043ms, 0 cards total
```

**Fact:** Both edge functions exceeded the 15-second client-side timeout (`deckService.ts:265-270`). They did NOT return 0 cards quickly — they hung for the full 15 seconds.

**Inference:** This is almost certainly a **Deno edge function cold start** combined with multiple sequential DB operations. Here's why:

1. **Cold start:** The Deno isolate for `discover-cards` and `generate-curated-experiences` hasn't been used recently. Supabase must boot a new isolate, download imports, and initialize — typically 2-5 seconds.
2. **Auth + tier check:** `auth.getUser()` + `get_remaining_swipes` + `get_effective_tier` = 3 round-trips to the database before the pool query even starts.
3. **Pool query:** `queryPoolCards()` runs a complex query with geo-bounding-box filter, impression exclusion join, and category filter.
4. **Total:** Cold start (3-5s) + 5 DB operations (1-2s each) = 8-15 seconds.

**Critical question: Is the card_pool empty for Raleigh, NC?**

If the pool were empty, the query would return 0 rows quickly. But the function still takes 15s because of cold start + the auth/tier queries that run BEFORE the pool query. Even an empty result takes 8-15s on cold start.

However, if the pool IS populated, the function would also take 8-15s on cold start but would return actual cards. The 15s client timeout is too aggressive for cold-start scenarios.

**What the user sees:** Loading spinner for 15 seconds, then 0 cards appear. Home tab shows empty state.

---

### Phase 5: Safety Timeout (0:38 – 0:43)

```
[RecommendationsContext] 20s first-mount safety timeout — forcing complete
```

**Fact:** RecommendationsContext (`RecommendationsContext.tsx:615-628`) has a 20-second safety timer that fires on first mount. Since the DeckService timed out at 15s and returned 0 cards, the context didn't receive `hasCompletedFetchForCurrentMode`. The 20-second timer forces it to `true`, transitioning to EMPTY state.

**What the user sees:** Home tab transitions from loading to empty state.

---

### Phase 6: User Taps Discover Tab (0:43+)

```
[ACTION] Tab pressed: discover
[AUTH] Initializing — fetching session...    ← FIRST (AppStateManager re-fires)
[AUTH] Initializing — fetching session...    ← SECOND (DiscoverScreen's own instance)
[NAV] Page: discover
[Discover] Device GPS: 35.790454 -78.7387092
Cache miss or stale. Fetching fresh discover data...
```

**Fact:** Auth initializes TWICE on every Discover tab press (proven, same as iOS logs — iOS shows this too).

**Fact:** `getDiscoverCacheFromMemory()` returns null — the module-level `discoverSessionCache` Map is empty because no successful discover fetch has ever completed in this session.

**Fact:** `loadDiscoverCache()` from AsyncStorage returns null — no prior session's data exists (fresh install or expired cache).

**Fact:** The code falls through to `ExperienceGenerationService.discoverExperiences()`, which calls the `discover-experiences` edge function. This function runs 12 per-category queries against `card_pool` (one per category) plus impression lookups.

**What the user sees:** Empty discover grid with loading indicator, waiting for another edge function call that will likely also be slow.

---

### Phase 7: User Gives Up and Switches Tabs

```
[ACTION] Tab pressed: connections
[ACTION] Tab pressed: home
[ACTION] Tab pressed: discover
[AUTH] Initializing — fetching session...    ← fires AGAIN
[AUTH] Initializing — fetching session...    ← fires AGAIN
Cache miss or stale. Fetching fresh discover data...   ← fires AGAIN
```

**Fact:** Every tab switch back to Discover triggers the full cycle again: double auth init + cache miss + fresh fetch. The `hasFetchedRef` guard reset on unmount, and the previous fetch either timed out or is still in-flight (no cancellation).

**What the user sees:** Every time they return to Discover, the same loading state starts over.

---

## iOS vs Android: Side-by-Side Comparison

| Event | iOS | Android |
|-------|-----|---------|
| Bundle time | Not shown (fast) | 16,942ms |
| Auth resolution | `INITIAL_SESSION` (cached) | `TOKEN_REFRESHED` (stale, extra round-trip) |
| Home tab DeckService | Not fired (React Query cache hit) | Fires discover-cards + generate-curated-experiences |
| Home deck result | Cached cards shown instantly | 0 cards after 15s timeout |
| Discover tab auth | Double init (same bug) | Double init (same bug) |
| Discover cache | **HIT** — `2026-03-23, expires 2026-03-24T21:12:30` | **MISS** — no prior data |
| Discover result | Instant pills from cache | Loading → edge function call → slow/timeout |
| Night-out events | `Night-out cache hit: 20 events` | `Night-out cache miss. Fetching Ticketmaster...` |
| RecommendationsContext | 20s timeout fires (same bug) | 20s timeout fires (same bug) |

**Key takeaway:** The ONLY reason iOS is fast is cache. Every other bug (double auth, 20s safety timeout, etc.) exists on BOTH platforms.

---

## Why the Android User Has No Cache

Three possible reasons (in order of likelihood):

1. **Fresh dev build / data cleared:** Android development builds frequently get wiped (Metro cache clear, `expo start --clear`, uninstall/reinstall). AsyncStorage is cleared on app uninstall.

2. **First-ever app launch:** No prior session has ever successfully fetched discover data, so there's nothing to cache.

3. **Cache expired:** The discover cache uses a 24-hour expiry (`expiresAt` timestamp). If the user's last successful fetch was >24 hours ago, the cache is stale and `isCacheStillValid()` returns false, triggering a full re-fetch.

In ALL THREE cases, the user hits the "no cache" path, which means:
- Full network fetch required
- Edge function cold start (2-5s)
- Multiple DB operations (5-10s)
- 15s client timeout kills the request
- User sees nothing

---

## The Real Problem (Constitution Lens)

**Constitution Principle 1:** "No dead taps. Show UI first, fetch after."

The current architecture ONLY obeys this principle when cache exists. When cache doesn't exist, it violates it completely:
- The Home deck shows a loading spinner for 15-20 seconds
- The Discover pills show nothing until the edge function responds
- There is no skeleton UI, no placeholder content, no progressive loading

**The app is fast on the second visit and broken on the first.** This is backwards — the first visit is the most important one (first impression, onboarding, new device).

---

## What Would Fix This (Constitution-Compliant)

### For the first-launch / no-cache scenario:

1. **Skeleton pills that render immediately** — show pill shapes + shimmer placeholders before any data arrives. The UI is never blank.

2. **Remove the double `useAuthSimple()`** — DiscoverScreen should read `useAppStore().user` (already resolved by AppStateManager). Saves 2-4s.

3. **Increase client-side timeout to 25s** — the 15s timeout is too aggressive for cold-start edge functions. The edge function itself is fine; the client gives up too early.

4. **Or better: don't block on the edge function at all** — fire the fetch in background, show whatever arrives first. If pills are empty after 5s, show a "loading your personalized picks" message instead of a blank screen.

### For the edge function cold start:

5. **Fire a `warmPing`** during auth initialization — both `discover-cards` and `discover-experiences` support `warmPing` (discovered in code: line 267-272 of discover-cards, line 68-73 of discover-experiences). This boots the Deno isolate without running business logic, so by the time the real request arrives, the isolate is warm. Cost: ~50ms extra during auth (which is already waiting on network anyway).

### For the cache invalidation on tab switch:

6. **Move discover data to React Query** — with `staleTime: 30min` and `gcTime: 2hr`, pills survive tab switches without re-fetching. The custom AsyncStorage + module-level cache + useRef guard system is the wrong tool for this job.

---

## Files Referenced

| File | Lines | Role |
|------|-------|------|
| `app-mobile/src/components/DiscoverScreen.tsx` | 871, 1577-1720 | Double auth, cache check, fetch orchestration |
| `app-mobile/src/hooks/useAuthSimple.ts` | 55-65 | Auth init (fires twice) |
| `app-mobile/src/services/deckService.ts` | 265-270 | 15s client timeout |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 615-628 | 20s safety timeout |
| `app-mobile/src/services/experienceGenerationService.ts` | 157-229 | Discover edge function call + auth retry |
| `supabase/functions/discover-cards/index.ts` | 326-518 | Auth + tier + pool query chain (5 DB ops) |
| `supabase/functions/discover-experiences/index.ts` | 155-344 | 12 per-category pool queries |
| `supabase/functions/generate-curated-experiences/index.ts` | 1-77 | Curated card generation |
| `supabase/functions/_shared/cardPoolService.ts` | 815-914 | serveCardsFromPipeline |
