# QA Report: Profile "Your Circle" Rework Retest (ORCH-0933)

> Date: 2026-05-23
> Mode: RETEST + SPEC-COMPLIANCE
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:3 P3:0 P4:2

## 1. Layman Summary

The source rework fixed the two original code defects: local migration files now qualify the ambiguous `user_id` CTE references, and Circle avatar taps now route into the app-level friend-profile owner whose Message button opens the Connections DM handoff. The release gate still fails because the linked dev DB has not applied `20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`; live `get_user_circle` still contains the old unqualified `SELECT user_id` references and authorized calls still fail with SQLSTATE `42702`.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
- Prior QA: `Mingla_Artifacts/reports/QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION_REWORK.md`
- Changed files: `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql`, `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`, `app-mobile/src/components/profile/circle/YourCircleSection.tsx`, `app-mobile/src/components/ProfilePage.tsx`, `app-mobile/app/index.tsx`, `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`
- Screenshots: `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 - 2026-05-23 at 06.38.48.png`, `/Users/sethogieva/Desktop/Screenshot_1779532772.png`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | ORCH-0933 migrations, linked migration list, live function definition, direct RPC calls | Source ambiguity fix, monotonic pending migration, live applied state, auth guard |
| Edge/RPC/Webhooks | `get_user_circle` RPC | `42501` guard preserved; authorized live call still fails before graph checks |
| Services | `app-mobile/src/services/circleService.ts` via tests/strict grep | RPC sole owner, no direct social graph reads |
| Hooks/State/Cache | `useUserCircle.ts`, `queryKeys.ts` | Focused lint/type filter, no rework cache shape changes |
| Components/Screens | `YourCircleSection.tsx`, `ProfilePage.tsx`, `app/index.tsx` | Duplicate local profile owner removed; app-level Message handoff wired |
| Business/Admin/Public | N/A | Consumer Profile only |
| Tests/Build | Happy/adversarial tests, strict grep, focused lint/type filter | Regression coverage and scoped checks |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Local SQL ambiguity fixed | `0002` lines 143/160 and `0003` lines 140/157 use `dau.user_id` / `cu.user_id`; `rg` found no unqualified target pattern | Verified source | Source is corrected. |
| Fix is deployable after `0002` already applied | `supabase migration list --linked` shows local `20260724000003` with blank remote column | Verified pending | Deployable migration exists, but is not live. |
| Live RPC is fixed | Live `pg_get_functiondef` still shows `SELECT user_id FROM dual_app_users` and `SELECT user_id FROM consumer_users` | Refuted | Release blocker. |
| Authorized live call works | Direct linked call with `auth.uid() = p_viewer_user_id` returned `ERROR 42702` | Refuted | Core feature still broken live. |
| Impersonation guard preserved | Prior direct mismatch passed; re-attempt hit Supabase temp-role circuit breaker after authorized failure | Partial | Source still has `42501`; previous QA/rework live proof exists. |
| Circle Message handoff fixed | `YourCircleSection.tsx` calls `onViewProfile`; `ProfilePage.tsx` passes `onViewFriendProfile`; `app/index.tsx` canonical overlay sets `pendingOpenDmUserId` and `connections` | Verified source | Runtime avatar/Message parity still blocked until live RPC loads rows. |
| Happy test not weakened | `node ...happy.test.tsx` PASS; row-major simulation fails | Verified | Regression remains meaningful. |
| Adversarial regression covers rework | `node ...adversarial.test.tsx` PASS; asserts no local modal owner and SQL qualification | Verified | Good coverage for original two P1s. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Linked migration status | `/Users/sethogieva/bin/supabase migration list --linked` | FAIL gate | `20260724000003 | | 2026-07-24 00:00:03` is local-only/pending. |
| Live function definition | `/Users/sethogieva/bin/supabase db query --linked "select pg_get_functiondef(...)"` | FAIL live state | Live body still has unqualified `SELECT user_id FROM dual_app_users` / `consumer_users`. |
| Authorized live RPC | Direct linked call with `request.jwt.claim.sub = ac7f...` and requested viewer `ac7f...` | FAIL | Returned SQLSTATE `42702` with ambiguous `user_id`. |
| Mismatch live RPC | Direct linked call with caller `ac7f...`, requested `c727...` | UNVERIFIED this retest | Supabase temp-role auth later hit `ECIRCUITBREAKER`; previous QA had `42501` proof and source guard remains. |
| Happy regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | Printed happy-path PASS. |
| Adversarial regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | Printed adversarial PASS. |
| Row-major simulation | `ORCH0933_SIMULATE_ROW_MAJOR=1 node ...happy.test.tsx` | PASS as negative test | Failed with expected Alice/Dan/Grace mismatch. |
| Strict grep | `bash .github/scripts/strict-grep/circle-rpc-sole-owner.sh && bash .github/scripts/strict-grep/circle-badge-dual-app.sh` | PASS | Both gates printed PASS. |
| Focused lint | `npx eslint src/components/profile/circle src/hooks/useUserCircle.ts src/services/circleService.ts --max-warnings=0` | PASS | Exit 0. |
| Focused TS filter | `npx tsc --noEmit --pretty false 2>&1 \| rg "circle\|useUserCircle\|circleService\|ProfilePage\|app/index\|queryKeys" \|\| true` | PASS filter | No filtered output. |
| Runtime screenshots | Operator iOS + Android screenshots | FAIL live state | iOS redbox and Android card/toast both show circle query failure. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS source / UNVERIFIED runtime | Message handoff now routes through app-level owner, but live rows cannot load yet. |
| One owner per truth | PASS | Circle no longer owns a local profile modal; app overlay owns friend profile. |
| No silent failures | PASS | UI shows error card/toast instead of silent failure while RPC is broken. |
| One key per entity | PASS | No new duplicate query keys in rework. |
| Server state server-side | PASS source / FAIL live | RPC owns graph, but live RPC is still old broken body. |
| Logout clears everything | N/A | Not touched. |
| Label temporary | PASS | Pending deploy state documented in rework report. |
| Subtract before adding | PASS | Local modal state removed. |
| No fabricated data | PASS | Error state shown; no fake avatars. |
| Currency-aware | N/A | Not payment display. |
| One auth instance | PASS | RPC uses `auth.uid()` only. |
| Validate at right time | PASS source | `p_limit` and caller guard preserved. |
| Exclusion consistency | UNVERIFIED live | Blocked exclusion cannot be proven until live RPC is fixed. |
| Persisted-state startup | N/A | Not touched. |

## 7. Findings

### P1 High

**P1-001: Linked dev DB still runs the broken `get_user_circle` function**
- **Evidence:** `supabase migration list --linked` shows `20260724000003` is pending; live `pg_get_functiondef` still contains unqualified `SELECT user_id FROM dual_app_users` and `SELECT user_id FROM consumer_users`; direct authorized call returned SQLSTATE `42702`.
- **What is wrong:** The rework source is not applied to the linked DB, so runtime still fails for authorized users.
- **Impact:** Core Profile "Your Circle" data path remains broken on both iOS and Android; SC-06, SC-08, SC-09, SC-13, SC-14, and runtime SC-17/18/19 cannot pass.
- **Required fix:** Operator applies `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql` via the approved deploy path; then tester reruns direct live RPC proof.
- **Retest:** Verify authorized call succeeds, mismatched caller returns `42501`, blocked users are excluded, business-only users are excluded, dual-app badge truth is correct, and tier precedence sorts correctly.

### P2 Medium

**P2-001: Android Maestro automation still blocked**
- **Evidence:** Rework report records `io.grpc.StatusRuntimeException: UNAVAILABLE` / `tcp:7001 closed`; current Android screenshot proves the app surface is reachable manually but not automated.
- **What is wrong:** Automated Android parity and 60+ avatar scroll/perf proof cannot run through Maestro.
- **Impact:** SC-17/19 remain manually gated even after DB deploy.
- **Required fix:** Repair Maestro/ADB driver and rerun Android Profile -> Your Circle -> avatar -> Message plus 60+ avatar scroll.
- **Retest:** Maestro passes on `emulator-5554` or replacement emulator.

**P2-002: Purchase-to-circle invalidation still unresolved**
- **Evidence:** Prior QA found no `circleKeys` invalidation in native checkout success paths; rework report explicitly left this out of scope.
- **What is wrong:** Newly co-attended users may not appear until stale/refocus.
- **Impact:** Bounded freshness issue, not the current P1 blocker.
- **Required fix:** Operator accepts v1 stale behavior or dispatches follow-up to invalidate `circleKeys.all` after successful ticket/order finalization.
- **Retest:** Purchase success invalidates/refetches circle cache or documented acceptance exists.

**P2-003: SC-20 invariant registry remains close-only pending**
- **Evidence:** Spec requires CLOSE registry updates; tester must not write global indexes.
- **What is wrong:** Invariants are not close-ready while verdict is FAIL.
- **Impact:** Closure cannot complete until PASS/close flow.
- **Required fix:** Orchestrator handles registry updates during CLOSE after retest PASS.
- **Retest:** Check CLOSE artifacts after PASS.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-01..SC-05 | PASS source/local | Mount, fixed grid, tier rings, badge guard verified by source/tests | None |
| SC-06 | FAIL live | Live authorized RPC fails with `42702` before consumer filter can be proven | P1-001 |
| SC-07 | PASS source / prior live | `42501` guard remains; prior QA proved mismatch | None |
| SC-08 | FAIL live | Source/test dedupe passes; live tier precedence blocked by old RPC | P1-001 |
| SC-09 | FAIL live | Source blocked filter exists; live blocked proof blocked by old RPC | P1-001 |
| SC-10 | PASS source / UNVERIFIED runtime | App-level Message handoff wired; runtime avatar rows cannot load yet | P1-001 runtime blocker |
| SC-11..SC-12 | PASS local | Empty state and pagination tests/source verified | None |
| SC-13..SC-14 | FAIL live | Live sorting cannot be proven until RPC applies | P1-001 |
| SC-15..SC-16 | PASS local | Strict grep and happy/adversarial tests pass | None |
| SC-17..SC-19 | FAIL/UNVERIFIED | iOS/Android screenshots show failure state; Android Maestro blocked | P1-001, P2-001 |
| SC-20 | PENDING | Close-only invariant registry work | P2-003 |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No impersonation | P1 if broken | Source guard `v_caller IS NULL OR v_caller <> p_viewer_user_id` and `42501` preserved in `0003` | PASS source; live mismatch not rerun this cycle due Supabase temp-role circuit breaker |
| SECURITY DEFINER search path | P1 if unsafe | `SET search_path = public, pg_temp` in both migrations | PASS |
| Client direct graph reads | P1 if present | Strict grep forbids direct `friends`/`pairings`/`orders` reads in circle scope | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Profile / Your Circle error | Error state truthful | P4 | Android screenshot shows in-card retry copy plus query toast while live RPC broken. |
| Avatar -> profile -> Message | Canonical handoff | P1 before rework | PASS source, runtime blocked by no rows until migration applies. |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Yes | FAIL live | Shared path still hits live RPC `42702`. |
| Business | N/A | N/A | Not touched. |
| Admin | N/A | N/A | Not touched. |
| Public/web | N/A | N/A | Not touched. |
| Solo | Yes | FAIL live | Consumer Profile path. |
| Collab | N/A | N/A | Not touched. |
| iOS | Screenshot + prior launch | FAIL live | Redbox shows ambiguous `user_id`. |
| Android | Screenshot | FAIL live / automation blocked | Profile reaches Circle but shows error state/toast; Maestro still unavailable. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| `0003` RPC replacement | Required | N/A | N/A | Directly touched | Auth/graph data | Pending deploy is the release blocker. |
| App-level profile handoff | Touched | N/A | N/A | N/A | N/A | Source-fixed; runtime proof waits for loaded rows. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Live authorized RPC | Direct linked query | FAIL `42702` | Rerun after `0003` deploy. |
| Live blocked/business-only/dual-app/tier | Direct linked SQL + app | BLOCKED | Requires `0003` deploy. |
| iOS runtime | Screenshot / launch hierarchy | FAIL state | After deploy: load avatars, tap avatar, tap Message, verify DM opens. |
| Android runtime | Screenshot | FAIL state | After deploy: same flow; repair Maestro for automation. |

## 14. Required Actions

1. **P1-001:** Apply `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql` through the operator-controlled migration path, then dispatch RETEST again.

## 15. Conditional / Recommended Actions

1. **P2-001:** Repair Android Maestro/ADB driver before final parity/perf close evidence.
2. **P2-002:** Decide whether to accept v1 purchase-to-circle stale behavior or dispatch a follow-up invalidation fix.
3. **P2-003:** Leave SC-20 invariant registry updates to orchestrator CLOSE after PASS.

## 16. Discoveries For Orchestrator

- The rework source is materially correct, but the live release gate is still red because `0003` is pending on the linked DB.
- Supabase CLI began returning temp-role auth/circuit-breaker errors after repeated linked queries; deploy/retest may need the correct `SUPABASE_DB_PASSWORD` or a cooldown.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| P1 live `get_user_circle` ambiguity | Source yes, live no | Local migrations fixed; live function still old; authorized call fails `42702` | Still failing live |
| P1 local profile modal Message dead action | Source yes | Circle no longer renders local modal; app-level Message handoff wired | Runtime proof blocked |
| P2 purchase invalidation | No | Out of rework scope | Existing P2 remains |
| P2 platform parity | Partial | iOS/Android screenshots prove failure state; Android Maestro blocked | Still not close-ready |
| SC-20 registry | No | Close-only | Pending |

Retest cycle: 1
