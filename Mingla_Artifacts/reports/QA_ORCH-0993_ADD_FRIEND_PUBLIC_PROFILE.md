# QA — ORCH-0993 [Add Friend button on public profile]

**Skill:** mingla-tester+claude
**Mode:** TARGETED (spec-compliance + adversarial regression + live-fire attempt)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0993-[add-friend-public-profile]/` on branch `ORCH-0993-add-friend-public-profile` (HEAD `34131f77f`)
**Inputs:** SPEC `SPEC_ORCH-0993_ADD_FRIEND_PUBLIC_PROFILE.md`, DESIGN `DESIGN_ORCH-0993_ADD_FRIEND_CTA.md`, IMPLEMENTATION `IMPLEMENTATION_ORCH-0993_ADD_FRIEND_PUBLIC_PROFILE.md`, screen `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`.
**External-API:** N/A — no external API touched. COMMS-0003 docs-citation N/A. (Acked COMMS-0002/0003/0004 = N/A: frontend-only, no backend/strict-grep, no INTAKE, no external API. No BLOCK targets ORCH-0993 or mingla-tester.)

---

## VERDICT: CONDITIONAL PASS

**Code-correctness verdict = PASS** (source + type + lint + DB-contract + regression all green, independently verified).
**Live-fire interaction leg = DEFERRED** behind a genuine, exhaustively-attempted-and-surfaced environment blocker (worktree symlinked `node_modules` → Metro/Expo-SDK-54 entry-realpath escape, compounded by a cross-session contention on the assigned port 8084). This deferral requires Seth's explicit acceptance OR a one-command unblock (see Handoff).

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 2 | **P4:** 2
- **Regression tests:** implementor happy `orch-0993-add-friend-cta.happy.test.tsx` (independently re-verified PASS + fails-on-revert) | tester adversarial `orch-0993-add-friend-cta.adversarial.test.tsx` (PASS + fails-on-revert proven 3 ways)

---

## 1. Success-Criteria matrix (SC-1..SC-9)

Verification level per SC. "Source-proven" = traced through the exact implemented lines + the upstream hook/service/migration contracts they depend on (all independently re-read, not trusted from the impl report). "Live-fire" = on-device interaction (blocked — see §4).

| SC | Requirement | Verdict | Level | Evidence |
|----|-------------|---------|-------|----------|
| **SC-1** | Stranger → filled "Add Friend", no Message; color contrast-correct `#c2410c`, white label ≥4.5:1 | PASS | Source-proven | `relationship==='stranger'` → `AddFriendCta` else-branch (screen 707-743); fill `CTA_LIGHT.fillPrimary = '#c2410c'` (129-138, 221), label `#ffffff` (130) = **5.94:1** (DESIGN §2.1, recomputed: L(#fff)=1.0, L(#c2410c)=0.1216 → (1.05)/(0.1716)=**6.12** by sRGB; DESIGN states 5.94 — both ≥4.5 ✅). Message only renders under `'friends'` (708). Designer's contrast correction (NOT SPEC §11's `#eb7825` which is 2.55:1 fail) is correctly implemented. |
| **SC-2** | Tap → "Sending…" disabled → "Requested" with NO manual refresh | PASS | Source-proven | `handleAddFriend` sets `ctaInFlight='send'` (382) → label `t('profile:friend.sending')`="Sending…" while `inFlight==='send'` (226); `await addFriend(userId,'',username)` (384); `addFriend` invalidates `friendsKeys.requests(userId)` (`useFriends.ts:249`) → `useFriendRequests` refetches → derivation flips to `outgoing_pending` → "Requested" (236). No manual refresh: cache-invalidation-driven, the existing owner (SPEC §3.2). |
| **SC-3** | "Requested" tappable → confirm dialog → cancel → reverts to "Add Friend" | PASS | Source-proven | outgoing pill `onPress=onCancelRequest` (237) → `Alert.alert` "Cancel friend request?" / body "{{name}} won't be notified." / Keep(cancel) + Cancel request(destructive) (729-740) → `doCancelRequest` → `cancelFriendRequest(outgoingRequest.id)` (414) → invalidates `friendsKeys.requests` → row gone → derivation → `stranger` → "Add Friend". `cancelFriendRequest` confirmed to DELETE + invalidate (`useFriends.ts`). |
| **SC-4** | Incoming → "Accept Request" → tap → friends → Message appears | PASS | Source-proven | incoming pill `checkmark-outline` + "Accept Request" (246-248); `handleAcceptRequest` → `acceptFriendRequest(incomingRequest.id)` (399) → invalidates `friendsKeys.all` (atomic RPC) → `profile.isFriend` true → derivation → `'friends'` → Message renders in same region (708-718). |
| **SC-5** | Friend → Message, NO Add-Friend (existing path unchanged) | PASS | Source-proven + regression | Message gate `onMessage && profile.isFriend` byte-unchanged (708); CTA is the `else` branch (720). Implementor happy test T-04/T-10 + my independent fails-on-revert confirm. |
| **SC-6** | Own profile → neither button | PASS | Source-proven | `isSelf = !!currentUserId && currentUserId===userId` (344); CTA region `isSelf ? null : …` (707). |
| **SC-7** | Error → pre-action state + inline error (NOT Alert) + error haptic, no false success | PASS | Source-proven + adversarial | catch → `Haptics…Error` (387) + `setCtaError(classifyCtaError(err))` (388); `finally setCtaInFlight(null)` (390) restores pre-action pill; inline `errorRow` w/ `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"` (291-298), NOT an Alert. **No optimistic flip** — adversarial test T-06 asserts `handleAddFriend` never sets 'Requested'/outgoing locally (proven fails-on-revert). |
| **SC-8** | `source='app'` default; no `'profile'` enum; no migration | PASS | Source + DB-proven | `addFriend` INSERT sets only `sender_id, receiver_id, status:'pending'` (`useFriends.ts:201-209`) → DB default `'app'`. Screen passes no `source` (adversarial asserts `doesNotMatch /source:'profile'/`). Zero migration files in diff. |
| **SC-9** | No new query key / staleTime / Realtime / edge / backend in diff | PASS | Diff-proven | `git diff origin/main...HEAD` touches only `ViewFriendProfileScreen.tsx` + locale JSON + tests. Consumes existing `useFriendRequests` (343, key `friendsKeys.requests`, existing 30s staleTime). No `.channel(` / new `useQuery` for friend_requests / `.rpc(` / `supabase.from(` added in the CTA. No `supabase/` files in diff. |

**All 9 SCs PASS at source/type/DB/regression level.** SC-1..SC-7 additionally warrant on-device interaction confirmation; that leg is blocked (§4) — code-path tracing is `proven` for logic but on-device render/interaction is `probable` (attempted, blocked, blocker named).

---

## 2. Upstream-contract verification (SPEC assumptions A2/A3/A4 — re-checked against live code, not trusted)

| Assumption | SPEC claim | Verified |
|-----------|-----------|----------|
| A2 | `addFriend(userId,'',username)` is the userId-path send | ✅ `useFriends.ts:88-110` UUID branch; throws `"User not found…"` at 109 for missing userId (T-07 target). |
| A3 | `useFriendRequests` returns `type`/`sender_id`/`receiver_id`/`id`/`status` | ✅ `friendsService.ts:28-42` `FriendRequest` interface + `fetchFriendRequests` 119-194 tags `type:"incoming"|"outgoing"`. |
| A4 | INSERT omits `source` → defaults `'app'`; unique `(sender_id,receiver_id)` | ✅ INSERT `useFriends.ts:201-209` (no source); `friend_requests_sender_id_receiver_id_key UNIQUE` at `20260505000000_baseline_squash_orch_0729.sql:10579` (unconditional — the T-09 DB idempotency backstop is real). |

---

## 3. Constitution + invariants

| Rule | Verdict | Evidence |
|------|---------|----------|
| #1 no dead taps | PASS | "Requested" cancels (237); every pill `onPress`. |
| #2 one owner per truth | PASS | Pending truth = `friendsKeys.requests` (only reader, no second copy); friends-edge = `useFriendProfile.isFriend`. Protective comment at derivation (338-341). |
| #3 no silent failures | PASS | Every catch surfaces inline error + error haptic (SC-7). |
| #4 one key per entity | PASS | No new query key (SC-9). |
| #12 validate at right time | N/A | no datetime logic. |
| **I-PROPOSED-PROFILE-ADD-FRIEND-STATE-DERIVED** | SATISFIED | state derived purely from the two existing owners; no third owner. |
| Message-friend-gate invariant | PRESERVED | gate condition byte-unchanged; CTA structurally an `else` (regression-tested). |

---

## 4. Live-fire sim gate — ATTEMPTED, BLOCKED, RESOLUTION EXHAUSTED, BLOCKER SURFACED

Per Phase 0.A this is a UI/runtime change shipping to consumer iOS + Android (parity automatic, single shared component per SPEC §5). I attempted the iOS-sim leg to `proven` level. Outcome: **the worktree environment blocks the dev-client bundle from loading**, by a root cause I diagnosed and tried five distinct resolutions for.

### 4.1 What worked
- Metro started clean on assigned port **8084** in the worktree; HTTP `/status` = running.
- The Mingla dev client `com.mingla.app.v2` is installed on both booted iOS sims (iPhone 17 Pro `17091E60…`, iPhone 17 `F7ECAC25…`) and on a physical Android device (`R58R54YV7JT`).
- Maestro 2.5.1 + openjdk present; drove launcher + dismiss flows successfully (NO osascript used, per memory rule).
- Got the iOS dev client off a stale foreign-Metro (META-ORCH-0991 on :8082) and onto my 8084 via the dev-launcher home screen.

### 4.2 The blocker (root-caused, not guessed)
The worktree's `node_modules` is an **absolute symlink → `~/Desktop/mingla-main/app-mobile/node_modules`**. Under Expo SDK 54 Metro, the entry module realpaths through the symlink into the anchor tree (outside the worktree project root), so Metro emits an unresolvable entry path:
```
Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry …
bundle URL: http://127.0.0.1:8084/../../../mingla-main/app-mobile/node_modules/expo-router/entry.bundle
→ iOS dev client: RCTFatal [RCTInstance handleBundleLoadingError]
```
**Confirmed identical failure offline:** `npx expo export --platform ios` fails the same way (`../../../mingla-main/app-mobile/node_modules/expo-router/entry-classic.js` import-stack escape) — proving it is the symlink-realpath, not a server/device issue.

### 4.3 Resolution attempts (all genuine, all exhausted)
1. APFS CoW clone (`cp -Rc`) of node_modules into the worktree → **stalled** at ~500/714 packages (expo-router never materialized).
2. `rsync -a --delete` → **stalled** at the same point (and `--delete-before` churned the tree into a holey state).
3. `rsync -a` fill (no delete) → **stalled**, flat CPU, 0 files written in 60s.
4. `cp -al` hardlink farm (metadata-only, no data I/O) → **stalled** twice at ~500 packages, flat CPU.
5. Restored the symlink (the documented worktree state) → bundle escapes per §4.2.

Five filesystem strategies stall reproducibly at the same ~500-package mark — indicating a hard environment constraint on materializing the large `node_modules` tree in this worktree (filesystem-write stall), not a clearable cache/cwd/cold-boot issue. No FIFOs/sockets/cyclic-symlinks found in the source tree to explain a single bad path.

### 4.4 Compounding cross-session contention (see Handoff)
After my scoped Metro restart, **another session (ORCH-0989 `[unified-cover-picker-sheet]`) claimed port 8084 with `--tunnel`** (verified: pid `58847`, cwd `…/ORCH-0989-…/mingla-business`). Per the no-cross-session-interference rule I did NOT reclaim it. The dispatch assigned me 8084 exclusively; the collision is real and is a second, independent obstacle to re-running the leg.

### 4.5 Android leg
Physical Android `R58R54YV7JT` is attached but screen-off/locked (black screenshot). Per `feedback_tester_3sims_plus_operator_physical.md` I do not drive Seth's physical device; and parity is automatic (single shared RN component + hook — SPEC §5.2), so the Android-specific risk (haptics + press feedback) is already covered by the same `expo-haptics`/`activeOpacity` code the iOS path uses.

### 4.6 Confidence ladder
- Logic / state-machine / error-truth / precedence / idempotency / DB-contract: **proven** (source + type + babel-compile + DB + regression-with-fails-on-revert).
- On-device render + tap interaction (SC-1..SC-7 visual/touch): **probable** (live-fire attempted, blocked by §4.2/§4.4, blocker named with a one-command unblock). NOT claimed as `proven`. Hence CONDITIONAL, not full PASS.

---

## 5. Independent code-validity proof (compensating for the blocked bundle)
- `npx tsc --noEmit`: **0 errors** in `ViewFriendProfileScreen.tsx` (with symlink-restored full module resolution; confirms the implementor's "0 errors" claim).
- `babel-preset-expo` transform of the screen: **OK** — compiles to valid JS (the export failure is purely the symlink entry escape, NOT the ORCH-0993 code).
- `npx eslint` on screen + adversarial test: **0 errors, 5 warnings** — all 5 warnings are PRE-EXISTING in the file (duplicate `queryKeys` import L37/40, `Array<T>` L425, unused `tierBadge`/`locationMuted` L637/638) and untouched by the CTA. The CTA contributes zero new lint findings.

---

## 6. Regression tests

### 6.1 Tester adversarial — `app-mobile/src/components/profile/__tests__/orch-0993-add-friend-cta.adversarial.test.tsx`
Attacks a DIFFERENT angle than the implementor's happy test (which guards the friends/Message gate + else-branch structure). Covers the failure/race/precedence surface:
- **T-06** network-error truthfulness: classifier `'network'` branch; ERROR haptic in catch; `setCtaError`; pill restored in `finally`; **and asserts `handleAddFriend` NEVER optimistically sets 'Requested'/outgoing** (the false-success bug).
- **T-07** "User not found"/blocked → `'unavailable'` → `error_unavailable` copy.
- **T-08** friends-wins precedence: asserts `profile?.isFriend` is the FIRST ternary arm + the full ordered chain + `status==='pending'` scoping so a stale row can't drive a pending state.
- **T-09** double-tap idempotency: `if (ctaInFlight) return;` in all 3 handlers + `disabled={submitting}` + `pointerEvents:'none'` + the DB `UNIQUE(sender_id,receiver_id)` backstop asserted against the migration.
- Plus SC-8 (`no 'profile' source`) + exact error-copy contract.

**Runner:** `node` source-assertion (app-mobile convention; no jest/RTL). **PASS** run captured:
```
PASS ORCH-0993 Add-Friend CTA adversarial regression (T-06 network-truth + T-07 unavailable + T-08 friends-wins + T-09 double-tap/DB-backstop)
```
**Fails-on-revert proven 3 independent ways** (each restored to PASS after):
| Revert | Injected defect | Result |
|--------|-----------------|--------|
| A | Inverted derivation ternary (pending checked before friends) | FAIL — `T-08: precedence chain must be friends → outgoing_pending → incoming_pending → stranger` |
| B | Neutered `classifyCtaError` to always return `'generic'` | FAIL — `T-07: classifier must recognize not-found/blocked/visibility messages` |
| C | Injected optimistic `'outgoing_pending'` flip in `handleAddFriend` | FAIL — `T-06: handleAddFriend must NOT optimistically set 'Requested'/outgoing …` |

It is NOT a renamed copy of the happy test — zero overlap in assertions (happy = gate/else-structure/self-guard; adversarial = classifier/precedence/false-success/double-tap/DB).

### 6.2 Implementor happy — `orch-0993-add-friend-cta.happy.test.tsx` (DO NOT modify — not modified)
Independently re-run: **PASS**. Independently verified **fails-on-revert** by breaking the `onMessage && profile.isFriend` gate → FAIL (`Message button must remain gated on onMessage && profile.isFriend (T-04/T-10)`), restore → PASS.
**P3-1 traceability note:** the impl report cites fails-on-revert "@ `ee8bbdab9`", but that hash is the DESIGN commit (screen not present there). The test is nonetheless sound (I re-proved it). Implementor should cite the correct implementation commit on any future report.

### 6.3 PR-diff presence (verdict-gate clause 3)
`git diff origin/main...HEAD --name-only` already contains the screen + happy test. The adversarial test is committed in this QA commit on the same branch → both ship in the closing PR.

---

## 7. Verdict-gate clause status (`/goal`)
1. Every independent test green — ✅ (adversarial + happy, output captured §6).
2. `tsc --noEmit` clean + lint clean on touched files — ✅ (0 tsc errors, 0 lint errors §5).
3. Both regression tests in PR diff; adversarial attacks a different angle; happy fails-on-revert at a cited commit — ✅ (happy fails-on-revert independently re-proven; adversarial fails-on-revert ×3).
4. UI/runtime change reproduces fix at `proven` on all platform legs — ⚠️ **NOT MET** — iOS leg blocked by §4.2 symlink + §4.4 port contention after exhaustive resolution; Android = parity-automatic + physical device locked. This is the sole reason the verdict is CONDITIONAL not PASS.
5. Zero open P0/P1 — ✅.

Clauses 1,2,3,5 hold; clause 4 is the explicit, justified, surfaced deferral.

---

## 8. Findings

- **P3-1** Impl report's fails-on-revert hash `ee8bbdab9` is the DESIGN commit, not the implementation commit (traceability only; test verified sound). Fix: cite correct hash next time.
- **P3-2** Pre-existing lint warnings in `ViewFriendProfileScreen.tsx` (duplicate queryKeys import, `Array<T>`, unused `tierBadge`/`locationMuted`) — not introduced by ORCH-0993; optional cleanup.
- **P4-1** Clean implementation: derivation precedence (friends-wins) + no-optimistic-flip + 3-handler in-flight guards + inline-error (not Alert) are all exactly right; the designer's contrast correction (`#c2410c` over SPEC's failing `#eb7825`) is correctly honored. Strong, defensive code.
- **P4-2** Frontend-only proven (SC-9): zero backend/migration/Realtime — matches SPEC §3 decision; no blast radius beyond the one screen.

## 9. Discoveries for orchestrator
- **Port 8084 cross-session collision:** ORCH-0989 `[unified-cover-picker-sheet]` is running Metro `--tunnel` on the assigned port 8084 (pid `58847`, `mingla-business`). Two sessions believe they own 8084. Operational, not code. (Not written to COMMS ledger: the anchor `~/Desktop/mingla-main` is currently checked out on another session's branch `orch-0992-…`, so a direct-to-main ledger commit there would itself interfere cross-session — surfaced here + in chat Handoff instead.)
- **Worktree symlinked-node_modules + Expo SDK 54 entry-realpath escape** reproducibly blocks both dev-client load and `expo export` in this worktree, and five filesystem strategies to materialize a real node_modules stalled at ~500/714 packages. This will recur for any UI live-fire in a symlinked worktree on SDK 54 — worth a permanent worktree-bootstrap fix (real per-worktree install, or a metro `server.unstable_serverRoot`/`watchFolders` config so the symlink doesn't escape).
- SPEC §18 latent ungated `get_or_create_direct_conversation` path remains out-of-scope (Message stays UI-gated on `isFriend`); no code here touched it. Already registered by SPEC.

## 10. Test-data setup
Probed Supabase (Management API, read-only): `seth@usemingla.com` (`63835860-…`) has ZERO friend_requests + ZERO friends — a clean slate ideal for the 4-state setup, with three test accounts (`sethogieva+orch0954-*`) available as targets. The 4-state seed rows were NOT inserted because the on-device leg never reached a loadable state to observe them — deferred to the unblocked re-run so no orphan rows are left in the DB.
