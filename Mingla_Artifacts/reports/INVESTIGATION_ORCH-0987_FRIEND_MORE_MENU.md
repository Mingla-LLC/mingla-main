# INVESTIGATION — ORCH-0987 [Friend more-menu]

**Skill:** Claude `mingla-forensics` (INVESTIGATE)
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0987-[friend-more-menu]/` on branch `ORCH-0987-friend-more-menu` (off `origin/main` `661d7b535`, post-ORCH-0986 merge)
**Affected surfaces:** consumer-iOS + consumer-Android (`app-mobile/`)
**Confidence:** HIGH (code-proven; all services exist and are wired in a shipping surface).

## 1. Symptom / goal

ORCH-0986 removed the dead ••• button from the friend profile (`ViewFriendProfileScreen`). ORCH-0987 builds the real ••• action sheet with six actions — unpair/pair, add-to-session (open the viewer's group chats / collab sessions → confirm prompt → invite the friend), mute, remove friend, block user, report user — and it must work on **all surfaces where a friend more-menu belongs**.

## 2. Headline finding (changes the scope)

**All six actions — and their backend services — ALREADY EXIST and are fully wired in one surface: the Connections friends list (`FriendsManagementList.tsx`).** ORCH-0987 is therefore primarily a **frontend reuse/extraction** task — surface the existing menu on the friend profile page (and any other friend surfaces) — **not** a from-scratch feature. No new edge functions or migrations are required.

## 3. Service inventory — every action already has a working service (verified)

| Action | Service / hook (file:line) | Signature |
|---|---|---|
| Unpair / Pair | `services/pairingService.ts:447` `unpair(pairingId)`; `:328` `sendPairRequest(params)`; hooks `hooks/usePairings.ts:154` `useUnpair()`, `:61` `useSendPairRequest()` | exist |
| Add-to-session (+invite) | `services/sessionMembershipService.ts:77` `addFriendsToSessions({sessionIds, friendUserId, sessionNames})`; hook `hooks/useAddFriendToSessions.ts:23`. Fires `send-collaboration-invite` push on `invited` outcome (`:134`). | exist |
| Mute | `services/muteService.ts:235` `toggleMuteUser(userId)` (+ `muteUser`/`unmuteUser`); hook `hooks/useFriendsQuery.ts:70` `useMutedUserIds()` | exist |
| Remove friend | `hooks/useFriends.ts:395` `removeFriend(friendUserId)` → RPC `remove_friend_atomic` | exist |
| Block user | `services/blockService.ts:34` `blockUser(userId, reason?)`; via `hooks/useFriends.ts:419` `blockFriend(userId, reason?)`; `BlockReason = harassment|spam|inappropriate|other` | exist |
| Report user | `services/reportService.ts:41` `submitReport(reportedUserId, reason, details?)`; `ReportReason = spam|inappropriate-content|harassment|other` | exist |

(`moderationService.ts` also present — added recently; blockService/reportService are the canonical action services.)

## 4. Surface inventory — where a friend more-menu exists vs. belongs

| # | Surface | File:line | Status |
|---|---|---|---|
| S1 | Friends list rows (Connections) | `components/connections/FriendsManagementList.tsx:251` (••• `ellipsis-vertical`) + sheet `:260-371` | ✅ **Complete** — all 6 actions wired. The reference implementation. |
| S2 | Friend profile page | `components/profile/ViewFriendProfileScreen.tsx:375` (••• removed by ORCH-0986) | ❌ **Gap — primary ORCH-0987 target.** Needs the menu. |
| S3 | Group/collab chat header participants | `components/MessageInterface.tsx:1199,1256-1270` | No per-participant friend menu (header has collab actions only). Candidate if scope includes chat. |
| S4 | Board member management | `components/BoardMemberManagementModal.tsx:129-190` | Admin controls only (promote/demote/remove-from-board), not personal friend actions. Candidate. |

**Note on "all surfaces it currently exists on":** today the friend more-menu exists on exactly ONE surface (S1, the friends list). The profile page (S2) is the gap. S3/S4 are *candidate* surfaces — they have people rows but no friend more-menu; whether to add it there is a SPEC scope decision for the operator (the directive "all surfaces it exists on" literally = S1, which is already done; the real ask is to bring it to S2 and keep parity wherever friend actions belong).

## 5. Where the action wiring lives (the reuse problem)

The `FriendsManagementList` component renders the menu UI but receives the action handlers as **props wired by its parent `ConnectionsPage.tsx`** (e.g., `onAddToSession`, `onBlockUser` → opens `BlockUserModal`; `onReportUser` → `ReportUserModal`; `onMuteUser` → `muteService.toggleMuteUser`; session list fetched in `ConnectionsPage` state). So the actions are **not** self-contained in the menu component — they're spread across `ConnectionsPage`. To reuse the menu on the profile page without duplicating ~hundreds of lines of wiring (and risking drift), the logic should be **extracted**.

## 6. Fix strategy (DIRECTION ONLY — not a spec)

Extract the existing, proven wiring into reusable units, then mount on the profile + any in-scope surfaces:
1. **`useFriendActions(friendUserId)` hook** — encapsulates pair/unpair, add-to-session (+ available-sessions query + confirm + invite), mute toggle, remove, block, report — returning handlers + state (pulled out of `ConnectionsPage`).
2. **`<FriendActionsSheet>` component** — the bottom-sheet UI (reuse the `FriendsManagementList` sheet markup) driven by the hook; includes the Block/Report modals + the session picker + the **confirm prompt before sending a session invite** (operator requirement 2026-05-28: "a prompt if they are sure, then the person is sent an invite just like adding them normally").
3. **Mount the ••• + sheet on `ViewFriendProfileScreen`** (S2) and refactor `ConnectionsPage`/`FriendsManagementList` (S1) to consume the SAME hook+sheet (single source of truth → Constitution #2, no drift). S3/S4 mount only if the SPEC includes them.

No backend work. The "add to session" confirm→invite mechanism already exists end-to-end (`addFriendsToSessions` → `send-collaboration-invite`); the SPEC only needs to guarantee the **confirm prompt** precedes the invite (verify whether S1's existing flow already prompts; if not, add it in the shared component so both surfaces get it).

## 7. Blast radius
- `ConnectionsPage.tsx` + `FriendsManagementList.tsx` (S1) — must refactor to the shared hook/sheet WITHOUT regressing the working menu (it's live). Strong regression-test target.
- `BlockUserModal`, `ReportUserModal`, session picker — reused by the shared component.
- No DB/RLS/edge-function changes. No cross-surface (business/admin/web) impact — friend menu is consumer-only.

## 8. Invariants
- Constitution #1 (no dead taps): the new ••• must open the sheet (the ORCH-0986 removal was specifically to avoid a dead tap — this ORCH satisfies it properly).
- Constitution #2 (one owner per truth): the extraction must make the shared hook/sheet the SINGLE source for friend actions — do not leave two divergent copies.

## 9. Discoveries for orchestrator
- The 6 actions are production-shipped in Connections; this ORCH is reuse + a profile-page mount, not new feature build. Scope is small → consider whether it even needs full design, or just a tight SPEC.
- Operator must decide S3/S4 inclusion (chat-header / board-member friend menus) — recommend deferring those unless explicitly wanted, to keep this ORCH tight.
- `moderationService.ts` was recently added (session-start git status) — SPEC should confirm whether report/block should route through it vs the existing `reportService`/`blockService` (possible consolidation, but out-of-scope unless operator wants it).

## 10. Confidence
HIGH — every service verified to exist by direct file read; the reference menu (S1) is shipped and wired. Live-fire not required for this code-audit (the actions exist + work in production today); the TEST phase will sim-verify the new profile-page mount + the refactor-no-regression on Connections per the live-fire rule.
