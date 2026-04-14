# Implementation Report: ORCH-0407 + ORCH-0404 — Push Alive + Realtime Resilience + Schema Fixes

> **Date:** 2026-04-13
> **Status:** Implemented, partially verified (TypeScript pass; needs device testing + migration deploy)
> **Files changed:** 4 files + 1 new migration
> **TypeScript:** 0 errors

---

## Fix 1: Stop Suppressing Foreground Push (ORCH-0407)

### app/index.tsx

**Before (lines 607-618):**
```typescript
const MESSAGE_TYPES = new Set(['direct_message_received', 'message', 'board_message_received', 'board_message_mention', 'board_card_message']);
const removeForeground = onForegroundNotification((data, prevent) => {
  if (!userIdRef.current) return;
  const notifType = data.type as string | undefined;
  if (notifType && MESSAGE_TYPES.has(notifType)) { return; }
  prevent();
});
```
**Why it was that way:** When Realtime was wired for in-app notifications, the reasoning was "push is redundant while app is open." All non-message pushes were suppressed.
**After:**
```typescript
const removeForeground = onForegroundNotification((_data, _prevent) => {
  // No-op: all pushes pass through to system tray
});
```
**Why safe:** The clicked handler (line 621-624) is completely separate and unchanged. `prevent()` was only preventing the system tray banner — removing it just lets banners show. No data flow changes.
**Revert:** Re-add `MESSAGE_TYPES` filter + `prevent()` call.

Also updated comment at line 552 to remove stale `MESSAGE_TYPES` reference.

---

## Fix 2: Add Polling Fallback to Pairings (ORCH-0404)

### app-mobile/src/hooks/usePairings.ts

**Before (usePairingPills, line 36-43):**
```typescript
staleTime: 2 * 60 * 1000, // 2 minutes
// no refetchInterval
```
**Why it was that way:** Relied entirely on Realtime via useSocialRealtime. No fallback was considered necessary.
**After:**
```typescript
staleTime: 2 * 60 * 1000,
refetchInterval: 5 * 60 * 1000, // ORCH-0404: Polling fallback matching friends pattern.
```
**Why safe:** Additive — doesn't remove Realtime invalidation. Same pattern used by useFriendsList and useFriendRequests (useFriendsQuery.ts). 5-minute cadence is a lightweight safety net.
**Revert:** Remove the `refetchInterval` line.

**Before (useIncomingPairRequests, line 45-52):**
```typescript
staleTime: 60 * 1000, // 1 minute
// no refetchInterval
```
**After:**
```typescript
staleTime: 60 * 1000,
refetchInterval: 5 * 60 * 1000, // ORCH-0404: Polling fallback — same safety net as pills.
```
**Why safe:** Same reasoning as above. Incoming pair requests also relied entirely on Realtime with no fallback.
**Revert:** Remove the `refetchInterval` line.

---

## Fix 3: Add Missing `reminders` Column (ORCH-0407)

### supabase/migrations/20260413000001_add_reminders_to_notification_preferences.sql

**Before:** Column didn't exist. `notify-dispatch` read `prefs.reminders` and got `undefined`. Reminders worked because `undefined === false` evaluates to `false`, so the skip check never triggered.
**After:** `ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS reminders BOOLEAN NOT NULL DEFAULT TRUE;`
**Why safe:** `DEFAULT TRUE` means all existing users keep getting reminders — no behavior change. Users who want to disable reminders now have a real column to set to `false`.
**Revert:** `ALTER TABLE public.notification_preferences DROP COLUMN IF EXISTS reminders;`

**DO NOT DEPLOY YET.** User must run `supabase db push` before OTA update.

---

## Fix 4: Remove Dead `dm_bypass_quiet_hours` Reference (ORCH-0407)

### supabase/functions/notify-dispatch/index.ts

**Before (lines 241-254):**
```typescript
if (isQuietHours(userTimezone)) {
  const bypassAllowed =
    type === "direct_message_received" &&
    prefs?.dm_bypass_quiet_hours === true;
  if (!bypassAllowed) {
    return jsonResponse({ ... reason: "quiet_hours" });
  }
}
```
**Why it was that way:** Aspirational code for a "DMs bypass quiet hours" feature. The column was never added to the schema, so the check was always false — DMs were always blocked during quiet hours like everything else.
**After:**
```typescript
if (isQuietHours(userTimezone)) {
  // ORCH-0407: Removed dead dm_bypass_quiet_hours check — column never existed
  return jsonResponse({ ... reason: "quiet_hours" });
}
```
**Why safe:** The bypass was never functional — `prefs?.dm_bypass_quiet_hours` was always `undefined`, so `bypassAllowed` was always `false`. The `if (!bypassAllowed)` block always executed. Removing the dead check produces identical runtime behavior.
**Revert:** Re-add the `bypassAllowed` variable and conditional. Then add the column to actually enable the feature.

---

## Verification Matrix

| Criterion | Method | Result |
|-----------|--------|--------|
| TypeScript passes | `npx tsc --noEmit` | **PASS** — 0 errors |
| Migration file created (not deployed) | File exists at expected path | **PASS** |
| No changes to clicked handler | Verified lines 621-624 unchanged | **PASS** |
| No changes to OneSignal service | No edits to oneSignalService.ts | **PASS** |
| ORCH-0407 SC1: Friend request shows banner in-app | Needs device test | **UNVERIFIED** |
| ORCH-0407 SC2: Pair accepted shows banner in-app | Needs device test | **UNVERIFIED** |
| ORCH-0407 SC3: DM messages still show banner | Needs device test (no regression) | **UNVERIFIED** |
| ORCH-0404 SC1: Pairings refresh within 5 min without user action | Needs device test after WebSocket drop | **UNVERIFIED** |

---

## Regression Surface

1. **DM push notifications** — must still show in-app (previously worked, should not regress)
2. **Notification tap navigation** — clicked handler unchanged, but verify deep links still route correctly
3. **Quiet hours** — verify DMs are still blocked during quiet hours (same as before — the bypass never worked)
4. **Pairing pills UI** — verify the 5-min refetch doesn't cause visible flickering or loading states
5. **Reminder notifications** — verify calendar/birthday/holiday push still sends after migration (DEFAULT TRUE preserves behavior)

---

## Deploy Order

1. **Apply migration FIRST:** `supabase db push` (adds `reminders` column)
2. **Deploy edge function:** `notify-dispatch` with dead code removed
3. **Publish OTA:** iOS and Android updates

---

## Discoveries for Orchestrator

None. All changes within scope.
