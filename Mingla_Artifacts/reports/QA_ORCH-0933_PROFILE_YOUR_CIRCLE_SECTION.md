# QA ORCH-0933 - Profile "Your Circle" Social Graph Section

**Date:** 2026-05-23  
**Tester:** Codex `tester` parity mirror  
**Mode:** TARGETED + SPEC-COMPLIANCE  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Verdict:** FAIL

## Executive Summary

ORCH-0933 is not ready to close. The applied live dev DB RPC rejects impersonation correctly, but normal authorized calls fail with SQLSTATE `42702` because the PL/pgSQL `RETURNS TABLE` output column `user_id` conflicts with unqualified `SELECT user_id` references inside the RPC. This breaks the core Profile "Your Circle" data path.

I added the requested tester adversarial regression at `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`. It exercises the service with a mocked Supabase client, spies on `supabase.from`, covers the seven requested invariants, and now fails before rework on the live-found ambiguity defect.

Second blocker: the implementor-declared local full-screen modal is not acceptable as shipped because `Message` inside `ViewFriendProfileScreen` only dismisses the local modal. The canonical caller in `app/index.tsx` closes the profile, opens the DM target, and switches to Connections.

## Severity Counts

| Severity | Count |
|---|---:|
| P0 Critical | 0 |
| P1 High | 2 |
| P2 Medium | 3 |
| P3 Low | 0 |
| P4 Note | 2 |

## Findings

### P1 - Live `get_user_circle` fails for authorized callers

**Impact:** Core feature is broken. The app cannot load real circle data for a valid viewer, so SC-06, SC-08, SC-09, SC-13, and SC-14 cannot be proven live and the section will show an error/empty path instead of the social graph.

**Evidence:**
- RPC return column `user_id` is declared in `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql:16`.
- The RPC uses unqualified `SELECT user_id FROM dual_app_users` at `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql:143`.
- The RPC uses unqualified `SELECT user_id FROM consumer_users` at `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql:160`.
- Direct live DB authorized call for viewer `ac7f00ee-b87f-4eb8-86ea-772b9fc88afa` failed with:

```text
ERROR 42702: column reference "user_id" is ambiguous
CONTEXT: PL/pgSQL function get_user_circle(uuid,integer,integer) line 14 at RETURN QUERY
```

**Required rework:** Qualify the CTE references, for example `SELECT cu.user_id FROM consumer_users cu` and `SELECT du.user_id FROM dual_app_users du`, then rerun the direct live checks for normal authorized call, blocked exclusion, business-only exclusion, dual-app badge truth, and tier precedence.

### P1 - Local friend-profile modal breaks Message behavior

**Impact:** Avatar tap can open a local modal, but the Message CTA inside that profile does not open a DM. It only closes the modal, creating a misleading/dead action for friends.

**Evidence:**
- Local modal composition is in `app-mobile/src/components/profile/circle/YourCircleSection.tsx:85`.
- Local `onMessage` is `onMessage={() => setSelectedUserId(null)}` at `app-mobile/src/components/profile/circle/YourCircleSection.tsx:95`.
- `ViewFriendProfileScreen` calls `onMessage(userId)` from the Message button at `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx:434`.
- Canonical app caller closes the profile, sets `pendingOpenDmUserId`, and navigates to Connections at `app-mobile/app/index.tsx:2323`.

**Required rework:** Route Circle avatar profile opening through the canonical app-level profile mechanism, or pass a local `onMessage(userId)` that performs the same DM handoff. Back/dismiss can stay modal-native, but Message must not silently close.

### P2 - Ticket purchase does not invalidate `circleKeys`

**Impact:** Newly co-attended users can remain stale until the 5 minute `staleTime` expires or app refocus causes a refetch. This matches the implementor-declared deviation and is not a P0 because scope is debatable, but it needs an operator decision.

**Evidence:**
- `useUserCircle` sets `staleTime: 5 * 60 * 1000` at `app-mobile/src/hooks/useUserCircle.ts:30`.
- Native checkout success returns without circle invalidation at `app-mobile/src/payments/nativeCheckoutFlow.ts:240`.
- App purchase handlers are logging-only at `app-mobile/app/index.tsx:1848`.
- `rg` found no `circleKeys` usage in the ticket/native checkout paths.

**Operator decision:** Accept v1 stale behavior, or ask implementor to invalidate `circleKeys.all` after order finalization/purchase success in a follow-up.

### P2 - Platform parity could not be completed

**Impact:** SC-17, SC-18, and SC-19 remain unverified. This is secondary to the RPC failure, but closure still needs iOS and Android runtime proof after rework.

**Evidence:**
- iOS Simulator `F7ECAC25-2A98-4002-AD17-85AED17AB752`: Maestro launched/tapped Mingla successfully, but hierarchy exposed only the app root/bottom sheet and no Profile/Your Circle accessible text after waits.
- Android Emulator `emulator-5554`: Maestro failed with `io.grpc.StatusRuntimeException: UNAVAILABLE`, caused by `Command failed (tcp:7001): closed`.
- No osascript keystrokes were used.

**Required rework/retest:** After the RPC and modal fixes, rerun Maestro on both platforms and capture Profile -> Your Circle -> avatar tap -> back -> message behavior. Include a 60+ avatar Android scroll/perf check.

### P2 - SC-20 is not close-ready

**Impact:** The seven invariants are not in `Mingla_Artifacts/INVARIANT_REGISTRY.md` yet. This is expected to happen during CLOSE, but CLOSE is blocked by this FAIL.

**Evidence:** Spec SC-20 requires CLOSE registry updates. No tester edit was made to global indexes per tester branch discipline.

## Positive Evidence

| Check | Result | Evidence |
|---|---|---|
| Mismatched RPC caller | PASS | Direct live DB call with caller `ac7f...` and requested viewer `c727...` returned SQLSTATE `42501`. |
| Happy regression | PASS | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` passed. |
| Happy fails-on-revert | PASS | `ORCH0933_SIMULATE_ROW_MAJOR=1 node ...happy.test.tsx` failed on row-major order as expected. |
| Strict grep G-CIRCLE-RPC-SOLE-OWNER | PASS | `bash .github/scripts/strict-grep/circle-rpc-sole-owner.sh` printed `PASS`. |
| Strict grep G-CIRCLE-BADGE-DUAL-APP | PASS | `bash .github/scripts/strict-grep/circle-badge-dual-app.sh` printed `PASS`. |
| Focused lint | PASS | `npx eslint src/components/profile/circle src/hooks/useUserCircle.ts src/services/circleService.ts --max-warnings=0` exited 0. |
| Focused TypeScript filter | PASS | `npx tsc --noEmit --pretty false | rg "circle|useUserCircle|circleService|ProfilePage|useFriends|usePairings|useNotifications|queryKeys" || true` produced no ORCH-0933 hits. |
| Happy test untouched | PASS | `git diff -- app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` produced no diff. |

## Spec Success Criteria Matrix

| SC | Status | Evidence |
|---|---|---|
| SC-01 | PASS by source | Mounted after `ProfileInterestsSection` and before stats in `app-mobile/src/components/ProfilePage.tsx:454` and `app-mobile/src/components/ProfilePage.tsx:464`. |
| SC-02 | PASS by source | `YourCircleSection` height is 180 at `YourCircleSection.tsx:104`; `GlassCard` adds 20 top + 20 bottom padding at `GlassCard.tsx:86`, totaling 220. |
| SC-03 | PASS | Column-major logic uses `Math.floor(index / ROWS_PER_COLUMN)` and `index % ROWS_PER_COLUMN` at `CircleGrid.tsx:29`; happy test passes and row-major simulation fails. |
| SC-04 | PASS by source/test | Tier ring colors map close/friend/extended to primary/success/gray at `CircleAvatarTile.tsx:17`. |
| SC-05 | PARTIAL | Render guard uses `person.hasBusinessApp` at `CircleAvatarTile.tsx:118`, but live RPC cannot produce rows due `42702`. |
| SC-06 | FAIL | Live authorized RPC fails before consumer-app filter can be verified. |
| SC-07 | PASS | Direct live mismatch returned SQLSTATE `42501`; guard is in migration lines 32-34. |
| SC-08 | FAIL | Live tier precedence cannot be verified because authorized RPC fails. Mocked service dedupe passes in adversarial test before the migration ambiguity assertion. |
| SC-09 | FAIL | Source has blocked `NOT EXISTS` at migration lines 162-169, but live blocked-row verification is blocked by `42702`. |
| SC-10 | FAIL | Avatar tap opens local modal, but Message behavior is broken versus canonical profile mechanism. |
| SC-11 | PASS by source/test | Empty copy exists and empty RPC mock returns no people in adversarial test. |
| SC-12 | PASS by source/test | `USER_CIRCLE_PAGE_SIZE = 60`, `initialPageParam = 0`, and next offset is `lastPage.offset + lastPage.limit` at `useUserCircle.ts:7` and `useUserCircle.ts:26`. |
| SC-13 | FAIL | Live sort by relationship/co-attendance recency cannot be verified because authorized RPC fails. |
| SC-14 | FAIL | Live tier sort precedence cannot be verified because authorized RPC fails. |
| SC-15 | PASS local | Both strict-grep gates pass locally; CI still must run after rework. |
| SC-16 | FAIL | Happy test passes, but tester adversarial test intentionally fails on the migration ambiguity found live. |
| SC-17 | FAIL/UNVERIFIED | iOS/Android parity not completed; Android Maestro driver unavailable and iOS did not expose Profile/Circle hierarchy. |
| SC-18 | UNVERIFIED | First-paint measurement not possible before runtime surface is reachable and RPC works. |
| SC-19 | UNVERIFIED | 60+ avatar Android scroll/fps not possible before Android Maestro and RPC are working. |
| SC-20 | PENDING | CLOSE-only registry work; not done because verdict is FAIL. |

## Direct RPC Verification

| Direct DB check | Result | Notes |
|---|---|---|
| Function exists remotely | PASS | `get_user_circle(p_viewer_user_id uuid, p_limit integer, p_offset integer)` exists on linked dev DB. |
| Authorized viewer call | FAIL | `auth.uid() = p_viewer_user_id` call failed with SQLSTATE `42702`. |
| Mismatched caller/viewer | PASS | Returned SQLSTATE `42501`. |
| Blocked-user exclusion | BLOCKED | Not seeded after authorized call failed; seeding cannot prove exclusion until `42702` is fixed. |
| Business-only exclusion | BLOCKED | Same blocker. |
| Dual-app truth | BLOCKED | Same blocker. |
| Tier precedence live | BLOCKED | Same blocker. |

## Rework Requirements

1. Fix `get_user_circle` ambiguity by qualifying all CTE `user_id` references that collide with `RETURNS TABLE` output variables.
2. Update `YourCircleSection.adversarial.test.tsx` only as needed so it passes after the SQL is corrected; do not remove the ambiguity guard.
3. Fix Circle profile Message behavior to match the canonical app-level profile flow.
4. Decide whether to accept or fix purchase -> `circleKeys` staleness; if accepted, document as an operator-approved P2.
5. Rerun direct live DB checks for authorized call, 42501 mismatch, blocked exclusion, business-only exclusion, dual-app truth, and tier precedence.
6. Rerun iOS Simulator and Android Emulator Maestro parity, including modal back/dismiss/message and 60+ avatar horizontal scroll.

## Next Handoff

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. ORCH-0933 QA verdict is FAIL in `Mingla_Artifacts/reports/QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`; rework the live `get_user_circle` RPC ambiguity causing authorized calls to fail with SQLSTATE `42702`, and fix Circle avatar profile Message behavior so it matches the canonical app-level `ViewFriendProfileScreen` DM handoff. Inputs are the spec `Mingla_Artifacts/specs/SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`, implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`, and new failing adversarial test `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`; hard guards remain: do not weaken the happy test, do not bypass strict grep, do not add duplicate state owners, and do not run `supabase db push` unless the operator explicitly assigns deploy. Expected output is a scoped rework report plus passing happy/adversarial/strict-grep/focused lint, direct live RPC proof for 42501/blocked/business-only/dual-app/tier precedence after migration application, and iOS + Android Maestro parity evidence. Route back to Codex `tester` for RETEST after rework.
