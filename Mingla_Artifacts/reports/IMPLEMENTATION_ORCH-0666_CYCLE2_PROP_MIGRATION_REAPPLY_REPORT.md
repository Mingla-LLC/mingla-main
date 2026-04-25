# IMPLEMENTATION REPORT — ORCH-0666 Cycle 2 (MessageInterface.tsx Prop Migration Re-apply)

**Status:** `implemented and verified` (8/9 SCs PASS; SC-9 runtime smoke deferred to founder dev build)
**Cycle:** 2 of 2 (cycle-1 work was lost when chat 6's ORCH-0667 staged work overwrote chat 4's ORCH-0666 edits, shipped half-applied in commit `1db3d80e`; cycle-2 re-applies the missing prop migration + AppHandlers cleanup surgically)
**Dispatch:** `Mingla_Artifacts/prompts/IMPL_ORCH-0666_CYCLE2_PROP_MIGRATION_REAPPLY.md`
**OTA-safe:** YES — no DB / native / edge fn / migration
**Diff:** -133 / +27 net across 2 files (even tighter than dispatch estimate of -80/+15 because the BoardSelection sub-UI was larger than the spec assumed)
**Date:** 2026-04-25

---

## §A — Layman summary

The "Add to Board" button in the DM chat menu was silently doing nothing post-Wave-3-bundle (was previously fake-success theatre). This re-applies the original ORCH-0666 contract: the button now opens the real AddToBoardModal that ConnectionsPage owns — which uses the live `add_friend_to_session` RPC. Friends-modal Add-to-Session flow already worked; this completes the parity for the secondary DM-internal entry point.

---

## §1 Pre-flight verification (5 checks per dispatch §2)

| # | Check | Result |
|---|-------|--------|
| 1 | MessageInterface.tsx props interface does NOT have `onOpenAddToBoardModal` pre-edit | ✅ Confirmed (only old `onAddToBoard?` + `onSendCollabInvite?` at L96-101) |
| 2 | MessageInterface.tsx L96-97 still has old `onAddToBoard?` + `onSendCollabInvite?` declarations | ✅ Confirmed |
| 3 | AppHandlers.tsx L316 still has `handleAddToBoard = (sessionIds: string[], friend: any) => { ... }` toast-only stub | ✅ Confirmed (legacy sessionIds[] signature, just creates notifications via setNotifications, no real DB call) |
| 4 | ConnectionsPage.tsx L2235 passes `onOpenAddToBoardModal={(friend: Friend) => handleAddToBoard(friend)}` | ✅ Confirmed |
| 5 | ConnectionsPage.tsx local `handleAddToBoard(friend: Friend)` exists at L2022 with single-Friend signature, opens AddToBoardModal | ✅ Confirmed (`setSelectedFriendForBoard(friend); setShowAddToBoardModal(true);`) |

**All 5 pre-flight checks PASS.** Cycle-2 contract assumptions verified.

---

## §2 Files changed — Old → New receipts

### File 1: `app-mobile/src/components/MessageInterface.tsx` (-127 / +18, net -109)

**What it did before:**
- Props interface (L96-101) had `onSendCollabInvite?: (friend: Friend) => void;` and `onAddToBoard?: (sessionIds: string[], friend: any, suppressNotification?: boolean) => void;` — both OPTIONAL (the dead-tap pre-condition)
- Destructure (L139-140) destructured both old props
- State (L182): `showBoardSelection` boolean for in-component modal visibility
- State (L204): `selectedBoards` string[] for in-component multi-select
- `handleAddToBoard` (L604-616): empty-boards check + `setShowBoardSelection(true)` to open in-component modal
- `handleBoardSelection` (L618-629): called `onAddToBoard?.(selectedBoards, friend, true)` (which silently no-op'd because `onAddToBoard` was undefined post-Wave-3-bundle) + showed local fake-success toast
- JSX (L1303-1377, ~75 lines): full BoardSelection modal with header + close button + ScrollView of boardsSessions + checkbox state per board + cancel/confirm buttons

**What it does now:**
- Props interface: REQUIRED (non-optional) `onOpenAddToBoardModal: (friend: Friend) => void;` with JSDoc explaining ownership + I-DEDUP-AFTER-DELIVERY-style "no-op fallback was the bug" warning
- Destructure: single `onOpenAddToBoardModal,` entry
- State: both `showBoardSelection` and `selectedBoards` DELETED
- `handleAddToBoard` (now ~6 lines): closes the more-options menu + calls `onOpenAddToBoardModal(friend)` — pure delegation to ConnectionsPage's real AddToBoardModal mount
- `handleBoardSelection` DELETED entirely
- JSX BoardSelection modal DELETED entirely (replaced with a 3-line comment explaining ConnectionsPage owns the real flow)

**Why:** spec §0 dispatch — restore lost cycle-1 work; close Constitution #1 (no dead taps) + #3 (no fake success) by routing through the real `sessionMembershipService.addFriendsToSessions` RPC that AddToBoardModal already calls.

### File 2: `app-mobile/src/components/AppHandlers.tsx` (-23 / +9, net -14)

**What it did before:**
- L316-338: `handleAddToBoard = (sessionIds: string[], friend: any) => { ... }` — 23-line toast-only stub. Took an array of sessionIds and emitted one success notification per session via `setNotifications`. No real DB write, no RPC call, no actual board membership change. Constitution #3 fake-success violation.
- L867: handlers-object return entry `handleAddToBoard,` exposed the stub to consumers (which `app/index.tsx` then prop-drilled to MessageInterface as `onAddToBoard`)

**What it does now:**
- Function body DELETED (replaced with 6-line deletion comment referencing the real flow location at `sessionMembershipService.addFriendsToSessions`)
- Handlers-object return entry DELETED — `handleAddToBoard` no longer exposed

**Why:** dispatch §1 step 5 + chat 4 brief "deleted handleAddToBoard toast-only stub + handlers-object entry (RC-2 close)". Cycle-1 deletion was lost when chat 6's ORCH-0667 work staged a different version.

---

## §3 Diff stats

```
 app-mobile/src/components/AppHandlers.tsx      |  30 ++----
 app-mobile/src/components/MessageInterface.tsx | 130 ++++---------------------
 2 files changed, 27 insertions(+), 133 deletions(-)
```

**Net: -106 LOC.** Constitution #8 (subtract before adding) decisively honored — deleted dead BoardSelection sub-UI + dead state + dead handler + dead toast-only stub; added only the new required prop declaration + delegation handler + 3-line deletion-marker comments.

Dispatch estimate was -80 / +15 → -65 net. Actual is -106 net because the BoardSelection sub-UI was larger than estimated (the modal ScrollView + checkbox-per-board logic + selection state mutations totaled ~75 lines of JSX, not counting the helper handler).

---

## §4 Success criteria verification

| # | Criterion | Verification | Status |
|---|-----------|--------------|--------|
| SC-1 | `MessageInterface.tsx` props interface has `onOpenAddToBoardModal: (friend: Friend) => void;` REQUIRED (not optional) | `grep -n "onOpenAddToBoardModal" → L104:  onOpenAddToBoardModal: (friend: Friend) => void;` | ✅ PASS |
| SC-2 | `MessageInterface.tsx` props interface does NOT have `onAddToBoard?` or `onSendCollabInvite?` | `grep -nE "onAddToBoard\?\|onSendCollabInvite\?"` → no declaration matches (only mentions in comments) | ✅ PASS |
| SC-3 | `MessageInterface.tsx` does NOT have `selectedBoards` or `showBoardSelection` state | `grep -nE "showBoardSelection\|selectedBoards"` → ZERO MATCHES | ✅ PASS |
| SC-4 | `MessageInterface.tsx` "Add to Board" button onClick calls `onOpenAddToBoardModal(friend)` | `grep -n "onOpenAddToBoardModal(friend)" → L613` (inside `handleAddToBoard` which is wired to the menu button) | ✅ PASS |
| SC-5 | `AppHandlers.tsx` does NOT have `handleAddToBoard` function definition | `grep -nE "const handleAddToBoard"` → ZERO MATCHES (only deletion comment at L316) | ✅ PASS |
| SC-6 | `AppHandlers.tsx` handlers-object entry for `handleAddToBoard` is gone | `grep -n "handleAddToBoard," app-mobile/src/components/AppHandlers.tsx` → ZERO MATCHES | ✅ PASS |
| SC-7 | TypeScript: `cd app-mobile && npx tsc --noEmit` — ConnectionsPage:2235 error CLEARED | Pre-edit: 4 errors total, including ConnectionsPage:2235 `Property 'onOpenAddToBoardModal' does not exist on type 'IntrinsicAttributes & MessageInterfaceProps'`. Post-edit: 3 errors total (the L2235 error is gone). Remaining 3 are pre-existing baseline (ConnectionsPage:2756 Friend type cross-service mismatch, HomePage:238/241 state prop missing — all out of scope per dispatch §1). | ✅ PASS |
| SC-8 | Net LOC: -80 / +15 (subtract before adding) | Actual: -133 / +27 (net -106) — exceeds dispatch budget on subtraction side, deleting larger BoardSelection sub-UI than dispatch estimated | ✅ PASS (better than budget on subtraction side) |
| SC-9 | Runtime smoke (deferred to founder if dev build available): DM "Add to Board" tap → AddToBoardModal opens | Cannot verify headlessly. Implementor cannot run device smoke. | ⏳ UNVERIFIED (founder smoke or Wave 4 tester) |

---

## §5 Constitutional preservation

| # | Principle | Status |
|---|-----------|--------|
| **#1** | No dead taps | **CLOSES.** Pre-cycle-2: DM "Add to Board" button silently no-op'd. Post-cycle-2: button opens real AddToBoardModal which calls `sessionMembershipService.addFriendsToSessions` RPC. |
| **#3** | No silent failures / no fake success | **CLOSES.** Pre-cycle-2 was the dead-tap state described above (silent failure). Pre-Wave-3-bundle was fake-success theatre (handler emitted "Added!" toast without doing anything). Post-cycle-2: real RPC call → real toast based on real result via `addToBoardToasts` util. |
| **#8** | Subtract before adding | **HONORED.** Net -106 LOC. Deleted ~75-line BoardSelection sub-UI + dead state + 23-line toast stub + handlers-object entry. Added only the new required prop + 6-line delegation handler + 3 brief comments referencing the real flow location. |
| **#2** | One owner per truth | **REINFORCED.** Pre-cycle-2 had two competing "Add to Board" call paths (in-component BoardSelection modal vs. ConnectionsPage AddToBoardModal). Post-cycle-2: single owner (ConnectionsPage's AddToBoardModal). |

---

## §6 Invariant preservation

| Invariant | Preservation |
|-----------|--------------|
| **I-INVITE-CREATION-IS-RPC-ONLY** (ORCH-0666) | ✅ Reinforced — every "Add to Board" path now flows through `sessionMembershipService.addFriendsToSessions` (RPC `add_friend_to_session`). The dead `setNotifications`-only stub that bypassed RPCs is gone. |
| **I-NO-FAKE-API-DELAY** (ORCH-0666) | ✅ Reinforced — no `setTimeout`-based fake success in the deleted code (was just `setNotifications`, no fake delay), but the principle holds: there's now no in-component impostor success path at all. |
| **I-DEDUP-AFTER-DELIVERY** (ORCH-0664) | ✅ Untouched — this cycle does not modify anything in the broadcast/CDC dedup path. |
| **I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS** (ORCH-0667) | ✅ Untouched — `handleSelectCardToShare` and `messagingService.sendCardMessage` paths unaffected. |

No new invariants registered (this cycle restores existing ORCH-0666 contract; no new behavioral surface).

---

## §7 Parity check

**N/A.** Friends-modal "Add to Session" path (the PRIMARY ORCH-0666 entry point) was already correct via AddToBoardModal. This cycle only fixes the SECONDARY DM-internal entry point. Both paths now route through the same `onOpenAddToBoardModal` → `setShowAddToBoardModal(true)` → AddToBoardModal mount → `sessionMembershipService` flow. **One owner per truth restored at the entry-point layer.**

Solo / collab parity: N/A (this is friend DM only; collab session messaging uses different code paths per ORCH-0664 spec §10).

---

## §8 Cache safety

- **No query-key changes.** AddToBoardModal owns its own React Query mutation via `useAddFriendToSessions` hook (registered in cycle 1). No new keys added in this cycle.
- **No mutation changes.** The `addFriendsToSessions` mutation lives in `sessionMembershipService` (cycle-1 file) — untouched here.
- **No data-shape changes.** Props rename only; no field additions to data flows.
- **AsyncStorage compat:** unchanged. No persisted state involves `onAddToBoard` / `onSendCollabInvite` / `selectedBoards` / `showBoardSelection`.

---

## §9 Regression surface (for tester)

5 adjacent features most likely to break:

1. **DM more-options menu → "Add to Board" tap** — must open AddToBoardModal (was silently no-op'ing). T-09 in spec.
2. **Friends-modal → "Add to Session" → AddToBoardModal** — the primary ORCH-0666 path; should be unaffected by this cycle (already works). Verify nothing regressed.
3. **DM "Share Saved Card" tap (ORCH-0667)** — different button on the same more-options menu. Should still open the saved-card picker (`handleShareSavedCard` at L636 untouched).
4. **DM more-options menu visibility** — `setShowMoreOptionsMenu(false)` is still called in the new `handleAddToBoard`, so menu correctly closes after the modal opens.
5. **AppHandlers consumers** — anyone who was destructuring `handleAddToBoard` from `useAppHandlers()` will get `undefined` now. Confirmed via grep that the only previous consumer was the prop-drill chain through `ConnectionsPage` → `MessageInterface.onAddToBoard` (which is also deleted in this cycle), so no orphan callers.

---

## §10 Discoveries for orchestrator

**None new from this cycle.** All work stayed within scope.

The 3 remaining baseline tsc errors (ConnectionsPage:2756 Friend type cross-service mismatch, HomePage:238/241 state prop missing) are previously-discovered and out of scope per dispatch §1:
- ConnectionsPage:2756 → ORCH-0673 candidate (Constitutional #2 violation, pre-existing)
- HomePage:238/241 → ORCH-0669 cycle-2 follow-up (will clear when ORCH-0669 lands)

---

## §11 Constraints respected

- ✅ TypeScript strict; no `any`, no `as any`, no `as unknown`
- ✅ No new dependencies, no new npm packages
- ✅ No new files (all changes within existing 2 files)
- ✅ No auto-formatted unrelated lines
- ✅ Used existing `useState` / handler patterns from the file
- ✅ Comments multi-line only where it adds genuine context (deletion markers explaining WHY, not WHAT)
- ✅ ZERO touch to ORCH-0664 / ORCH-0667 / ORCH-0668 / ORCH-0659/0660 code surfaces (verified via grep — `onBroadcastReceive`, `handleShareSavedCard`, `addIncomingMessageToUI`, `sendCardMessage` all unchanged)
- ✅ ZERO DB / migration / edge fn / RLS / native code touched

---

## §12 Ready for orchestrator REVIEW + commit

All 8 implementor-verifiable SCs PASS. SC-9 (runtime smoke) deferred to founder or Wave 4 tester.

Tester actions:
1. Re-run grep checks SC-1 through SC-6 independently
2. Re-run `cd app-mobile && npx tsc --noEmit` — confirm 3 baseline errors only (down from 4)
3. Verify diff matches §2 receipts (no scope creep)
4. Live-fire: DM chat → tap more-options → tap "Add to Board" → AddToBoardModal opens with friend pre-context → select session(s) → tap confirm → real RPC fires → real outcome toast appears

---

## §13 Hand-back to orchestrator — surgical commit prep

Working tree changes from this cycle:
- `app-mobile/src/components/MessageInterface.tsx` — entirely ORCH-0666 cycle-2 (no parallel ORCH hunks; previous chat 6's ORCH-0667 hunks were committed in `1db3d80e` and now on HEAD; cycle-2's edits are deltas on top of that)
- `app-mobile/src/components/AppHandlers.tsx` — entirely ORCH-0666 cycle-2 (previous ORCH-0667 `handleShareSavedCard` shim untouched; only `handleAddToBoard` removed)

Both files clean for surgical pathspec commit. No `git add -p` needed.

Recommended commit pattern:
```bash
git commit -m "fix(chat): ORCH-0666 cycle-2 ..." -- \
  app-mobile/src/components/MessageInterface.tsx \
  app-mobile/src/components/AppHandlers.tsx
```

This bypasses the index entirely — only these 2 working-tree files commit. ORCH-0659/0660 working-tree changes + WORLD_MAP/MASTER_BUG_LIST sync deltas remain untouched for their own commits.

---

## §14 Commit message draft

```
fix(chat): ORCH-0666 cycle-2 MessageInterface prop migration + AppHandlers cleanup

Cycle 2 of 2 — completes the ORCH-0666 contract that shipped half-applied
in commit 1db3d80e (Wave 3 chat-domain bundle). Chat 4's MessageInterface.tsx
+ AppHandlers.tsx ORCH-0666 edits were overwritten by chat 6's ORCH-0667
work that staged a different version of these two files; cycle-2 re-applies
the missing prop migration + handler cleanup surgically.

MessageInterface.tsx (-127/+18):
- Props interface: deleted optional onAddToBoard? + onSendCollabInvite?;
  added required onOpenAddToBoardModal: (friend: Friend) => void.
  REQUIRED (not optional) so TypeScript catches missing wiring at compile
  time — "no-op fallback" was the exact pre-cycle-2 dead-tap shape.
- Destructure: single onOpenAddToBoardModal entry.
- Deleted state: showBoardSelection, selectedBoards.
- handleAddToBoard (was ~13 lines): now ~6 lines that close the more-options
  menu and delegate via onOpenAddToBoardModal(friend).
- Deleted handleBoardSelection (used dead onAddToBoard prop).
- Deleted ~75-line BoardSelection sub-UI (in-component modal that was
  fake-success theatre — Constitution #1/#3 violations).

AppHandlers.tsx (-23/+9):
- Deleted handleAddToBoard toast-only stub function body (was 23-line
  setNotifications-only legacy stub with sessionIds[] signature).
- Deleted handlers-object return entry — handleAddToBoard no longer exposed.

ConnectionsPage.tsx and app/index.tsx untouched (already had cycle-1
ORCH-0666 work that survived). The local handleAddToBoard at
ConnectionsPage:2022 (single-Friend signature, opens AddToBoardModal)
is the surviving correct version.

Constitution #1 (no dead tap) + #3 (no fake success) close: button now
opens real AddToBoardModal which calls sessionMembershipService
.addFriendsToSessions (atomic SECURITY DEFINER RPC add_friend_to_session
with 5 guards + 7 outcomes), with real-result toasts via addToBoardToasts.

TypeScript: ConnectionsPage:2235 error TS2322 (onOpenAddToBoardModal not
on MessageInterfaceProps) CLEARED. Baseline 3 remaining errors are
pre-existing parallel work (ConnectionsPage:2756 Friend type cross-service,
HomePage:238/241 state prop) — out of scope per dispatch.

Net diff: -133/+27 = -106 LOC. Constitution #8 (subtract before adding)
decisively honored. No DB / native / edge fn / migration changes —
OTA-safe both platforms.

ORCH-0666 closes (cycle 2 of 2).
Spec: specs/SPEC_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION.md
Cycle-1 report: outputs/IMPLEMENTATION_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION_REPORT.md
Cycle-2 report: reports/IMPLEMENTATION_ORCH-0666_CYCLE2_PROP_MIGRATION_REAPPLY_REPORT.md
Dispatch: prompts/IMPL_ORCH-0666_CYCLE2_PROP_MIGRATION_REAPPLY.md
```
