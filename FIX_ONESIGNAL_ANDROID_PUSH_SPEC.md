# Feature: Migrate to OneSignal — Unified Push Architecture

**Date:** 2026-03-12
**Status:** Planned
**Requested by:** Fix broken Android push notifications by migrating entirely to OneSignal, removing expo-notifications.

---

## 1. Summary

Push notifications on Android are broken because two competing push systems (`expo-notifications` and `react-native-onesignal`) both register a `FirebaseMessagingService`, and only one can win the FCM token. Rather than removing OneSignal (which offers segmentation, A/B testing, analytics, intelligent delivery, and in-app messaging), this spec **migrates everything to OneSignal** and removes `expo-notifications` entirely.

The migration touches three layers:
1. **Mobile** — Remove `expo-notifications` plugin/services, keep OneSignal SDK as sole push handler, rewrite notification listeners to use OneSignal's event system.
2. **Edge Functions** — Rewrite `push-utils.ts` to call OneSignal's REST API (targeting users by `external_id` = Supabase UUID), eliminating the need for the `user_push_tokens` table entirely.
3. **Configuration** — Verify `google-services.json` matches Firebase project `mingla-dev`, configure OneSignal dashboard with FCM v1 credentials from `mingla-dev`.

The confirmed Firebase project is **`mingla-dev`** (project number `169132274606`).

---

## 2. Why OneSignal Over Expo Push

| Capability | Expo Push | OneSignal |
|------------|-----------|-----------|
| Basic push delivery | Yes | Yes |
| User segmentation | No | Yes — tags, filters, segments |
| A/B testing | No | Yes — built-in |
| Delivery analytics | No | Yes — delivery, open, CTR |
| Intelligent delivery (optimal send time) | No | Yes |
| In-app messaging | No | Yes — no app update needed |
| Frequency capping | No | Yes — automatic |
| Notification templates | No | Yes — dashboard-managed |
| Journeys (multi-step workflows) | No | Yes — visual builder |
| Web push (future) | No | Yes — same system |
| Token management | Manual (you store tokens) | Automatic (OneSignal manages) |
| Cost | Free | Free tier covers current scale |

---

## 3. Root Cause Analysis (For Context)

### Problem 1: Two FCM Services Competing
Both `expo-notifications` and `onesignal-expo-plugin` register their own `FirebaseMessagingService` during `npx expo prebuild`. On Android, only one can receive FCM tokens. `expo-notifications` is listed first in `app.json` plugins, so it wins. OneSignal's native SDK never gets a token.

### Problem 2: OneSignal Has Zero Backend Integration
All 8 edge functions send pushes via Expo Push API (`exp.host/--/api/v2/push/send`). Zero backend code calls OneSignal's API. Even if OneSignal had a token, nothing would use it.

### Problem 3: `google-services.json` Was Untracked
The file references Firebase project `mingla-dev` but was not committed to git. User has confirmed `mingla-dev` is the correct and current Firebase project.

### Problem 4: Mobile-Side Push Sending (Security Issue)
`notificationService.ts` and `enhancedNotificationService.ts` send pushes directly from the mobile client by querying `user_push_tokens` for other users' tokens. This exposes push tokens if RLS is misconfigured. OneSignal eliminates this entirely — you target by `external_id`, and OneSignal's server handles token routing.

---

## 4. Success Criteria

1. On Android launch, OneSignal native SDK logs appear in **Logcat** showing FCM token registration and player creation. No `expo-notifications` FCM service in the Android manifest.
2. After login, `OneSignal.login(userId)` links the OneSignal subscription to the Supabase UUID. Verifiable in OneSignal dashboard → Audience → search by external ID.
3. Edge functions send pushes via OneSignal REST API targeting `external_id`. A push sent by `send-friend-link` arrives on the Android device within 5 seconds.
4. Foreground notifications trigger in-app notification banners via OneSignal's `foregroundWillDisplay` event. Background taps navigate to the correct page via OneSignal's `click` event.
5. The `user_push_tokens` table is no longer written to or read from by any code (can be dropped in a future cleanup migration).
6. `notificationService.ts` and `enhancedNotificationService.ts` are deleted. All notification logic is in `oneSignalService.ts`.
7. iOS push notifications continue working (OneSignal handles APNs automatically).
8. `google-services.json` is committed to git and matches Firebase project `mingla-dev`.

---

## 5. OneSignal Dashboard Setup (Manual — Before Any Code Changes)

These steps must be completed by a human in the browser before the code changes will work.

### 5.1 Configure Android Platform (FCM v1)

1. Open [Firebase Console](https://console.firebase.google.com) → Project **`mingla-dev`**.
2. Go to **Project Settings → Service accounts → Generate new private key**. Download the JSON file.
3. Open [OneSignal Dashboard](https://dashboard.onesignal.com) → App **`388b3efc-14c2-4de2-98cb-68c818be9f06`**.
4. Go to **Settings → Platforms → Google Android**.
5. Select **FCM v1 (Service Account JSON)** and upload the private key JSON from step 2.
6. Save.

### 5.2 Configure iOS Platform (APNs)

1. If not already done: go to OneSignal Dashboard → **Settings → Platforms → Apple iOS**.
2. Upload your APNs Auth Key (`.p8` file) or APNs Certificate (`.p12` file).
3. Enter the Team ID and Key ID from your Apple Developer account.
4. Save.

### 5.3 Get the OneSignal REST API Key

1. OneSignal Dashboard → **Settings → Keys & IDs**.
2. Copy the **REST API Key**. This will be stored as a Supabase edge function secret.
3. Note the **App ID** (already known: `388b3efc-14c2-4de2-98cb-68c818be9f06`).

### 5.4 Store OneSignal Secrets in Supabase

Run these commands (replace `YOUR_REST_API_KEY` with the actual key from §5.3):

```bash
supabase secrets set ONESIGNAL_APP_ID=388b3efc-14c2-4de2-98cb-68c818be9f06
supabase secrets set ONESIGNAL_REST_API_KEY=YOUR_REST_API_KEY
```

These environment variables will be available to all edge functions via `Deno.env.get()`.

---

## 6. Database Changes

### 6.1 No New Tables

OneSignal manages push tokens internally. The `user_push_tokens` table becomes obsolete.

### 6.2 No Immediate Table Drops

Do NOT drop `user_push_tokens` in this migration. Leave it in place as a safety net during the transition. It can be dropped in a future cleanup migration after confirming OneSignal is working end-to-end for at least 2 weeks.

---

## 7. Edge Function Changes

### 7.1 Rewrite `supabase/functions/_shared/push-utils.ts`

**Current behavior:** Sends to Expo Push API using an Expo push token string.
**New behavior:** Sends to OneSignal REST API using the target user's Supabase UUID as `external_id`.

**Replace the entire file with:**

```typescript
// supabase/functions/_shared/push-utils.ts
//
// Sends push notifications via OneSignal REST API.
// Targets users by external_id (= Supabase auth.users.id).
// OneSignal manages FCM/APNs tokens internally — no token storage needed.

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";

interface PushPayload {
  targetUserId: string;           // Supabase UUID — maps to OneSignal external_id
  title: string;
  body: string;
  data?: Record<string, unknown>;
  androidChannelId?: string;      // Android notification channel
}

interface OneSignalResponse {
  id?: string;
  errors?: string[] | Record<string, string[]>;
}

/**
 * Sends a push notification to a specific user via OneSignal.
 *
 * The user must have been registered in OneSignal via `OneSignal.login(userId)`
 * on the mobile client. OneSignal resolves the external_id to the correct
 * device(s) and delivers via FCM (Android) or APNs (iOS) automatically.
 *
 * Returns true if the push was accepted by OneSignal, false otherwise.
 */
export async function sendPush(payload: PushPayload): Promise<boolean> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn("[push-utils] OneSignal credentials not configured. Skipping push.");
    return false;
  }

  const oneSignalPayload = {
    app_id: ONESIGNAL_APP_ID,
    target_channel: "push",
    include_aliases: {
      external_id: [payload.targetUserId],
    },
    headings: { en: payload.title },
    contents: { en: payload.body },
    data: payload.data ?? {},
    ...(payload.androidChannelId && {
      android_channel_id: payload.androidChannelId,
    }),
  };

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      response = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify(oneSignalPayload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (networkErr) {
    console.warn("[push-utils] Network error sending push:", networkErr);
    return false;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    console.warn("[push-utils] OneSignal returned HTTP", response.status, errorText);
    return false;
  }

  let body: OneSignalResponse;
  try {
    body = await response.json();
  } catch {
    return true;
  }

  if (body.errors) {
    console.warn("[push-utils] OneSignal errors:", JSON.stringify(body.errors));
    // "All included players are not subscribed" means the user hasn't registered
    // a device yet. This is not a bug — they just haven't opened the app.
    return false;
  }

  return true;
}

/**
 * Sends a push to multiple users. Fires in parallel, never throws.
 * Returns an array of booleans (one per user) indicating success/failure.
 */
export async function sendPushToMany(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  androidChannelId?: string
): Promise<boolean[]> {
  return Promise.all(
    userIds.map((userId) =>
      sendPush({ targetUserId: userId, title, body, data, androidChannelId }).catch(() => false)
    )
  );
}
```

**Key changes from old push-utils.ts:**
- No longer imports `createClient` from Supabase (no token lookup needed)
- No longer accepts `supabaseUrl` or `supabaseServiceKey` parameters
- No longer queries `user_push_tokens` table
- No stale token purging needed (OneSignal handles token lifecycle)
- Targets users by `external_id` (Supabase UUID) instead of push token string
- Added `sendPushToMany()` helper for multi-user notifications

---

### 7.2 Update All Edge Functions That Call `sendPush()`

Every edge function currently calls `sendPush(supabaseUrl, supabaseServiceKey, payload)` where `payload.to` is an Expo push token. Each must be updated to:

1. **Remove** the `user_push_tokens` query (no longer needed).
2. **Change** the `sendPush()` call to use `targetUserId` instead of `to`.
3. **Remove** the `supabaseUrl` and `supabaseServiceKey` arguments from `sendPush()`.

Below is the **exact change pattern** for each function. The business logic remains identical — only the push delivery mechanism changes.

---

#### 7.2.1 Pattern: Old vs. New

**OLD pattern (in every function):**
```typescript
import { sendPush } from "../_shared/push-utils.ts";

// ... inside handler ...
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Query push token
const { data: tokenRow } = await adminClient
  .from("user_push_tokens")
  .select("push_token")
  .eq("user_id", targetUserId)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (tokenRow?.push_token) {
  await sendPush(supabaseUrl, supabaseServiceKey, {
    to: tokenRow.push_token,
    title: "...",
    body: "...",
    data: { ... },
    sound: "default",
    channelId: "...",
  });
}
```

**NEW pattern (replace with):**
```typescript
import { sendPush } from "../_shared/push-utils.ts";

// ... inside handler ...

// No token query needed — OneSignal resolves external_id to device(s)
await sendPush({
  targetUserId: targetUserId,
  title: "...",
  body: "...",
  data: { ... },
  androidChannelId: "...",
}).catch(() => {});
```

**Key differences:**
- Delete the entire `user_push_tokens` query block
- Delete the `if (tokenRow?.push_token)` guard — OneSignal handles missing subscriptions gracefully
- Replace `to: tokenRow.push_token` with `targetUserId: userId`
- Replace `channelId` with `androidChannelId`
- Remove `sound: "default"` — OneSignal controls sound via dashboard/channel config
- Remove `supabaseUrl` and `supabaseServiceKey` from `sendPush()` args
- Wrap in `.catch(() => {})` to maintain fire-and-forget behavior

---

#### 7.2.2 `send-friend-link/index.ts`

Apply the pattern from §7.2.1. This function sends up to 2 pushes:

**Push 1 — to target user (friend link request):**
```typescript
await sendPush({
  targetUserId: targetUserId,
  title: `${requesterDisplayName} wants to connect`,
  body: "Tap to accept and start planning together.",
  data: {
    type: "friend_link_request",
    linkId,
    requesterId,
    requesterName: requesterDisplayName,
    requesterAvatarUrl,
  },
}).catch(() => {});
```

**Push 2 — to target user (re-initiate after decline, consent request):**
```typescript
await sendPush({
  targetUserId: targetUserId,
  title: "Link profiles?",
  body: `Want to link profiles and share details with ${targetName}?`,
  data: {
    type: "link_consent_request",
    linkId,
    friendName: targetName,
    friendUserId: targetUserId,
  },
}).catch(() => {});
```

Delete both `user_push_tokens` queries in this file.

---

#### 7.2.3 `respond-friend-link/index.ts`

Apply the pattern from §7.2.1. This function sends pushes based on accept/decline:

**On DECLINE — to requester:**
```typescript
await sendPush({
  targetUserId: requesterId,
  title: "Connection update",
  body: `${targetName} isn't available to connect right now.`,
  data: {
    type: "friend_link_declined",
    linkId,
    declinedByName: targetName,
    declinedByUserId: currentUserId,
  },
}).catch(() => {});
```

**On ACCEPT — to both users (consent request):**
```typescript
// Push to requester
await sendPush({
  targetUserId: requesterId,
  title: `You and ${targetName} are now friends!`,
  body: "Want to link profiles and share your details with each other?",
  data: {
    type: "link_consent_request",
    linkId,
    friendName: targetName,
    friendUserId: targetUserId,
    friendAvatarUrl: targetAvatarUrl,
  },
}).catch(() => {});

// Push to accepter
await sendPush({
  targetUserId: targetUserId,
  title: `You and ${requesterName} are now friends!`,
  body: "Want to link profiles and share your details with each other?",
  data: {
    type: "link_consent_request",
    linkId,
    friendName: requesterName,
    friendUserId: requesterId,
    friendAvatarUrl: requesterAvatarUrl,
  },
}).catch(() => {});
```

Delete all `user_push_tokens` queries.

---

#### 7.2.4 `send-collaboration-invite/index.ts`

**Push to invitee:**
```typescript
await sendPush({
  targetUserId: invitedUserId,
  title: "New Collaboration Invite",
  body: `${inviterName} invited you to join "${sessionName}"`,
  data: {
    type: "collaboration_invite_received",
    sessionId,
    sessionName,
    inviteId,
    inviterId,
    inviterName,
    inviterUsername,
    inviterAvatarUrl,
  },
  androidChannelId: "collaboration-invites",
}).catch(() => {});
```

**Push to inviter (confirmation):**
```typescript
await sendPush({
  targetUserId: inviterId,
  title: "Collaboration Invite Sent",
  body: `You invited ${invitedDisplayName} to join "${sessionName}"`,
  data: {
    type: "collaboration_invite_sent",
    sessionId,
    sessionName,
    inviteId,
    invitedUserId,
    invitedUsername,
  },
  androidChannelId: "collaboration-invites",
}).catch(() => {});
```

Delete all `user_push_tokens` queries.

---

#### 7.2.5 `notify-invite-response/index.ts`

**Push to inviter:**
```typescript
const accepted = response === "accepted";
await sendPush({
  targetUserId: inviterId,
  title: accepted ? `${invitedName} is in!` : `${invitedName} can't make it`,
  body: accepted
    ? `They joined "${sessionName}." Time to plan.`
    : `They passed on "${sessionName}." You can invite someone else.`,
  data: {
    type: "collaboration_invite_response",
    inviteId,
    sessionId,
    response,
    deepLink: `mingla://collaboration/session/${sessionId}`,
  },
  androidChannelId: "collaboration-invites",
}).catch(() => {});
```

Delete all `user_push_tokens` queries.

---

#### 7.2.6 `respond-link-consent/index.ts`

**Push to both users:**
```typescript
// Use sendPushToMany or two individual calls
await sendPush({
  targetUserId: userId1,
  title: `You and ${user2Name} are now linked!`,
  body: "You can now see each other's details in For You.",
  data: {
    type: "link_consent_completed",
    linkId,
  },
}).catch(() => {});

await sendPush({
  targetUserId: userId2,
  title: `You and ${user1Name} are now linked!`,
  body: "You can now see each other's details in For You.",
  data: {
    type: "link_consent_completed",
    linkId,
  },
}).catch(() => {});
```

Delete all `user_push_tokens` queries.

---

#### 7.2.7 `process-referral/index.ts`

**Push to referrer:**
```typescript
await sendPush({
  targetUserId: referrerId,
  title: "You earned Elite time!",
  body: `${referredName} joined Mingla! You earned 1 month of Elite.`,
  data: {
    type: "referral_credited",
    referred_id,
  },
  androidChannelId: "referral-rewards",
}).catch(() => {});
```

Delete the `user_push_tokens` query.

---

#### 7.2.8 `send-friend-request-email/index.ts`

**Push to receiver:**
```typescript
await sendPush({
  targetUserId: receiverId,
  title: `${senderName} wants to connect`,
  body: "Tap to accept or pass.",
  data: {
    type: "friend_request",
    requestId,
    senderId,
    senderUsername,
  },
  androidChannelId: "friend-requests",
}).catch(() => {});
```

Delete the `user_push_tokens` query.

---

#### 7.2.9 `send-message-email/index.ts`

**Push for regular message:**
```typescript
await sendPush({
  targetUserId: recipientId,
  title: senderName,
  body: truncatedPreview,
  data: {
    type: "message",
    conversationId,
  },
  androidChannelId: "messages",
}).catch(() => {});
```

**Push for mention:**
```typescript
await sendPush({
  targetUserId: recipientId,
  title: `${senderName} mentioned you`,
  body: truncatedPreview,
  data: {
    type: "mention",
    conversationId,
  },
  androidChannelId: "messages",
}).catch(() => {});
```

Delete the `user_push_tokens` query.

---

## 8. Mobile Implementation

### 8.1 Files to DELETE

| File | Reason |
|------|--------|
| `app-mobile/src/services/notificationService.ts` | Expo Push wrapper — replaced by OneSignal. Only used in `useSessionManagement.ts` for mobile-side push sending (security anti-pattern). |
| `app-mobile/src/services/enhancedNotificationService.ts` | Expo Push wrapper — replaced by OneSignal. Used in `MobileFeaturesProvider.tsx`, `AppStateManager.tsx`, `messagingService.ts`, `boardMessageService.ts`. |

### 8.2 Files to MODIFY

#### 8.2.1 `app-mobile/app.json`

**Change 1: Remove `expo-notifications` from plugins array.**

**Remove this entry (line 87):**
```json
"expo-notifications",
```

**Change 2: Remove `onesignal-expo-plugin` development mode — set to production.**

**Replace (lines 112-117):**
```json
[
  "onesignal-expo-plugin",
  {
    "mode": "development"
  }
]
```

**With:**
```json
[
  "onesignal-expo-plugin",
  {
    "mode": "production"
  }
]
```

**Why `production`:** The `development` mode disables some OneSignal features. For a real app (even during dev builds), use `production`. This does NOT affect your development workflow — it only affects how OneSignal configures its native code.

---

#### 8.2.2 `app-mobile/src/services/oneSignalService.ts`

**Replace the entire file. This becomes the single notification service for the entire app.**

```typescript
import { OneSignal, LogLevel } from 'react-native-onesignal'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ONESIGNAL_APP_ID = '388b3efc-14c2-4de2-98cb-68c818be9f06'

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false

/**
 * Initialize the OneSignal SDK. Call once at app startup before any other
 * OneSignal methods. Safe to call again — subsequent calls are no-ops.
 */
export function initializeOneSignal(): void {
  if (_initialized) return
  console.log('[OneSignal] initializeOneSignal() called')
  try {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    OneSignal.initialize(ONESIGNAL_APP_ID)
    OneSignal.Notifications.requestPermission(true)
    _initialized = true
    console.log('[OneSignal] initialized ✅')
  } catch (e) {
    console.warn('[OneSignal] Initialization failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Link the OneSignal player to a Supabase user ID.
 * Call immediately after a successful Supabase sign-in.
 *
 * This sets the external_id in OneSignal, which is how edge functions
 * target push notifications to specific users via the REST API.
 */
export function loginOneSignal(userId: string): void {
  if (!_initialized) return
  try {
    OneSignal.login(userId)
    console.log('[OneSignal] login:', userId)
  } catch (e) {
    console.warn('[OneSignal] login failed:', e)
  }
}

/**
 * Unlink the OneSignal player from the current user.
 * Call immediately after Supabase sign-out.
 */
export function logoutOneSignal(): void {
  if (!_initialized) return
  try {
    OneSignal.logout()
    console.log('[OneSignal] logout')
  } catch (e) {
    console.warn('[OneSignal] logout failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification event listeners
// ─────────────────────────────────────────────────────────────────────────────

export interface OneSignalNotificationData {
  type?: string
  [key: string]: unknown
}

/**
 * Register a callback for when a push notification arrives while the app is
 * in the foreground. The callback receives the notification's `data` payload.
 *
 * By default, OneSignal will display the notification in the system tray.
 * Call `event.preventDefault()` inside the callback to suppress display
 * and handle it purely in-app.
 *
 * Returns a cleanup function to remove the listener.
 */
export function onForegroundNotification(
  callback: (data: OneSignalNotificationData, prevent: () => void) => void
): () => void {
  if (!_initialized) return () => {}

  const handler = (event: any) => {
    const data = (event.getNotification().additionalData ?? {}) as OneSignalNotificationData
    callback(data, () => event.preventDefault())
  }

  OneSignal.Notifications.addEventListener('foregroundWillDisplay', handler)
  return () => {
    OneSignal.Notifications.removeEventListener('foregroundWillDisplay', handler)
  }
}

/**
 * Register a callback for when the user taps a notification (from system tray,
 * lock screen, or banner). The callback receives the notification's `data` payload.
 *
 * Returns a cleanup function to remove the listener.
 */
export function onNotificationClicked(
  callback: (data: OneSignalNotificationData) => void
): () => void {
  if (!_initialized) return () => {}

  const handler = (event: any) => {
    const data = (event.notification.additionalData ?? {}) as OneSignalNotificationData
    callback(data)
  }

  OneSignal.Notifications.addEventListener('click', handler)
  return () => {
    OneSignal.Notifications.removeEventListener('click', handler)
  }
}
```

---

#### 8.2.3 `app-mobile/app/index.tsx`

**Change 1: Remove `expo-notifications` import.**

**Remove (line 75):**
```typescript
import * as Notifications from "expo-notifications";
```

**Change 2: Add new OneSignal listener imports.**

The existing import at line 56 already has:
```typescript
import { initializeOneSignal, loginOneSignal, logoutOneSignal } from "../src/services/oneSignalService";
```

**Change to:**
```typescript
import {
  initializeOneSignal,
  loginOneSignal,
  logoutOneSignal,
  onForegroundNotification,
  onNotificationClicked,
} from "../src/services/oneSignalService";
```

**Change 3: Replace the expo-notifications listeners with OneSignal listeners.**

**Remove the entire useEffect block at lines 188-329** (the `// Push notification listeners` block that uses `Notifications.addNotificationReceivedListener` and `Notifications.addNotificationResponseReceivedListener`).

**Replace with:**
```typescript
  // Push notification listeners — convert pushes to in-app notifications
  useEffect(() => {
    // Foreground: push arrives while app is open
    const removeForeground = onForegroundNotification((data, prevent) => {
      if (!data?.type) return;

      // Suppress system tray notification — handle purely in-app
      prevent();

      switch (data.type) {
        case "friend_link_request":
          inAppNotificationService.notifyFriendLinkRequest(
            (data.requesterName as string) || "Someone",
            data.linkId as string,
            data.requesterId as string,
            data.requesterAvatarUrl as string | undefined
          );
          break;
        case "link_consent_request":
          inAppNotificationService.notifyLinkConsentRequest(
            (data.friendName as string) || "Someone",
            data.linkId as string,
            data.friendUserId as string,
            data.friendAvatarUrl as string | undefined
          );
          break;
        case "collaboration_invite_received":
          inAppNotificationService.notifyCollaborationInvite(
            (data.sessionName as string) || "a session",
            (data.inviterName as string) || "Someone",
            data.sessionId as string,
            data.inviteId as string,
            data.inviterAvatarUrl as string | undefined
          );
          break;
        case "friend_link_declined":
          inAppNotificationService.notifyFriendLinkDeclined(
            (data.declinedByName as string) || "Someone"
          );
          break;
        case "link_consent_completed":
          inAppNotificationService.add(
            "system",
            (data.title as string) || `You and ${(data.friendName as string) || "your friend"} are now linked!`,
            (data.body as string) || "You can now see each other's details in For You.",
            { page: "discover" },
            { linkId: data.linkId }
          );
          break;
        case "collaboration_invite_response":
          inAppNotificationService.add(
            "collaboration_invite",
            (data.title as string) || "Collaboration update",
            (data.body as string) || "Someone responded to your invite.",
            { page: "home" },
            { sessionId: data.sessionId, inviteId: data.inviteId, response: data.response }
          );
          break;
        case "collaboration_invite_sent":
          inAppNotificationService.add(
            "system",
            (data.title as string) || "Invite sent",
            (data.body as string) || "Your collaboration invite was sent.",
            { page: "home" },
            { sessionId: data.sessionId }
          );
          break;
      }
    });

    // Background: user taps a push notification
    const removeClicked = onNotificationClicked((data) => {
      if (!data?.type) return;

      switch (data.type) {
        case "friend_link_request":
          inAppNotificationService.notifyFriendLinkRequest(
            (data.requesterName as string) || "Someone",
            data.linkId as string,
            data.requesterId as string,
            data.requesterAvatarUrl as string | undefined
          );
          setCurrentPage("discover");
          break;
        case "link_consent_request":
          inAppNotificationService.notifyLinkConsentRequest(
            (data.friendName as string) || "Someone",
            data.linkId as string,
            data.friendUserId as string,
            data.friendAvatarUrl as string | undefined
          );
          setCurrentPage("connections");
          break;
        case "collaboration_invite_received":
          inAppNotificationService.notifyCollaborationInvite(
            (data.sessionName as string) || "a session",
            (data.inviterName as string) || "Someone",
            data.sessionId as string,
            data.inviteId as string,
            data.inviterAvatarUrl as string | undefined
          );
          setCurrentPage("home");
          break;
        case "link_consent_completed":
          inAppNotificationService.add(
            "system",
            (data.title as string) || `You and ${(data.friendName as string) || "your friend"} are now linked!`,
            (data.body as string) || "You can now see each other's details in For You.",
            { page: "discover" },
            { linkId: data.linkId }
          );
          setCurrentPage("discover");
          break;
        case "collaboration_invite_response":
          inAppNotificationService.add(
            "collaboration_invite",
            (data.title as string) || "Collaboration update",
            (data.body as string) || "Someone responded to your invite.",
            { page: "home" },
            { sessionId: data.sessionId, inviteId: data.inviteId, response: data.response }
          );
          setCurrentPage("home");
          break;
        case "collaboration_invite_sent":
          inAppNotificationService.add(
            "system",
            (data.title as string) || "Invite sent",
            (data.body as string) || "Your collaboration invite was sent.",
            { page: "home" },
            { sessionId: data.sessionId }
          );
          setCurrentPage("home");
          break;
      }
    });

    return () => {
      removeForeground();
      removeClicked();
    };
  }, []);
```

**Change 4: Keep the existing OneSignal init and login/logout useEffects exactly as they are** (lines 140-156). They are already correct.

---

#### 8.2.4 `app-mobile/src/components/MobileFeaturesProvider.tsx`

**Remove all `enhancedNotificationService` usage.** OneSignal handles permission requests and token registration internally.

**Change 1: Remove imports (lines 5-6):**
```typescript
// DELETE these lines:
import { enhancedNotificationService } from '../services/enhancedNotificationService';
import { smartNotificationService } from '../services/smartNotificationService';
```

**Change 2: Remove `notificationPermissionGranted` state and all notification methods.**

Remove from state:
```typescript
const [notificationPermissionGranted, setNotificationPermissionGranted] = useState(false);
```

Remove from `initializeMobileFeatures()` the notification initialization block (lines 123-131):
```typescript
// DELETE this block:
enhancedNotificationService.initialize()
  .then(permission => {
    setNotificationPermissionGranted(permission);
    return permission;
  })
  .catch(error => {
    return false;
  }),
```

Remove the smart notification initialization block (lines 133-140):
```typescript
// DELETE this block:
user ? smartNotificationService.initializeUser(user.id)
  .then(() => {
    return true;
  })
  .catch(error => {
    return false;
  }) : Promise.resolve(false),
```

Remove the `registerForNotifications` useEffect (lines 91-95):
```typescript
// DELETE:
useEffect(() => {
  if (user && isInitialized) {
    registerForNotifications();
  }
}, [user, isInitialized]);
```

Remove the `registerForNotifications` function (lines 220-233).

Remove the `sendLocalNotification` function (lines 235-246).

Update the context type and value to remove notification-related fields:
- Remove `notificationPermissionGranted` from interface and value
- Remove `registerForNotifications` from interface and value
- Remove `sendLocalNotification` from interface and value

---

#### 8.2.5 `app-mobile/src/components/AppStateManager.tsx`

**Change: Replace `enhancedNotificationService.resetTokenState()` with `logoutOneSignal()`.**

**Where:** Line 800-801.

**Replace:**
```typescript
const { enhancedNotificationService } = await import("../services/enhancedNotificationService");
enhancedNotificationService.resetTokenState();
```

**With:**
```typescript
const { logoutOneSignal } = await import("../services/oneSignalService");
logoutOneSignal();
```

**Why:** OneSignal manages its own token state. Calling `OneSignal.logout()` dissociates the device from the user's external_id. The next `OneSignal.login(newUserId)` will re-associate it.

---

#### 8.2.6 `app-mobile/src/services/messagingService.ts`

**Where:** Lines 608-618.

**Remove the push sending code entirely.** Mobile clients must NOT send pushes to other users — this is a security anti-pattern. The edge function `send-message-email` already handles push delivery for messages.

**Replace the block at ~line 605-620:**
```typescript
// DELETE the try block that imports enhancedNotificationService and calls sendPushNotification
```

If `send-message-email` does NOT currently handle all message types (e.g., direct session messages), create a new edge function or extend the existing one. But do NOT send pushes from the mobile client.

---

#### 8.2.7 `app-mobile/src/services/boardMessageService.ts`

**Where:** Lines 721-736.

**Same as §8.2.6 — remove the mobile-side push sending.** Board message notifications should be sent by an edge function, not the mobile client.

**Remove the block that imports `enhancedNotificationService` and calls `sendPushNotification`.**

---

#### 8.2.8 `app-mobile/src/hooks/useSessionManagement.ts`

**Where:** Lines 6, 1118-1127.

**Remove the import (line 6):**
```typescript
import { notificationService } from '../services/notificationService';
```

**Remove the push sending loop (lines 1118-1127):**
```typescript
// DELETE:
if (otherParticipants?.length) {
  const sessionName = sessionState.availableSessions.find(s => s.id === sessionId)?.name ?? 'Session';
  for (const p of otherParticipants) {
    try {
      await notificationService.sendSessionUpdate(p.user_id, sessionName, 'session_ended');
    } catch (notifError) {
      console.error('[useSessionManagement] Push notification failed:', notifError);
    }
  }
}
```

**Replace with an edge function call** or remove entirely if session-end notifications aren't critical. If needed, create a `notify-session-ended` edge function that takes `sessionId` and sends pushes to all participants via OneSignal.

---

#### 8.2.9 `app-mobile/package.json`

**Remove `expo-notifications` dependency:**
```
"expo-notifications": "~0.32.16",
```

**Keep these (they stay):**
```
"onesignal-expo-plugin": "^2.1.0",
"react-native-onesignal": "^5.3.3",
```

**After removing, run:** `npm install` to update the lockfile.

---

## 9. Configuration Changes

### 9.1 `app-mobile/google-services.json`

**Action:** This file is already correct for Firebase project `mingla-dev`. Commit it to git:
```bash
git add app-mobile/google-services.json
```

### 9.2 `app-mobile/app.json` — Clean Up Stale Google Project ID

**Where:** `expo.extra.GOOGLE_PROJECT_ID` (line 132).

**Change:**
```json
"GOOGLE_PROJECT_ID": "mingla-488410"
```

**To:**
```json
"GOOGLE_PROJECT_ID": "mingla-dev"
```

**Why:** This should match the actual Firebase project. `mingla-488410` was the old project.

---

## 10. Implementation Order

**Step 1: OneSignal Dashboard Setup (§5).**
Configure FCM v1 credentials from Firebase project `mingla-dev`. Configure APNs. Get the REST API key. Store secrets in Supabase. This is all manual browser work — do it FIRST.

**Step 2: Rewrite `push-utils.ts` (§7.1).**
Replace the entire file with the OneSignal REST API version. This is the foundation all edge functions depend on.

**Step 3: Update all 8 edge functions (§7.2).**
For each function: delete the `user_push_tokens` query, change `sendPush()` call to new signature. The notification titles, bodies, and data payloads stay identical — only the delivery mechanism changes.

**Step 4: Deploy edge functions.**
```bash
supabase functions deploy
```
Verify secrets are available: check logs for the `[push-utils] OneSignal credentials not configured` warning — if it appears, secrets weren't set correctly.

**Step 5: Rewrite `oneSignalService.ts` (§8.2.2).**
Replace with the expanded version that includes `onForegroundNotification` and `onNotificationClicked`.

**Step 6: Update `index.tsx` notification listeners (§8.2.3).**
Replace `expo-notifications` listeners with OneSignal listeners. Remove the `expo-notifications` import.

**Step 7: Update `MobileFeaturesProvider.tsx` (§8.2.4).**
Remove all `enhancedNotificationService` and `smartNotificationService` references.

**Step 8: Update `AppStateManager.tsx` (§8.2.5).**
Replace `enhancedNotificationService.resetTokenState()` with `logoutOneSignal()`.

**Step 9: Remove mobile-side push sending (§8.2.6, §8.2.7, §8.2.8).**
Delete push-from-client code in `messagingService.ts`, `boardMessageService.ts`, and `useSessionManagement.ts`.

**Step 10: Delete dead files (§8.1).**
Delete `notificationService.ts` and `enhancedNotificationService.ts`.

**Step 11: Update `app.json` (§8.2.1).**
Remove `expo-notifications` from plugins. Change `onesignal-expo-plugin` mode to `production`.

**Step 12: Update `package.json` (§8.2.9).**
Remove `expo-notifications` dependency. Run `npm install`.

**Step 13: Fix `google-services.json` and stale project ID (§9).**
Commit `google-services.json`. Update `GOOGLE_PROJECT_ID` in `app.json`.

**Step 14: Clean prebuild and rebuild.**
```bash
cd app-mobile
npx expo prebuild --clean
eas build --profile development --platform android
```

**Step 15: Verify on device.**
- Launch app → check Logcat for OneSignal native logs (FCM token registration, player creation)
- Login → check OneSignal dashboard → Audience → search by external ID (Supabase UUID)
- Trigger a push via edge function (e.g., send a friend link) → verify delivery on Android
- Verify iOS still works (regression check)

---

## 11. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | OneSignal native logs on launch | Launch app on Android, check Logcat | OneSignal logs showing FCM token registration, player ID creation | Native |
| 2 | No expo-notifications service in manifest | Inspect `android/app/src/main/AndroidManifest.xml` after prebuild | No `expo.modules.notifications` entries | Build |
| 3 | External ID linked after login | Login as test user, check OneSignal dashboard | User appears in Audience with correct external_id | Mobile → OneSignal |
| 4 | Friend link push delivered | User A sends friend link to User B (Android) | User B receives push within 5 seconds | Edge → OneSignal → FCM |
| 5 | Collab invite push delivered | User A invites User B to session | User B sees push with title "New Collaboration Invite" | Edge → OneSignal → FCM |
| 6 | Foreground notification handled | Push arrives while app is open | In-app notification banner appears, system tray notification suppressed | Mobile |
| 7 | Background tap navigates | User taps push from system tray | App opens to correct page (discover for friend link, home for collab) | Mobile |
| 8 | Decline push delivered | User B declines User A's friend link | User A sees "Connection update" push | Edge → OneSignal → FCM |
| 9 | Link consent push delivered | Both users consent to link | Both receive "You and X are now linked!" push | Edge → OneSignal → FCM |
| 10 | Message push delivered | User A sends message to User B | User B receives push with sender name and preview | Edge → OneSignal → FCM |
| 11 | Mention push delivered | User A mentions User B in session | User B receives "X mentioned you" push | Edge → OneSignal → FCM |
| 12 | Referral push delivered | Referred user joins and accepts | Referrer receives "You earned Elite time!" push | Edge → OneSignal → FCM |
| 13 | iOS push works | Same tests on iOS device | All pushes delivered via APNs | Edge → OneSignal → APNs |
| 14 | Logout clears identity | Logout, check OneSignal dashboard | Device no longer associated with external_id | Mobile → OneSignal |
| 15 | No mobile-side push sending | Search codebase for `exp.host` or `user_push_tokens` reads | Zero results outside of dead code | Security |
| 16 | Edge function error handling | Call `sendPush` with non-existent external_id | Returns false, no crash, function completes normally | Edge |

---

## 12. Common Mistakes to Avoid

1. **Forgetting to set Supabase secrets:** If `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` aren't set via `supabase secrets set`, every push will silently fail with the "credentials not configured" warning. Verify by checking edge function logs after deployment.

2. **Using the wrong OneSignal API endpoint:** The v5 REST API endpoint is `https://api.onesignal.com/notifications` (NOT `https://onesignal.com/api/v1/notifications`). The old v1 endpoint still works but the new one is canonical.

3. **Forgetting `target_channel: "push"`:** When using `include_aliases` with `external_id`, you MUST include `target_channel: "push"` in the request body. Without it, OneSignal doesn't know which channel to deliver on.

4. **Not calling `OneSignal.login(userId)` after auth:** The entire system depends on the mobile client calling `OneSignal.login(userId)` after Supabase authentication. Without this, OneSignal has no external_id to target. The existing code in `index.tsx` already does this — do not remove it.

5. **Leaving `expo-notifications` plugin in `app.json`:** Even if you delete all the JS-side code, the `expo-notifications` plugin will still register its `FirebaseMessagingService` during prebuild if it's in the plugins array. You MUST remove it from plugins.

6. **Not running `npx expo prebuild --clean`:** Without `--clean`, the old `expo-notifications` native code remains. You MUST use `--clean` to regenerate from scratch.

7. **Sending push from mobile client:** The old code sends pushes directly from the app by querying `user_push_tokens`. This exposes other users' push tokens. With OneSignal, all push sending goes through edge functions using the REST API key — the mobile client never touches push delivery. Do not replicate the old pattern.

---

## 13. Future Opportunities (Not In Scope — Just Noting)

Once OneSignal is working end-to-end, these become possible with zero code changes:

- **Segments:** Create "inactive_7d" segment in OneSignal dashboard → send re-engagement campaigns
- **A/B testing:** Test notification copy variations from dashboard → measure open rates
- **Intelligent delivery:** Enable "Intelligent Delivery" per notification → OneSignal sends at each user's optimal engagement time
- **In-app messages:** Create in-app modals/banners in OneSignal dashboard → triggered by user behavior without app updates
- **Journeys:** Build onboarding drip sequences (Day 1: welcome, Day 3: first board, Day 7: invite friend) entirely from dashboard

---

## 14. Handoff to Implementor

This is a **migration** task. You are replacing one push system (Expo Push) with another (OneSignal). The notification types, titles, bodies, and data payloads remain identical — only the delivery mechanism changes.

Execute steps in the exact order specified in §10. The OneSignal dashboard setup (§5) MUST be completed before any code will work. The edge function changes (§7) can be deployed independently of the mobile changes (§8) — they will gracefully handle users who haven't updated their app yet (pushes will fail with "not subscribed" which is expected).

After implementation, produce your `IMPLEMENTATION_REPORT.md` referencing each section of this spec and hand off to the tester for verification against §11.
