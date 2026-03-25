# Implementation Prompt: README Lock-In + Constitution Hardening + Codebase Documentation

**Skill:** Implementor
**Date:** 2026-03-25
**Scope:** README updates, constitution expansion, protective comments across the codebase. Zero logic changes.

---

## Part 1: Expand the Architecture Constitution in README.md

Read the current constitution (README.md → "Architecture Constitution" section — 8 principles). Expand it with lessons learned from this hardening session. Add these new principles:

### New Principle 9: No fabricated data
**"Never render hardcoded fallback values as if they were real data. Missing data = hidden or '—'. A fake '4.5' rating is worse than no rating."**

Why: Pass 1 found 5 hardcoded fake values (ratings, travel times, prices) displayed as real data across SavedTab, BoardSessionCard, SwipeableSessionCards.

### New Principle 10: Currency-aware everywhere
**"Every price display must use the user's currency via `useLocalePreferences()` or prop-threaded `currency`. No hardcoded `$` symbols."**

Why: Pass 1 found 7 of 10 price surfaces using hardcoded USD.

### New Principle 11: One auth instance
**"Only one component may call `useAuthSimple()` — the root AppStateManager. All other components read auth state from `useAppStore()` or receive it via props. Duplicate auth instances cause racing token refreshes that break Android."**

Why: 5 components were calling useAuthSimple(), creating 5 auth listeners, 5 getSession() calls, and 5 Realtime subscriptions. This poisoned Android's auth state mid-session.

### New Principle 12: Validate at the right time
**"Schedule validation checks the selected time, not the current time. Any time-dependent validation must use the user's chosen datetime, not `new Date()`."**

Why: Pass 3 found schedule checks using `isPlaceOpenNow()` before the user picked a time.

### New Principle 13: Exclusions must be consistent across all card-serving paths
**"Every card-serving function (discover-cards, discover-experiences, generate-curated-experiences) must apply the same exclusion filters: global type exclusions, per-category type exclusions, AND venue name keyword exclusions (`isChildVenueName`). Check the full `types` array, not just `primary_type`."**

Why: discover-cards was missing isChildVenueName(). generate-curated-experiences only checked primary_type.

### New Principle 14: Prefer persisted state for instant startup
**"On cold start, use Zustand-persisted state (profile, preferences, saved cards) to render immediately. Refresh from server in background. Gate on `_hasHydrated`, not network responses."**

Why: Android showed permanent loading screen because the profile gate waited for a network fetch that failed with an expired token. The profile was already persisted locally.

---

## Part 2: Add Behavioral Contracts to README.md

Add a new section after the constitution: **"## Behavioral Contracts"**

Document the verified behaviors from our hardening:

### Preferences → Deck Contract
```
- On preference change (solo): optimistic cache updated immediately, deck resets via
  preferencesRefreshKey bump, new cards fetched with new preferences. No invalidateQueries
  race — AppHandlers is the single owner.
- On preference change (collab): board_session_preferences updated in DB, session deck
  query invalidated via queryClient.invalidateQueries(['session-deck', sessionId]).
- Stale batch rejection: cached deck batches include prefsHash. On cold start, batches
  with non-matching hash are rejected (safe migration for old batches without hash).
```

### Save Contract
```
- On swipe-right: card removed from deck (optimistic), save fires.
  - Success: card stays removed, toast shown.
  - Failure: card rolls back into deck (removedCards Set delete), Alert shown by AppHandlers.
  - handleSaveCard returns Promise<boolean> — true on success/duplicate, false on failure.
```

### Schedule Validation Contract
```
- Hours validation occurs AFTER user picks a time, not before.
- Uses isPlaceOpenAt(weekdayText, selectedDateTime), not isPlaceOpenNow().
- Soft gate: Alert with "Schedule Anyway" option (hours data may be stale).
- Curated cards: each stop validated at estimated arrival time (cumulative duration + travel).
```

### Session Load Contract
```
- 6 queries in 1 parallel phase (was 11 queries in 3 sequential phases).
- Validation derived from Phase 1 data (no separate BoardErrorHandler queries).
- Saved cards + unread count fire at T=0 (not gated on validation).
- Expected: ~0.5s healthy, ~2s degraded.
```

### Auth Contract
```
- Single useAuthSimple() instance in AppStateManager. All others use useAppStore().
- On TOKEN_REFRESHED: invalidateQueries() retries all failed queries with new token.
- Cold start: 5s grace period prevents 3-strike forced sign-out during token refresh.
- Zustand _hasHydrated gate: app renders from persisted state immediately, refreshes
  in background. No "Getting things ready" blocking screen for returning users.
```

### Exclusion Contract
```
- All 3 card-serving functions apply: GLOBAL_EXCLUDED_PLACE_TYPES (type check),
  category_type_exclusions (DB table), isChildVenueName() (keyword check).
- Type checks scan full types[] array, not just primary_type.
- Curated stops: both stop types AND stop names checked.
```

### Card Display Contract
```
- Missing rating: hidden (no badge/text). Never show "0.0" or fake "4.5".
- Missing travel time: hidden. Never show "15m" or "12 min drive".
- Missing price: show "—" (em dash). Never show "$12-28".
- Star color: #fbbf24 on light backgrounds, white on dark/image overlays.
- Travel icon: getTravelModeIcon(travelMode) — car-outline for driving,
  bicycle for biking, bus-outline for transit, walk-outline for walking,
  navigate-outline for unknown/null.
- Currency: all price displays use user's currency via useLocalePreferences()
  or prop-threaded currency code. No hardcoded $ symbols.
```

---

## Part 3: Protective Comments Across the Codebase

Add `// RELIABILITY:` comments at every critical fix point. These comments explain WHY the code exists so future developers (human or AI) don't accidentally revert it.

### useAuthSimple.ts — TOKEN_REFRESHED handler
```typescript
// RELIABILITY: On TOKEN_REFRESHED, invalidate ALL React Query queries so they
// refetch with the new valid JWT. Without this, Android cold-start with expired
// token leaves all queries in permanent error state (they exhausted retry:1 with
// the old token and never retry). Also enter grace period to prevent 3-strike
// forced sign-out during the refresh window.
// See: LAUNCH_READINESS_TRACKER — "Token refresh / expiry handling"
```

### useAuthSimple.ts — grace period on init
```typescript
// RELIABILITY: Enter 401 grace period BEFORE getSession() on cold start.
// Android stored tokens are often expired. getSession() returns them as-is,
// queries fire with expired JWT, get 401s. The grace period prevents the
// 3-strike zombie auth handler from force-signing-out during the refresh window.
```

### appStore.ts — _hasHydrated flag
```typescript
// RELIABILITY: _hasHydrated is NOT persisted — starts false every cold start.
// Set to true by onRehydrateStorage callback. index.tsx gates on this to ensure
// the profile gate sees the hydrated profile value (not the default null).
// Without this, Android shows permanent "Getting things ready" screen because
// the profile network fetch fails with expired token but the persisted profile
// is available after rehydration.
```

### PreferencesSheet.tsx — where invalidateQueries was removed
```typescript
// RELIABILITY: DO NOT add invalidateQueries here. AppHandlers.handleSavePreferences
// already handles the transition via: (1) optimistic cache set for ["userPreferences"],
// (2) preferencesRefreshKey bump triggering deck reset, (3) deck history reset on hash
// change. Adding invalidateQueries(["userPreferences"]) here causes a RACE CONDITION:
// the server refetch returns OLD prefs (DB write is fire-and-forget and hasn't completed)
// and overwrites the optimistic cache. This was the root cause of the "wrong cards after
// preference change" bug. Proven from user logs: [QUERY] success userPreferences appeared
// BETWEEN Fetch #1 (correct, optimistic) and Fetch #2 (wrong, stale server data).
```

### useBoardSession.ts — collab prefs invalidation
```typescript
// RELIABILITY: Invalidate session deck after collab prefs save. Without this,
// the session deck query key ['session-deck', sessionId] never changes, staleTime
// is 30 minutes, and cached cards are served forever after preference changes.
// This matches the existing realtime handler pattern at line ~366.
```

### useBoardSession.ts — derived validation
```typescript
// RELIABILITY: Session validity and user permission are derived from Phase 1 data.
// Do NOT add separate BoardErrorHandler queries — they were the cause of 3 sequential
// redundant queries that added 600-1800ms to session load time. Phase 1 SELECT *
// already includes is_active, archived_at, created_by. Participants query includes
// user_id and has_accepted. Everything needed for validation is here.
```

### useBoardSession.ts — timeout handler
```typescript
// RELIABILITY: On 10s timeout, set sessionValid=false and hasPermission=false
// (not just loading=false). Without this, the loading gate in SessionViewModal
// shows an infinite spinner because sessionValid stays null.
```

### SwipeableCards.tsx — save rollback
```typescript
// RELIABILITY: Await onCardLike and check the boolean result. If false (save failed),
// remove card.id from removedCards Set so the card reappears in the deck. The user
// sees the Alert from AppHandlers and can try saving again. Without this rollback,
// a failed save = permanent card loss (not in saved, not in deck, not recoverable).
```

### SwipeableCards.tsx — PanResponder .catch()
```typescript
// RELIABILITY: .catch() on fire-and-forget handleSwipe call. Without this,
// any error in handleSwipe becomes an unhandled promise rejection.
```

### openingHoursUtils.ts — isPlaceOpenAt
```typescript
// RELIABILITY: isPlaceOpenAt checks a SPECIFIC datetime, not the current time.
// isPlaceOpenNow is a convenience wrapper that passes new Date().
// Schedule validation MUST use isPlaceOpenAt(hours, selectedDateTime) — checking
// current time would wrongly block scheduling for a future time when the place
// is open, or wrongly allow scheduling for a time when the place is closed.
```

### cardPoolService.ts — isChildVenueName filter
```typescript
// RELIABILITY: isChildVenueName() checks venue names against keyword patterns
// (kids, children, bounce, playground, etc.). This is the ONLY filter that catches
// kids venues with adult Google place types (e.g., "Kids Fun Zone Bowling" has
// types=['bowling_alley'] which passes all type-based exclusions). All 3 card-serving
// functions must apply this filter. See also: generate-curated-experiences checks
// both card-level names AND individual stop names.
```

### generate-curated-experiences/index.ts — full types array check
```typescript
// RELIABILITY: Check the FULL types[] array against exclusion lists, not just
// primary_type. A gym with primary_type='community_center' and types=['gym',
// 'community_center'] would pass a primary_type-only check. This was the cause
// of gyms appearing as curated experience stops.
```

### useDeckCards.ts — prefsHash matching
```typescript
// RELIABILITY: Match cached batches by prefsHash in addition to batchSeed +
// activePills. Without this, a batch cached with old price/travel/time preferences
// would be served on cold start if only categories matched. Old batches without
// prefsHash field are safely rejected (undefined !== hash → false).
```

### index.tsx — _hasHydrated gate
```typescript
// RELIABILITY: Gate on !_hasHydrated || isLoadingAuth. This ensures the profile
// gate at line ~1633 sees the Zustand-persisted profile value (from AsyncStorage
// rehydration) instead of the default null. Without this gate, Android cold start
// with expired token shows permanent "Getting things ready" because the profile
// network fetch fails but the persisted profile hasn't loaded yet.
```

### SavedTab.tsx, BoardSessionCard.tsx — no fabricated fallbacks
```typescript
// RELIABILITY: Conditionally render rating/travel/price — hide when missing.
// Do NOT add fallback values like || "4.5" or || "15m". Missing data = hidden.
// See Architecture Constitution Principle 9: "No fabricated data."
```

### All currency-aware components — useLocalePreferences
```typescript
// RELIABILITY: Price display uses user's currency via useLocalePreferences().
// Do NOT hardcode $ symbols. See Architecture Constitution Principle 10.
```

---

## Part 4: Update LAUNCH_READINESS_TRACKER.md

Update all items we resolved with final grades and evidence. Mark the full pipeline audit as complete.

---

## Rules

- ONLY add comments and README text. Do NOT change any logic or behavior.
- Comments use the `// RELIABILITY:` prefix for searchability.
- Keep comments concise but include the WHY and what breaks if removed.
- README contracts are plain English, not code.
- Do NOT add comments to files that weren't touched in this hardening session.
