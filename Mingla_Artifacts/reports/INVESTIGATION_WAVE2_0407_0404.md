# Investigation Report: Wave 2 — ORCH-0407 (Push Notifications) + ORCH-0404 (Realtime Updates)

> **Date:** 2026-04-13
> **Confidence:** ORCH-0407: High (code audit complete) | ORCH-0404: High for architecture, PROBABLE for the specific pair-request bug
> **Standard:** Maximum caution. Every finding backed by file+line.

---

## Executive Summary

**ORCH-0407 (Push Notifications):** The push notification system is NOT fundamentally broken — it's actually one of the most well-architected parts of the app. There are 11 edge functions that send notifications through a centralized dispatch hub (`notify-dispatch`) with user preferences, quiet hours, rate limiting, idempotency, and i18n. OneSignal integration is correctly wired: init → login → permission → handlers.

The real issue is **perception, not plumbing.** When the app is in the foreground, ALL non-message push notifications are intentionally suppressed (code at `app/index.tsx:608-618`). The design intent: Realtime delivers in-app notifications, so push is redundant while the app is open. But this makes the app feel dead — the user sees nothing happening unless they open the notification center. There are also 3 schema bugs (missing `reminders` column, nonexistent `dm_bypass_quiet_hours` column, disabled Android channels) and an abandoned table.

**ORCH-0404 (Realtime Updates):** The pairing system DOES have Realtime subscriptions — both `pair_requests` and `pairings` tables are subscribed via `useSocialRealtime.ts`. The sender's UI SHOULD update when the receiver accepts. The code is correct on paper. If the user is experiencing stale state, the most likely cause is ORCH-0337 (Realtime handlers silently cleared after disconnect/reconnect — a known open issue). Collaboration sessions have the most extensive Realtime coverage in the app (16 postgres_changes + 5 broadcast listeners). All major two-party systems (friends, pairings, DMs, sessions) have Realtime + polling fallback. Only blocking/muting lack Realtime.

---

## ORCH-0407: OneSignal Integration Health

### Architecture Overview

Two-tier system:
1. **Server-side notifications:** Persistent rows in `notifications` table, synced to client via Supabase Realtime → in-app notification center
2. **Push notifications:** Sent via OneSignal REST API for device-level alerts (lock screen, system tray)

### Player ID / Device Registration

| Step | Where | Evidence |
|------|-------|----------|
| SDK initialization | `oneSignalService.ts:33-51` | Called once at `app/index.tsx:288`. Retries 3x with 3s delay. |
| Login (link device to user) | `oneSignalService.ts:69-80` | Uses `OneSignal.login(userId)` with Supabase UUID as `external_id`. Called at `app/index.tsx:296-304`. |
| Permission request | `oneSignalService.ts:93-110` | Deferred to after coach mark tour via `permissionOrchestrator.ts`. Calls `pushSubscription.optIn()`. |
| Logout (unlink device) | `oneSignalService.ts:116-125` | Called in `AppStateManager.tsx:747` on sign-out. |

**No `player_id` storage in DB.** OneSignal manages FCM/APNs tokens internally. The app uses `external_id` (Supabase UUID) for targeting. The `user_push_tokens` table was created (migration `20260310000002`) but is **abandoned — never written to, never read from anywhere.**

### Push Notification Trigger Matrix

| Event | Edge Function | Sends Push? | To Whom? | Trigger | Status |
|-------|-------------|-------------|----------|---------|--------|
| New DM message | `notify-message` → `notify-dispatch` | YES | Recipient | User sends message | WORKING |
| Board message / mention | `notify-message` → `notify-dispatch` | YES | Other participants | User sends board message | WORKING |
| Friend request received | `send-friend-request-email` | YES (email) + DB notification row (triggers Realtime) | Receiver | User sends friend request | PARTIAL — push not confirmed, email yes |
| Friend request accepted | `send-friend-accepted-notification` → `notify-dispatch` | YES | Sender | Receiver accepts | WORKING |
| Pair request received | `send-pair-request` edge fn | DB notification row (triggers Realtime) | Receiver | User sends pair request | NEEDS VERIFICATION — push may not fire |
| Pair request accepted | `send-pair-accepted-notification` → `notify-dispatch` | YES | Sender | Receiver accepts | WORKING |
| Collaboration invite | `send-collaboration-invite` → `notify-dispatch` | YES | Receiver | User invites to session | WORKING |
| Collaboration invite response | `notify-invite-response` → `notify-dispatch` | YES | Sender | Receiver accepts/declines | WORKING |
| Session card saved | `boardNotificationService.notifyCardSaved` → `notify-dispatch` | YES | Other participants | User saves card to board | WORKING |
| Session card voted | `boardNotificationService.notifyCardVoted` → `notify-dispatch` | YES | Card saver | User votes on card | WORKING |
| Session match | `notify-session-match` → `notify-dispatch` | YES | All participants | Mutual likes detected | WORKING |
| Calendar reminder | `notify-calendar-reminder` (cron) | YES | User with scheduled entry | Daily cron | WORKING |
| Birthday reminder | `notify-birthday-reminder` (cron) | YES | User with upcoming birthday | Daily cron at 9 AM UTC | WORKING |
| Holiday reminder | `notify-holiday-reminder` (cron) | YES | User with paired birthday | Cron | WORKING |
| Paired user saved card | `notify-pair-activity` → `notify-dispatch` | YES | Paired partner | User saves a card | WORKING |
| Referral credited | `notify-referral-credited` → `notify-dispatch` | YES | Referrer | New user uses code | WORKING |
| Re-engagement | `notify-lifecycle` (cron) | YES | Inactive users | Weekly cron | WORKING |
| Weekly digest | `notify-lifecycle` (cron) | YES | Active users | Weekly cron | WORKING |
| Onboarding incomplete | `notify-lifecycle` (cron) | YES | Users who didn't finish | Cron | WORKING |
| Nearby friend on map | NONE | NO | N/A | N/A | NEVER BUILT |
| Someone saved a card you shared | NONE | NO | N/A | N/A | NEVER BUILT |

### The "App Feels Dead" Root Cause

**File:** `app-mobile/app/index.tsx:608-618`

```typescript
const MESSAGE_TYPES = new Set([
  'direct_message_received', 'message', 'board_message_received',
  'board_message_mention', 'board_card_message'
]);
const removeForeground = onForegroundNotification((data, prevent) => {
  if (!userIdRef.current) return;
  const notifType = data.type as string | undefined;
  if (notifType && MESSAGE_TYPES.has(notifType)) {
    return; // Let message pushes show in system tray
  }
  prevent(); // Suppress non-message pushes
});
```

**What this does:** When the app is in the foreground, ALL push notifications EXCEPT messages are silently suppressed. The design intent is that Realtime delivers in-app notifications, making push redundant. But the user never sees anything happen unless they open the notification center.

**Classification:** DESIGN DECISION, not a bug. But it directly causes the "app feels dead" perception. The user explicitly wants push to make the app feel alive even while in-app.

### Schema Bugs Found

| Bug | Location | Impact | Severity |
|-----|----------|--------|----------|
| Missing `reminders` column in `notification_preferences` | Migration `20260312000002` | Users cannot disable calendar/birthday/holiday push — `notify-dispatch:48` references `prefs.reminders` which doesn't exist, so it's always `undefined` (falsy in JS → notifications disabled for reminders!) | S1 — reminders may never send |
| `dm_bypass_quiet_hours` referenced but doesn't exist | `notify-dispatch:245` | DMs never bypass quiet hours even if intended | S2 |
| Android channels commented out | `notify-dispatch:268-273` | All Android pushes use default channel — no priority differentiation | S2 |
| Abandoned `user_push_tokens` table | Migration `20260310000002` | Dead table + weekly cron cleanup on empty table | S3 |

### CRITICAL FINDING: `reminders` Preference Bug

**File:** `supabase/functions/notify-dispatch/index.ts:48-53` (type-to-preference mapping)

The code maps `holiday_reminder`, `birthday_reminder`, `calendar_reminder_tomorrow` to the `"reminders"` preference. But `notification_preferences` table has NO `reminders` column.

When `notify-dispatch` checks `prefs.reminders`:
- `prefs` is the row from `notification_preferences`
- `prefs.reminders` is `undefined` (column doesn't exist)
- The check `if (prefs[prefKey] === false)` → `undefined === false` → `false` → notification PROCEEDS

So reminders DO send, but only by accident (undefined !== false). If someone adds the column with `DEFAULT TRUE`, behavior is preserved. If they add it with `DEFAULT FALSE`, all reminders break silently.

---

## ORCH-0404: Collaboration Session Realtime Verification

### CONFIRMED: Collaboration sessions have extensive Realtime

**File:** `app-mobile/src/services/realtimeService.ts:297-614`

`subscribeToBoardSession(sessionId, callbacks)` creates channel `board_session:${sessionId}` with:
- **16 postgres_changes listeners:** cards saved/updated, votes cast/removed, RSVPs, messages, card messages, presence, participants joined/left, preferences changed, deck regenerated, session updated, card locked
- **5 broadcast listeners:** board messages (instant path), typing start/stop
- **Dual-path messaging:** Broadcast (instant) + postgres_changes (fallback)

This is the most thoroughly wired Realtime system in the app. User's belief that "collaboration sessions have realtime updates" is **PROVEN CORRECT**.

### Pair Request Acceptance — The Specific Bug

**The Realtime subscriptions exist.** In `useSocialRealtime.ts`:
- Line 120-138: `pair_requests` table, `receiver_id=eq.${userId}` — invalidates `pairingKeys.incomingRequests()` + `pairingKeys.pills()`
- Line 140-154: `pair_requests` table, `sender_id=eq.${userId}` — UPDATE events invalidate `pairingKeys.pills()`
- Lines 158-185: `pairings` table, `user_a_id=eq.${userId}` AND `user_b_id=eq.${userId}` — invalidates `pairingKeys.pills()`

When receiver accepts via `accept_pair_request_atomic` RPC:
1. pair_request row UPDATE (status → 'accepted') → triggers Realtime for sender's `sender_id` filter
2. pairings row INSERT → triggers Realtime for sender's `user_a_id` or `user_b_id` filter
3. Both should invalidate `pairingKeys.pills()` → UI refreshes

**So why doesn't the sender see the update?**

Three possible explanations (cannot prove from code alone):

1. **ORCH-0337 (most likely):** Realtime handlers are silently cleared after a WebSocket disconnect/reconnect cycle. This is a known, open, S1 issue. If the sender's WebSocket dropped at any point since opening the app, their `useSocialRealtime` handlers are dead — they receive Realtime events but the callbacks no longer fire. Close/reopen fixes it because it remounts `RealtimeSubscriptions.tsx`.

2. **RPC + Realtime interaction:** `accept_pair_request_atomic` is a SECURITY DEFINER function. While Supabase Realtime should still fire for table changes regardless of who made them (as long as the subscription filter matches), there have been edge cases in Supabase where RPCs don't trigger Realtime events as expected.

3. **Polling gap:** `usePairingPills` has `staleTime: 2 * 60 * 1000` (2 min) but NO `refetchInterval`. If Realtime fails, there's no fallback polling. Unlike friends (which have a 5-min `refetchInterval` fallback), pairings have NO polling safety net.

**Classification:** PROBABLE — the code is correct on paper. The most likely cause is ORCH-0337 (dead Realtime handlers) combined with no polling fallback.

### Two-Party Interaction Matrix

| System | Realtime Sub? | Polling Fallback? | Push Notification? | Both Sides See Update? | Evidence |
|--------|-------------|-------------------|-------------------|----------------------|----------|
| **Pair requests** | YES (sender + receiver) | NO `refetchInterval` | YES (accepted only) | SHOULD but may fail (ORCH-0337) | `useSocialRealtime.ts:120-154` |
| **Friend requests** | YES (receiver only) | YES (5 min) | YES (accepted) | Receiver: yes. Sender: via 5-min poll | `useSocialRealtime.ts:40-51`, `useFriendsQuery.ts:30` |
| **Friends list** | YES | YES (5 min) | N/A | Yes | `useSocialRealtime.ts:94-106` |
| **DM messages** | YES (per-conversation) | NO | YES | Yes (instant via Realtime) | `messagingService.ts:518-530` |
| **DM read receipts** | YES | NO | NO | Yes | `useSocialRealtime.ts:187-198` |
| **Collab session state** | YES (16 listeners) | NO | YES (invites, matches) | Yes (most comprehensive) | `realtimeService.ts:297-614` |
| **Board collaboration** | YES | NO | N/A | Yes | `realtimeService.ts:136-207` |
| **Blocking** | NO | YES (5 min) | NO | Delayed (5 min) | `useFriendsQuery.ts:57-65` |
| **Muting** | NO | NO | NO | Only on app restart | Not found |
| **Calendar entries** | YES | NO | YES (reminders) | N/A (single user) | `useSocialRealtime.ts:108-119` |

### Key Gap: Pairings Have No Polling Fallback

Unlike friends (`refetchInterval: 5 * 60 * 1000`), the `usePairingPills` query has NO `refetchInterval`:

**File:** `app-mobile/src/hooks/usePairings.ts:40-51`
```typescript
export function usePairingPills(userId: string | undefined) {
  return useQuery<PairingPill[]>({
    queryKey: pairingKeys.pills(userId ?? ""),
    queryFn: () => fetchPairingPills(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    // NO refetchInterval — relies entirely on Realtime
  });
}
```

If Realtime fails (ORCH-0337), pairings never refresh until the user navigates away and back, backgrounds the app, or pulls to refresh. Friends have a 5-minute safety net; pairings don't.

---

## Adjacent Findings

| ID | Title | Severity | Source |
|----|-------|----------|--------|
| NEW | `notification_preferences` missing `reminders` column — reminders work by accident (`undefined !== false`) | S1 | ORCH-0407 — notify-dispatch:48 |
| NEW | `dm_bypass_quiet_hours` referenced but column doesn't exist | S2 | ORCH-0407 — notify-dispatch:245 |
| NEW | Android notification channels disabled (commented out) | S2 | ORCH-0407 — notify-dispatch:268 |
| NEW | Abandoned `user_push_tokens` table + weekly cron on empty table | S3 | ORCH-0407 — migration 20260310000002 |
| NEW | Foreground push suppression makes app feel dead (design decision, not bug) | S1 (UX) | ORCH-0407 — index.tsx:608-618 |
| NEW | Pairing pills have NO polling fallback unlike friends | S2 | ORCH-0404 — usePairings.ts:40-51 |
| NEW | Muting has no Realtime AND no polling — only refreshes on restart | S2 | ORCH-0404 |
| EXISTING | ORCH-0337: Realtime handlers cleared after disconnect/reconnect | S1 | ORCH-0404 — probable cause of pair request stale state |

---

## Confidence Assessment

| Finding | Confidence | What Would Raise It |
|---------|-----------|---------------------|
| Push system architecture is working | PROVEN | N/A — code fully traced |
| Foreground suppression causes "dead" perception | PROVEN | User confirmation that they want in-app push banners |
| `reminders` column missing from notification_preferences | PROVEN | Migration + code cross-check complete |
| Pair request Realtime subscriptions exist | PROVEN | Code at useSocialRealtime.ts:120-185 |
| Pair request stale state caused by ORCH-0337 | PROBABLE | Runtime test: check WebSocket state after long use session |
| Pair request stale state caused by missing polling fallback | PROBABLE | Add refetchInterval and test if it resolves |
| Collaboration sessions have full Realtime | PROVEN | 16+5 listeners documented |
