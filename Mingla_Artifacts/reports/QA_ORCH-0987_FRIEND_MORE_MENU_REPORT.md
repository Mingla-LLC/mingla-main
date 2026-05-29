# QA — ORCH-0987 [Friend more-menu] — VERDICT: PASS (operator-confirmed iOS; tester-driven Android)

**Tester:** Claude `mingla-tester`
**Date:** 2026-05-28
**Branch:** `ORCH-0987-friend-more-menu` (HEAD `849f25333` + uncommitted session work below)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0987-[friend-more-menu]/`
**Mode:** TARGETED + live-fire (iOS via operator, Android via tester/Maestro+adb)

## Scope (grew past the APPROVED scope — needs re-REVIEW before merge)
1. **Friend profile ••• menu** (original APPROVED scope): shared `FriendActionsSheet` + `useFriendActions` mounted on `ViewFriendProfileScreen`.
2. **Add-to-session fix**: the picker was always empty (sheet was never fed sessions). Fixed with a lazy one-shot session fetch in `useFriendActions` (enabled only while the picker is open; no realtime).
3. **Friends-modal freeze fix**: tapping Add-to-session from the friends-tab modal froze iOS (stacked-modal present-during-dismiss). Fixed by deferring the present.
4. **UNIFY (operator-requested mid-test)**: the friends-tab modal menu (`FriendsManagementList` inline sheet) now routes its ⋮ to the SAME shared `FriendActionsSheet`. Legacy inline sheet + its plumbing removed. One menu owns both surfaces (Constitution #2).

## Static gates — GREEN
- `friendMenu.test.ts` (implementor happy-path) 5/5 + `friendMenu.adversarial.test.ts` (tester, fails-on-revert proven) 5/5 → **10/10**.
- `tsc --noEmit`: 0 errors on every touched file (`useFriendActions`, `FriendActionsSheet`, `friendMenu`, `sharedSessionCleanup`, `ViewFriendProfileScreen`, `ConnectionsPage`, `FriendsManagementList`).

## Live-fire
- **iOS (operator-confirmed):** profile ••• menu works; friends-modal ⋮ → shared menu, all 6 actions, **no freeze** ("all confirmed").
- **Android (tester-driven, device `R58R54YV7JT` Galaxy A72 / Android 14, Maestro+adb):**
  - Profile ••• → sheet opens; Add to session → `friend-actions-sessions` query returns `Array(3)`, picker renders, app responsive, no render storm.
  - Friends-modal ⋮ → friends modal closes → shared sheet opens (no freeze) → Add to session → AddToBoardModal presents correctly.
  - Build: fresh iOS + Android `development` dev clients (EAS `66cef2f0` / `0f9b20e8`) compiled to include the `expo-video` native module (pre-existing main-inherited launch gap that red-boxed older dev builds; not an ORCH-0987 defect).

## Root cause — friends-modal freeze (fixed)
`ConnectionsPage.onAddToSession` synchronously dismissed the action sheet + the friends modal while presenting `AddToBoardModal`. On iOS, presenting a modal in the same tick two others are dismissing leaves an invisible touch-blocking overlay → frozen app. iOS-only (Android has no such race — it silently failed to present instead). Fixed by deferring the present until the dismiss animations finish; the unify generalizes this (⋮ closes the friends modal, then opens the shared sheet at top level — never stacks 3 modals).

## Files changed this session (uncommitted)
- `app-mobile/src/hooks/useFriendActions.ts` — lazy `friend-actions-sessions` useQuery → `boardsSessions`.
- `app-mobile/src/components/friends/FriendActionsSheet.tsx` — pass `boardsSessions`.
- `app-mobile/src/components/connections/FriendsManagementList.tsx` — ⋮ → `onOpenFriendActions`; legacy inline sheet + dead props removed.
- `app-mobile/src/components/ConnectionsPage.tsx` — render shared `FriendActionsSheet` (resolves pairingId/isPaired/isPending from `pairingPills`); close-modal + defer-open; mute refresh on close; removed dead mount props.
- `app-mobile/src/utils/__tests__/friendMenu.adversarial.test.ts` (new).

## Notes / known tradeoffs
- **UX tradeoff (intentional):** using the menu from the friends modal returns to the chat list (not back into the friends modal) — required to avoid the stacked-modal freeze.
- **State sync:** pair/unpair/remove/block sync via React Query (shared hook reuses the same mutation hooks ConnectionsPage reads); mute is ConnectionsPage local state, re-pulled on sheet close (best-effort; self-corrects on focus).

## Discoveries for orchestrator (cleanup / follow-ups)
1. **Dead code to remove in the re-review pass:** `handleMuteUserFromModal` / `handleRemoveFriendFromModal` / `handleBlockFromModal` / `handleReportFromModal` in `ConnectionsPage` are now orphaned (the shared sheet replaced them), plus their now-dead `BlockUserModal`/`ReportUserModal` mounts + `selectedUserToBlock`/`selectedUserToReport` state. Left in place this session to avoid a cascade cleanup of the critical file at the tail of a long session; inert (tsc-clean). Should be removed during the re-review.
2. **Main-inherited:** `expo-video` is in `origin/main` JS; any dev build predating it red-boxes at launch — rebuild dev clients on branches off current main. `expo-video` is listed twice in `origin/main` `app-mobile/package.json` (merge artifact, worth a cleanup).
3. **Scope grew past APPROVED** (unify pulled in by operator) — re-REVIEW required before merge; single-owner strict-grep gate (deferred at SPEC) can now land since the two-path state is resolved.

## Verdict
**PASS** — all six actions work on the friend profile AND the (now-unified) friends-modal surface; the iOS freeze is resolved (operator-confirmed); static gates green. Pending: orchestrator re-REVIEW for the grown scope + the dead-code cleanup in #1.
