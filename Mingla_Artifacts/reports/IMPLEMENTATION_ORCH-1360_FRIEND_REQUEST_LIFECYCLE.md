# IMPLEMENTATION — ORCH-1360 [guest-sheet-friend-request-no-confirm-no-cancel]

**Phase:** IMPLEMENT · **Skill:** mingla-implementor · **Date:** 2026-07-12
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1360_FRIEND_REQUEST_LIFECYCLE.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1360_FRIEND_REQUEST_LIFECYCLE.md`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` · branch `ORCH-1359-guest-sheet-polish` (rebased on origin/main `c9b8206ea`; 0 behind)
**Ships in:** the SAME OTA/PR as ORCH-1358/1359. Committed 1358/1359 product code untouched.
**Class:** frontend-only · OTA-safe (pure JS + RN `Alert`) · no backend/migration/edge · no new deps.
**Status:** implemented and verified (source-structure gates green; runtime SC-1/SC-4/SC-5/SC-7 are login/seed-gated → mingla-tester on device).
**Code commit:** `3dd29fd9b`

---

## 1. Summary (plain English)

The consumer "Who's going" guest sheet now (1) asks you to confirm before sending a friend request — a native OS dialog naming the person ("Send a friend request to <name>?"), so a mis-tap no longer fires a real request; and (2) lets you take back a sent request — the previously-dead "Requested" pill is now tappable and pops a native "Cancel friend request?" confirm that withdraws it and returns the row to the "Add friend" button. No new success banner is added — the confirm dialog is the confirmation. All three changes live entirely inside one file; anonymous / "Not on Mingla" / "You" rows are untouched and stay action-less.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified by | Status @ commit |
|----|-----------|-------------|-----------------|
| SC-1 | Add-friend opens a confirm dialog naming the guest; no `friend_requests` write until "Send request"; "Cancel" leaves the row unchanged | T-1360-A (source: `Alert.alert` gates; wrapper never calls `addFriend`; message `Send a friend request to ${name}?`) + on-device (tester) | ✓ `3dd29fd9b` (runtime → tester) |
| SC-2 | On confirm: haptic → inflight spinner → `addFriend(profileId, "", username)` → "Requested" chip | T-1360-B (exact string preserved in `doSendFriendRequest`) + on-device | ✓ `3dd29fd9b` |
| SC-3 | "Requested" chip is a `<Pressable>` (`testID orch-1360-guest-sheet-cancel-request-<key>`) opening `Cancel friend request?` | T-1360-C | ✓ `3dd29fd9b` |
| SC-4 | On confirm: `cancelFriendRequest(requestId)` with requestId from the outgoing pending `friendRequests` row; spinner; row reverts; BOTH `addStates[key]` and `hasPendingOutgoing` clear | T-1360-D + T-1360-E + on-device | ✓ `3dd29fd9b` (runtime → tester) |
| SC-5 | Withdraw failure → inline hint "Couldn't withdraw — try again"; row stays "Requested" | source (`doWithdrawRequest` catch → `showHint`) + on-device | ✓ `3dd29fd9b` (runtime → tester) |
| SC-6 | Anonymous / unlinked / "You" rows render NO add/withdraw control; both new handlers no-op on `profileId === null` | T-1360-F (`showActions` gate unchanged + both handlers guarded) + A-3 (unchanged, green) | ✓ `3dd29fd9b` |
| SC-7 | If the guest becomes a friend while open, the add/withdraw zone disappears, Message unlocks | source (`isFriendRow` → `showAddFriend=false`; unchanged logic) + on-device | ✓ `3dd29fd9b` (runtime → tester) |
| SC-8 | No RN `<Modal>`, no BaseBottomSheet `overlay` prop; open/close/z-index unchanged; confirm is `Alert.alert` only | T-1360-G + orch_1341 T-01/T-04 (green) | ✓ `3dd29fd9b` |
| SC-9 | No backend/migration/edge; diff confined to the allowlist; OTA-publishable | `git diff --stat` (3 files) + no migration/edge added | ✓ `3dd29fd9b` |

---

## 3. Files changed

| File | Status | Δ |
|------|--------|---|
| `app-mobile/src/components/EventGuestListSheet.tsx` | M | +138 / −13 |
| `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` | M | +10 / −4 (single `[TEST-MOD-APPROVED ORCH-1360]` T-10 clause) |
| `app-mobile/src/components/__tests__/orch_1360_guest_sheet_friend_request_lifecycle.test.ts` | A | +210 (8 tests) |

Exactly the SPEC §2 allowlist. Nothing else staged.

---

## 4. Data-model changes applied

None. `cancelFriendRequest` (hard-DELETE of `friend_requests` by `id` + `friendsKeys.requests` invalidation) and `addFriend` already exist in `useFriends.ts`. No migration, no RLS, no edge change.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **New suite:** `app-mobile/src/components/__tests__/orch_1360_guest_sheet_friend_request_lifecycle.test.ts` — 8 Deno source-structure tests (T-1360-A…H), house 1341/1157 `strip`-and-assert style.
- **T-10 whitelist clause:** `orch_1341_guest_list_sheet.test.ts` — one added `||` branch accepting the `orch-1360-guest-sheet-cancel-request-${item.key}` Pressable testID, tagged `[TEST-MOD-APPROVED ORCH-1360]` (precedent: ORCH-1359 did the same).

**fails-on-revert verified at `3dd29fd9b`** (true LINE DELETION, not comment-out):
- Deleted the `Alert.alert` confirm gate in `handleAddFriendPress` (Part 1 revert → `void doSendFriendRequest(row)` directly) → **T-1360-A FAILED**.
- Reverted the withdraw `<Pressable>` to an inert `<View>` (Part 2 revert) → **T-1360-C FAILED**.
- Combined revert run: `6 passed | 2 failed`. Restored via `git checkout -- EventGuestListSheet.tsx` → **8 passed | 0 failed**.

Full battery (META-ORCH-1337 Deno suites + 1359 + the new 1360) = **209 passed | 0 failed**.

---

## 7. Old → New receipts

### `app-mobile/src/components/EventGuestListSheet.tsx`
**What it did before:** Tapping "Add friend" fired `addFriend(...)` immediately on a single (mis-)tap; the "Requested" state was an inert `<View>` with no `onPress` — a dead end (no way to withdraw). Only `{ friends, friendRequests, addFriend }` was pulled from `useFriends`.
**What it does now:**
- Import `Alert` (line 57); destructure `cancelFriendRequest` from `useFriends` (line 170); new `cancelInflight` per-row state (line 202), reset on sheet close (line 259).
- **Part 1** (lines 372–412): `doSendFriendRequest` holds the EXACT prior send body verbatim (`await addFriend(profileId, "", row.guest.username ?? undefined)`); `handleAddFriendPress` is now a confirm wrapper that keeps the `if (profileId === null) return;` anon guard, then `HapticFeedback.selection()` + `Alert.alert("Send friend request?", "Send a friend request to <name>?", [Cancel, Send request])`. The send fires ONLY from the "Send request" `onPress`.
- **Part 2** (lines 473–527, 700–748): `doWithdrawRequest` sets `cancelInflight`, calls `cancelFriendRequest(requestId)` when a requestId resolved, clears the optimistic `addStates[row.key]`, `showHint` on failure, clears `cancelInflight` in `finally`. `handleCancelRequestPress` guards on null profileId, derives the requestId via `friendRequests.find(r => r.status==="pending" && r.sender_id===viewerId && r.receiver_id===profileId)` (same predicate as `hasPendingOutgoing`), then `Alert.alert("Cancel friend request?", "<name> won't be notified.", [Keep, Cancel request(destructive)])`. The "Requested" chip is now a 3-way render: `cancelInflight` → busy `<View>` spinner (retains the T-17 a11y strings), else a `<Pressable>` withdraw chip (`testID orch-1360-guest-sheet-cancel-request-<key>`), else the add/inflight/add-friend branches unchanged.
- `renderGuestRow` deps extended with `cancelInflight` + `handleCancelRequestPress`.
**Why:** SPEC §4.1–§4.4 (SC-1…SC-8); investigation F-1 (dead-end chip) + F-3 (no confirm gate).
**Lines changed:** ~138 added / ~13 removed.

### `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts`
**Before:** T-10 accepted only add-friend / message / error-retry / ORCH-1359 open-profile Pressables.
**Now:** one added `||` branch accepts the ORCH-1360 withdraw testID; assertion message updated to name the new target. Tagged `[TEST-MOD-APPROVED ORCH-1360]`.
**Why:** SPEC §6 / F-6 — the "Requested" chip becomes a 4th sanctioned Pressable; the row container stays non-pressable (T-09 still green).
**Lines changed:** +10 / −4.

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | YES — add-friend confirm + tappable "Requested" withdraw | shared file |
| 2 | Consumer Android | YES — same; `Alert.alert` renders the platform AlertDialog | automatic (shared RN code) |
| 3 | Buyer/anonymous Web | No — web guest funnel is an install-gate (no names, no add-friend) | n/a |
| 4 | Business iOS | No — no guest-list sheet | n/a |
| 5 | Business Android | No — same | n/a |
| 6 | Admin Web (adjacent) | No — unrelated | n/a |
| 7 | Business Web preview (adjacent) | No — unrelated | n/a |

Parity is automatic — surfaces 1+2 share `EventGuestListSheet.tsx`. Native Alert button order/labels differ by OS (acceptable, SC-2-Android note).

---

## 9. Smoke result

Runtime sim/device NOT run by the implementor: reaching the "Requested" state needs a logged-in consumer + a seeded event carrying a NAMED non-friend Mingla going-guest (Seth-gated credential/seed-data per the investigation §Repro blocker). Source-structure gates run and green: full META-ORCH-1337 battery + new 1360 suite = **209/209**; app-mobile `tsc --noEmit` clean on `EventGuestListSheet.tsx` (0 errors attributable to the change; the 902 project-wide tsc errors are pre-existing baseline noise — Deno `__tests__` files lacking Deno types + `react-dom/server` decls — none in this file or referencing the new symbols); append-only gate green (token-approved). Runtime SC-1/SC-4/SC-5/SC-7 → mingla-tester on device.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` markers introduced.
- Reconciliation (NOT a deviation): the SPEC §4.4 *illustrative* chip-replacement dropped `accessibilityLabel={`Friend request sent to ${name}`}` and `accessibilityState={{ disabled: true }}`, but committed test **orch_1341 T-17 (lines 332–333) asserts both strings** and SPEC §2 mandates T-17 stay byte-green. Both strings are preserved on the `cancelInflight` busy `<View>` branch (semantically the disabled/busy state) — honoring both SPEC clauses. No test modified beyond the single allowed T-10 clause.
- The confirm-before-add pattern is guest-sheet-only; ViewFriendProfileScreen/ConnectionsPage still fire ADD directly (investigation D-i — separate ORCH if product wants it everywhere). NOT widened here.

---

## 11. Operator action required

- **No migration `db push`** (no migration). **No edge deploy** (none touched).
- **Ships via consumer OTA per-platform** in the SAME `[deploy]` as ORCH-1358/1359 — orchestrator/operator-owned at CLOSE (implementor does not OTA/deploy/merge).
- **CLOSE registration (orchestrator, SPEC §11):** register `orch_1360_guest_sheet_friend_request_lifecycle.test.ts` in `.github/workflows/meta-orch-1337-social-proof-tests.yml` (explicit-list, append a line — NOT done here: not in the implementor allowlist); flip **I-PROPOSED-1360-FRIEND-REQUEST-CONFIRM-AND-CANCEL** ACTIVE.
- **HEAD commit body must retain `[TEST-MOD-APPROVED ORCH-1360]`** through CLOSE (CI reads HEAD for the append-only gate).

---

## 12. Discoveries for Orchestrator

- None new. Investigation discoveries D-i (confirm-before-add elsewhere), D-ii (`cancelFriendRequest` hard-DELETEs vs `status='cancelled'` dead enum), D-iii (sheet hardcoded-English, no i18n) stand as filed — none actioned here (out of scope).
- **Comms ledger:** read on entry; no OPEN `BLOCK` targets ORCH-1360 / mingla-implementor / ALL. COMMS-0052 (business-app OTA freeze) is `RESOLVED` and business-only — irrelevant to this consumer app-mobile change, and the implementor deploys nothing regardless. COMMS-0093 (WARN/ALL — the sealed guest-sheet contract) was factored: `Alert.alert` preserves the no-second-`<Modal>` / overlay-slot-unused posture. No new ledger entry required.
