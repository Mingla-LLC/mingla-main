# IMPLEMENTATION — ORCH-0987 [Friend more-menu]

**Skill:** Claude `mingla-implementor` (parity)
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0987-[friend-more-menu]/` on branch `ORCH-0987-friend-more-menu`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0987_FRIEND_MORE_MENU.md`
**Status:** implemented, partially verified (type-check + unit test green; on-device sim left to tester).
**Scope executed:** operator option (a) — **safe core**: shared hook + sheet + profile mount. ConnectionsPage dedupe DEFERRED to a careful follow (operator-approved).

## Summary
Built the friend ••• action sheet as a shared, single-owner unit and mounted it on the friend profile (the gap ORCH-0986 left). All six actions reuse the existing shipping services + the existing `AddToBoardModal`/`BlockUserModal`/`ReportUserModal`. Zero backend/migration changes.

## Cross-Surface (Step 3.5)
- **Consumer iOS + Android:** the ••• on `ViewFriendProfileScreen` opens `FriendActionsSheet` (shared RN component → automatic parity). Affected files below.
- **NOT affected:** Connections list (unchanged this pass — still uses its own menu; dedupe is the follow), business/admin/buyer-web (no friend surface).

## Old → New Receipts

### `app-mobile/src/utils/sharedSessionCleanup.ts` (NEW)
- **Before:** `cleanupSharedSessions` lived inline in `ConnectionsPage.tsx:2936` (private).
- **Now:** extracted to a reusable `cleanupSharedSessions(currentUserId, otherUserId)` util so the shared hook runs the identical pre-remove/pre-block session cleanup (Constitution #2).
- **Why:** SC-6 single-owner; the hook must behave identically to Connections.

### `app-mobile/src/utils/friendMenu.ts` (NEW)
- **Now:** pure `derivePairAction(isPaired,isPending)` + `FRIEND_MENU_ACTIONS` (6) — testable menu model.
- **Why:** unit-testable pair-state logic (regression anchor).

### `app-mobile/src/hooks/useFriendActions.ts` (NEW)
- **Now:** single hook owning pair (`useSendPairRequest`), unpair (`useUnpair` + confirm), add-to-session (opens picker), mute (`muteService.toggleMuteUser` + `useMutedUserIds`), remove (`useFriends.removeFriend` + cleanup + confirm), block (`useFriends.blockFriend` + cleanup), report (`reportService.submitReport`); manages the 3 modals' visibility; mixpanel parity (`trackFriendRemoved`/`trackFriendBlocked`). Every path surfaces errors via Alert (Constitution #3).
- **Why:** SC-3/SC-6 — friend-action logic has ONE owner.

### `app-mobile/src/components/friends/FriendActionsSheet.tsx` (NEW)
- **Now:** the ••• bottom sheet (RN Modal, markup mirroring `FriendsManagementList`) + renders `AddToBoardModal`/`BlockUserModal`/`ReportUserModal`, all driven by `useFriendActions`. Pair row is pair-state-aware; pair/remove gated by `isFriend`; ≥44pt rows + accessibility labels.
- **Why:** SC-1/2/7. Reuses existing modals → confirm-before-invite is the picker's explicit "Add" button (I-0987-CONFIRM-BEFORE-INVITE satisfied without a redundant Alert).

### `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` (MODIFIED, ~+20 lines)
- **Before:** ••• removed by ORCH-0986 (dead-tap comment).
- **Now:** ••• chip wired to open `FriendActionsSheet`; added `isPendingPair` derivation + `showActionsSheet` state + the sheet mount (passing friend identity, pairingId, isPaired/isPending/isFriend).
- **Why:** SC-1 — the menu now exists + works on the profile (no dead tap).

### `app-mobile/src/utils/__tests__/friendMenu.test.ts` (NEW)
- Regression test (`// @ts-nocheck`, deno-run, matching app-mobile node/deno test convention).

## Spec Traceability
| SC | Status | Evidence |
|----|--------|----------|
| SC-1 ••• opens sheet | IMPLEMENTED, sim-unverified | `ViewFriendProfileScreen` ••• → `setShowActionsSheet(true)` → `<FriendActionsSheet>` |
| SC-2 pair-state row | IMPLEMENTED + unit-tested | `derivePairAction` + test (5/5) |
| SC-3 actions match Connections | IMPLEMENTED | hook reuses the same services/mutations |
| SC-4 add-to-session confirm→invite | IMPLEMENTED | `AddToBoardModal` (its "Add" is the confirm) |
| SC-5 Connections unchanged | N/A this pass | Connections untouched (dedupe deferred) |
| SC-6 single owner | PARTIAL | `useFriendActions` is the owner for the profile path; Connections still has its own copy until the dedupe follow |
| SC-7 ≥44pt + a11y + dismissible | IMPLEMENTED | sheet rows `minHeight:48`, accessibilityLabel each, backdrop-tap close |

## Regression Test
- Path: `app-mobile/src/utils/__tests__/friendMenu.test.ts`
- Run: `deno test --allow-read` → **5 passed / 0 failed**.
- **fails-on-revert VERIFIED:** breaking `derivePairAction` (`return "pair"` short-circuit) → **3/5 failed**; restored → 5/5. (Demonstrated this session; not a git-hash revert since this is net-new code.)

## Verification
- `tsc --noEmit` → **0 errors on ORCH-0987 touched files** (repo has pre-existing unrelated errors outside scope).
- deno unit test green (above).
- Sim live-fire: NOT run by implementor — for the tester (note: this worktree's `node_modules` is symlinked; per the ORCH-0986 lesson the tester must `npm install` in the worktree to run Metro, and use the plain `https://…exp.direct` link for any device test).

## Invariants
- Constitution #1 (no dead taps): ••• now opens the sheet; every row fires an action. PASS.
- Constitution #2 (one owner): PARTIAL — profile path uses `useFriendActions`; the Connections copy remains until the dedupe follow (operator-approved temporary two-path state).
- Constitution #3 (no silent failures): every hook path Alerts on error. PASS.
- I-0987-CONFIRM-BEFORE-INVITE: satisfied via the picker's explicit Add action. PASS.

## Discoveries for Orchestrator
1. **Dedupe follow required** to fully satisfy Constitution #2 + the SPEC's single-owner strict-grep gate (T-07): refactor `ConnectionsPage`/`FriendsManagementList` onto `useFriendActions`/`FriendActionsSheet` and remove the duplicate handler cluster. The single-owner strict-grep gate was DEFERRED (it cannot pass while two paths exist) — it lands with the dedupe.
2. The add-to-session confirm is the `AddToBoardModal` "Add" button (no separate Alert) — confirm this matches operator intent at TEST.
3. Mute feedback uses `Alert` (not the Connections toast) in the shared hook to keep it self-contained — acceptable minor UX variance.

## Transition Items
- `// [TRANSITIONAL]` not used in code, but the **two-path state** (profile via shared hook; Connections via its own handlers) is the transitional condition — exit when the dedupe follow lands.
