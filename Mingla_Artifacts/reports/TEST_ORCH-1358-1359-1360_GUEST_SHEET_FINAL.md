# TEST (FINAL) — ORCH-1358 / 1359 / 1360 Guest-Sheet Batch

**Phase:** TEST (final gate) · **Skill:** mingla-tester · **Date:** 2026-07-12
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` · branch `ORCH-1359-guest-sheet-polish`
**HEAD at test:** `d147964db` (tester adversarial test) · 1360 code at `3dd29fd9b` · rebased clean on origin/main.
**Primary file under test:** `app-mobile/src/components/EventGuestListSheet.tsx`

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise).

The full ORCH-1360 friend-request lifecycle (confirm-before-add + withdraw-after-sent) and the
ORCH-1359 authed guest-sheet UI were proven on-device (iOS sim) with live-fire Supabase DB
verification of every write/no-write. Regression gate satisfied: implementor happy-path suite
(fails-on-revert independently re-run) **and** tester adversarial suite (different angle,
on-branch, in the closing diff) both green. Full META-ORCH-1337 battery **213/0** (209 baseline +
4 new adversarial). No product code modified.

**Login unblock:** the "phone-only" bypass as literally described does NOT exist on the consumer
WelcomeScreen (Apple/Google only). The real reviewer path is OAuth → optional onboarding phone
bypass (+12015550199 / 123456 kicks in only at the onboarding phone step). I completed login via
Seth's own already-authenticated Google account (no password entry; account already onboarded →
landed straight on the feed) and drove the authed guest sheet the prior pass could not reach.

Dispatch-accepted deferrals (NOT defects, NOT blocking): SC-5 error path verified by source
handling-trace only (dispatch said "don't force"); Consumer Android runtime not exercised
(no emulator + pre-existing ORCH-1171 stale-dev-build gap — parity is automatic, one shared RN
file); "Keeping it low-key" private-Mingla string not on this event's roster (source + prior RPC
proof; "Not on Mingla" confirmed at runtime).

---

## 2. SC-by-SC matrix (ORCH-1360 — primary)

Test event: **BBQ Pool Party** (`8b84539d-…`, rsvp, scheduled, public, non-private), slug
`smokerhythm/july-4th-bbq-pool-party`. Target named non-friend Mingla going-guest:
**sethogievabelgium Gotham** (profileId `485addca-58e0-400b-9ddc-7d2460210bc4`, visibility `friends`,
Raleigh). Viewer: Seth (`b17e3e15-…`).

| SC | Criterion | Result | Runtime evidence |
|----|-----------|--------|------------------|
| **SC-1** | Tap "Add friend" → native "Send a friend request to <name>?" confirm; Cancel sends nothing | **PASS** | Tapped `orch-1341-guest-sheet-add-friend-485addca…` → native alert **"Send friend request?" / "Send a friend request to sethogievabelgium Gotham?" / Cancel · Send request** (screenshot 12). Tapped Cancel → DB `friend_requests` Seth→target = `[]` (no write). Alert renders OVER the sheet (no RN Modal). |
| **SC-2** | Confirm → inflight → chip "Requested" | **PASS** | Re-tapped Add-friend → "Send request" → row shows **"Requested"** chip, Message stays locked (screenshot 14). DB row created: `69e1cf7a-…`, status `pending`, sender=Seth, receiver=target. |
| **SC-4** | Tap "Requested" → native "Cancel friend request?" → confirm → withdrawn → row reverts to "Add friend"; BOTH optimistic + server clear | **PASS** | Tapped `orch-1360-guest-sheet-cancel-request-485addca…` (testID fired) → native **"Cancel friend request?" / "sethogievabelgium Gotham won't be notified." / Cancel request (destructive) · Keep** (screenshot 15). Tapped "Cancel request" → row reverted to **"Add friend"** button (screenshot 16); DB row `69e1cf7a` **deleted** (`[]`). Optimistic addStates cleared (UI) + server hasPendingOutgoing cleared (DB delete + `friendsKeys.requests` invalidation). |
| **SC-5** | Withdraw failure surfaces error, keeps chip | **PASS (handling-trace, not force-triggered — per dispatch "don't force")** | Source: `doWithdrawRequest` catch → `showHint(row.key, "Couldn't withdraw — try again")`; the optimistic delete sits AFTER the `await` inside `try`, so on throw addStates is NOT cleared and the server row persists → `hasPendingOutgoing` stays true → chip stays "Requested". Structurally identical to the proven add-failure handler. Runtime force not performed (network-fault injection unavailable on sim; dispatch allowed the deferral). |
| **SC-7** | Already-friend guest: no add/withdraw affordance, Message unlocks | **PASS** | **Seth O** (`c727d491-…`, IS a friend of Seth per DB) row shows **only the orange (unlocked) Message button, no Add-friend / no Requested / no withdraw** (screenshots 11/14/16). `showAddFriend = showActions && !isFriendRow` → false. |

### SC-by-SC (ORCH-1359 authed UI + 1358)

| Item | Result | Runtime evidence |
|------|--------|------------------|
| Named rows: name + CITY, no @username | **PASS** | `sethogievabelgium Gotham` / **"Raleigh"**, `rambleawaypod U` / **"Raleigh"**, `Seth O` / **"Raleigh"** — city subtitle, no `@handle` (screenshot 11). Matches `cityFor(location)` = first comma-segment of "Raleigh, NC, United States". |
| "Not on Mingla" (unlinked) vs "Keeping it low-key" (private) distinct | **PARTIAL-PASS** | "Guest / **Not on Mingla**" unlinked row rendered at runtime (screenshot 11). "Keeping it low-key" not present on this event's roster (no private-Mingla going-guest); confirmed distinct in source (separate string for `isMinglaUser && !isNamed`) + prior-tester RPC privacy-matrix proof. Both are visually distinct row types. |
| Tap NAMED name → ViewFriendProfileScreen over the detail; Back returns to the detail | **PASS** | Tapped `orch-1359-guest-sheet-open-profile-485addca…` → **ViewFriendProfileScreen** for "sethogievabelgium Gotham" (Raleigh · Mingla+ · Lv.1) opened over the detail (screenshot 17, sheet closed-before-navigate). Tapped Back → returned to **BBQ Pool Party event detail** (screenshot 18), NOT the home shell. |
| Anonymous / unlinked / You names non-pressable | **PASS (source + visual)** | "Guest / Not on Mingla" row: `canOpenProfile` requires `isNamed && profileId!==null && onOpenProfile` → false → plain `<Text>` (no testID, no Pressable). No add/message affordance rendered on that row (screenshot 11). No "You" row on this event (Seth not going). |
| ORCH-1358 gap above the momentum card (authed) | **PASS (spot-reconfirm; prior-proven)** | `orch_1358_card_spacing.test.ts` green in the 213/0 battery; prior tester proved the iOS card-gap. Authed event-detail render (screenshots 18/19) showed no layout regression. |

---

## 3. Findings

**None (P0/P1/P2/P3 = 0).** Two P4 (praise) — see §6.

Observations carried as dispatch-accepted deferrals, not findings:
- **SC-5 runtime not force-triggered** — dispatch explicitly said "don't force"; handling verified by source. If a future pass wants live proof, inject a network fault (airplane mode) during the withdraw and assert the "Couldn't withdraw — try again" hint + retained "Requested" chip.
- **Consumer Android runtime not exercised** — no Android emulator booted; the pre-existing ORCH-1171 stale-dev-build / react-native-keyboard-controller gap is an environment condition (not this batch). Parity is automatic: surfaces 1+2 share one RN file, and `Alert.alert` renders the native Android AlertDialog (button order differs by OS — SPEC SC-2-Android note, acceptable).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Ran the implementor's happy-path suite `orch_1360_guest_sheet_friend_request_lifecycle.test.ts`
against the **clean** tree and against **true line-deletion reverts** (restored via
`git checkout --` after each; tree confirmed clean).

- **Clean HEAD (`3dd29fd9b`):** `8 passed | 0 failed`.
- **Combined revert** — Part 1 (deleted the `Alert.alert` confirm in `handleAddFriendPress` → direct
  `void doSendFriendRequest(row)`) + Part 2 (reverted the withdraw `<Pressable>` to the inert
  `<View>`): **`6 passed | 2 failed`**.
  - `T-1360-A` → `AssertionError: handleAddFriendPress opens a native Alert.alert`.
  - `T-1360-C` → `AssertionError: a <Pressable> carries the orch-1360 withdraw testID (not the inert <View> dead end)`.
- Restored (`git checkout -- EventGuestListSheet.tsx`) → `8 passed | 0 failed`. Exactly matches the
  implementor report's `6 passed | 2 failed` claim. **fails-on-revert re-verified at `3dd29fd9b`.**

---

## 5. Adversarial test added (tester-owned)

**Path:** `app-mobile/src/components/__tests__/orch_1360_friend_request_withdraw_targeting.adversarial.test.ts`
**Commit:** `d147964db` (append-only new file; no product / existing-test change).
**In closing diff:** yes — `git diff origin/main...HEAD --name-only` lists it alongside the
implementor's `orch_1360_guest_sheet_friend_request_lifecycle.test.ts` and the T-10 whitelist mod.

**Different angle:** the implementor's `T-1360-D` asserts the predicate strings exist *somewhere in
the whole sheet* — but the identical `sender_id===viewerId && receiver_id===profileId && status="pending"`
strings ALSO live in the row-render `hasPendingOutgoing` scan, so `T-1360-D` would still pass even if
the WITHDRAW handler's own predicate were swapped/weakened. My suite **isolates
`handleCancelRequestPress`, extracts its actual `.find(...)` predicate, and EXECUTES it** against a
fabricated array of 3 pending outgoing requests to different receivers + an incoming decoy + an
accepted decoy to the same person — proving cancel picks the request keyed to **this row's
profileId** (the RIGHT requestId) and rejects both decoys. Plus ADV-4 structurally guards that the
withdraw hands `pendingReq?.id` (derived request id), never a profileId/viewerId.

- **Clean HEAD:** `ADV-1..ADV-4` `4 passed | 0 failed`.
- **fails-on-revert:** weakened the handler predicate (dropped `&& r.receiver_id === profileId` → "pick
  the first pending outgoing regardless of receiver") → **`ADV-1` FAILED** (`Values are not equal:
  must select req-to-B … NOT req-to-A/req-to-C`) and **`ADV-3` FAILED**. Restored → `4 passed`.
  **fails-on-revert verified at `3dd29fd9b`.**

Both 1360 suites at HEAD: **12 passed | 0 failed**.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **PASS** | The formerly-inert "Requested" `<View>` is now a live `<Pressable>` withdraw (testID fired at runtime); the previously dead-end state now has an action. |
| 2 | One owner per truth | **PASS** | `friend_requests` written/deleted only via `useFriends().addFriend`/`cancelFriendRequest`; sheet holds no competing store. |
| 3 | No silent failures | **PASS** | add + withdraw both `catch → showHint(...)`; no swallowed errors. |
| 4 | One query key per entity | **PASS** | `friendsKeys.requests` invalidation owned by the hook; no ad-hoc keys added. |
| 5 | Server state stays server-side | **PASS** | `friendRequests`/`friends` from React Query; only `addStates`/`cancelInflight` (client UI) in local state. |
| 6 | Logout clears everything | **N/A** | No auth/session change. |
| 7 | Label `[TRANSITIONAL]` | **N/A** | None introduced. |
| 8 | Subtract before adding | **PASS** | Reused `Alert.alert` + existing `cancelFriendRequest`; no new dialog primitive, no RN Modal. |
| 9 | No fabricated data | **PASS** | City is `location`-derived (null → name-only); no faked identity/status. |
| 10 | Currency-aware | **N/A** | No money. |
| 11 | One auth instance | **PASS** | `viewerId` from `useAppStore`; no new auth. |
| 12 | Validate at the right time | **PASS** | requestId derived at press time from live `friendRequests` (verified by adversarial ADV-1). |
| 13 | Exclusion consistency | **PASS** | Blocked pairs excluded server-side; anon guard (`profileId===null` return) on both new handlers. |
| 14 | Persisted-state startup | **N/A** | No persisted store change. |

---

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---------|--------|----------|
| Consumer iOS | **PASS (proven)** | iPhone 17 Pro sim `17091E60-…`, iOS 26.4, dev build `com.mingla.app.v2` on Metro 8090 (this worktree, `--clear`). SC-1/2/4/7 + all 1359 authed-UI proven with live-fire DB. |
| Consumer Android | **DEFERRED (dispatch-accepted)** | No emulator booted; pre-existing ORCH-1171 stale-dev-build gap (environment condition, not this batch). Parity automatic — single shared `EventGuestListSheet.tsx`; `Alert.alert` → native AlertDialog. |
| Buyer/anon Web | **N/A** | Web guest funnel is an install-gate (no names, no add-friend). SPEC §3. |
| Business iOS / Android | **N/A** | No guest-list sheet in the business app. |
| Admin Web / Business Web preview | **N/A** | Unrelated. |
| Physical iPhone (HITL) | **NOT REQUIRED THIS PASS** | iOS sim proof with DB live-fire is sufficient for the primary paths; no hardware-keyboard behavior in scope. |

Edge-fn live-deploy: N/A — this batch is frontend-only, OTA-safe (no migration, no edge change).

---

## 8. Regression / battery

- Full META-ORCH-1337 Deno battery (CI registry, 20 files) + new 1360 lifecycle suite = **209/0**
  (reproduced the stated baseline exactly).
- With my adversarial suite added: **213 passed | 0 failed**.
- No regression to committed 1358/1359 (orch_1358_card_spacing, orch_1359_peer_guest_location,
  orch_1359_location_identity_weld.adversarial, orch_1359_guest_sheet_identity,
  orch_1359_guest_sheet_open_profile all green).
- The new 1360 suites are NOT yet in the CI registry (`meta-orch-1337-social-proof-tests.yml`) —
  expected: the implementor report §11 assigns registration to the orchestrator at CLOSE. Both must
  be appended to the explicit-list workflow at CLOSE (2 lines) or they will not run in CI.

---

## 9. Discoveries for Orchestrator

- **CLOSE must register both 1360 suites in CI** — append
  `orch_1360_guest_sheet_friend_request_lifecycle.test.ts` AND
  `orch_1360_friend_request_withdraw_targeting.adversarial.test.ts` to
  `.github/workflows/meta-orch-1337-social-proof-tests.yml` (explicit-list, never glob), and flip
  **I-PROPOSED-1360-FRIEND-REQUEST-CONFIRM-AND-CANCEL** ACTIVE. HEAD body must retain
  `[TEST-MOD-APPROVED ORCH-1360]` through CLOSE (append-only gate reads HEAD).
- **Reviewer-bypass doc drift (P4 note for the orchestrator, not this batch):** the consumer
  WelcomeScreen offers only Apple/Google — the "phone +12015550199" bypass is a *post-OAuth
  onboarding-step* mechanism, not a WelcomeScreen login. Future test dispatches should say "OAuth →
  onboarding phone bypass" (or use the onboarded demo Google account) to avoid the prior pass's
  login dead-end.
- Test residue fully torn down: the one `friend_requests` row created during SC-2 was deleted by the
  SC-4 withdraw; final DB check = `[]`. Net-zero; no ORCH-namespaced seed rows were needed (BBQ Pool
  Party already carried the full named/friend/anon matrix).

## P4 — praise
- Clean reuse of the existing `Alert.alert` friend-confirm primitive — no second RN Modal, no
  overlay-slot engagement, COMMS-0084 posture intact (SC-8).
- The withdraw requestId is correctly derived at press time via the exact `hasPendingOutgoing`
  predicate, keyed to the row's profileId — survived the adversarial multi-pending execution test.

---

## 10. Routing

**PASS → CLOSE (orchestrator).** No rework. At CLOSE: register both 1360 CI suites, flip
I-PROPOSED-1360 ACTIVE, ship consumer OTA per-platform in the SAME `[deploy]` as ORCH-1358/1359.
