# Investigation: Session Deck & Holiday Card Latency

**Date:** 2026-03-24
**Symptom:** Paired person view, standard upcoming holiday, and custom holiday cards take >1s to return. Logs show first `generate-session-deck` call at 1936ms. Massive `friends.requests` query spam (50+ identical queries).
**Confidence:** HIGH — traced full chain from component → hook → edge function → DB

---

## Summary of Root Causes

Three independent issues compound into perceived slowness:

1. **Duplicate edge function calls** — `useBoardSession` fires a raw `supabase.functions.invoke()` AND `useSessionDeck` React Query fires the same call simultaneously
2. **Edge function is a 4-hop sequential waterfall** — auth → participant check → prefs load → cache check → location fallback (3 more queries) → 2 sub-function HTTP calls
3. **`friends.requests` query spam** — 50+ identical queries from `useForegroundRefresh` invalidating the entire `friendsKeys.all` family across 10+ mounted components

---

## ROOT CAUSE 1: Duplicate `generate-session-deck` Calls

**Fact:** [useBoardSession.ts:323](app-mobile/src/hooks/useBoardSession.ts#L323) fires a raw `supabase.functions.invoke("generate-session-deck")` on every `onPreferencesChanged` realtime event — outside React Query, fire-and-forget.

**Fact:** [RecommendationsContext.tsx:433](app-mobile/src/contexts/RecommendationsContext.tsx#L433) simultaneously enables `useSessionDeck()` which calls the exact same edge function via React Query.

**Evidence from logs:**
```
[EDGE] → generate-session-deck | body={"sessionId":"609e...","batchSeed":0}
[EDGE] ← generate-session-deck OK 1936ms    ← First call (cache miss)
[EDGE] → generate-session-deck | body={"sessionId":"609e...","batchSeed":0}
[EDGE] ← generate-session-deck OK 441ms     ← Second call (cache hit)
```

**Inference:** The raw invoke in `useBoardSession` is a legacy remnant. It duplicates the React Query path, wastes a round-trip, and the result is thrown away (no state update from it).

**Fix:** Remove the raw `supabase.functions.invoke` call from `useBoardSession.ts:322-328`. The `onDeckRegenerated` callback at line 335 already invalidates `["session-deck", sessionId]` which triggers `useSessionDeck` to refetch properly.

---

## ROOT CAUSE 2: Edge Function Sequential Waterfall (1936ms)

The `generate-session-deck` edge function performs **7 sequential database operations** before it can start generating cards:

| Step | Query | Estimated Time |
|------|-------|---------------|
| 1 | `auth.getUser(token)` — JWT validation | ~100-200ms |
| 2 | `session_participants` — verify membership | ~50-100ms |
| 3 | `board_session_preferences` — load all prefs | ~50-100ms |
| 4 | `computePreferencesHash()` — SHA-256 | ~5ms |
| 5 | `session_decks` — cache lookup | ~50-100ms |
| 6 | `collaboration_sessions` → `preferences` → `user_location_history` — location fallback (3 queries, sequential) | ~150-300ms |
| 7 | Two sub-function HTTP calls (`discover-cards` + `generate-curated-experiences`) — **in parallel** | ~800-1200ms |
| 8 | `session_decks` — version lookup + upsert | ~100-200ms |
| **Total** | | **~1400-2200ms** |

**Key bottlenecks:**

### A. Location fallback waterfall (lines 320-350)
When no participant has custom coordinates (GPS mode), the function does:
1. Query `collaboration_sessions` for `created_by` (~100ms)
2. Query `preferences` for creator's location settings (~100ms)
3. Query `user_location_history` for latest GPS (~100ms)

These 3 queries are **sequential** and only needed when `aggregated.location` is null. With GPS users (your case), this waterfall always fires.

### B. Sub-function HTTP calls
`discover-cards` and `generate-curated-experiences` are called via **HTTP fetch to the same Supabase functions endpoint**. Each call includes:
- HTTP overhead (~50-100ms network + TLS)
- Cold start penalty if isolate is cold (~200-500ms)
- Their own DB queries internally

Even though they run in parallel (`Promise.allSettled`), the slower one gates the response.

### C. Steps 1-5 are fully sequential
Auth → participant check → prefs load → hash → cache check. These cannot be parallelized because each depends on the previous, but steps 2 and 3 could run in parallel (both only need `sessionId`).

---

## ROOT CAUSE 3: `friends.requests` Query Storm

**Fact:** `useFriends()` hook is mounted in **10+ components simultaneously:**
- ConnectionsPage, FriendsModal, BlockedUsersModal, CreateSessionModal, OnboardingFlow, PairRequestModal, UserInviteModal, FriendRequestsModal, ProfilePage, AppStateManager

**Fact:** Each `useFriends()` call creates independent `useFriendRequests()`, `useFriendsList()`, and `useBlockedUsers()` query subscriptions.

**Fact:** `useForegroundRefresh` (line 199) invalidates `friendsKeys.all` on every resume >5s, which invalidates ALL friends-family queries across ALL mounted components.

**Fact:** `FRIENDS_STALE_TIME = 30_000` (30 seconds) — meaning after 30s, any component re-render triggers a refetch.

**Inference:** The 50+ `friends.requests` log entries are React Query correctly de-duplicating the actual network call (same query key = one fetch) but logging the subscription notification to each of the 10+ mounted observers. **This is not 50 network calls** — it's 50 cache-hit notifications.

**However:** The sheer volume of React Query observer notifications creates JS thread congestion during the critical window when the deck is trying to render. This delays card appearance.

---

## CONTRIBUTING FACTOR: Third `generate-session-deck` Call on App Resume

**Fact from logs:** A third identical call fires when the app resumes from background:
```
[LIFECYCLE] appState: inactive → active
[EDGE] → generate-session-deck | body={"sessionId":"609e...","batchSeed":0}
```

This is because `useForegroundRefresh` doesn't invalidate `session-deck` queries (intentionally excluded), but the `resumeCount` state change in `useForegroundRefresh` causes `RecommendationsContext` to re-render. If `useSessionDeck`'s data is stale (>30min), React Query's `focusManager` triggers a refetch on resume.

---

## CONTRIBUTING FACTOR: `[AUTH] Initializing — fetching session...` Spam

Every tab press triggers `[AUTH] Initializing — fetching session...` — sometimes twice per navigation. This suggests auth state is being re-initialized on every screen mount rather than being read from a stable context.

---

## Recommended Fixes (Priority Order)

### P0 — Remove duplicate edge function call
- Delete the raw `supabase.functions.invoke` at [useBoardSession.ts:322-328](app-mobile/src/hooks/useBoardSession.ts#L322-L328)
- The `onDeckRegenerated` handler at line 335 already handles cache invalidation
- **Impact:** Eliminates the duplicate 441ms call entirely

### P1 — Parallelize edge function steps 2+3
- Run `session_participants` check and `board_session_preferences` load concurrently with `Promise.all`
- **Impact:** Save ~50-100ms on every call

### P1 — Parallelize location fallback queries
- When `aggregated.location` is null, run the 3 location queries as a single RPC or at least batch `collaboration_sessions` + `preferences` into one query
- **Impact:** Save ~100-200ms on GPS-mode users

### P2 — Pre-warm sub-function isolates
- Add a `warmPing` call to `discover-cards` and `generate-curated-experiences` when the session is first opened (before preferences are submitted)
- The edge function already supports `warmPing` (line 201)
- **Impact:** Eliminate ~200-500ms cold start penalty

### P3 — Add `refetchOnWindowFocus: false` to `useFriendRequests`
- Friends data is refreshed by Realtime + `useForegroundRefresh` invalidation
- `refetchOnWindowFocus` causes redundant refetches on every app state change
- **Impact:** Reduce friends query noise during critical render window

---

## Invariants That Should Hold

1. **One call, one path:** A deck generation request must travel through exactly one code path (React Query), never duplicated by a parallel raw invoke
2. **Sequential only when dependent:** Edge function steps that don't depend on each other must run in parallel
3. **Location should be pre-resolved:** By the time `generate-session-deck` runs, location should already be in `board_session_preferences` — not requiring 3 fallback queries
