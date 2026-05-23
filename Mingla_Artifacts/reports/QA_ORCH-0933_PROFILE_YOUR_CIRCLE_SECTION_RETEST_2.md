# QA Report: Profile "Your Circle" Rework Retest 2 (ORCH-0933)

> Date: 2026-05-23
> Mode: RETEST + SPEC-COMPLIANCE
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:4 P3:0 P4:2

## 1. Layman Summary

The previous P1 live RPC blocker is cleared enough for a conditional gate: the linked live `get_user_circle` function now contains the qualified `dau.user_id` and `cu.user_id` references, wrong-actor calls still return `42501`, and Android runtime now shows actual Circle avatars instead of the prior error card/toast. The Message regression is fixed in source by routing Circle avatar taps through the app-level `ViewFriendProfileScreen` owner, and Android runtime confirms avatar tap opens a real friend profile. This is not a full PASS because direct authorized SQL proof for every data invariant was blocked by Supabase CLI pooler auth, Android Maestro is still broken, and the final Message -> DM tap-through remains manual/source-verified rather than automation-proven.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
- Prior QA: `Mingla_Artifacts/reports/QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
- Retest 1: `Mingla_Artifacts/reports/QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION_RETEST.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION_REWORK.md`
- Evidence screenshots: `Mingla_Artifacts/reports/evidence/ORCH-0933/android_profile_after_migration.png`, `Mingla_Artifacts/reports/evidence/ORCH-0933/android_avatar_profile.png`, `Mingla_Artifacts/reports/evidence/ORCH-0933/android_avatar_profile_scrolled.png`
- Changed code: `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql`, `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`, `app-mobile/src/components/profile/circle/YourCircleSection.tsx`, `app-mobile/src/components/ProfilePage.tsx`, `app-mobile/app/index.tsx`, `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | Local migrations, live `pg_get_functiondef`, direct wrong-actor query | Ambiguity fix deployed, auth guard preserved |
| RPC behavior | `get_user_circle` via app runtime and SQL attempts | Android authorized app call loads rows; SQL count blocked by CLI auth |
| Services/hooks | `circleService.ts`, `useUserCircle.ts`, `queryKeys.ts` | RPC sole owner, focused lint/type filter |
| Components/screens | `YourCircleSection.tsx`, `ProfilePage.tsx`, `app/index.tsx` | No local modal owner; canonical profile/DM handoff source |
| Runtime parity | Android screenshots, iOS Maestro hierarchy attempt | Android Profile/Circle/avatar profile proven; iOS partial; Android Maestro unavailable |
| Tests/build | Happy/adversarial/strict grep/lint/type filter | Regression gates |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Live SQL ambiguity is fixed | Live `pg_get_functiondef` shows `SELECT dau.user_id FROM dual_app_users dau` and `SELECT cu.user_id FROM consumer_users cu` | Verified | Prior live `SELECT user_id` defect is gone. |
| Authorized runtime Circle loads | Android screenshot `android_profile_after_migration.png` | Verified runtime | Your Circle renders avatars/badges instead of error state. |
| Wrong actor still rejected | Direct linked query with caller `ac7f...`, requested `c727...` returned `42501` | Verified | Security guard preserved. |
| Direct SQL authorized count works | CLI query with caller=requested viewer | Unverified | Supabase pooler/temp-role auth failed before query execution. Android runtime proves app-level authorized success. |
| Blocked/business-only/dual-app/tier live proofs | Direct SQL requested | Partial | Source/live function body has filters/sort; direct invariant SQL was blocked by CLI auth. |
| Circle Message handoff fixed | Source in `YourCircleSection`, `ProfilePage`, `app/index`; Android avatar tap opened Ava Thompson profile | Partial/verified source | Final Message tap-through to DM not visible/proven in viewport; canonical source is correct. |
| Tests are not weakened | Happy PASS; row-major simulation fails; adversarial PASS | Verified | Regression coverage retained. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Live function body | `supabase db query --linked "select pg_get_functiondef(...)"` | PASS | Live body has `dau.user_id` / `cu.user_id`. |
| Wrong actor | Direct linked query with caller `ac7f...`, requested `c727...` | PASS | Returned `ERROR 42501 get_user_circle: unauthorized`. |
| Authorized runtime | Android ADB profile screenshot | PASS runtime | `android_profile_after_migration.png` shows Circle avatars and no error card/toast. |
| Avatar tap | Android ADB tap first avatar | PASS runtime | `android_avatar_profile.png` opens Ava Thompson profile. |
| Message handoff | Source + Android profile opened | PARTIAL | App source wires `onMessage` to `setPendingOpenDmUserId` and Connections; final CTA not tapped in runtime. |
| Happy regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | Printed PASS. |
| Adversarial regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | Printed PASS. |
| Strict grep | `bash .github/scripts/strict-grep/circle-rpc-sole-owner.sh && bash .github/scripts/strict-grep/circle-badge-dual-app.sh` | PASS | Both printed PASS. |
| Focused lint | `npx eslint src/components/profile/circle src/hooks/useUserCircle.ts src/services/circleService.ts --max-warnings=0` | PASS | Exit 0. |
| iOS Maestro launch/hierarchy | `maestro --device F7ECAC25... test orch0933_launch_probe.yaml` + hierarchy grep | PARTIAL | Launch succeeded; hierarchy grep only found Profile in current viewport/state. |
| Android Maestro | Previous/current attempts | BLOCKED | Driver still fails with `tcp:7001 closed`; used ADB screenshots instead. |

## 6. Findings

### P2 Medium

**P2-001: Direct SQL proof for all circle invariants is incomplete**
- **Evidence:** Authorized direct SQL count could not run because Supabase CLI pooler/temp-role auth returned `ECIRCUITBREAKER` / `SUPABASE_DB_PASSWORD` errors. MCP SQL could read metadata but could not invoke `get_user_circle` in the authenticated role.
- **Impact:** Tester could not directly prove blocked exclusion, business-only exclusion, dual-app truth, and tier precedence through SQL rows.
- **Why not P1:** Live function body is corrected, wrong-actor proof passes, and Android authenticated runtime renders Circle avatars.
- **Required follow-up:** When Supabase CLI auth is healthy, run the direct invariant SQL matrix requested by the original QA.

**P2-002: Android Maestro automation remains unavailable**
- **Evidence:** Android Maestro driver remains blocked by `io.grpc.StatusRuntimeException: UNAVAILABLE` / `tcp:7001 closed`; ADB screenshots were used instead.
- **Impact:** Android parity/perf is manually evidenced, not automation-proven.
- **Required follow-up:** Repair Maestro/ADB driver and rerun Android Profile -> Your Circle -> avatar -> Message plus 60+ avatar scroll.

**P2-003: Message-to-DM tap-through is source-verified but not fully runtime-proven**
- **Evidence:** `YourCircleSection` calls `onViewProfile`; `ProfilePage` passes `onViewFriendProfile`; `app/index.tsx` closes profile, sets `pendingOpenDmUserId`, and switches to Connections. Android avatar tap opened the app-level friend profile. The visible Ava Thompson profile did not expose a Message CTA in the captured viewport.
- **Impact:** The original dead-local-modal bug is fixed, but the final DM handoff should still be manually tapped on a profile that exposes Message.
- **Required follow-up:** On a friend profile where Message is visible, tap Message and confirm Connections DM opens.

**P2-004: Purchase-to-circle invalidation remains a product decision**
- **Evidence:** Prior QA finding remains; rework did not touch checkout invalidation.
- **Impact:** Newly co-attended users may wait for staleTime/refocus.
- **Required follow-up:** Operator accepts v1 stale behavior or dispatches a focused invalidation follow-up.

## 7. Positive Evidence

- Live `get_user_circle` no longer contains the ambiguous unqualified CTE `user_id` references.
- Android Profile now renders Circle avatars with tier rings and business badges, replacing the previous error card.
- Circle avatar tap opens the app-level friend profile screen.
- Wrong-actor request returns `42501`.
- Happy/adversarial/strict-grep/focused lint all pass.
- No duplicate Circle-local `ViewFriendProfileScreen` or `Modal` owner remains.

## 8. Spec Traceability

| Criterion | Status | Evidence |
|---|---|---|
| SC-01..SC-05 | PASS | Source/tests plus Android runtime Circle render. |
| SC-06 | PASS runtime / partial SQL | Android authenticated runtime loads avatars; direct SQL consumer-only matrix not run. |
| SC-07 | PASS | Wrong actor returned `42501`. |
| SC-08 | PARTIAL | Source/live function enforces tier exclusion; service adversarial dedupe passes; direct SQL tier matrix pending. |
| SC-09 | PARTIAL | Source/live function has blocked filter; direct SQL blocked-row proof pending. |
| SC-10 | PASS source / partial runtime | Avatar opens friend profile; final Message->DM tap still manual. |
| SC-11..SC-16 | PASS | Tests, source, strict grep, lint. |
| SC-17 | PARTIAL | Android runtime proof; iOS only partial hierarchy; Android Maestro blocked. |
| SC-18 | UNVERIFIED | First-paint timing not measured. |
| SC-19 | UNVERIFIED | 60+ avatar Android scroll/fps not automated. |
| SC-20 | PENDING | CLOSE-only registry work. |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| No impersonation | P1 if failed | Direct wrong-actor call returned `42501`; source guard remains | PASS |
| SECURITY DEFINER hardening | P1 if failed | `SET search_path = public, pg_temp` in live function body | PASS |
| Client direct graph reads | P1 if present | Strict grep passed | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Your Circle populated | Runtime no longer shows error card | PASS | Android screenshot shows avatars. |
| Avatar tap | Opens app-level friend profile | PASS | Ava Thompson profile opened. |
| Message CTA | Final handoff | P2 | Source-correct; runtime CTA not captured. |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Yes | CONDITIONAL PASS | Android runtime strong; iOS partial. |
| Business/Admin/Public | N/A | N/A | Not touched. |
| Solo | Yes | PASS runtime on Android | Profile path. |
| Collab | N/A | N/A | Not touched. |
| iOS | Partial | PARTIAL | Launch works, current hierarchy not enough for final flow. |
| Android | Manual/ADB | PASS with P2 automation gap | Circle loads and avatar opens profile. |

## 12. Required Actions

None blocking source/release at P1/P0 level.

## 13. Conditional / Recommended Actions

1. Run the direct live SQL invariant matrix once Supabase CLI auth is healthy: authorized count, 42501, blocked exclusion, business-only exclusion, dual-app truth, and tier precedence.
2. Manually tap Message on a visible friend profile and verify Connections DM opens.
3. Repair Android Maestro and rerun automated Android parity/perf.
4. Decide the purchase-to-circle invalidation P2 before or during close planning.

## 14. Discoveries For Orchestrator

- The migration appears applied in live function body even though `supabase migration list --linked` was unreliable/hung during this pass.
- Supabase CLI temp-role/pooler auth is flaky enough to interfere with QA; this is now a tooling reliability issue separate from ORCH-0933 source.

## 15. Retest Notes

| Previous finding | Fixed? | Evidence | Residual |
|---|---|---|---|
| P1 live `get_user_circle` ambiguity | Yes | Live function body fixed; Android Circle loads avatars | Direct invariant SQL pending due CLI auth |
| P1 local profile modal Message dead action | Yes source / partial runtime | Local modal removed; avatar opens app-level profile | Final Message tap-through manual |
| P2 purchase invalidation | No | Out of scope | Operator decision |
| P2 platform parity | Partial | Android ADB evidence | iOS/Android Maestro/perf gaps |
| SC-20 registry | Pending | Close-only | Orchestrator CLOSE |

Retest cycle: 2
