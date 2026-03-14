# Implementation Report: Friend Request & Acceptance Push Notifications
**Date:** 2026-03-14
**Spec:** Diagnosed from investigation (no formal spec — bug fix + missing feature)
**Status:** Complete

---

## 1. What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `supabase/functions/send-friend-request-email/index.ts` | Sent push for friend requests (no preferences check) | ~117 lines |
| `app-mobile/src/hooks/useFriends.ts` | Friend mutations (accept had no push notification) | ~436 lines |
| `app-mobile/app/index.tsx` | Push notification handler (no `friend_accepted` case) | ~700+ lines |

### Pre-existing Behavior
- **Friend request sending:** Push notification was sent via `send-friend-request-email` edge function, but did NOT check `notification_preferences` before sending.
- **Friend request acceptance:** No push notification was sent to the original sender. The `notifyFriendAccepted()` method existed in `inAppNotificationService.ts` but was never called.
- **Mobile push handler:** Only handled `friend_request`, `collaboration_invite_received`, `collaboration_invite_response`, and `collaboration_invite_sent` types. No `friend_accepted` case existed.

---

## 2. What Changed

### New Files Created
| File | Purpose | Key Exports |
|------|---------|-------------|
| `supabase/functions/send-friend-accepted-notification/index.ts` | Sends push notification to the original sender when their friend request is accepted | Deno edge function (no exports) |

### Files Modified
| File | What Changed |
|------|-------------|
| `supabase/functions/send-friend-request-email/index.ts` | Added `notification_preferences` check before sending push — respects `push_enabled` and `friend_requests` flags |
| `app-mobile/src/hooks/useFriends.ts` | Added best-effort `trackedInvoke('send-friend-accepted-notification')` call in `acceptFriendRequest()` after RPC success |
| `app-mobile/app/index.tsx` | Added `friend_accepted` case to `processNotification` switch + added `friend_accepted: "connections"` to `NAV_TARGETS` |
| `README.md` | Updated edge function count (49→50), added `send-friend-accepted-notification` to edge functions table, updated phone invites section, updated recent changes |

### Edge Functions
| Function | New / Modified | Method | Endpoint |
|----------|---------------|--------|----------|
| `send-friend-accepted-notification` | New | POST | /send-friend-accepted-notification |
| `send-friend-request-email` | Modified | POST | /send-friend-request-email |

---

## 3. Implementation Details

### Change 1: New Edge Function — `send-friend-accepted-notification/index.ts`

Follows the exact same pattern as `send-friend-request-email`:
- CORS headers (identical)
- Validates required fields (`accepterId`, `senderId`)
- Looks up accepter's profile for display name (same name resolution logic)
- Checks `notification_preferences` for the sender (push recipient) using `.maybeSingle()` — handles case where no preferences row exists (default: send)
- Calls `sendPush()` with:
  - `targetUserId: senderId`
  - `title: "{AccepterName} accepted your request"`
  - `body: "You're now connected — start planning together!"`
  - `data: { type: "friend_accepted", accepterId, accepterName, requestId }`
  - `androidChannelId: "friend-requests"`
- Push failure is caught and logged (best-effort)

### Change 2: Notification Preferences Check in `send-friend-request-email`

Added between the `!userExists || !receiverId` guard and the `sendPush()` call:
```typescript
const { data: prefs } = await supabase
  .from("notification_preferences")
  .select("friend_requests, push_enabled")
  .eq("user_id", receiverId)
  .maybeSingle();

if (prefs && (prefs.push_enabled === false || prefs.friend_requests === false)) {
  // Skip push, return success with reason
}
```
Uses `.maybeSingle()` — if no preferences row exists (new user, hasn't configured preferences), defaults to sending (all defaults are `true` per migration `20260312000002`).

### Change 3: Push Call in `acceptFriendRequest()`

Added after `result.success` check, before the revealed invite loop:
```typescript
if (result.sender_id) {
  try {
    await trackedInvoke('send-friend-accepted-notification', {
      body: { accepterId: userId, senderId: result.sender_id, requestId },
    });
  } catch (notifyErr) {
    console.warn('[useFriends] Failed to send friend accepted notification:', notifyErr);
  }
}
```
Follows the exact same pattern as the existing collaboration invite notifications (lines 289-305).

### Change 4: `friend_accepted` Handler in `index.tsx`

Added new case to `processNotification`:
```typescript
case "friend_accepted": {
  const accepterName = (data.accepterName as string) || "Someone";
  const accepterId = data.accepterId as string | undefined;
  inAppNotificationService.notifyFriendAccepted(accepterName, accepterId);
  break;
}
```
Added `friend_accepted: "connections"` to `NAV_TARGETS` — tapping the push navigates to the connections page.

---

## 4. Verification Results

### Success Criteria
| # | Criterion | How Verified |
|---|-----------|-------------|
| 1 | Friend request sends push to receiver | Code path: `addFriend()` → `trackedInvoke('send-friend-request-email')` → `sendPush()`. Verified code exists and is unchanged (was already working). |
| 2 | Friend request push respects notification preferences | New preferences check added before `sendPush()`. Uses `.maybeSingle()` — no row = send (safe default). |
| 3 | Friend acceptance sends push to original sender | New code: `acceptFriendRequest()` → `trackedInvoke('send-friend-accepted-notification')` → `sendPush()`. |
| 4 | Friend acceptance push respects notification preferences | Edge function checks `notification_preferences.friend_requests` and `push_enabled` for the sender. |
| 5 | Mobile app creates in-app notification for `friend_accepted` push | `processNotification` switch handles `friend_accepted` → calls `notifyFriendAccepted()`. |
| 6 | Tapping `friend_accepted` push navigates to connections page | `NAV_TARGETS["friend_accepted"] = "connections"`. |
| 7 | All notification calls are best-effort (never fail the main operation) | All `trackedInvoke` calls wrapped in try/catch with `console.warn`. Edge function push calls use `.catch()`. |

---

## 5. Deviations from Spec

None. The investigation findings were followed exactly as specified.

---

## 6. Known Limitations & Future Considerations

1. **Friend request push avatar:** The `friend_request` push payload does not include the sender's avatar URL. The in-app notification passes `undefined` for `avatar_url`. This is a pre-existing limitation, not introduced by this change.

2. **Friend acceptance in-app notification for the accepter:** When a user accepts a friend request, only the original SENDER gets notified (via push). The ACCEPTER does not get an in-app notification saying "You're now connected with X." This is by design — the accepter just performed the action, so a notification would be redundant.

3. **OneSignal subscription state:** If a user hasn't completed the OneSignal `login()` + `optIn()` flow (e.g., denied notification permission), pushes targeting their `external_id` will fail with "All included players are not subscribed." This is logged by `push-utils.ts` but not surfaced to the caller. This is a pre-existing limitation affecting ALL push notifications, not specific to friend requests.

---

## 7. Files Inventory

### Created
- `supabase/functions/send-friend-accepted-notification/index.ts` — Edge function: sends push to original sender when friend request is accepted

### Modified
- `supabase/functions/send-friend-request-email/index.ts` — Added notification preferences check before sending push
- `app-mobile/src/hooks/useFriends.ts` — Added push notification call in `acceptFriendRequest()`
- `app-mobile/app/index.tsx` — Added `friend_accepted` case to push notification handler + navigation target
- `README.md` — Updated edge function count, tables, and recent changes

---

## 8. Deployment Notes

After merging, deploy the new edge function:
```bash
supabase functions deploy send-friend-accepted-notification
```

Also redeploy the modified edge function:
```bash
supabase functions deploy send-friend-request-email
```

No new environment variables required — uses the same `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` already configured.

No database migrations required — the `notification_preferences` table already exists with the `friend_requests` and `push_enabled` columns.
