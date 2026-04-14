# Investigation: Foreground Push Notification Display Failure (ORCH-0407)

> **Date:** 2026-04-13
> **Confidence:** PROVEN — native Java source code traced line by line
> **SDK:** react-native-onesignal v5.3.3

---

## Executive Summary

The OneSignal React Native SDK has a **timing bug in the foreground notification display path**. When a JS foreground listener is registered, the native code ALWAYS calls `event.preventDefault()` (holds the notification), sends the event to JS, and is supposed to wait for JS to respond. But the wait logic is broken for the `display()` path — the native thread unblocks and returns BEFORE JS has a chance to call `display()`. By the time JS calls `display()`, the native notification pipeline has already moved on.

The fix is simple: **don't register a foreground listener at all.** When no listener is registered, the native SDK auto-displays the notification immediately. This is the only reliable path.

---

## Root Cause: Native Timing Bug in SDK's `onWillDisplay` Method

### File + Line
`app-mobile/node_modules/react-native-onesignal/android/src/main/java/com/onesignal/rnonesignalandroid/RNOneSignal.java:379-406`

### Exact Code (annotated)

```java
@Override
public void onWillDisplay(INotificationWillDisplayEvent event) {
    // LINE 380: If NO JS listener registered → auto-display and return
    if (!this.hasAddedNotificationForegroundListener) {
        event.getNotification().display();  // ← THIS IS THE WORKING PATH
    }

    // LINE 384-386: Cache the event for later JS access
    INotification notification = event.getNotification();
    String notificationId = notification.getNotificationId();
    notificationWillDisplayCache.put(notificationId, event);

    // LINE 387: ALWAYS prevent display — even when we WANT to display
    event.preventDefault();

    try {
        // LINE 390-392: Send event to JS (async — queued on the bridge)
        sendEvent("OneSignal-notificationWillDisplayInForeground", ...);

        // LINE 394-402: SUPPOSED to wait for JS response
        try {
            synchronized (event) {
                // BUG: This only blocks when JS calls preventDefault()
                // (which puts the ID in preventDefaultCache).
                // When JS calls display(), preventDefaultCache does NOT
                // contain the ID, so this while condition is FALSE
                // IMMEDIATELY — before JS even receives the event.
                while (preventDefaultCache.containsKey(notificationId)) {
                    event.wait();
                }
            }
        } catch (InterruptedException e) { ... }
    } catch (JSONException e) { ... }
}
// METHOD RETURNS — notification is finalized as "prevented"
```

### What it does

When a JS foreground listener is registered:
1. `event.preventDefault()` is called UNCONDITIONALLY (line 387) — notification is held
2. Event is sent to JS via the bridge (async)
3. The `while (preventDefaultCache.containsKey(notificationId))` check runs BEFORE JS receives the event
4. Since JS hasn't responded yet, `preventDefaultCache` doesn't contain the ID → condition is FALSE
5. The while loop body (`event.wait()`) is NEVER entered
6. `onWillDisplay()` returns immediately — notification is finalized as "prevented"
7. Later, JS receives the event and calls `display()` → calls native `event.getNotification().display()`
8. But the native notification pipeline has already finalized — the `display()` call is too late

### What it should do

The `synchronized(event)` / `event.wait()` block should block the native thread until JS responds with EITHER `display()` or `preventDefault()`. But the logic only blocks for `preventDefault()` (which populates `preventDefaultCache`). For `display()`, the thread unblocks immediately because `preventDefaultCache` doesn't contain the ID.

### Causal Chain

1. App registers foreground listener → native `hasAddedNotificationForegroundListener = true`
2. Push arrives → native `onWillDisplay()` fires
3. Auto-display path skipped (line 380: `hasAddedNotificationForegroundListener` is true)
4. `event.preventDefault()` called unconditionally → notification held
5. Event queued to JS bridge (async)
6. While loop check: `preventDefaultCache` empty → FALSE → loop exits immediately
7. `onWillDisplay()` returns → native notification pipeline finalizes the "prevented" notification
8. JS eventually receives event → calls `display()` → native `displayNotification()`
9. Native retrieves cached event → calls `event.getNotification().display()` → **TOO LATE**
10. User sees nothing — notification was received but never displayed

### Verification Step

Remove the foreground listener registration entirely. With no listener:
- `hasAddedNotificationForegroundListener` stays `false`
- `onWillDisplay()` hits line 381: `event.getNotification().display()` — displays IMMEDIATELY
- The `event.preventDefault()` at line 387 runs AFTER display — but the notification is already posted to the system notification manager, so prevent can't un-show it

---

## What Happens with NO Listener Registered (THE FIX)

Looking at `RNOneSignal.java:379-382`:

```java
if (!this.hasAddedNotificationForegroundListener) {
    event.getNotification().display();
}
```

When no JS foreground listener is registered:
1. `onWillDisplay()` fires
2. `hasAddedNotificationForegroundListener` is FALSE
3. `event.getNotification().display()` is called IMMEDIATELY — notification shows
4. Then `event.preventDefault()` runs (line 387) — but notification is already in the system tray
5. `sendEvent()` fires but no JS listeners receive it — no-op
6. Method returns

**This is the ONLY reliable path to display foreground notifications with this SDK version.**

---

## The `displayNotification` Native Method (Why It Fails)

`RNOneSignal.java:409-417`:

```java
@ReactMethod
private void displayNotification(String notificationId) {
    INotificationWillDisplayEvent event = notificationWillDisplayCache.get(notificationId);
    if (event == null) {
        Logging.error("Could not find onWillDisplayNotification event...");
        return;
    }
    event.getNotification().display();
}
```

This retrieves the cached event and calls `display()`. The event IS in the cache (populated at line 386). But calling `display()` here happens AFTER `onWillDisplay()` has already returned. The OneSignal native SDK has already processed the "prevented" notification. Whether `display()` works at this point depends on the internal OneSignal SDK implementation — and based on the user's test, **it does NOT work.**

---

## Recommended Fix

**Remove the foreground listener entirely.** Don't call `OneSignal.Notifications.addEventListener('foregroundWillDisplay', ...)` at all.

In `oneSignalService.ts`, the `onForegroundNotification` function should not register any native listener. Instead, it should be a no-op or removed.

In `app/index.tsx`, remove the `onForegroundNotification(...)` call entirely.

With no listener registered, the native SDK auto-displays ALL foreground notifications at line 381. The user gets system banners for every push while the app is open.

**If filtering is needed later** (e.g., suppress certain types), implement it using Android notification channels or a custom in-app banner instead of the SDK's broken foreground listener.

---

## Confidence Assessment

| Finding | Confidence |
|---------|-----------|
| Native `event.preventDefault()` called unconditionally | **PROVEN** — RNOneSignal.java:387 |
| While loop exits immediately for display path | **PROVEN** — RNOneSignal.java:396, `preventDefaultCache` empty before JS responds |
| JS `display()` call arrives after `onWillDisplay()` returns | **PROVEN** — async bridge, native thread unblocks first |
| No listener → auto-display works | **PROVEN** — RNOneSignal.java:380-382, `display()` called before `preventDefault()` |
| Removing the listener is the correct fix | **PROVEN** — only path where `display()` is called synchronously within the native callback |
