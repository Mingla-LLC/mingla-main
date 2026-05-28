# REVIEW — ORCH-0987 [Friend more-menu] — VERDICT: APPROVED

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-28
**Branch:** `ORCH-0987-friend-more-menu` HEAD `1d6cc54b0`
**Against:** `specs/SPEC_ORCH-0987_FRIEND_MORE_MENU.md` + `reports/IMPLEMENTATION_ORCH-0987_FRIEND_MORE_MENU.md`

## Commit-hash verification (REQUIRED)
**PASS.** HEAD `1d6cc54b0`; working tree clean (0 uncommitted excl node_modules). All 7 claimed files in the commit: `useFriendActions.ts` (+199), `FriendActionsSheet.tsx` (+151), `ViewFriendProfileScreen.tsx` (+34/-2), `friendMenu.ts` (+23), `sharedSessionCleanup.ts` (+42), `friendMenu.test.ts` (+28), implementation report. Every claimed-changed file shows on `git log`.

## Dependency walk (REQUIRED)
**N/A — no config-layer changes.** The diff touches zero `supabase/`, `.github/`, `tsconfig*`, `package.json`, `app.json`, `metro`, or `babel` files. Pure app-mobile frontend (new hook + component + util + profile edit + test). No consumers to walk.

## Spec compliance
- SC-1 ••• opens sheet: `ViewFriendProfileScreen` ••• `onPress={() => setShowActionsSheet(true)}` → `<FriendActionsSheet>` (1 match, wired). No dead tap.
- SC-2 pair-state row: `derivePairAction` + unit test 5/5.
- SC-3 actions match Connections: hook reuses `useSendPairRequest`/`useUnpair`/`useFriends`/`muteService`/`reportService`/`AddToBoardModal`.
- SC-4 add-to-session confirm: `AddToBoardModal` explicit Add = confirm (I-0987-CONFIRM-BEFORE-INVITE).
- SC-6 single owner: action logic lives in `useFriendActions`; `FriendActionsSheet` only passes the hook's API to the modals (no direct service calls). The Connections duplicate is the documented deferral.
- SC-7 ≥44pt + a11y: sheet rows `minHeight:48` + accessibilityLabel each; backdrop-tap close.

## Constitutional
- #1 no dead taps: ••• opens sheet, every row fires an action. PASS.
- #2 one owner: PARTIAL-by-design — profile path uses the shared hook; ConnectionsPage retains its copy until the operator-approved dedupe follow. ACCEPTED (operator option a). Two-path state is transitional + documented.
- #3 no silent failures: 5 catch blocks, all console.error + Alert. PASS.
- #9 no fabrication: N/A (no data display added).

## Regression gate (Step 0.5 — implementor half)
`app-mobile/src/utils/__tests__/friendMenu.test.ts` committed; deno 5/5; fails-on-revert proven (break `derivePairAction` → 3/5 fail; restore → 5/5). Tester's adversarial half pending at TEST.

## Deferrals (accepted, not blockers)
1. ConnectionsPage dedupe → operator-approved follow (option a).
2. Single-owner strict-grep gate → lands with the dedupe (cannot pass while two paths exist).

## COMMS
0006 (BLOCK) is scoped to ORCH-0980. 0007/0009/0010 (WARN/ALL) are backend/migration topics (ORCH-0964/0978) — N/A to this frontend-only ORCH; factored, no action.

## Verdict
**APPROVED.** Route to `mingla-tester` for iOS + Android live-fire. Note: TEST requires `npm install` in the worktree (node_modules is symlinked — ORCH-0986 lesson) + a logged-in account on the sim/device (a Seth touchpoint per the notify-list). No edge deploy / migration this ORCH.
