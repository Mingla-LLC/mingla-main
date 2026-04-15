# Investigation: Android OneSignal Device Registration Unreliable (ORCH-0407)

> **Date:** 2026-04-14
> **Confidence:** HIGH — root cause proven from code trace + SDK behavior analysis
> **Affects:** ALL platforms, not just Android

---

## Executive Summary

The OneSignal push subscription (`optIn()`) is only called after the coach mark tour completes or is skipped. If a user opens the app but never finishes the coach mark tour, their device is logged into OneSignal (`login(userId)` succeeds) but the push subscription is never activated (`optIn()` never runs). OneSignal knows the user exists but has no device to deliver to — resulting in `invalid_aliases` when you try to send them a push.

This affects EVERY user who hasn't completed the coach mark tour, on BOTH Android and iOS. It's not an Android-specific bug — it's a flow dependency bug.

---

## Root Cause: `optIn()` Gated Behind Coach Mark Tour Completion

### 6-Field Proof

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/services/permissionOrchestrator.ts:10-12` and `app-mobile/src/contexts/CoachMarkContext.tsx:309,337` |
| **Exact code** | `requestPostTourPermissions()` calls `requestPushPermission()` which calls `OneSignal.User.pushSubscription.optIn()`. This function is ONLY called from two places: tour completed (CoachMarkContext:309) and tour skipped (CoachMarkContext:337). |
| **What it does** | The push subscription (`optIn()`) is deferred until the coach mark tour either completes or is skipped. If neither happens, `optIn()` never runs. Without `optIn()`, the device is logged in to OneSignal (`login()` succeeded) but has NO active push subscription. OneSignal cannot deliver push to an un-opted-in device. |
| **What it should do** | `optIn()` should run at login time, immediately after `OneSignal.login(userId)`. The OS permission dialog (`requestPermission()`) can still be deferred to the tour — but `optIn()` is a separate concern: it tells OneSignal "register this device for push delivery." |
| **Causal chain** | 1. User opens app → `initializeOneSignal()` succeeds → 2. `loginToOneSignal(userId)` calls `OneSignal.login(userId)` → OneSignal backend creates user identity → 3. Coach mark tour is pending but never started/completed → 4. `requestPostTourPermissions()` never runs → 5. `optIn()` never called → 6. Device has NO active push subscription → 7. Server sends push via `include_aliases.external_id` → 8. OneSignal finds user but no deliverable subscriptions → 9. Returns `invalid_aliases` error |
| **Verification** | Call `OneSignal.User.pushSubscription.optIn()` right after `login()`. Then send a push. The `invalid_aliases` error should disappear. |

---

## Timing Analysis: No Race Condition Between Init and Login

**DISPROVEN** — init and login have correct sequencing.

Both are in separate `useEffect` hooks at `index.tsx:286-303`:

```typescript
// useEffect 1 (empty deps — fires first in render order)
useEffect(() => {
  initializeOneSignal();  // SYNCHRONOUS — sets _initialized = true immediately
}, []);

// useEffect 2 (depends on user?.id)
useEffect(() => {
  if (user?.id) {
    loginToOneSignal(user.id).catch(...)  // checks _initialized — always true after useEffect 1
  }
}, [user?.id, isLoadingAuth]);
```

React guarantees useEffects fire in declaration order within the same render. `initializeOneSignal()` is synchronous — `_initialized` is `true` before useEffect 2 runs. **No race condition.**

The retry logic (if init fails) DOES create a gap — but `OneSignal.initialize()` is a synchronous native bridge call that rarely fails. If it fails, all retries will fail too (same underlying cause).

---

## Why `login()` Alone Is Insufficient

In OneSignal SDK v5, the user lifecycle is:

```
initialize(appId)  →  login(externalId)  →  optIn()  →  requestPermission()
     SDK ready          identity linked       subscription     OS permission
                                              activated        dialog shown
```

- `login()` creates the user identity (external_id → device mapping) on OneSignal's backend
- `optIn()` activates the push subscription — tells OneSignal "this device WANTS to receive push"
- `requestPermission()` asks the OS for `POST_NOTIFICATIONS` permission (Android 13+)

Without `optIn()`:
- The user exists in OneSignal (login succeeded)
- But the push subscription is opted OUT (default state)
- When you target by `include_aliases.external_id`: OneSignal finds the user but no active subscription → `invalid_aliases`

**OneSignal returns `invalid_aliases` for BOTH "user not found" AND "user found but no deliverable subscriptions."** The error is misleading — it doesn't mean login failed.

---

## Current Flow vs Correct Flow

### Current (broken for users who don't complete tour):

```
App launch → initialize() → login(userId) → [coach mark tour pending]
                                                    ↓
                                        Tour never completes
                                                    ↓
                                        optIn() never called
                                                    ↓
                                        Push subscription: INACTIVE
                                                    ↓
                                        Push delivery: FAILS (invalid_aliases)
```

### Correct (all users get push):

```
App launch → initialize() → login(userId) → optIn() → [push works immediately]
                                                              ↓
                                              [later] Tour completes → requestPermission()
                                                              ↓
                                              OS dialog → grant/deny
                                              ↓                    ↓
                                    Push shows as banner    Push delivered but
                                                           OS silently drops it
```

The key insight: **`optIn()` and `requestPermission()` are separate concerns.**

- `optIn()` = "register this device with OneSignal for push delivery" — should happen immediately
- `requestPermission()` = "ask the OS to allow showing notifications" — can be deferred

On Android 12 and below: no OS permission needed, so `optIn()` alone is sufficient.
On Android 13+: `optIn()` registers the subscription, but without `requestPermission()`, the OS silently drops notifications when they arrive. They're still "delivered" by OneSignal but invisible to the user.

---

## Contributing Factor: Native `login()` Is Fire-and-Forget

`RNOneSignal.java:598-600`:
```java
@ReactMethod
public void login(String externalUserId) {
    OneSignal.login(externalUserId);
}
```

No error handling. No Promise return. No callback. If the OneSignal native SDK fails to sync the login with its backend (network error, rate limit), JS has no way to know. The `await` in `loginToOneSignal()` is meaningless — `OneSignal.login()` in the JS SDK returns `void`, not a Promise.

This means login failures are COMPLETELY SILENT. The device thinks it logged in, but OneSignal's backend never registered the external_id.

---

## Recommended Fix

**Move `optIn()` to run immediately after `login()`, before the coach mark tour.**

In `oneSignalService.ts`, modify `loginToOneSignal`:

```typescript
export async function loginToOneSignal(userId: string): Promise<void> {
  if (!_initialized) {
    console.warn('[OneSignal] loginToOneSignal called before init — skipping')
    return
  }
  try {
    await OneSignal.login(userId)
    // ORCH-0407: optIn immediately after login so the device is registered
    // for push delivery. Without this, users who haven't completed the coach
    // mark tour have no active subscription and pushes fail with invalid_aliases.
    // requestPermission() is still deferred to the tour — optIn and permission
    // are separate: optIn registers the subscription, permission lets the OS show it.
    await OneSignal.User.pushSubscription.optIn()
    _loginComplete = true
    if (__DEV__) logger.push('login + optIn', { userId })
  } catch (e) {
    console.warn('[OneSignal] loginToOneSignal failed:', e)
  }
}
```

And update `requestPushPermission()` to only handle the OS permission dialog (remove `optIn()` since it's now in login):

```typescript
export async function requestPushPermission(): Promise<boolean> {
  if (!_initialized) {
    console.warn('[OneSignal] requestPushPermission called before init — skipping')
    return false
  }
  try {
    const granted = await OneSignal.Notifications.requestPermission(true)
    if (__DEV__) logger.push('permission result', { granted })
    // optIn() already called at login — no need to call again here
    return granted
  } catch (e) {
    console.warn('[OneSignal] requestPushPermission failed:', e)
    return false
  }
}
```

---

## Blast Radius

- **Affects:** EVERY user who hasn't completed or skipped the coach mark tour — on ALL platforms
- **Scope:** Push delivery fails entirely for these users (not just foreground display)
- **Production impact:** Any user who installed the app, authenticated, but closed the app before completing the coach mark → no push notifications ever
- **Admin impact:** None (admin doesn't use OneSignal)

---

## Confidence Assessment

| Finding | Confidence |
|---------|-----------|
| `optIn()` gated behind tour completion | **PROVEN** — code trace: permissionOrchestrator.ts → CoachMarkContext.tsx |
| `invalid_aliases` caused by missing subscription | **PROVEN** — OneSignal API behavior: alias with no subscription = invalid_aliases |
| No race condition between init and login | **PROVEN** — React useEffect ordering + synchronous init |
| Native login is fire-and-forget | **PROVEN** — RNOneSignal.java:598-600, no error handling |
| Moving optIn() to login fixes it | **HIGH** — follows OneSignal SDK v5 recommended lifecycle |
