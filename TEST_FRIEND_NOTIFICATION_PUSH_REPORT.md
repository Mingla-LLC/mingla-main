# 🔍 Test Report: Friend Request & Acceptance Push Notifications
**Date:** 2026-03-14
**Spec:** No formal spec — diagnosed from investigation
**Implementation:** `IMPLEMENTATION_FRIEND_NOTIFICATION_PUSH_REPORT.md`
**Tester:** Brutal Tester Skill
**Verdict:** 🔴 FAIL

---

## Executive Summary

The implementation adds friend-accepted push notifications and notification preferences checking — a sensible feature set with mostly clean code. However, it contains **1 critical security vulnerability** (no JWT authentication on the new edge function, allowing any caller to push arbitrary notifications to any user), **2 high-severity defects** (information disclosure in error responses, stale closure bug from missing dependency), and **3 medium findings** (pattern violations, missing deduplication). The critical finding alone blocks merge.

---

## Test Manifest

Total items tested: 38
| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 4 | 3 | 0 | 1 |
| Pattern Compliance | 6 | 3 | 3 | 0 |
| Security | 4 | 2 | 2 | 0 |
| Edge Functions | 10 | 7 | 3 | 0 |
| React Query & State | 4 | 3 | 1 | 0 |
| Mobile Push Handler | 5 | 4 | 0 | 1 |
| Spec Criteria | 7 | 7 | 0 | 0 |
| **TOTAL** | **40** | **29** | **9** | **2** |

---

## 🔴 Critical Findings (Must Fix Before Merge)

### CRIT-001: No JWT Authentication on `send-friend-accepted-notification`

**File:** `supabase/functions/send-friend-accepted-notification/index.ts` (lines 17-111)
**Category:** Security — Authentication Bypass

**What's Wrong:**
The new edge function has **zero authentication**. It uses the service role key internally but never validates the caller's JWT. Any actor who knows the edge function URL can send an arbitrary push notification to **any user** by providing any `senderId` and `accepterId`.

Compare with `send-collaboration-invite/index.ts` (lines 29-61), which:
1. Checks for `Authorization` header → returns 401 if missing
2. Creates a user-scoped Supabase client to validate the JWT → returns 401 if invalid
3. Enforces that the JWT user matches one of the payload IDs → returns 403 if not

The new function does **none of this**.

**Evidence:**
```typescript
// send-friend-accepted-notification/index.ts — entire auth section is MISSING
serve(async (req) => {
  if (req.method === "OPTIONS") { /* CORS */ }
  try {
    const payload: FriendAcceptedPayload = await req.json();
    // ← No auth header check
    // ← No JWT validation
    // ← No identity enforcement
    const { accepterId, senderId } = payload;  // ← Trusts caller blindly
```

**Required Fix:**
Add the same JWT validation pattern used in `send-collaboration-invite/index.ts`:
1. Extract `Authorization` header → 401 if missing
2. Create user-scoped client with `SUPABASE_ANON_KEY` → validate JWT → 401 if invalid
3. Assert `jwtUser.id === accepterId` → 403 if mismatch (only the accepter should call this)

**Why This Matters:**
Without this, any authenticated or unauthenticated actor can:
- Spam any user with fake "X accepted your request" notifications
- Impersonate any user as the "accepter"
- Use this as a social engineering vector (fake connection notifications)

---

### CRIT-002: Information Disclosure in Error Response

**File:** `supabase/functions/send-friend-accepted-notification/index.ts` (lines 100-108)
**Category:** Security — OWASP Information Disclosure

**What's Wrong:**
The catch block leaks `error.message` and `error.toString()` to the client response:

```typescript
} catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send notification",  // ← leaks internals
        details: error.toString(),                               // ← leaks stack/paths
      }),
```

This was explicitly identified and fixed in `send-collaboration-invite/index.ts` (see line 251 comment: "CRIT-001 FIX: Log full error server-side, return static message to client. Never leak error.message or error.toString()"). The new function repeats the original vulnerability.

**Required Fix:**
Replace lines 100-108 with:
```typescript
} catch (error) {
    console.error("Error sending friend accepted notification:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
}
```

**Why This Matters:**
Leaking `error.message` and `error.toString()` can expose internal file paths, library versions, Deno stack traces, and Supabase connection details — all useful for attackers.

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: Stale Closure — `userId` Missing from `acceptFriendRequest` Dependency Array

**File:** `app-mobile/src/hooks/useFriends.ts` (lines 293, 331)
**Category:** React Correctness — Stale Closure Bug

**What's Wrong:**
The new code at line 293 uses `userId` (from Zustand store) inside `acceptFriendRequest`:
```typescript
accepterId: userId,  // line 293 — captured by closure
```

But the `useCallback` dependency array at line 331 is `[queryClient]` — it does **not** include `userId`:
```typescript
[queryClient]  // line 331 — missing userId
```

Before this change, `acceptFriendRequest` never referenced `userId`, so `[queryClient]` was correct. Now it does, and the dependency array wasn't updated.

**Evidence:**
Other callbacks in the same file that use `userId` correctly include it:
- `addFriend` → `[queryClient, userId]` (line 251)
- `declineFriendRequest` → `[queryClient, userId]` (line 350)
- `cancelFriendRequest` → `[queryClient, userId]` (line 429)

**Required Fix:**
Change line 331 from `[queryClient]` to `[queryClient, userId]`.

**Why This Matters:**
If the user's auth state changes (logout → login as different user — unlikely but possible), the callback sends the **old** user's ID as `accepterId`. The edge function would send a push claiming "Old User accepted your request" with the wrong `accepterId`. In practice the impact is low because auth state rarely changes mid-session, but it's a correctness bug that violates React's rules of hooks and could become a real problem with fast user switching.

---

### HIGH-002: Push Silently Fails but Response Claims `method: "push"` Sent Successfully

**File:** `supabase/functions/send-friend-accepted-notification/index.ts` (lines 76-97)
**Category:** Logic Error — Misleading Success Response

**What's Wrong:**
The `sendPush()` call uses `.catch()` to swallow errors (line 87), then execution unconditionally falls through to return `{ success: true, method: "push" }` (lines 91-97). If the push actually fails (network error, OneSignal down, user not subscribed), the caller still receives a response saying the push was sent.

```typescript
await sendPush({ ... }).catch((err) => console.warn(...));
// ← If push fails, execution continues here
return new Response(
  JSON.stringify({ success: true, method: "push" }),  // ← Always claims push sent
```

**Required Fix:**
Capture the result of `sendPush()` and return the actual outcome:
```typescript
let pushSent = false;
try {
  pushSent = await sendPush({ ... });
} catch (err) {
  console.warn('[send-friend-accepted-notification] Push failed:', err);
}
return new Response(
  JSON.stringify({ success: true, method: pushSent ? "push" : "push_failed" }),
  ...
);
```

**Why This Matters:**
The existing `send-friend-request-email` function has the same pattern (line 111), so this is a pre-existing issue. However, the implementor's report claims they "followed the exact same pattern" — which is true, but the pattern itself is wrong. For observability and debugging, the caller should know whether the push actually landed.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: Inconsistent Error Handling Strategy — `.catch()` vs `try/catch`

**File:** `supabase/functions/send-friend-accepted-notification/index.ts` (line 87)
**Category:** Pattern Violation

**What's Wrong:**
The `send-collaboration-invite` function has an explicit comment (line 190): "HIGH-003 FIX: Single error handling strategy — try/catch only, no .catch() chain." This was a deliberate codebase decision. The new function uses `.catch()` on the `sendPush()` call, directly contradicting this established fix.

**Required Fix:**
Replace `.catch()` with try/catch:
```typescript
try {
  await sendPush({ ... });
} catch (err) {
  console.warn('[send-friend-accepted-notification] Push failed:', err);
}
```

The `send-friend-request-email` function (line 111) also has this same `.catch()` pattern — it predates the fix. Both should be updated.

---

### MED-002: No Deduplication for `friend_accepted` Push Notifications

**File:** `app-mobile/app/index.tsx` (lines 348-353)
**Category:** UX — Duplicate Notifications

**What's Wrong:**
The `friend_request` handler (lines 325-346) has deduplication logic:
```typescript
case "friend_request": {
  if (!requestId) { break; }           // guard against malformed payload
  notifiedFriendRequestIdsRef.current.add(requestId);  // dedup tracking
  ...
}
```

The `friend_accepted` handler has neither:
```typescript
case "friend_accepted": {
  const accepterName = (data.accepterName as string) || "Someone";
  const accepterId = data.accepterId as string | undefined;
  inAppNotificationService.notifyFriendAccepted(accepterName, accepterId);
  break;
}
```

If OneSignal delivers the same notification twice (retry, network hiccup, app killed and restored), the user sees duplicate "You and X are now connected!" in-app notifications.

**Required Fix:**
Track `requestId` or `accepterId` in a ref to deduplicate, similar to the `friend_request` pattern.

---

### MED-003: Untyped `catch` Variable in Edge Function

**File:** `supabase/functions/send-friend-accepted-notification/index.ts` (line 98)
**Category:** TypeScript — Type Safety

**What's Wrong:**
```typescript
} catch (error) {  // ← no type annotation
    error.message   // ← accessing .message on unknown type
```

The `send-collaboration-invite` function uses `catch (error: unknown)` (line 250), which is the TypeScript strict-mode pattern. The new function omits the type annotation. While Deno may not enforce this at runtime, it's a pattern violation that `error.message` access should require a type guard.

**Required Fix:**
Change to `catch (error: unknown)` and use `error instanceof Error ? error.message : String(error)`. (This becomes moot once CRIT-002 is fixed, since the error message won't be returned to the client.)

---

## ✅ What Passed

### Things Done Right

1. **Best-effort notification pattern:** The `trackedInvoke` call in `useFriends.ts` is correctly wrapped in try/catch and never fails the main `acceptFriendRequest` operation. The DB write succeeded before the notification attempt — exactly right.

2. **Notification preferences check with correct semantics:** Both edge functions use `.maybeSingle()` to query preferences, meaning users with no preferences row (most users initially) default to receiving notifications. This matches the migration defaults (`push_enabled: TRUE`, `friend_requests: TRUE`).

3. **In-app notification service reuse:** The `notifyFriendAccepted` method already existed in `inAppNotificationService.ts` and was correctly wired up — no new methods invented, just connected the existing one.

4. **NAV_TARGETS addition:** Adding `friend_accepted: "connections"` to the navigation map is clean and matches the `friend_request` target. Tapping the push correctly navigates to the connections page.

5. **CORS headers consistently applied:** All response paths in the new edge function include CORS headers, including error and early-return paths.

6. **Push data payload structure:** The `friend_accepted` push data includes `type`, `accepterId`, `accepterName`, and `requestId` — all the data the mobile handler needs.

---

## Spec Compliance Matrix

| Success Criterion | Tested? | Passed? | Evidence |
|-------------------|---------|---------|----------|
| Friend request push respects notification preferences | ✅ | ✅ | `send-friend-request-email` lines 82-97: checks `push_enabled` and `friend_requests` |
| Friend acceptance sends push to original sender | ✅ | ✅ | `useFriends.ts` lines 288-300 → edge function → `sendPush()` |
| Friend acceptance push respects notification preferences | ✅ | ✅ | `send-friend-accepted-notification` lines 58-73 |
| Mobile app creates in-app notification for `friend_accepted` | ✅ | ✅ | `index.tsx` lines 348-353 → `notifyFriendAccepted()` |
| Tapping `friend_accepted` push navigates to connections | ✅ | ✅ | `NAV_TARGETS["friend_accepted"] = "connections"` (line 371) |
| All notification calls are best-effort | ✅ | ✅ | try/catch in `useFriends.ts`, `.catch()` in edge function |
| Push failure never fails the main operation | ✅ | ✅ | DB write completes before notification attempt |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Created send-friend-accepted-notification/index.ts" | ✅ | ✅ | File exists, 111 lines, correct structure |
| "Added preferences check to send-friend-request-email" | ✅ | ✅ | Lines 82-97 check `push_enabled` and `friend_requests` |
| "Added push call in acceptFriendRequest()" | ✅ | ✅ | Lines 288-300 — correct, but `userId` dep missing |
| "Added friend_accepted handler + nav target" | ✅ | ✅ | Lines 348-353 + line 371 |
| "Follows exact same pattern as send-friend-request-email" | ✅ | 🟡 Partial | Pattern matched — but both functions miss auth (send-friend-request-email also has no JWT check, which is a pre-existing issue). The newer send-collaboration-invite has auth, and the new function should follow that pattern instead. |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)
1. **CRIT-001**: Add JWT authentication to `send-friend-accepted-notification` — mirror the auth pattern from `send-collaboration-invite/index.ts` lines 29-61. Assert `jwtUser.id === accepterId`.
2. **CRIT-002**: Remove `error.message` and `error.toString()` from the 500 response body. Return a static error string only.

### Strongly Recommended (merge at your own risk)
3. **HIGH-001**: Add `userId` to `acceptFriendRequest`'s useCallback dependency array → `[queryClient, userId]`
4. **HIGH-002**: Return actual push success/failure status in response instead of always claiming `method: "push"`

### Should Fix Soon
5. **MED-001**: Replace `.catch()` with `try/catch` on `sendPush()` calls (both edge functions)
6. **MED-002**: Add deduplication tracking for `friend_accepted` notifications in `index.tsx`
7. **MED-003**: Add `: unknown` type annotation to catch clause (moot if CRIT-002 is fixed)

### Technical Debt to Track (Outside Scope)
- `send-friend-request-email` also has no JWT authentication (pre-existing — same vulnerability as CRIT-001 but not introduced by this change)
- The function name `send-friend-request-email` no longer sends emails — it only sends pushes. The name is misleading but renaming requires coordination.

---

## Verdict Justification

**🔴 FAIL** — 2 critical findings. Do not merge. Return to implementor with this report.

CRIT-001 (missing auth) is a security vulnerability that allows any caller to push fake notifications to any user. CRIT-002 (info disclosure) leaks server internals to clients. Both must be fixed before re-testing.

After CRIT-001 and CRIT-002 are fixed, HIGH-001 (stale closure) should also be addressed — it's a correctness bug even if low-probability in practice. The remaining findings are pattern consistency issues that won't cause user-visible failures but should be cleaned up.

A re-test pass will be needed after the critical fixes to verify the auth flow works correctly end-to-end.
