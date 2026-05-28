# SPEC — ORCH-0987 [Friend more-menu]

**Skill:** Claude `mingla-forensics` (SPEC)
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0987-[friend-more-menu]/` on branch `ORCH-0987-friend-more-menu`
**Surfaces:** consumer-iOS + consumer-Android (`app-mobile/`)
**Input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0987_FRIEND_MORE_MENU.md`
**Scope chosen by operator:** TIGHT (option A) — profile-page mount + shared extraction + dedupe Connections. NO chat-header / board-member menus.
**Routing after SPEC:** Codex `implementor-mingla` → `mingla-tester` (iOS + Android).

## 1. Scope / Non-Goals / Assumptions

### Scope
1. Extract the friend-action orchestration that currently lives in `ConnectionsPage.tsx` into a reusable **`useFriendActions(friendUserId)` hook** + a reusable **`<FriendActionsSheet>`** component (the ••• bottom sheet), so friend actions have ONE owner.
2. Mount a ••• control + `<FriendActionsSheet>` on the friend profile (`ViewFriendProfileScreen.tsx`) — restoring the affordance ORCH-0986 removed, now functional.
3. Refactor `ConnectionsPage.tsx` / `FriendsManagementList.tsx` to consume the SAME hook + sheet (dedupe — Constitution #2).
4. The six actions: **pair/unpair** (pair-state-aware label), **add-to-session** (picker → confirm prompt → invite + push), **mute/unmute**, **remove friend**, **block user**, **report user**.

### Non-Goals
- Chat-header (`MessageInterface`) and board-member (`BoardMemberManagementModal`) friend menus (S3/S4) — deferred; register a follow-up ORCH if wanted later.
- Any new backend: all services, RPCs, edge functions, and the three modals (`AddToBoardModal`, `BlockUserModal`, `ReportUserModal`) already exist and are reused as-is.
- `moderationService.ts` consolidation — out of scope (keep `blockService`/`reportService` as the action services).
- No DB / RLS / migration / edge-function changes whatsoever.

### Assumptions
- A1: The existing services behave correctly (they ship in Connections today): `pairingService.unpair`/`sendPairRequest`, `useAddFriendToSessions`→`sessionMembershipService.addFriendsToSessions`, `muteService.toggleMuteUser`, `useFriends.removeFriend`/`blockFriend`, `reportService.submitReport`.
- A2: `AddToBoardModal` is the session/collab picker that invites via `addFriendsToSessions` (which fires `send-collaboration-invite` push on `invited`). The implementor reuses it; if it does NOT already show a confirm step before inviting, the shared flow adds an `Alert.alert` confirm before the invite call (operator requirement).
- A3: `ViewFriendProfileScreen` already has `pairedPill`/`isPaired` + `profile.isFriend` + `currentUserId` in scope to drive pair-state + gating.

## 2. Cross-Surface Impact (Phase 2.5)

| # | Surface | In scope? | Behavior / parity |
|---|---------|-----------|-------------------|
| 1 | Consumer iOS | YES | ••• on friend profile + Connections both render the shared `<FriendActionsSheet>`. Parity automatic (one shared component). |
| 2 | Consumer Android | YES | Same shared RN component → automatic parity. Sheet must be dismissible (backdrop tap) on both; Alert confirms are native on both. |
| 3 | Buyer/anon Web | NO | No friend surface. |
| 4 | Business iOS | NO | No friend surface. |
| 5 | Business Android | NO | No friend surface. |
| 6 | Admin Web | NO | No friend surface. |
| 7 | Business Web preview | NO | No friend surface. |

Parity is automatic because both consumer surfaces mount the SAME extracted component — no per-surface code paths. Single shared success criteria below (no `-iOS`/`-Android` split needed beyond the live-fire parity check at TEST).

## 3. Layer Specifications

### 3.1 Hook — `app-mobile/src/hooks/useFriendActions.ts` (NEW)
Encapsulates all friend-action logic currently spread across `ConnectionsPage.tsx` (handlers at `:821 handlePairFriend`, `:846 handleUnpairFriend`, `:3015 handleMuteUser`, `:2984 handleRemoveFriend`, `:3042/3052 handleBlockUser/Confirm`, `:3074/3079 handleReportUser/Submit`, plus the `:3744 onAddToSession` inline).
- **Signature:** `useFriendActions(args: { friendUserId: string; friendDisplayName: string; pairingId?: string | null; isPaired: boolean; isPending: boolean; onAfterAction?: (action: FriendActionKind) => void }): FriendActionsApi`
- **Returns (`FriendActionsApi`):**
  - handlers: `pair()`, `unpair()` (Alert confirm), `mute()`/`toggleMute()`, `removeFriend()` (Alert confirm), `blockUser()` (opens block modal), `reportUser()` (opens report modal), `addToSession()` (opens picker)
  - modal-visibility state + setters for `AddToBoardModal`, `BlockUserModal`, `ReportUserModal`
  - derived: `isMuted` (from `useMutedUserIds`), `pairLabel: "Pair" | "Unpair" | "Pending"`, per-action loading flags
  - the block/report confirm callbacks (`onBlockConfirm(reason)`, `onReportSubmit(userId, reason, details)`) wrapping `blockService`/`reportService`.
- Uses existing hooks/services only (A1). `onError` on every mutation surfaces an `Alert.alert` (Constitution #3) — no silent catch.

### 3.2 Component — `app-mobile/src/components/friends/FriendActionsSheet.tsx` (NEW)
- **Props:** `{ visible: boolean; onClose: () => void; friendUserId: string; friendDisplayName: string; pairingId?: string | null; isPaired: boolean; isPending: boolean; isFriend: boolean; availableSessions: SessionPickerItem[]; }`
- Renders the bottom sheet (reuse the `FriendsManagementList.tsx:260-371` RN-Modal sheet markup + styles — DO NOT introduce a new sheet primitive) with the six rows in this order: Pair/Unpair (label from `pairLabel`; hidden if not friend or self), Add to session, Mute/Unmute, Remove friend, Block user, Report user.
- Internally consumes `useFriendActions` and renders the three existing modals (`AddToBoardModal`, `BlockUserModal`, `ReportUserModal`) wired to the hook's state.
- **Add-to-session contract:** tapping "Add to session" opens `AddToBoardModal` (the session/collab picker). After the user picks a session, show an `Alert.alert` confirm (`"Invite {friendDisplayName} to {sessionName}?"`); on confirm → `addFriendsToSessions` (fires invite + push). No invite without the confirm (operator requirement). If `availableSessions` is empty, show the existing empty state — do not show a broken picker.
- Destructive actions (unpair, remove, block) use `Alert.alert` confirm before firing (matches current Connections behavior).
- Accessibility: each row is a `Pressable` with `accessibilityRole="button"` + label (e.g., `Block {name}`); ≥44pt touch targets (I-38).

### 3.3 Profile mount — `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
- Re-add the ••• overflow chip in the hero (the `overflowButton` style still exists, `:539`), with `onPress` opening `<FriendActionsSheet>`. Remove the ORCH-0986 "hidden to avoid dead tap" comment.
- Wire `<FriendActionsSheet>` with the screen's existing `userId` (friend), `name`, `pairedPill?.pairingId`, `isPaired`, pending state, `profile.isFriend`, and the available-sessions list (fetch via the same source Connections uses — `useCollaborationSessions`/the sessions query; if that query isn't readily available here, the hook exposes a `useAvailableSessionsForInvite()` helper extracted alongside).
- `accessibilityLabel` for the ••• stays `Profile actions for {name}`.

### 3.4 Dedupe — `ConnectionsPage.tsx` + `FriendsManagementList.tsx`
- Replace the in-`ConnectionsPage` handler cluster + modal state + `FriendsManagementList`'s inline sheet with the shared `useFriendActions` + `<FriendActionsSheet>` (or, minimally, route `FriendsManagementList`'s ••• to open the shared sheet). The friend-action LOGIC must live in ONE place (the hook) — no duplicated service-call handlers across `ConnectionsPage` and the profile.
- This refactor MUST NOT regress the Connections menu (it ships today). Strong regression target.

### 3.5 No backend layer
No DB/RLS/edge/migration. (Confirms COMMS-0009 migration-drift concern is N/A here.)

## 4. Success Criteria
- SC-1: A ••• control renders on the friend profile hero; tapping it opens the action sheet. (No dead tap — Constitution #1.)
- SC-2: The sheet shows all six actions; the pair row reads **Unpair** when paired, **Pair** when not, **Pending** when a request is outstanding.
- SC-3: Each action invoked from the profile behaves identically to the same action in Connections (pair/unpair updates state; mute toggles; remove/block/report complete; errors surface via Alert).
- SC-4: Add-to-session opens the session/collab picker; selecting a session shows a confirm prompt naming the friend + session; confirming sends the invite (+ push); cancelling sends nothing.
- SC-5: The Connections friend menu still works unchanged after the refactor (no regression).
- SC-6: Friend-action logic has a single owner — `useFriendActions`; no duplicated per-surface service-call handlers (Constitution #2).
- SC-7: All sheet rows are ≥44pt with accessibility labels; sheet dismissible by backdrop on iOS + Android.

## 5. Invariants
| ID | Invariant | Preservation | Test |
|----|-----------|--------------|------|
| Constitution #1 | No dead taps | ••• opens the sheet; every row fires an action | T-01 |
| Constitution #2 | One owner per truth | Single `useFriendActions` hook; grep gate forbids duplicated handlers | T-07 |
| Constitution #3 | No silent failures | Every mutation has `onError` → Alert | T-04 |
| I-0987-CONFIRM-BEFORE-INVITE (new) | Add-to-session never invites without a confirm | confirm Alert precedes `addFriendsToSessions` | T-05 |

## 6. Test Cases
| Test | Scenario | Expected | Layer |
|------|----------|----------|-------|
| T-01 | Tap ••• on profile | Sheet opens with 6 rows | Component |
| T-02 | Paired vs not vs pending | Row reads Unpair / Pair / Pending | Component |
| T-03 | Mute from profile | `toggleMuteUser` called; isMuted flips; reflected in Connections | Hook+service |
| T-04 | Block service errors | Alert surfaces; user not silently "blocked" | Hook |
| T-05 | Add-to-session confirm | Pick session → confirm Alert → invite sent; cancel → no invite | Component+service |
| T-06 | Remove/unpair confirm | Destructive Alert precedes the call | Component |
| T-07 | Single-owner gate | `ConnectionsPage` + `ViewFriendProfileScreen` both import the shared sheet; no duplicated `submitReport`/`blockUser`/`toggleMuteUser` call sites outside `useFriendActions` | strict-grep |
| T-08-iOS / T-08-Android | Parity live-fire | Sheet + each action work on both | Component |

**Step 0.5 gate:** implementor ships a happy-path test (e.g., T-02 pair-state rendering or T-05 confirm-before-invite) with fails-on-revert; tester writes an adversarial test on a different angle (e.g., T-04 error-surfacing or T-07 single-owner). app-mobile uses the node-assertion test pattern (per ORCH-0975 precedent).

## 7. Implementation Order
1. Extract `useFriendActions.ts` (move logic from `ConnectionsPage`).
2. Build `FriendActionsSheet.tsx` (reuse `FriendsManagementList` sheet markup + the 3 existing modals).
3. Mount ••• + sheet on `ViewFriendProfileScreen`.
4. Refactor `ConnectionsPage`/`FriendsManagementList` onto the shared hook+sheet (no regression).
5. Tests (§6) + strict-grep single-owner gate (`.github/scripts/strict-grep/orch-0987-friend-actions.mjs`, one script + one job per the registry pattern). No backend allowlist needed (no `supabase/` touch → COMMS-0002 N/A).

## 8. Regression Prevention
- Single-owner strict-grep gate (T-07): friend-action service calls (`submitReport`, `blockUser`/`blockFriend`, `toggleMuteUser`, `addFriendsToSessions`, `unpair`) appear only inside `useFriendActions.ts` — not duplicated in screen components.
- Pair-state + confirm-before-invite tests lock the two behaviors most likely to regress.

## 9. Confidence
HIGH. Pure frontend reuse of shipping services + modals; the only genuinely new code is the hook + sheet wrappers and the profile mount. No backend risk. Main risk is the Connections refactor regressing the existing menu — mitigated by SC-5 + the dedupe being a move, not a rewrite.
