# SPEC — ORCH-1360 [guest-sheet-friend-request-no-confirm-no-cancel]

**Phase:** SPEC · **Skill:** mingla-forensics · **Date:** 2026-07-12
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1360_FRIEND_REQUEST_LIFECYCLE.md`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` · branch `ORCH-1359-guest-sheet-polish` (HEAD `3ccfc6118`)
**Ships in:** the SAME OTA/PR as ORCH-1358/1359. Do NOT disturb committed 1358/1359 product code.
**Class:** frontend-only · OTA-safe (pure JS) · no backend/migration/edge.

---

## 1. Executive summary

The consumer "Who's going" guest sheet (`EventGuestListSheet.tsx`, shipped ORCH-1341) has two defects: (D1) a sent friend request cannot be withdrawn — the "Requested" chip is an inert dead-end `<View>`; and (D2) tapping "Add friend" fires a real request on a single (possibly mis-)tap with no confirmation. This spec wires three changes, all inside the sheet:

1. **Confirm-before-add** — tapping "Add friend" opens a native `Alert.alert` naming the person; the request fires ONLY on confirm.
2. **Withdraw-after-sent** — the "Requested" chip becomes pressable → native `Alert.alert` confirm → `useFriends().cancelFriendRequest(requestId)` → the row reverts to "Add friend" (both the optimistic `addStates` and the server `hasPendingOutgoing` clear).
3. **Send feedback** — resolved by (1): the pre-action prompt IS the confirmation. No post-send toast is added (DESIGN §2.5 "no toasts" preserved). The subtle "Requested" chip swap remains as the passive sent-state.

The confirm primitive is **native `Alert.alert`** — the app's existing friend-request-withdraw confirm (ViewFriendProfileScreen, ConnectionsPage). It is an OS alert, not an RN `<Modal>`, so it does not violate the sheet's sealed "no second RN Modal" contract (COMMS-0084) and does not regress open/close/z-index. `cancelFriendRequest` and `addFriend` already exist — no backend work.

---

## 2. Scope & non-goals

**In scope (allowlist — the ONLY files the implementor may change):**
- `app-mobile/src/components/EventGuestListSheet.tsx` — all three behavioral changes.
- `app-mobile/src/components/__tests__/orch_1360_guest_sheet_friend_request_lifecycle.test.ts` — NEW Deno source-structure regression suite (fails-on-revert).
- `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` — a SINGLE `[TEST-MOD-APPROVED ORCH-1360]` clause extending the T-10 Pressable whitelist for the new withdraw-chip testID. No other assertion may change.

**DO-NOT-TOUCH (stop-and-amend before touching any of these):**
- ORCH-1358/1359 committed product code: the ORCH-1359 name-open-profile logic, city/`line2` logic, and the ORCH-1358 spacing — all in this same file. Preserve every existing line; ADD only.
- `useFriends.ts`, `useFriendsQuery.ts`, `friendsService.ts` — reused as-is. No signature or query change.
- `RsvpGoingConfirmDialog.tsx`, `BaseBottomSheet.tsx` overlay slot — NOT used (Alert.alert instead).
- `ViewFriendProfileScreen.tsx`, `ConnectionsPage.tsx` — reference only; do NOT edit (no cross-surface widening).
- The 3 consumer detail screens — NO change needed (sheet is self-contained).
- Backend: no migration, no edge function, no RLS. `cancelFriendRequest` already deletes `friend_requests` and invalidates the cache.
- The other committed 1341 assertions (T-01, T-04, T-11b, A-3, etc.) — must stay byte-unchanged and GREEN.

**Non-goals:**
- No pre-add confirm on ViewFriendProfileScreen/ConnectionsPage (Discovery D-i — separate ORCH if wanted).
- No i18n of the sheet (stays hardcoded-English, sheet convention — Discovery D-iii).
- No branded in-sheet confirm card / overlay-slot use (would engage T-04 + new UI — see Open Question OQ-1).
- No change to the message-button behavior, the anonymity seal, or any of the five sheet states.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---------|---------|-----------------------|---------------|--------|
| 1 | Consumer iOS | **YES** | Add-friend asks to confirm; "Requested" chip is tappable to withdraw. | `EventGuestListSheet.tsx` | shared |
| 2 | Consumer Android | **YES** | Same. `Alert.alert` renders the platform AlertDialog. | (same shared file) | **automatic** (shared RN code) |
| 3 | Buyer/anonymous Web | No | Web guest funnel is install-gate; no names, no add-friend. | — | n/a |
| 4 | Business iOS | No | No guest-list sheet in business app. | — | n/a |
| 5 | Business Android | No | Same. | — | n/a |
| 6 | Admin Web | No | Unrelated. | — | n/a |
| 7 | Business Web preview | No | Unrelated. | — | n/a |

Parity is **automatic** (surfaces 1+2 share one file). No per-surface split needed except the SC-2-Android note below (Alert.alert button ordering differs by OS — acceptable, native).

---

## 4. Layered specification

Only the **Component** layer changes. Database / edge / service / hook / realtime layers are unaffected (reused verbatim).

### 4.1 Imports (top of `EventGuestListSheet.tsx`)
- Add `Alert` to the existing `react-native` import (currently: `AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View`). → add `Alert`.
- Extend the `useFriends` destructure (line 169) from `{ friends, friendRequests, addFriend }` to `{ friends, friendRequests, addFriend, cancelFriendRequest }`. (`autoFetchBlockedUsers: false` stays.)

### 4.2 New per-row state
- Add a `cancelInflight` record alongside `messageInflight` (line ~194):
  `const [cancelInflight, setCancelInflight] = useState<Record<string, boolean>>({});`
- Reset it on sheet close in the existing `!visible` effect (lines 247-254): add `setCancelInflight({});`.

### 4.3 Part 1 — Confirm-BEFORE-add (rewrite `handleAddFriendPress`, lines 356-377)

Split into a confirm wrapper + the existing send body. The `if (profileId === null) return;` guard MUST stay within the first ~600 chars of `handleAddFriendPress` (adversarial test A-3), and the exact string `await addFriend(profileId, "", row.guest.username ?? undefined)` MUST be preserved verbatim (test T-11b).

Contract (illustrative, ≤ shape only — not full code):
- `handleAddFriendPress(row)`:
  1. `const profileId = row.guest.profileId;`
  2. `if (profileId === null) return;` (anon guard — unchanged position)
  3. compute `const name = row.guest.displayName ?? row.guest.username ?? "Guest";`
  4. `HapticFeedback.selection();` (light tap ack for opening the prompt)
  5. `Alert.alert(title, message, [ {text:"Cancel", style:"cancel"}, {text:<confirm>, onPress:() => void doSendFriendRequest(row)} ]);`
- `doSendFriendRequest(row)` — the EXISTING body verbatim: `HapticFeedback.medium()` → `setAddStates(inflight)` → `try { await addFriend(profileId, "", row.guest.username ?? undefined); setAddStates(requested); } catch { clear + showHint("Couldn't send — try again"); }`. (Recompute `const profileId = row.guest.profileId;` inside; it is non-null here.)

**Copy (hardcoded English, sheet convention; adjustable microcopy — OQ-2):**
- Title: `Send friend request?`
- Message: `` `Send a friend request to ${name}?` ``
- Buttons: `Cancel` (style `cancel`) · `Send request` (default; fires `doSendFriendRequest`).

Rapid double-tap: the native alert blocks re-entry while open; on confirm, `doSendFriendRequest` sets `inflight` synchronously (the button then shows the spinner, not pressable). No extra guard needed.

### 4.4 Part 2 — Withdraw-AFTER-sent (make the "Requested" chip pressable, lines 604-612)

Replace the inert `<View style={styles.requestedChip}>` with a `<Pressable>` that opens a withdraw confirm. Keep the label text "Requested" (test T-13 asserts the string) and the styling; add pressed feedback.

New handlers:
- `handleCancelRequestPress(row)`:
  1. `const profileId = row.guest.profileId;`
  2. `if (profileId === null) return;` (anon guard — parity)
  3. `const name = row.guest.displayName ?? row.guest.username ?? "Guest";`
  4. derive `const pendingReq = friendRequests.find(r => r.status === "pending" && r.sender_id === viewerId && r.receiver_id === profileId);` (same predicate as `hasPendingOutgoing`)
  5. `HapticFeedback.selection();`
  6. `Alert.alert("Cancel friend request?", `${name} won't be notified.`, [ {text:"Keep", style:"cancel"}, {text:"Cancel request", style:"destructive", onPress:() => void doWithdrawRequest(row, pendingReq?.id)} ]);`
- `doWithdrawRequest(row, requestId?)`:
  1. `HapticFeedback.medium()`
  2. `setCancelInflight(prev => ({...prev, [row.key]: true}))`
  3. `try { if (requestId) await cancelFriendRequest(requestId); setAddStates(prev => { const n={...prev}; delete n[row.key]; return n; }); } catch { showHint(row.key, "Couldn't withdraw — try again"); } finally { setCancelInflight(prev => { const n={...prev}; delete n[row.key]; return n; }); }`

**State reconciliation (both sources clear):** `cancelFriendRequest` invalidates `friendsKeys.requests` → `friendRequests` refetches without the outgoing row → `hasPendingOutgoing` becomes `false`; AND `doWithdrawRequest` deletes `addStates[row.key]` → the optimistic `"requested"` clears. `showRequestedChip = addState === "requested" || hasPendingOutgoing` → `false || false` → the "Add friend" button returns.

**Copy (canonical — matches ViewFriendProfileScreen's i18n copy, hardcoded here):**
- Title: `Cancel friend request?`
- Message: `` `${name} won't be notified.` ``
- Buttons: `Keep` (style `cancel`) · `Cancel request` (style `destructive`; fires `doWithdrawRequest`).

**Chip render (replace lines 604-612):**
```tsx
showRequestedChip ? (
  cancelInflight[item.key] === true ? (
    <View style={styles.requestedChip}>
      <ActivityIndicator size="small" color="rgba(255,255,255,0.55)" />
    </View>
  ) : (
    <Pressable
      onPress={() => void handleCancelRequestPress(item)}
      hitSlop={4}
      style={({ pressed }) => [styles.requestedChip, pressed ? styles.actionPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`Cancel friend request to ${name}`}
      accessibilityHint="Withdraws your request"
      testID={`orch-1360-guest-sheet-cancel-request-${item.key}`}
    >
      <Text style={styles.requestedChipText}>Requested</Text>
    </Pressable>
  )
) : addState === "inflight" ? ( /* …existing spinner… */ ) : ( /* …existing add-friend Pressable… */ )
```
Add `handleCancelRequestPress` (and its deps: `friendRequests`, `viewerId`, `cancelFriendRequest`, `showHint`, `cancelInflight`) to the `renderGuestRow` dependency array.

### 4.5 Part 3 — Send feedback
No new success toast/hint. The pre-action confirm (4.3) is the confirmation; the "Requested" chip is the passive sent-state. DESIGN §2.5 "no toasts" preserved. (The failure `showHint("Couldn't send — try again")` stays.)

### 4.6 Edge cases (behavior contract)
| Edge | Contract |
|------|----------|
| **Request accepted by the other user meanwhile** | `friends` refetches → `isFriendRow = true` → `showAddFriend = false` → the whole add/requested/withdraw zone disappears and the Message button unlocks. Friends-wins ordering (parity with ViewFriendProfileScreen §3.4). No withdraw of a now-accepted request. |
| **Rapid double-tap (add)** | Native alert blocks re-entry; confirm sets `inflight` synchronously. |
| **Rapid double-tap (withdraw)** | `cancelInflight[key]` shows a spinner and removes the Pressable; native alert blocks re-entry. |
| **Withdraw with no resolvable requestId** (optimistic-only, near-impossible: `addFriend` awaits the requests refetch before setting `"requested"`, so the server row is present) | `doWithdrawRequest` clears the optimistic `addStates[key]` and does NOT call `cancelFriendRequest`. If a real server request existed unseen, the next `friendRequests` refetch (staleTime 30s / realtime) re-surfaces `hasPendingOutgoing` → the chip self-heals to "Requested". No data corruption. |
| **Blocked pair** | Server excludes blocked users from the guest list (1338 SC-6); such a row never renders. `addFriend` also has its own visibility gate (throws → caught → "Couldn't send — try again"). No sheet-side block logic. |
| **Chip state on sheet reopen** | On close, `addStates`/`cancelInflight` reset; on reopen the query refetches (gcTime 0) and `hasPendingOutgoing` drives the chip from SERVER truth. `friendRequests` (always-enabled global query) supplies the requestId → withdraw works on reopen. |
| **Anonymous / unlinked / "Not on Mingla" / You rows** | `showActions = item.isNamed && !item.isYou` unchanged → no add/withdraw controls render. Both new handlers hard-return on `profileId === null`. Anonymity seal intact. |
| **Message button** | Unchanged. |

---

## 5. Success criteria (numbered, testable)

- **SC-1** — Tapping the add-friend button opens a confirm dialog whose message names the guest (`Send a friend request to <name>?`); no `friend_requests` write occurs until "Send request" is tapped. Tapping "Cancel" leaves the row in its "Add friend" state with no request sent.
- **SC-2** — On "Send request", the existing flow runs: haptic → inflight spinner → `addFriend(profileId, "", username)` → chip shows "Requested".
  - **SC-2-Android note:** button order/labels render via the native AlertDialog; acceptable native variance.
- **SC-3** — The "Requested" chip is a `<Pressable>` (`testID orch-1360-guest-sheet-cancel-request-<key>`). Tapping it opens a confirm dialog (`Cancel friend request?` / `<name> won't be notified.` / Keep · Cancel request).
- **SC-4** — On "Cancel request", `cancelFriendRequest(requestId)` runs with the requestId derived from the outgoing pending `friendRequests` row; the chip shows a brief spinner (`cancelInflight`), then the row reverts to the "Add friend" button. BOTH `addStates[key]` and `hasPendingOutgoing` are cleared.
- **SC-5** — On withdraw failure, the row shows the inline hint "Couldn't withdraw — try again" and stays in the "Requested" state.
- **SC-6** — Anonymous, unlinked ("Not on Mingla"), and "You"/self rows render NO add-friend or withdraw control (unchanged). Both new handlers no-op on `profileId === null`.
- **SC-7** — If the guest becomes a friend while the sheet is open (request accepted), the add/withdraw zone disappears and the Message button unlocks (no withdraw of an accepted request).
- **SC-8** — No RN `<Modal>` and no BaseBottomSheet `overlay` prop are introduced; sheet open/close/z-index is byte-for-byte unchanged. The confirm is `Alert.alert` only.
- **SC-9** — No backend/migration/edge change; the diff is confined to the allowlist; OTA-publishable per-platform.

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|-----------|---------------|----------------|
| I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY (row container never pressable; only sanctioned controls interactive) | Row container stays `Animated.View`; the withdraw chip becomes a NEW sanctioned control (parity with the ORCH-1359 name-open supersession). | orch_1341 T-09 (container) stays GREEN; T-10 extended via `[TEST-MOD-APPROVED ORCH-1360]`. |
| COMMS-0084 "no second RN `<Modal>`" | `Alert.alert` is an OS alert, not `<Modal>`; overlay slot unused. | orch_1341 T-01 (`!/<Modal\b/`) + T-04 (`!/\boverlay\s*=/`) stay GREEN; new suite asserts `Alert.alert(` present and `<Modal`/`overlay=` absent. |
| SPEC_ORCH-1341 §2.5 "NO TOASTS" | No toast added; confirmation is a pre-action dialog; passive "Requested" state only. | new suite asserts no `Toast`/toast import added. |
| D8 anonymity seal | Both new handlers hard-return on `profileId === null`; `showActions` gate unchanged. | orch_1341 A-3 stays GREEN; new suite asserts both handlers contain `if (profileId === null) return;`. |
| exact addFriend signature | `await addFriend(profileId, "", row.guest.username ?? undefined)` preserved verbatim, relocated into `doSendFriendRequest`. | orch_1341 T-11b stays GREEN. |

**New (DRAFT — flips ACTIVE on CLOSE, orchestrator owns the flip):**
**I-PROPOSED-1360-FRIEND-REQUEST-CONFIRM-AND-CANCEL** — in the guest sheet, sending a friend request is gated by a pre-action confirm, and a sent request is always withdrawable; the "Requested" state is never a dead end.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1360-A | confirm-before-add present | source of `handleAddFriendPress` | contains `Alert.alert(` before any `addFriend` call; `if (profileId === null) return;` still in first ~600 chars | source-structure |
| T-1360-B | exact addFriend string preserved | sheet source | contains `await addFriend(profileId, "", row.guest.username ?? undefined)` | source-structure |
| T-1360-C | withdraw chip is a sanctioned Pressable | sheet source | `<Pressable` with `testID={\`orch-1360-guest-sheet-cancel-request-${item.key}\`}` and `onPress` → `handleCancelRequestPress` | source-structure |
| T-1360-D | withdraw wires cancelFriendRequest with a derived id | sheet source | `cancelFriendRequest` destructured from `useFriends`; `cancelFriendRequest(` called; requestId derived via `friendRequests.find(... receiver_id === profileId ...)` | source-structure |
| T-1360-E | both state sources clear on withdraw | sheet source | `doWithdrawRequest` deletes `addStates[row.key]`; relies on `friendsKeys.requests` invalidation (in the hook) — assert the optimistic-clear line present | source-structure |
| T-1360-F | anon guard on withdraw handler | sheet source | `handleCancelRequestPress` contains `if (profileId === null) return;` | source-structure |
| T-1360-G | no second Modal / no overlay / no toast | sheet source | `!/<Modal\b/`, `!/\boverlay\s*=/`, no `Toast` import; `Alert.alert(` present | source-structure (fails-on-revert anchor) |
| T-1360-H | T-10 whitelist extended | orch_1341 test source | T-10 window regex accepts `orch-1360-guest-sheet-cancel-request-${item.key}` | source-structure |

Runtime happy/error/edge (SC-1, SC-4, SC-5, SC-7) → owned by mingla-tester on-device (login + seeded named-guest event), since these are the login/seed-data-gated paths the investigation could not sim.

---

## 8. Implementation order

1. Imports: add `Alert`; extend `useFriends` destructure with `cancelFriendRequest` (§4.1).
2. State: add `cancelInflight` + reset on close (§4.2).
3. Part 1: split `handleAddFriendPress` into confirm wrapper + `doSendFriendRequest`, preserving the anon guard and the exact addFriend string (§4.3).
4. Part 2: add `handleCancelRequestPress` + `doWithdrawRequest`; make the "Requested" chip a `<Pressable>` with the inflight spinner (§4.4); update `renderGuestRow` deps.
5. Copy: hardcode the two dialogs' strings (§4.3 / §4.4).
6. Tests: write `orch_1360_guest_sheet_friend_request_lifecycle.test.ts` (T-1360-A…G); add the `[TEST-MOD-APPROVED ORCH-1360]` clause to orch_1341 T-10 (T-1360-H).
7. Gates: run the app-mobile typecheck + the Deno suites (1341 + adversarial + 1359 + new 1360) — all GREEN; prove fails-on-revert per §9.

Files touched: only the three in the §2 allowlist.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the new `orch_1360_guest_sheet_friend_request_lifecycle.test.ts` reads `EventGuestListSheet.tsx`, strips comments (1157/1163/1341 house `strip` helper), and asserts the presence of the confirm-before-add (`Alert.alert(` gating the add), the pressable withdraw chip + `cancelFriendRequest` wiring, and the absence anchors (`<Modal`, `overlay=`, `Toast`).

**Proven fails-on-revert (the implementor must demonstrate in the implementation report):**
- Revert Part 1 (call `addFriend` directly, delete the `Alert.alert` confirm) → **T-1360-A FAILS**.
- Revert Part 2 (restore the inert `<View>` "Requested" chip / drop `cancelFriendRequest`) → **T-1360-C / T-1360-D FAIL**.
- Re-introduce an RN `<Modal>` or overlay-slot confirm → **T-1360-G FAILS** (and orch_1341 T-01/T-04).
- Drop the anon guard from the withdraw handler → **T-1360-F FAILS**.
- Break the exact addFriend string → **orch_1341 T-11b FAILS**.

**Protective comment (in the sheet, at the confirm + withdraw sites):** `// ORCH-1360: send is confirm-gated (Alert.alert — NOT an RN <Modal>, COMMS-0084) and a sent request is always withdrawable (cancelFriendRequest); the "Requested" state must never be a dead end.`

---

## 10. Open questions

- **OQ-1 (design, non-blocking — recommend native Alert):** native `Alert.alert` vs a branded in-sheet confirm card. Native Alert is RECOMMENDED — it is the app's existing friend-confirm primitive, respects the sealed no-second-Modal contract, requires no overlay-slot work or T-04 modification, and is OTA-safe. A branded card would engage the BaseBottomSheet overlay slot + a T-04 `[TEST-MOD-APPROVED]` change + net-new UI — larger scope, contradicts "don't invent a new dialog primitive." Only escalate to Seth/designer if the native alert's look is explicitly unacceptable.
- **OQ-2 (microcopy, non-blocking):** exact wording of the pre-add dialog ("Send friend request?" / "Send a friend request to `<name>`?" / "Send request"). Proposed copy is on-voice and mirrors the canonical withdraw copy; a designer may tweak the strings without changing the mechanism.
- **OQ-3 (product, non-blocking — recommend confirm both):** whether WITHDRAW should also confirm (this spec says yes, reusing the canonical "Cancel friend request?" copy) or be an immediate tap. Recommended: confirm both, for misfire symmetry with the pre-add confirm. If Seth prefers instant withdraw, drop the withdraw `Alert.alert` and call `doWithdrawRequest` directly — one-line change, no other impact.

None of these block IMPLEMENT; all have a stated recommended default.

---

## 11. Downstream routing

**Next = mingla-implementor** (build from this SPEC + investigation; fold into the ORCH-1358/1359 batch; frontend-only; OTA-safe; allowlist-bound). **Then = mingla-tester** (on-device runtime for SC-1/SC-4/SC-5/SC-7 with a logged-in consumer + a seeded event carrying a named non-friend Mingla going-guest; the paths the investigation could not sim). **Then = mingla-orchestrator CLOSE** (flip I-PROPOSED-1360 ACTIVE; per-platform consumer OTA + PR in the SAME `[deploy]` as 1358/1359; register the new invariant + test in the CI guard).

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]/` on branch `ORCH-1359-guest-sheet-polish`.
**Allowlist (repeat):** `EventGuestListSheet.tsx` · new `orch_1360_guest_sheet_friend_request_lifecycle.test.ts` · one `[TEST-MOD-APPROVED ORCH-1360]` clause in `orch_1341_guest_list_sheet.test.ts`. Everything else DO-NOT-TOUCH.
