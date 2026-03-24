# Domain Architecture Decision Records

> These ADRs document the ownership model for domains that have historically
> drifted. They are binding — violations require an ADR amendment, not a hack.
>
> Established: 2026-03-23 (Launch Hardening Program)

---

## ADR-001: Block State

**Status:** Active

| Aspect | Detail |
|--------|--------|
| **Source of truth** | `blocked_users` table + RLS policies (server) |
| **Client cache** | React Query via `friendsKeys.blocked(userId)` — synchronous lookup |
| **Server role** | RLS enforces message/profile access. `has_block_between` RPC for bidirectional check. |
| **Client role** | Cached block list for instant UX decisions. Background RPC for "they blocked me" detection. |

**Lifecycle:**
- Loaded on mount, refreshed on resume via `friendsKeys.all` invalidation
- Block/unblock actions invalidate `friendsKeys.all` immediately
- Background bidirectional check guarded by `latestSelectedChatRef`

**Failure rules:**
- Block check failure defaults to unblocked (server enforces at send time)
- Block RPC wrapped in `withTimeout(5000)`

**Forbidden:**
- Awaiting block RPC before opening any UI
- Maintaining a second block list in Zustand or useState
- Trusting client block state as a security boundary

---

## ADR-002: Subscription Tier

**Status:** Active (TRANSITIONAL — "take highest of 3" model)

| Aspect | Detail |
|--------|--------|
| **Source of truth** | `get_effective_tier()` RPC (server) |
| **Client cache** | `useEffectiveTier()` combines 3 sources (RevenueCat, Supabase subscriptions, server RPC) with 60s staleTime. Takes highest. |
| **Server role** | Edge functions check tier before gated actions. RPC resolves admin overrides, paid subscriptions, trials, referrals. |

**Lifecycle:**
- All 3 sources refresh every 60 seconds (staleTime)
- Refreshed on resume via CRITICAL_QUERY_KEYS
- Purchase success updates RevenueCat cache immediately + sync to Supabase with retry

**Failure rules:**
- Sync failure after purchase: retry once after 2s, info toast on total failure
- Stale tier showing paid when free: max 60s window, gated actions revalidate

**Forbidden:**
- StaleTime longer than 60 seconds on subscription queries
- Silent purchase sync failures (`.catch(() => {})`)
- Trusting client tier for security — server always verifies

**Transitional:** "Take highest of 3" model remains. Permanent fix: single server-authoritative tier RPC. Tracked in `TRANSITIONAL_ITEMS_REGISTRY.md`.

---

## ADR-003: Saved Cards / Query Keys

**Status:** Active

| Aspect | Detail |
|--------|--------|
| **Source of truth** | `saved_experiences` table (server) |
| **Client cache** | React Query under `savedCardKeys.all` prefix (`['savedCards']`). One factory in `queryKeys.ts`. |
| **Server role** | CRUD on saved_experiences. Realtime subscription pushes changes. |

**Lifecycle:**
- 3 sub-queries (list, saves, paired) all under one prefix
- All mutations invalidate `savedCardKeys.all` — reaches every sub-query
- Realtime sync (`useSavesRealtimeSync`) also invalidates `savedCardKeys.all`
- Refreshed on resume via CRITICAL_QUERY_KEYS

**Failure rules:**
- Save/unsave has optimistic update with rollback on error
- Remove has optimistic removal with rollback

**Forbidden:**
- Creating a new query key for saved cards outside `savedCardKeys` factory
- Inline `["savedCards", ...]` string literals anywhere except `queryKeys.ts`
- Invalidating a sub-key without also invalidating the parent when a mutation runs

---

## ADR-004: Notifications / Unread Counts

**Status:** Active

| Aspect | Detail |
|--------|--------|
| **Source of truth** | `notifications` table (server), `messages` + `message_reads` tables (server) |
| **Client cache** | React Query via `notificationKeys`. Realtime subscriptions for INSERT/UPDATE/DELETE. |
| **Badge** | OneSignal manages badge count. Incremented by push payload, cleared on last-read and markAllAsRead. |

**Lifecycle:**
- Notifications: realtime INSERT/UPDATE/DELETE → optimistic cache update
- DM unread: `message_reads` INSERT listener invalidates `['conversations']`
- Badge: `clearAll()` when unread reaches 0 or markAllAsRead called

**Failure rules:**
- markAsRead failure: rollback optimistic update, re-invalidate
- Badge SDK limitation: `setBadgeCount()` not available in OneSignal RN v5 — documented

**Forbidden:**
- Computing unread counts without a realtime subscription
- Updating notification DB without updating React Query cache
- Silent catch on notification read operations

---

## ADR-005: Preferences / Profile Ownership

**Status:** Active

| Aspect | Detail |
|--------|--------|
| **Source of truth** | `preferences` table (server), `profiles` table (server) |
| **Preferences cache** | React Query (`['userPreferences', userId]`, 60s staleTime) + offlineService AsyncStorage (read-only fallback) |
| **Profile cache** | Zustand (runtime + persisted for cold-start UI) + realtime listener for push updates |

**Lifecycle:**
- Preferences: fetched on mount, refreshed every 60s, offline fallback from AsyncStorage
- Profile: persisted in Zustand for instant cold-start, fresh fetch always fires on mount, realtime updates in-place
- Onboarding: preferences saved atomically at completion (single write, retry on failure)
- Category change: invalidates `['deck-cards']` + `['userPreferences']` immediately

**Failure rules:**
- Onboarding save failure: user sees retry UI, cannot proceed with stale defaults
- Preference write failure: thrown (not masked), caller handles

**Forbidden:**
- Storing preferences in Zustand (dead field removed — do not re-add)
- Mid-onboarding server preference writes (removed — single atomic save at end)
- `PreferencesService.updateUserPreferences` returning false on error (must throw)
- Profile mount effect skipping fresh fetch when persisted data exists

---

## ADR-006: Service Error Contracts

**Status:** Active (TRANSITIONAL)

**Current state:** 4 service functions return `null`/`[]`/fallback on error instead of throwing. Consumers cannot distinguish "no data" from "fetch failed." All marked with `[TRANSITIONAL]` logging.

**Target state:** All service functions either throw or return `ServiceResult<T> = {data, error}`. Consumers render distinct error vs. empty states.

**Affected functions:**
- `PreferencesService.getUserPreferences()` → returns `null`
- `friendsService.fetchFriends()` → partial mask (second query)
- `experiencesService.getExperiences()` → returns `[]`
- `experiencesService.getRecommendations()` → falls back to basic query

**Forbidden:**
- New service functions that return `null`/`[]` on error without `[TRANSITIONAL]` logging and a header comment
- Removing `[TRANSITIONAL]` tags without completing the `ServiceResult<T>` migration
- `fetchAllExperiences()` mock data fallback being re-enabled or consumed
