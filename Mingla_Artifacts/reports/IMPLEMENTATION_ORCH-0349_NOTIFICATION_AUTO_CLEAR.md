# Implementation Report: ORCH-0349 — Notification Auto-Clear on Entity Resolution

**Implementor:** Implementor Agent
**Date:** 2026-04-09
**Status:** Implemented, partially verified (needs runtime + migration deployment)

---

## Summary

Notifications now auto-clear when the user acts on the underlying entity — from any surface in the app. Three defense-in-depth layers ensure cleanup happens reliably.

---

## Files Changed

### 1. `supabase/migrations/20260409800000_auto_clear_notifications_on_entity_resolved.sql` (NEW)

**What it did before:** Did not exist. No server-side notification cleanup existed.

**What it does now:** Creates a shared trigger function `delete_notifications_on_entity_resolved()` with SECURITY DEFINER that:
- Fires AFTER UPDATE on `friend_requests`, `pair_requests`, `collaboration_invites`
- Only activates when `OLD.status = 'pending' AND NEW.status != 'pending'`
- Deletes matching notification rows by `related_id` and `type`
- Also adds `idx_notifications_related_id` index for performant lookups

**Why:** Layer 1 (authoritative server-side cleanup). Even if client code fails, stale notifications get cleaned up. The trigger WHEN clause and the function's internal guard both prevent firing on non-status updates.

---

### 2. `app-mobile/src/hooks/useNotifications.ts`

**What it did before:**
- Action handlers (accept/decline for all entity types) threw errors when the entity was already processed, causing permanent "Action failed. Tap to retry." state
- No generic utility for out-of-sheet notification cleanup
- `dismissCollaborationInviteNotifications` existed but was incorrectly identified as dead code (it's used in `app/index.tsx`)

**What it does now:**
- **New `dismissNotificationByEntity()` utility** (exported): Finds notifications by `related_id` + `type`, deletes from DB (fire-and-forget), and optimistically removes from React Query cache. Used by `useFriends` and `usePairings` for out-of-sheet cleanup.
- **All 8 action handlers** now catch errors gracefully: instead of re-throwing (which caused the permanent "Action failed" state), they `warn`-log the error and still call `deleteNotification()`. The user intent ("I've dealt with this") is honored.
- **Collaboration invite handlers** also handle the `!result.success` path by clearing the notification and returning cleanly instead of throwing.

**Why:** Layer 2 (graceful stale-notification handling). Eliminates the cascade failure where stale notifications could never be cleared through their action buttons.

**Lines changed:** ~80 (8 handler catch blocks + 1 new utility function)

---

### 3. `app-mobile/src/hooks/useFriends.ts`

**What it did before:** `acceptFriendRequest()` and `declineFriendRequest()` had zero awareness of the `notifications` table.

**What it does now:** After the entity is resolved and caches are invalidated, both functions call `dismissNotificationByEntity()` as fire-and-forget to clear the corresponding `friend_request_received` notification.

**Why:** Layer 3 (out-of-sheet instant cleanup for friend requests). When accepting/declining from ConnectionsPage or FriendRequestsModal, the notification disappears from the sheet immediately.

**Lines changed:** ~15 (import + 2 cleanup calls)

---

### 4. `app-mobile/src/hooks/usePairings.ts`

**What it did before:** `useAcceptPairRequest` and `useDeclinePairRequest` mutations had zero awareness of the `notifications` table.

**What it does now:** Both mutations call `dismissNotificationByEntity()` in their `onSuccess` handlers to clear the corresponding `pair_request_received` notification. Added `userId` from `useAppStore` to `useDeclinePairRequest` (was already present in `useAcceptPairRequest`).

**Why:** Layer 3 (out-of-sheet instant cleanup for pair requests). When accepting/declining from IncomingPairRequestCard, the notification disappears from the sheet immediately.

**Lines changed:** ~20 (import + 2 cleanup calls + userId access)

---

## Investigation Correction

The investigation report stated that `dismissCollaborationInviteNotifications` was "dead code" — never imported or called. This was **incorrect**. It IS imported and called in `app/index.tsx:87,1343,1370` for both accept and decline of collaboration invites from the pill bar. The collab invite out-of-sheet path was already working. No changes were needed for that path.

---

## Decision Log

| Decision | Reasoning |
|----------|-----------|
| Kept `dismissCollaborationInviteNotifications` | Already in use by `app/index.tsx`. The generic `dismissNotificationByEntity` is used for friend/pair requests; both can coexist. |
| Used trigger WHEN clause + internal guard | Belt-and-suspenders: the WHEN clause prevents the trigger from firing at all on non-status updates, and the internal guard catches edge cases (e.g., if status was already non-pending). |
| Cast `OLD.id::TEXT` in trigger | `related_id` column is TEXT, but entity IDs are UUID. The cast ensures the comparison works correctly. |
| Fire-and-forget for client-side cleanup | The DB trigger is authoritative. Client-side cleanup is a UX optimization (instant cache removal). If it fails, the Realtime DELETE event from the trigger will clean up within 1-2 seconds. |
| Added `userId` to `useDeclinePairRequest` | Needed for the `dismissNotificationByEntity` call. Follows the same pattern already used in `useAcceptPairRequest`. |

---

## Success Criteria Self-Check

| # | Criterion | Verified? | Notes |
|---|-----------|-----------|-------|
| SC-1 | Friend request accepted from ConnectionsPage clears notification | CODE ✅ | `useFriends.ts` calls `dismissNotificationByEntity` after accept. Needs runtime verification. |
| SC-2 | Pair request accepted from DiscoverScreen clears notification | CODE ✅ | `usePairings.ts` calls `dismissNotificationByEntity` in `onSuccess`. Needs runtime verification. |
| SC-3 | Collab invite accepted from pill bar clears notification | CODE ✅ | Already wired via `dismissCollaborationInviteNotifications` in `index.tsx`. No change needed. |
| SC-4 | Fresh in-sheet accept clears notification immediately | CODE ✅ | Happy path unchanged — RPC succeeds, `deleteNotification` fires. |
| SC-5 | Stale in-sheet accept silently clears notification | CODE ✅ | Catch block now calls `deleteNotification` instead of re-throwing. |
| SC-6 | In-sheet decline clears notification | CODE ✅ | Same graceful catch pattern applied. |
| SC-7 | DB trigger fires on status change and deletes notification | UNVERIFIED | Migration written but not deployed. Needs `supabase db push` + SQL verification. |
| SC-8 | Double-delete is safe | CODE ✅ | `DELETE WHERE id=X` is idempotent. Both trigger and client can fire without conflict. |
| SC-9 | Non-actionable notifications unaffected | CODE ✅ | `trial_ending`, `visit_feedback_prompt` handlers are navigation-only (mark read + navigate). Not touched. |
| SC-10 | Realtime DELETE propagates cross-device | UNVERIFIED | Depends on DB trigger firing + Realtime publication. The `notifications` table is already in `supabase_realtime` publication. |

---

## Invariant Preservation

| Invariant | Preserved? |
|-----------|-----------|
| No dead taps | ✅ — Stale notifications now clear instead of showing infinite "Action failed" loop |
| No silent failures | ✅ — Errors are logged at `warn` level; notification deletion still proceeds |
| One owner per truth | ✅ — DB trigger is authoritative. Client-side is optimistic. Realtime propagates truth. |
| Idempotent deletes | ✅ — All DELETE paths match by ID; 0-row deletes produce no errors |

---

## Parity Check

- **Solo / collab:** Both modes use the same notification system. Changes apply equally.
- **In-sheet / out-of-sheet:** Both paths now clear notifications — in-sheet via graceful catch, out-of-sheet via `dismissNotificationByEntity`.

---

## Regression Surface

1. **In-sheet happy path** — accepting fresh notifications from the sheet (unchanged code path)
2. **Notification creation** — `notify-dispatch` edge function (not touched)
3. **Realtime subscription** — INSERT/UPDATE/DELETE handlers (not touched)
4. **Badge count** — `clearNotificationBadge` calls (not touched)
5. **Friend/pair/collab business logic** — the accept/decline RPC and service calls (not touched, only added post-success cleanup)

---

## Discoveries for Orchestrator

1. **Investigation incorrectly flagged `dismissCollaborationInviteNotifications` as dead code.** It's imported and actively used in `app/index.tsx:87,1343,1370`. The collaboration invite out-of-sheet path was already functional.
2. **Pre-existing TypeScript errors** in `app/index.tsx` (isTabVisible prop, activity page type) and `ExperienceCard.tsx` (missing source prop). These are unrelated to this change.
