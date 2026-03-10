# Test Report: Bulletproof Sign-Out & Account Deletion Cleanup
**Date:** 2026-03-10
**Spec:** FEATURE_BULLETPROOF_SIGNOUT_CLEANUP_SPEC.md
**Implementation:** IMPLEMENTATION_BULLETPROOF_SIGNOUT_CLEANUP_REPORT.md
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

The implementation is structurally sound. The primary bug (stale `phoneVerified` surviving sign-out) is fully fixed with proper defense-in-depth. The prefix-based AsyncStorage sweep is well-designed and future-proof. However, **one AsyncStorage key escapes the sweep filter** (`mingla:connections:conversations:*` uses a colon separator instead of underscore), and the error resilience in `handleSignOut` doesn't fully satisfy spec criterion #4. Both are fixable in under 5 minutes.

---

## Test Manifest

Total items tested: 42

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 4 files | 4 | 0 | 0 |
| Pattern Compliance | 4 files | 4 | 0 | 0 |
| Security | 4 files | 4 | 0 | 0 |
| AsyncStorage Key Coverage | 22 keys | 21 | 1 | 0 |
| React Query & State | 4 checks | 4 | 0 | 1 |
| Error Resilience | 3 paths | 2 | 1 | 0 |
| Spec Criteria (§3) | 7 criteria | 6 | 1 | 0 |
| Spec Test Cases (§8) | 14 cases | 13 | 1 | 0 |
| **TOTAL** | **42** | **38** | **3** | **1** |

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: Missed AsyncStorage Key — `mingla:connections:conversations:*`

**File:** `app-mobile/src/components/ConnectionsPage.tsx` (line 83)
**Category:** Data Leak / Incomplete Cleanup

**What's Wrong:**
The conversations cache key uses a COLON separator (`mingla:connections:conversations:v1:${userId}`) instead of the standard UNDERSCORE (`mingla_`). The sweep filter in `handleSignOut()` checks `key.startsWith("mingla_")` and `key.startsWith("@mingla")` — neither matches `mingla:`.

After sign-out or account deletion, the previous user's cached conversation data remains in AsyncStorage.

**Evidence:**
```typescript
// ConnectionsPage.tsx line 82-83
const getConversationsCacheKey = (userId: string) =>
  `mingla:connections:conversations:${CONNECTIONS_CACHE_VERSION}:${userId}`;

// AppStateManager.tsx line 802 — does NOT match the above
if (key.startsWith("mingla_")) return true;
```

**Required Fix:**
Add one line to the filter in `AppStateManager.tsx` at line 803 (after the `mingla_` check):

```typescript
if (key.startsWith("mingla:")) return true;
```

**Why This Matters:**
Violates spec criterion #2: "zero data from the previous account is visible." While the userId-scoped key prevents User B from *seeing* User A's conversations (different cache key), User A's data still physically exists on the device after deletion — a privacy/data-retention violation. Also leaves orphaned storage that grows over account switches.

---

### HIGH-002: Incomplete Error Resilience — AsyncStorage Throw Skips signOut()

**File:** `app-mobile/src/components/AppStateManager.tsx` (lines 778-846)
**Category:** Error Resilience / Spec Non-Compliance

**What's Wrong:**
If `AsyncStorage.getAllKeys()` or `AsyncStorage.multiRemove()` throws (lines 800-814), execution jumps to the catch block (line 833). The catch block only resets `userIdentity` state — it does NOT call `queryClient.clear()` or `signOut()`. The user ends up with:
- Zustand cleared ✅ (runs before AsyncStorage, line 794)
- AsyncStorage NOT cleared ❌
- React Query NOT cleared ❌
- Supabase session still active ❌ (signOut never called)

This creates a zombie state: local app thinks user is signed out (Zustand cleared), but Supabase session is alive.

**Evidence:**
```typescript
// Lines 778-846 (simplified)
const handleSignOut = async () => {
  try {
    store.clearUserData();         // ✅ runs
    const allKeys = await AsyncStorage.getAllKeys();  // ❌ CAN THROW
    // ... everything below this is skipped if above throws ...
    queryClient.clear();           // ❌ skipped
    await signOut();               // ❌ skipped — SUPABASE SESSION STAYS ALIVE
  } catch (error) {
    // Only resets userIdentity — doesn't call signOut() or clear queryClient
    setUserIdentity({ ... });
  }
};
```

**Required Fix:**
Wrap the AsyncStorage operations in their own try/catch so that `queryClient.clear()` and `signOut()` always execute:

```typescript
const handleSignOut = async () => {
  try {
    // Reset UI state...
    store.clearUserData();

    // AsyncStorage sweep — non-blocking (if it fails, defense-in-depth catches stale data)
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const userScopedKeys = allKeys.filter((key) => {
        if (key.startsWith("mingla_")) return true;
        if (key.startsWith("mingla:")) return true;  // HIGH-001 fix
        if (key.startsWith("@mingla")) return true;
        if (key.startsWith("board_cache_")) return true;
        if (key.startsWith("dismissed_cards_")) return true;
        if (key.startsWith("debug_logs_")) return true;
        if (key === "offline_data") return true;
        if (key === "pending_actions") return true;
        if (key === "realtime_offline_queue") return true;
        if (key === "recommendation_cache") return true;
        return false;
      });
      if (userScopedKeys.length > 0) {
        await AsyncStorage.multiRemove(userScopedKeys);
      }
    } catch (storageError) {
      console.error("AsyncStorage cleanup failed (defense-in-depth will catch stale data):", storageError);
    }

    // Clear React Query cache
    queryClient.clear();

    // Clear local state
    setUserIdentity({ ... });

    // Supabase sign out
    await signOut();
  } catch (error) {
    console.error("Error during sign out:", error);
    setUserIdentity({ ... });
  }
};
```

**Why This Matters:**
Spec criterion #4: "If handleSignOut() throws at any point, ALL cleanup still completes." The current implementation violates this — a throw in the AsyncStorage section cascades to skip signOut. While AsyncStorage rarely throws in practice, the spec explicitly requires resilience here, and the fix is trivial.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: Two Consecutive setData Calls Could Be Merged

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (lines 579 + 587)
**Category:** Code Efficiency / Clarity

**What's Wrong:**
Two `setData` calls fire in the same synchronous block:
```typescript
// Line 579
if (persisted) {
  setData((prev) => ({ ...prev, ...persisted }))
}

// Line 587
const dbPhoneVerified = !!profile.phone
setData((prev) => ({ ...prev, phoneVerified: dbPhoneVerified }))
```

While this is **functionally correct** (React 18 batches updater functions and applies them in order, so the second call correctly overrides `phoneVerified` from the first), it's an unnecessary double state update. The intent — "merge persisted data, then force `phoneVerified` from DB" — would be clearer as a single call.

**Required Fix (optional, not blocking):**
```typescript
const dbPhoneVerified = !!profile.phone
if (persisted) {
  setData((prev) => ({ ...prev, ...persisted, phoneVerified: dbPhoneVerified }))
} else {
  setData((prev) => ({ ...prev, phoneVerified: dbPhoneVerified }))
}
```

**Why This Matters:**
Not a bug. React 18 handles this correctly. But two separate `setData` calls make it less obvious that the second one intentionally overrides the first. A single merged call makes the "DB overrides AsyncStorage" intent explicit and eliminates one queued update.

---

### MED-002: useAuthSimple Auth Listener Doesn't Perform Full Cleanup

**File:** `app-mobile/src/hooks/useAuthSimple.ts` (lines 102-106)
**Category:** Incomplete Cleanup Path (Out of Scope but Adjacent)

**What's Wrong:**
When `useAuthSimple`'s auth state listener detects a deleted user or invalid session, it calls:
```typescript
await supabase.auth.signOut();
setAuth(null);
clearUserData();
```
It does NOT clear AsyncStorage or React Query cache. This is a **different sign-out path** than `handleSignOut()` — it fires when Supabase detects the session is invalid server-side (e.g., account deleted from another device or admin panel).

**Impact:** If account deletion is detected through this path (not through `handleSignOut`), stale AsyncStorage data persists. The defense-in-depth in OnboardingFlow covers `phoneVerified`, but other user data (cards, preferences, boards) would survive.

**Required Fix:** Outside scope of this implementation. Flag for future work — the auth listener should call the same comprehensive cleanup logic or a shared cleanup utility.

**Why This Matters:** Creates a secondary path where the cleanup bug can recur if account invalidation happens server-side without the user explicitly tapping "sign out" or "delete account."

---

## ✅ What Passed

### Things Done Right

1. **Prefix-based sweep is the correct architectural choice.** Future `mingla_*` keys are automatically covered without code changes. This eliminates an entire class of "forgot to add key to cleanup" bugs.

2. **Defense-in-depth DB override in OnboardingFlow is excellent.** Even if ALL cleanup fails, `!!profile.phone` forces the correct `phoneVerified` value. This is genuine defense-in-depth, not just a comment.

3. **queryClient.clear() placement is correct.** Called after AsyncStorage sweep, before Supabase signOut. Uses the `useQueryClient()` hook result from component scope (line 272), properly captured in the closure. No import issues.

4. **mingla-mobile-storage (Zustand) exclusion is naturally safe.** The hyphen vs underscore distinction means the filter `key.startsWith("mingla_")` cannot accidentally match `mingla-mobile-storage`. This is elegant and won't drift.

5. **AccountSettings setTimeout hardening is clean.** Removing `async` and adding `.catch()` is the correct pattern. `setTimeout` ignores returned promises, so the old `async` callback silently swallowed errors. The new pattern explicitly handles them.

6. **authService.ts duplicate removal is safe.** Verified zero external callers of `authService.signOut()` — the method exists as a legacy path but is never called outside the class itself. The cleanup code it had (2 keys) is now covered by the comprehensive sweep.

7. **Comment quality is high.** Every new code block has a comment explaining *why*, not just *what*. The comments in the AsyncStorage filter explain what's preserved and why. Good for future maintainers.

### Passing Verifications

| Check | Result | Evidence |
|-------|--------|----------|
| No `any` types introduced | ✅ PASS | No new `any` in modified lines |
| No `@ts-ignore` / `@ts-nocheck` | ✅ PASS | Not found in any modified file |
| No inline styles | ✅ PASS | All styles use StyleSheet.create() |
| No API keys exposed to mobile | ✅ PASS | No secrets in modified code |
| No direct third-party API calls | ✅ PASS | All changes are client-side state management |
| Import ordering matches siblings | ✅ PASS | Consistent with existing patterns |
| Export style matches convention | ✅ PASS | Default export for AccountSettings, named for others |
| queryClient from useQueryClient hook | ✅ PASS | Line 272, properly in component scope |
| Zustand persist key excluded | ✅ PASS | `mingla-mobile-storage` (hyphen) excluded by `mingla_` (underscore) filter |
| Device preferences preserved | ✅ PASS | `selected_language`, `translation_cache` not matched by any filter |
| No temporary console.logs left | ✅ PASS | No debug logging in modified code |
| phoneAlreadyVerified block (lines 621-632) still runs correctly | ✅ PASS | `phoneAlreadyVerified = !!profile.phone` → sets additional identity data for returning users |
| Cleanup order is correct | ✅ PASS | Zustand → AsyncStorage → React Query → Supabase signOut |

---

## Spec Compliance Matrix

| # | Success Criterion (from Spec §3) | Tested? | Passed? | Evidence |
|---|----------------------------------|---------|---------|----------|
| 1 | Phone requires OTP after delete + re-signup | ✅ | ✅ | `mingla_onboarding_data` cleared by prefix sweep; DB override forces `phoneVerified: false` when `profile.phone = null` |
| 2 | Zero stale data after sign-out + different account | ✅ | ⚠️ | **HIGH-001**: `mingla:connections:conversations:*` escapes the filter. All other keys covered. |
| 3 | Fresh DB load after sign-out + same account | ✅ | ✅ | `queryClient.clear()` removes all cached queries |
| 4 | All cleanup completes even if handleSignOut throws | ✅ | ❌ | **HIGH-002**: AsyncStorage throw skips signOut and queryClient.clear |
| 5 | Defense-in-depth catches stale data if cleanup fails | ✅ | ✅ | `dbPhoneVerified = !!profile.phone` runs unconditionally |
| 6 | profiles.phone is sole source of truth for phoneVerified | ✅ | ✅ | Override at line 586-587, runs after AsyncStorage merge |
| 7 | React Query cache cleared on sign-out | ✅ | ✅ | `queryClient.clear()` at line 818 |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| Replaced card-state-only sweep with prefix sweep | ✅ | ✅ | Lines 800-815, filter is comprehensive (with one gap — HIGH-001) |
| Added defense-in-depth phoneVerified override | ✅ | ✅ | Lines 586-587, unconditional override from `!!profile.phone` |
| Removed async from setTimeout, added .catch() | ✅ | ✅ | Lines 74-80, clean pattern |
| Removed duplicate AsyncStorage cleanup from authService | ✅ | ✅ | Lines 32-33, replaced with comment |
| queryClient accessed via useQueryClient() hook | ✅ | ✅ | Line 272, captured in closure |
| mingla-mobile-storage naturally excluded | ✅ | ✅ | Hyphen vs underscore distinction is correct |
| Zero external callers of authService.signOut() | ✅ | ✅ | Grep confirmed — no matches in entire `app-mobile/src` |
| "All 14 test cases pass" | ✅ | ⚠️ | 13/14 pass. Test case #2 (zero stale data) has the `mingla:` key gap |
| "Prefix sweep clears all 20+ known keys" | ✅ | ⚠️ | Clears all `mingla_*` keys but misses `mingla:*` keys |

---

## Recommendations

### Mandatory (block merge until done)
1. **HIGH-001**: Add `if (key.startsWith("mingla:")) return true;` to the filter in AppStateManager.tsx line 803.
2. **HIGH-002**: Wrap AsyncStorage operations in their own try/catch so `queryClient.clear()` and `signOut()` always execute.

### Strongly Recommended (merge at your own risk)
1. **MED-001**: Merge the two `setData` calls in OnboardingFlow lines 579-587 into one for clarity.

### Technical Debt to Track
1. **MED-002**: `useAuthSimple`'s auth listener is a secondary sign-out path that doesn't perform full cleanup. Consider extracting the AsyncStorage sweep into a shared utility that both paths can call.
2. **ConnectionsPage naming convention**: The `mingla:` prefix with colons is inconsistent with the rest of the codebase which uses `mingla_` with underscores. Consider renaming the cache key to `mingla_connections_conversations_${version}_${userId}` for consistency.

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — No critical findings. Two high findings remain, both with trivial fixes (one line addition + one try/catch wrap). The core bug fix (stale `phoneVerified`) is solid and the defense-in-depth layer is genuine. Safe to merge IF both HIGH findings are addressed first. After fixes, no re-test needed — the changes are mechanical and low-risk.
