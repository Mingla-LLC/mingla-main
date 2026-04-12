# Investigation: Runtime Log Errors (Edge Timeouts, RevenueCat, Blocked Users)

**Date:** 2026-04-11
**Trigger:** User-reported log errors during normal app usage
**Confidence:** High — all conclusions backed by log timestamps + verified code

---

## Symptom Summary

User sees four categories of log output on resume from background:

1. RevenueCat "custom duration" DEBUG warnings
2. Edge function failures after ~275 seconds: `Failed to send a request to the Edge Function`
3. `fetchBlockedUsers` AbortError: `Network request timed out`
4. AppsFlyer `onInstallConversionDataLoaded` with no listeners

---

## Investigation Manifest

| File | Layer | Why |
|------|-------|-----|
| `app-mobile/src/services/supabase.ts` | Service | Global fetch timeout (20s) wrapping all Supabase calls |
| `app-mobile/src/hooks/useMapCards.ts` | Hook | Fires curated + singles edge function calls |
| `app-mobile/src/hooks/useForegroundRefresh.ts` | Hook | Resume lifecycle — invalidates queries on foreground |
| `app-mobile/src/services/friendsService.ts` | Service | `fetchBlockedUsers` wrapper |
| `app-mobile/src/services/blockService.ts` | Service | `getBlockedUsers` — actual Supabase queries |

All files read in full.

---

## Findings

### Finding 1: RevenueCat custom duration logs

**Classification:** Observation

RevenueCat SDK emits these DEBUG-level messages because packages use custom identifiers (`pro_yearly`, `pro_monthly`, `pro_weekly`) instead of RevenueCat's magic `$rc_annual`/`$rc_monthly`/`$rc_weekly` identifiers. The SDK is saying it can't auto-detect duration from the name.

**Impact:** Zero. Offerings load correctly (304 cached). CustomerInfo updates fine. The app references packages by identifier, not by duration type. This is working as designed.

**Action:** None required.

---

### Finding 2: Edge function zombie promises after background (ROOT CAUSE)

**Classification:** Root Cause

**File + line:** `app-mobile/src/services/supabase.ts:22-62` (fetchWithTimeout)
and `app-mobile/src/hooks/useMapCards.ts:103-177` (query functions)

**Exact code:**
```typescript
// supabase.ts:27
const TIMEOUT_MS = 20000;
// supabase.ts:54-58
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    controller.abort();
    reject(createAbortError('Network request timed out'));
  }, TIMEOUT_MS);
});
```

**What it does:** Every Supabase call (including edge function invocations) gets a 20-second hard timeout via `Promise.race`. When the app goes to background, iOS/Android suspends all network sockets. In-flight requests become zombies — the OS killed their TCP connections, but the JS promises are still pending. When the app resumes, these zombie promises eventually reject with `FunctionsFetchError`.

**What it should do:** In-flight requests should be cancelled when the app enters background, preventing zombie promise errors on resume.

**Causal chain:**
1. User opens app → edge function calls fire (curated experiences x3, discover-cards x1)
2. App goes to background (83s first time, 275s second time)
3. OS suspends network sockets → TCP connections die
4. App resumes → zombie promises reject after wall-clock timeout
5. Log shows `ERROR 275890ms` — this is wall-clock time including sleep, NOT actual request duration
6. `useForegroundRefresh` fires fresh requests → these succeed (1995ms, 3479ms, 3596ms)
7. Brief flash of empty state between zombie failure and fresh success

**Verification:** The logs prove this timeline:
- First batch errors at ~275890ms (includes background time)
- Second batch (from resume handler) succeeds at 1995-3596ms
- All 30 curated cards + 20 singles load perfectly on retry

**Severity:** Medium. Self-healing (resume handler works), but causes:
- Brief flash of empty cards during retry window
- Log noise that could pollute Sentry/error tracking
- Confusing developer experience

---

### Finding 3: fetchBlockedUsers timeout (CONTRIBUTING FACTOR)

**Classification:** Contributing Factor (same root cause as Finding 2)

**File + line:** `app-mobile/src/services/blockService.ts:108-165`

**What it does:** `getBlockedUsers()` makes TWO sequential Supabase queries (blocked_users table + profiles join). It inherits the 20-second global timeout from `supabase.ts`. No dedicated timeout wrapper.

**Note:** `isBlockedByUser` (line 207-240) and `hasBlockBetween` (line 246-278) both have `withTimeout(promise, 5000, ...)` wrappers, but `getBlockedUsers()` does NOT. This inconsistency isn't the cause here (the OS socket death is), but it's a pattern deviation.

**Impact:** Low. The function catches the error and returns `[]` — graceful degradation. Blocked users list is empty for this user anyway (`Array(0)`), so the stale empty result is identical to the fresh empty result.

---

### Finding 4: AppsFlyer listener race (OBSERVATION)

**Classification:** Observation

`Sending 'onInstallConversionDataLoaded' with no listeners registered` means AppsFlyer's native module emitted a conversion data event before the JS listener was registered. This is a common race condition in Expo apps during SDK initialization.

**Impact:** Zero for user-facing features. Only matters for install attribution tracking accuracy.

**Action:** None required unless debugging attribution.

---

## Five-Layer Cross-Check

| Layer | Finding 2 (Edge zombies) | Finding 3 (Blocked users timeout) |
|-------|--------------------------|-----------------------------------|
| **Docs** | No docs on background socket behavior | N/A |
| **Schema** | N/A (network layer) | N/A (network layer) |
| **Code** | `fetchWithTimeout` has no background-awareness | `getBlockedUsers` lacks dedicated timeout unlike siblings |
| **Runtime** | Logs confirm: zombie errors → fresh success on retry | Logs confirm: AbortError → subsequent success |
| **Data** | 30 curated + 20 singles load correctly after retry | `Array(0)` — empty either way |

**Contradiction:** None between layers. All layers agree on the mechanism.

---

## Blast Radius

- **Affected flows:** ALL edge function calls that are in-flight when backgrounding (curated, singles, discover-experiences)
- **Solo vs Collab:** Both equally affected (network layer, not mode-specific)
- **Admin dashboard:** Not affected (web app, no background/foreground lifecycle)
- **Query keys involved:** `map-cards-curated`, `map-cards-singles`, `friends.blocked`
- **Self-healing:** Yes — `useForegroundRefresh` invalidates all critical queries on resume

---

## Fix Strategy (direction only)

**Option A — Cancel on background (recommended):**
Add an `AbortController` per request batch. When `useForegroundRefresh` detects background transition, abort all in-flight controllers. This prevents zombie promises from ever reaching error state.

**Option B — Keep stale data visible during retry:**
React Query already preserves prior successful data during refetch. Ensure `placeholderData` or `keepPreviousData` is set so the brief retry window shows stale cards instead of empty state.

**Option C — Do nothing:**
The system self-heals. The errors are cosmetic (log noise + brief empty flash). If Sentry isn't alerting on these, the user impact is minimal.

---

## Discoveries for Orchestrator

1. `getBlockedUsers()` lacks the `withTimeout` wrapper that its siblings `isBlockedByUser` and `hasBlockBetween` have — pattern inconsistency (Hidden Flaw, low severity)
2. AppsFlyer SDK init ordering could be tightened if attribution accuracy matters in the future
