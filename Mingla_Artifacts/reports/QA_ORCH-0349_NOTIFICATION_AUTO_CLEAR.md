# QA Report: ORCH-0349 — Notification Auto-Clear on Entity Resolution

**Tester:** Tester Agent
**Date:** 2026-04-09
**Mode:** TARGETED (Orchestrator-dispatched)
**Verdict:** PASS

---

## Summary

All 10 success criteria verified. 8 pass by independent code tracing, 2 unverified pending migration deployment (code is correct, needs runtime confirmation). 5 regression checks all pass. Zero P0/P1/P2 findings. One P4 (praise).

---

## Success Criteria Results

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| SC-1 | Friend accept from ConnectionsPage clears notification | **PASS** | `useFriends.ts:350-355` — `dismissNotificationByEntity(userId, queryClient, { relatedId: requestId, type: 'friend_request_received' })` called after RPC success + cache invalidation, guarded by `if (userId)` |
| SC-2 | Pair accept from DiscoverScreen clears notification | **PASS** | `usePairings.ts:174-179` — `dismissNotificationByEntity` called in `useAcceptPairRequest.onSuccess`, guarded by `if (userId)` |
| SC-3 | Collab invite accept from pill bar clears notification | **PASS** | `app/index.tsx:1343` — `dismissCollaborationInviteNotifications` already wired. Not modified in this change (correctly). |
| SC-4 | Fresh in-sheet accept clears notification (happy path) | **PASS** | `useNotifications.ts:491-502` — try block unchanged: RPC → invalidations → `await deleteNotification(notificationId)`. Happy path intact. |
| SC-5 | Stale in-sheet accept silently clears notification | **PASS** | `useNotifications.ts:503-506` — catch block now calls `console.warn` + `await deleteNotification(notificationId)`. No re-throw. NotificationsModal's `handleAccept` catch at line ~323 will never be reached. "Action failed" state eliminated. |
| SC-6 | In-sheet decline clears notification | **PASS** | All 4 decline handlers (`declineFriendRequestAction`, `declinePairRequestAction`, `declineCollaborationInviteAction`, `declineLinkRequestAction`) follow identical graceful catch pattern. Independently verified each one. |
| SC-7 | DB trigger fires on status change | **UNVERIFIED** | Migration not deployed. Code verified correct: WHEN clause `OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending'`, SECURITY DEFINER, `OLD.id::TEXT` cast, idempotent DELETE. Needs `supabase db push` + runtime SQL verification. |
| SC-8 | Double-delete is safe | **PASS** | PostgreSQL DELETE on non-existent rows: 0 affected, no error. Supabase client `.delete().eq()` does not throw on 0-row results. `deleteNotification` catches its own errors internally (line ~414). Multiple delete paths (trigger + client) cannot conflict. |
| SC-9 | Non-actionable notifications unaffected | **PASS** | `NotificationsModal.tsx` NOT in git diff (not modified). `trial_ending` / `visit_feedback_prompt` cases (lines 311-317) only call `onMarkAsRead` + `onClose` + `onNotificationTap` — never enter action handler paths. |
| SC-10 | Realtime DELETE propagates cross-device | **UNVERIFIED** | Requires deployed trigger + two devices. Code verified correct: `notifications` table is in `supabase_realtime` publication (migration `20260315000024:68`). Realtime DELETE handler (lines ~274-281) filters by `payload.old.id`. |

---

## Regression Check Results

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| R-1 | Notification creation works | **PASS** | `notify-dispatch/index.ts` not in git diff. No changes to notification creation pipeline. |
| R-2 | Realtime subscription works | **PASS** | INSERT/UPDATE/DELETE handlers in `useNotifications.ts` not modified (diff only touches action handlers and adds new utility). Subscription setup (lines ~274-333) untouched. |
| R-3 | Badge count not broken | **PASS** | `clearNotificationBadge` calls not modified. `markAsRead` and `markAllAsRead` functions untouched. |
| R-4 | Mark All Read / Clear All work | **PASS** | `markAllAsRead` (line ~380) and `clearAll` (line ~421) not in diff. Unchanged. |
| R-5 | Trigger doesn't fire on non-status updates | **PASS** | Trigger WHEN clause: `OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending'`. Internal guard adds second check. Updating only `updated_at` on a pending request will not fire the trigger (status didn't change). Updating `updated_at` on a non-pending request also won't fire (`OLD.status` is not 'pending'). |

---

## Forensic Findings

### P4 — Clean defense-in-depth architecture
The three-layer approach (DB trigger + graceful stale handling + client-side instant cleanup) is well-designed. Each layer works independently. Failure of any single layer is covered by the others. The `dismissNotificationByEntity` utility follows the same patterns as the existing `dismissCollaborationInviteNotifications`. No architectural deviation.

### Edge Cases Verified (No Issues Found)

1. **`deleteNotification` in catch block safety:** `deleteNotification` (line ~402) catches its own errors internally — never throws. Safe to call from a catch block.

2. **Timing race between DB trigger and client-side cleanup:** The RPC (`accept_friend_request_atomic`) changes status in a transaction → trigger fires within that transaction → by the time `dismissNotificationByEntity` runs, the trigger may have already deleted the row. The client's DELETE matches 0 rows (no error), and `setQueryData` filtering an already-removed ID is a no-op. Safe.

3. **Circular import risk:** `useFriends.ts` and `usePairings.ts` import from `useNotifications.ts`. Reverse direction uses dynamic `import()` (e.g., `await import('../services/pairingService')`). No circular dependency.

4. **Collab invite `!result.success` early return:** `acceptCollaborationInviteAction` lines 604-607 return after `deleteNotification` without invalidating caches. Correct — if the invite was already processed, caches were already updated when the entity was resolved from the other surface.

5. **`userId` guard coverage:** All out-of-sheet calls guard with `if (userId)`. All in-sheet handlers guard with `if (!userId) return` at the top. No unguarded path.

---

## Constitutional Compliance

| # | Principle | Verdict |
|---|-----------|---------|
| 1 | No dead taps | **PASS** — "Action failed. Tap to retry." infinite loop eliminated. Stale notifications now silently clear. |
| 2 | One owner per truth | **PASS** — DB trigger is authoritative. Client-side is optimistic UX. Realtime propagates server truth. |
| 3 | No silent failures | **PASS** — All catch blocks log at `warn` level with descriptive messages before clearing. Not silent. |
| 4-14 | Remaining principles | **N/A** — Not affected by this change. |

---

## Verdict

**PASS**

- P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 1 (praise)
- 8/10 SC fully verified, 2/10 unverified pending migration deployment (code confirmed correct)
- 5/5 regression checks pass
- 0 constitutional violations

**Deploy requirement:** Apply migration `20260409800000_auto_clear_notifications_on_entity_resolved.sql` via `supabase db push` BEFORE publishing the OTA update. SC-7 and SC-10 become fully verified after deployment.
