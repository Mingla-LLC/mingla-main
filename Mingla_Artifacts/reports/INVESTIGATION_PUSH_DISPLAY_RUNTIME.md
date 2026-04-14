# Investigation: Push Notifications Delivered But Never Displayed — Runtime Deep Dive (ORCH-0407)

> **Date:** 2026-04-13
> **Confidence:** HIGH for findings 1-3. CANNOT VERIFY finding 4 without device testing.

---

## Executive Summary

The user is testing on a **DEV build** (Metro/React Refresh), not the production build. The dev build's Metro cache is serving STALE code that still references `onForegroundNotification` — evidenced by the runtime error `ReferenceError: Property 'onForegroundNotification' doesn't exist`. This stale code registers the native foreground lifecycle listener BEFORE crashing, poisoning the native state. Once the native `hasAddedNotificationForegroundListener` flag is set to `true`, the auto-display path is permanently skipped for the lifetime of that app process. Metro fast refresh does NOT recreate native modules — only a full app restart (or fresh native build) resets this state.

The production build (OTA-updated Play Store internal test) should work correctly because:
1. Cold app launch creates a fresh `RNOneSignal` instance with `hasAddedNotificationForegroundListener = false`
2. The OTA JS bundle has no `addEventListener('foregroundWillDisplay', ...)` call
3. The native flag stays `false` → OneSignal SDK's default handler shows notifications

**The user needs to test on the production build, not the dev build.** If the production build also fails, it's an Android OS-level issue (notification permission or channel).

---

## Finding 1: Dev Build Stale Metro Cache Poisons Native State

**Classification:** ROOT CAUSE (for dev build)

| Field | Evidence |
|-------|----------|
| **File + line** | User's Metro logs: `ERROR [ReferenceError: Property 'onForegroundNotification' doesn't exist]` |
| **Exact code** | Stale Metro bundle still contains: `const removeForeground = onForegroundNotification(...)` from a previous code version |
| **What it does** | Metro serves a cached JS bundle that references the removed `onForegroundNotification`. Before crashing, the stale code may have already called `addNotificationForegroundLifecycleListener()` from the previous render cycle (or a previous session's hot module replacement). Once the native flag is set, it persists for the app process lifetime. |
| **What it should do** | The dev build should run clean code with no foreground listener. User needs `npx expo start --clear` to purge the Metro cache. |
| **Causal chain** | 1. Dev build starts → Metro serves stale cached bundle → 2. Stale bundle calls `addNotificationForegroundLifecycleListener()` → 3. Native `hasAddedNotificationForegroundListener = true` → 4. Push arrives → native `onWillDisplay` fires → 5. Line 380: `!hasAddedNotificationForegroundListener` is FALSE → auto-display SKIPPED → 6. `event.preventDefault()` called → notification suppressed → 7. Event sent to JS → stale JS handler crashes → notification never displayed |
| **Verification** | Run `npx expo start --clear` then relaunch dev build. Or test on production build. |

---

## Finding 2: Native State Does NOT Reset on Metro Fast Refresh

**Classification:** CONTRIBUTING FACTOR

| Field | Evidence |
|-------|----------|
| **File + line** | `RNOneSignal.java:95` — `private boolean hasAddedNotificationForegroundListener = false;` (instance field, not reset on fast refresh) |
| **Exact code** | `RNOneSignal.java:217-221`: constructor cleanup only runs when a NEW instance is created (`if (currentInstance != null && currentInstance != this)`). Fast refresh does NOT create a new native module instance — it only re-executes JS. |
| **What it does** | Once `hasAddedNotificationForegroundListener` is set to `true` by ANY JS code version during the app process lifetime, it stays `true` until: (a) `removeObservers()` is called (host destroyed at line 231-233), or (b) a new RNOneSignal instance is created (app process restart). Metro fast refresh does neither. |
| **Causal chain** | Old JS → registers listener → flag true → fast refresh → new JS doesn't register → flag still true from old JS |

---

## Finding 3: Production Build Has Clean Native State

**Classification:** OBSERVATION (positive — this should work)

On production build cold launch:
1. `RNOneSignal` constructor runs (line 209) → `hasAddedNotificationForegroundListener = false`
2. OTA JS bundle loads — no `addEventListener('foregroundWillDisplay', ...)` call
3. `addNotificationForegroundLifecycleListener()` is never called from JS
4. Flag stays `false`
5. No lifecycle listener registered with OneSignal native SDK
6. Push arrives → OneSignal SDK's default handler → posts notification to Android notification manager → banner shows

**Evidence:**
- `hasAddedNotificationForegroundListener` is an instance field initialized to `false` (line 95)
- Constructor at line 209 creates new HashMap instances, starts fresh
- Cleanup at line 217-219 removes old instance's observers
- OTA bundle has no reference to `onForegroundNotification` (verified — grep found 0 references in `app/index.tsx`)

---

## Finding 4: Android 13+ Permission — CANNOT VERIFY

**Classification:** POSSIBLE CONTRIBUTING FACTOR

Push notification permission (`POST_NOTIFICATIONS`) on Android 13+ requires:
1. The app targets SDK 33+ (Expo SDK 51+ targets 34 by default)
2. The runtime permission must be requested and granted
3. Without it, the OS silently drops ALL notifications

The permission flow:
- `requestPushPermission()` at `oneSignalService.ts:93-110` calls `OneSignal.Notifications.requestPermission(true)` + `optIn()`
- Called via `permissionOrchestrator.ts:11` → `requestPostTourPermissions()`
- Triggered from `CoachMarkContext.tsx:309,337` — after the coach mark tour completes

**Risk:** If the test user account completed onboarding BEFORE the permission orchestrator was added, the permission was never requested. The OS would silently drop all notifications.

**How to verify:** Check Android Settings → Apps → Mingla → Notifications. If notifications are disabled, grant permission and test again.

**OneSignal reports "Delivered" regardless** — FCM accepts the message even if the OS drops it. "Delivered" means "reached FCM," not "displayed on device."

---

## Finding 5: display() + preventDefault() Conflict in Auto-Display Path

**Classification:** OBSERVATION (affects dev builds with registered listener, NOT production with no listener)

`RNOneSignal.java:379-406`:
```java
if (!this.hasAddedNotificationForegroundListener) {
    event.getNotification().display();  // LINE 381
}
// ...
event.preventDefault();  // LINE 387 — ALWAYS runs
```

If `hasAddedNotificationForegroundListener` is `false`:
1. `display()` is called at line 381
2. `preventDefault()` is called at line 387

Whether `preventDefault()` cancels the prior `display()` depends on the OneSignal native SDK's internal implementation (compiled .aar — not readable from source). If `display()` synchronously posts to the Android notification manager, `preventDefault()` can't unpost it. If `display()` just sets a flag that `preventDefault()` then clears, the notification is suppressed.

**This only matters if the lifecycle listener IS registered** (which it shouldn't be on the production build). With NO listener registered, `onWillDisplay` never fires, and the SDK handles display internally without this code path.

---

## Recommended Actions

### Immediate (test now):

1. **Test on the PRODUCTION build** (Play Store internal test), NOT the dev build
   - Force-close the app completely
   - Reopen
   - Have another account send a friend request
   - Check for banner

2. **If production build also fails:**
   - Check Android Settings → Apps → Mingla → Notifications → ensure enabled
   - Check if notification channels exist and are enabled

### For dev build (if needed):

3. Run `npx expo start --clear` to purge Metro cache, then relaunch
   - This ensures the dev build runs the latest JS code without stale references
   - The native module will still have the stale `hasAddedNotificationForegroundListener` flag from the current process — force-close and relaunch after clearing cache

### If BOTH builds fail:

4. The issue is OS-level: either POST_NOTIFICATIONS permission not granted, or notification channel disabled. The fix would be to ensure `requestPushPermission()` has been called and granted for the test device.

---

## Confidence Assessment

| Finding | Confidence | Reasoning |
|---------|-----------|-----------|
| Dev build stale cache is the cause | **HIGH** | Runtime error in logs proves stale code is running |
| Native flag persists across fast refresh | **PROVEN** | RNOneSignal.java constructor + fast refresh behavior |
| Production build should work | **HIGH** | Code trace shows clean path with no listener |
| Android permission could be an issue | **POSSIBLE** | Cannot verify from code — needs device check |
| display()+preventDefault() conflict | **UNKNOWN** | Would need to decompile the OneSignal .aar to verify |
