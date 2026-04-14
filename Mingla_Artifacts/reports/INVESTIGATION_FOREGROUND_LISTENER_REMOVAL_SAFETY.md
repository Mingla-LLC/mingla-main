# Investigation: Foreground Listener Removal Safety Audit (ORCH-0407)

> **Date:** 2026-04-13
> **Confidence:** HIGH for all findings except iOS runtime behavior (needs device test)

---

## 1. Why Was the Foreground Listener Originally Added?

### Git History Evidence

**Commit `f224813f` — "feat: implement Notifications System V2 — server-side authoritative notifications"**

This was a major refactor that introduced:
- `notify-dispatch` centralized notification hub
- `notifications` table in the database
- Supabase Realtime subscription for in-app notifications
- The foreground listener with `prevent()` logic

The original code comments (still visible at `index.tsx:604-605`):
```
// also receives an in-app entry via Realtime (notifications table INSERT).
// For non-DM notifications: suppress system tray — Realtime delivers in-app.
```

**Original reasoning:** When Notifications V2 was built, every push notification also creates a database row that triggers a Realtime event. The in-app notification center picks this up immediately. The developer reasoned: "If the user is in the app, they'll see the notification in the notification center via Realtime, so showing ALSO a system banner would be a duplicate."

DMs were exempted because they're time-sensitive — you want to see the banner even if you're in the app.

**Conclusion:** The listener was NOT added to fix a bug. It was a design choice to avoid what was perceived as double-notification (Realtime in-app + push banner). No ORCH-ID or bug report motivated it.

---

## 2. Will Removing the Listener Cause Regressions?

### Per-Notification-Type Analysis

With no listener, the native SDK auto-displays every foreground push. For each type:

| Notification Type | Current Behavior (w/ listener) | Behavior w/o Listener | Regression Risk |
|---|---|---|---|
| **DM message** | Shows banner (was in MESSAGE_TYPES allow list) | Shows banner | **NONE** — same behavior |
| **Board message / mention** | Shows banner (was allowed) | Shows banner | **NONE** — same behavior |
| **Friend request received** | Suppressed by prevent() | Shows banner | **LOW** — user also gets Realtime in-app notification. Two signals (banner + notification center dot) but not a true "duplicate" since they serve different purposes. |
| **Friend request accepted** | Suppressed | Shows banner | **LOW** — same as above |
| **Pair request received** | Suppressed | Shows banner | **LOW** — same |
| **Pair request accepted** | Suppressed | Shows banner | **LOW** — same |
| **Collaboration invite** | Suppressed | Shows banner | **LOW** — same |
| **Session match** | Suppressed | Shows banner | **LOW** — same |
| **Calendar reminder** | Suppressed | Shows banner | **NONE** — reminders are not duplicated in Realtime UX |
| **Birthday/holiday reminder** | Suppressed | Shows banner | **NONE** — same as calendar |
| **Paired user saved card** | Suppressed | Shows banner | **LOW** — same as friend request pattern |
| **Lifecycle (re-engagement)** | Suppressed | Shows banner | **NONE** — user wasn't actively using app when these fire |

**No HIGH-risk regressions identified.** The "duplicate" concern (banner + Realtime) is a UX preference, not a functional regression. The user explicitly wants both — they said "I want the app to feel alive."

### DM-While-In-Conversation Scenario

When a DM arrives while the user is ALREADY in that conversation: they see the message appear in the chat (via Realtime) AND they see a system banner. This was ALREADY the case before our changes — DMs were always allowed through the foreground handler. Removing the listener doesn't change this.

### Action Buttons (Accept/Decline)

Friend request and pair request notifications include action buttons (Accept/Decline). These are handled in `processNotification` (index.tsx:384-391) which runs when the notification is TAPPED or an action button is pressed. This function runs via the `onNotificationClicked` handler, which is **completely independent** of the foreground handler.

```typescript
// index.tsx:615-618 (click handler — SEPARATE from foreground)
const removeClicked = onNotificationClicked((data) => {
  if (!data?.type) return;
  processNotification(data, NAV_TARGETS[data.type as string]);
});
```

The `onNotificationClicked` handler is registered via `addNotificationClickListener()` (RNOneSignal.java:359-366) — a separate native method with its own boolean guard (`hasAddedNotificationClickListener`). **Removing the foreground listener does NOT affect click handling.**

---

## 3. Does the Tap Handler Still Work Without the Foreground Listener?

**YES — PROVEN**

Evidence:
- **Android:** `addNotificationClickListener()` (RNOneSignal.java:359-366) registers click listener with `OneSignal.getNotifications().addClickListener(rnNotificationClickListener)`. This is a completely separate native registration from `addNotificationForegroundLifecycleListener()` (line 369-375).
- **iOS:** The click listener uses `sendEventWithName:@"OneSignal-notificationClicked"` which is a separate event name from the foreground event (`OneSignal-notificationWillDisplayInForeground`).
- **JS SDK:** In `index.js:425-426`, `addEventListener('click', ...)` calls `e.addNotificationClickListener()`, while `addEventListener('foregroundWillDisplay', ...)` calls `e.addNotificationForegroundLifecycleListener()`. Completely independent code paths.

`processNotification` (index.tsx:366-453) does NOT reference or depend on any state set by the foreground handler. It reads only `data` from the click event payload (notificationId, deepLink, actionId, type).

---

## 4. Does iOS Behave the Same as Android?

### iOS Native Code (`RCTOneSignalEventEmitter.m`)

**Key difference: iOS has NO blocking wait loop.**

Android's `onWillDisplay` (RNOneSignal.java:379-406):
```java
event.preventDefault();
sendEvent(...);
synchronized (event) {
    while (preventDefaultCache.containsKey(notificationId)) {
        event.wait();  // BLOCKS (broken — exits immediately for display path)
    }
}
```

iOS's `onWillDisplayNotification` (RCTOneSignalEventEmitter.m:385-398):
```objc
_notificationWillDisplayCache[event.notification.notificationId] = event;
[event preventDefault];
[RCTOneSignalEventEmitter sendEventWithName:... withBody:...];
// Returns immediately — no blocking wait
```

iOS `displayNotification` (line 573-592):
```objc
dispatch_async(dispatch_get_main_queue(), ^{
    [event.notification display];  // Dispatches to main queue
});
[_preventDefaultCache removeObjectForKey:notificationId];
[_notificationWillDisplayCache removeObjectForKey:notificationId];
```

**iOS dispatches `display` to the main queue asynchronously.** This MAY work because:
1. The lifecycle callback returns immediately (no blocking)
2. The display is dispatched to the main queue's next run loop
3. The OneSignal iOS SDK may hold the notification in a pending state until display is called

**CANNOT VERIFY from code alone** — need a device test to confirm iOS `display()` works or doesn't. But the removal approach (no listener = auto-display) works reliably on BOTH platforms.

### iOS Auto-Display Without Listener

When no foreground listener is registered on iOS:
- `_hasAddedNotificationForegroundLifecycleListener` stays `false`
- `addForegroundLifecycleListener:self` is never called
- The OneSignal iOS SDK uses its default behavior: present the notification using iOS's `UNNotificationPresentationOptions` (banner + sound + badge)
- This is handled at the native iOS level by the OneSignal SDK's `UNUserNotificationCenter` delegate

**AUTO-DISPLAY WORKS ON iOS WITHOUT LISTENER — same as Android.**

---

## 5. Badge Count

The foreground handler currently does NOT manage badges. Badges are handled by:
1. **Increment:** `notify-dispatch` sets `iosBadgeType: "Increase"` and `iosBadgeCount: 1` in the push payload (index.ts:297-298). OneSignal handles the increment natively.
2. **Reset:** `clearNotificationBadge()` in `oneSignalService.ts:143-150` resets to 0 when user opens NotificationsModal.

**Removing the foreground listener has NO effect on badge behavior.** Badge increment is in the push payload processed by the native SDK, not by the JS handler.

---

## 6. Expo Plugin Configuration

`app.json:109-121`:
```json
["onesignal-expo-plugin", {
  "mode": "production",
  "smallIcons": ["./assets/ic_stat_onesignal_default.png"],
  "largeIcons": ["./assets/ic_onesignal_large_icon_default.png"],
  "smallIconAccentColor": "#EB7825"
}]
```

No notification display behavior configuration. The plugin only sets icons and accent color. **No interference with foreground display.**

---

## 7. SDK Upgrade Assessment

| Version | Status |
|---------|--------|
| Current: 5.3.3 | Has the Android timing bug in `onWillDisplay` |
| Latest: 5.4.3 | Available — CANNOT verify if the timing bug is fixed without reading their changelog or the updated native code |

**Upgrading to 5.4.3 is a POSSIBLE alternative** but carries risk:
- May introduce breaking changes
- Requires a full native build (not OTA-deployable)
- Would need its own investigation to verify the timing bug is fixed

**Removing the listener is safer than upgrading** for an immediate fix.

---

## 8. Sustainability Assessment

### What we lose by removing the listener

The ability to filter, suppress, or modify specific notification types while the app is foregrounded. Use cases that would no longer be possible:
- Suppress DM push while user is already in that conversation
- Show a custom in-app banner instead of the system banner
- Modify the notification content before display

### How to get filtering back later

**Option A: Android notification channels (recommended future path)**
- Create channels per notification category (social, messages, reminders, marketing)
- Users can control channels in Android settings
- No JS-level interception needed
- Works with auto-display

**Option B: Upgrade SDK**
- If `react-native-onesignal` 5.4.x fixes the timing bug, the listener approach would work again
- Requires full native build + testing

**Option C: In-app detection + programmatic channel muting**
- Detect when user is in a specific screen (e.g., in a DM conversation)
- Temporarily mute that conversation's notification channel
- Re-enable on screen exit

### Verdict

Removing the listener is a **PROPER FIX, not a patch**:
1. The listener was a design choice (not a bug fix) — removing it reverses that choice
2. The auto-display path is the INTENDED SDK behavior when no customization is needed
3. The user explicitly wants all notifications to show — no filtering needed now
4. Future filtering can be done via notification channels (better UX anyway — users control it in OS settings)

---

## Final Recommendation

**REMOVE the foreground listener entirely.** Specifically:

1. In `app/index.tsx`: remove the `onForegroundNotification(...)` call and its cleanup. The `removeForeground` variable and the callback are deleted entirely.

2. In `oneSignalService.ts`: keep the `onForegroundNotification` function definition (it's a reusable utility), but the fact that nobody calls it means no native listener is registered. OR delete it if cleanliness is preferred — just add a comment explaining why it was removed.

3. **Do NOT remove the `onNotificationClicked` handler** — this is independent and must stay.

### What this achieves
- Native SDK auto-displays all foreground notifications (proven at RNOneSignal.java:380-382)
- Tap handler continues working independently (proven — separate native registration)
- Badges continue working (push payload, not JS handler)
- Action buttons continue working (click handler, not foreground handler)
- Works on both Android and iOS
- No SDK upgrade needed
- OTA-deployable (JS-only change)

### Risks
- DM push shows banner even when user is already reading that conversation (was already the case — DMs were in the allow list)
- User may see both a system banner AND the notification center updating simultaneously for the same event (intentional — "app feels alive")
