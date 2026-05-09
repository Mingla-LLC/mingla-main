# QA Report: ORCH-0749 Mobile Auth/Cache/RLS Log Storm

> Date: 2026-05-07
> Mode: SPEC-COMPLIANCE / TARGETED
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:1 P4:1

## 1. Layman Summary

The implementation is directionally sound and passes the new ORCH-0749 repo-running regression gate. I found no P0/P1 code blocker in the auth/cache/RLS/log-storm fix.

This is not a full closeout PASS yet because the most important proof for this class of bug is runtime auth-transition behavior on a simulator/device: prior-user cache on reload, user A to user B, Apple cancel, Profile scroll, and missing preferences row. Those flows were not executed in this tester pass.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Test prompt: `Mingla_Artifacts/prompts/TEST_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Product/test files listed in the test prompt, with focused inspection of auth cleanup, query persistence, query client, blocked-users, AppsFlyer, engagement, profile interests, AppStateManager, app store, icon mapping, and the ORCH regression script.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | Existing RLS assumptions from spec; no migration in scope | Verified implementation did not weaken RLS or add DB changes |
| Edge/RPC/Webhooks | `app-mobile/src/services/cardEngagementService.ts` | Unauthenticated guard before `record_engagement` RPC |
| Services | `friendsService.ts`, `blockService.ts`, `appsFlyerService.ts` | Auth actor checks, stale callback no-op, false-empty blocked list removal |
| Hooks/State/Cache | `useAuthSimple.ts`, `useFriendsQuery.ts`, `useProfileInterests.ts`, `queryClient.ts`, `authCleanup.ts`, `queryPersistence.ts`, `appStore.ts` | Cleanup routing, cancellation classification, persistence predicate, profile interests missing-row behavior, scroll write guard |
| Components/Screens | `AppStateManager.tsx`, `OnboardingFlow.tsx`, `AccountSettings.tsx`, `Icon.tsx`, `app/index.tsx` | Root store selector usage, direct sign-out bypass removal, icon warning aliases, query persistence wiring |
| Business/Admin/Public | N/A | Mobile-only scope |
| Tests/Build | `npm run test:orch-0749`, `npx tsc --noEmit`, `npx expo lint --quiet`, `git diff --check` | Regression gate and repo health impact |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Pending and non-idle queries are not dehydrated | `queryPersistence.ts:77-97`; `app/index.tsx:2980-2985`; `npm run test:orch-0749` | Verified | Blocks the repeated dehydrated pending `userPreferences` failure class |
| Auth-mismatched query keys are not persisted/kept | `queryPersistence.ts:50-75`, `authCleanup.ts:37-49` | Verified | Conservative UUID scan may over-remove some caches, but privacy direction is safe |
| Query cancellations are not production errors | `queryClient.ts:143-155`, `queryPersistence.ts:34-48` | Verified | Real non-cancellation errors still go to console/breadcrumbs |
| Shared auth cleanup is used for null/sign-out/switch paths | `useAuthSimple.ts:263`, `useAuthSimple.ts:310-315`, `useAuthSimple.ts:342-347`, `AppStateManager.tsx:754-772`, `OnboardingFlow.tsx:1890` | Verified | Runtime sequencing still needs device verification |
| Blocked-users auth mismatch is not cached as `[]` | `useFriendsQuery.ts:57-64`, `friendsService.ts:204-225`, `blockService.ts:116-129` | Verified | Matching authenticated empty result still returns `[]` |
| AppsFlyer stale callback no-ops | `appsFlyerService.ts:80-127` | Verified | Rechecks Supabase user before upsert |
| Engagement skips when unauthenticated | `cardEngagementService.ts:48-69` | Verified | Authenticated payload shape is preserved |
| Profile interests missing row does not throw | `useProfileInterests.ts:20-32` | Verified | Uses `.maybeSingle()` and defaults arrays |
| Profile render storm mitigated | `AppStateManager.tsx:94-98`, `AppStateManager.tsx:188-189`, `appStore.ts:327-336` | Verified structurally | Runtime render-count validation still pending |
| Apple cancel and icon warnings handled | `useAuthSimple.ts:707-718`, `Icon.tsx:331`, `Icon.tsx:425-427` | Verified structurally | Runtime Apple cancel still pending |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| ORCH-0749 regression gate | `cd app-mobile && npm run test:orch-0749` | PASS | All 17 static checks passed; gate ended `ORCH-0749 regression gate: PASS` |
| TypeScript | `cd app-mobile && npx tsc --noEmit` | FAIL baseline only | Existing `ConnectionsPage.tsx(2763,52)` Friend mismatch and `HomePage.tsx(246,19)/(249,54)` missing `state`; no new ORCH-0749-specific TypeScript errors observed |
| Lint | `cd app-mobile && npx expo lint --quiet` | FAIL baseline only | 9 existing errors: OnboardingFlow unescaped entities, PopularityIndicators conditional hook, PreferencesSections/ShuffleButton unescaped entities, duplicate `CollaborationSession` exports |
| Whitespace | `git diff --check` | PASS | No whitespace errors |
| Direct auth instance check | `rg -n "useAuthSimple\\(" app-mobile/src app-mobile/app` | PASS | Only `AppStateManager.tsx:87` uses `useAuthSimple()` |

## 6. Findings

### P2 Medium

**P2-001: Runtime auth-transition QA is still required before closeout**

- **Evidence:** Implementor report lists manual tester gates as remaining; this tester pass did not run the Expo app on simulator/device.
- **What is wrong:** The code and static gate cover the structure, but the original bug was runtime sequencing: pending queries, auth listener timing, SDK callbacks, and persisted state on reload/user switch.
- **Impact:** Without runtime verification, we cannot prove that prior-user query work, AppsFlyer writes, Apple cancel logging, and Profile scroll behavior are quiet in the real app lifecycle.
- **Required action:** Run the manual gates from the test prompt on iOS simulator/device before orchestrator closes ORCH-0749.
- **Retest:** Capture clean logs for no-session reload, user A sign-out to user B sign-in, Apple cancel, Profile scroll, and missing preferences row.

**P2-002: Regression coverage is repo-running but still structural/static**

- **Evidence:** `app-mobile/scripts/ci/orch-0749-regression-check.mjs` scans source text for required guards and passed via `npm run test:orch-0749`.
- **What is wrong:** This satisfies the repo-running gate requirement at an interim level, but it does not execute helper functions under mocked query/auth states or simulate Supabase/AppState timing.
- **Impact:** A future refactor could preserve strings while changing behavior, so this should not be treated as full executable behavioral coverage for auth/cache/RLS.
- **Required action:** Keep the static gate now, but when app-mobile gets a Jest/Vitest/RN test harness, convert the highest-risk checks to executable unit tests for `queryPersistence`, blocked-users mismatch, and auth cleanup.
- **Retest:** `npm run test:orch-0749` must stay green; future behavioral tests should prove the same contracts without relying only on text matching.

### P3 Low

**P3-001: Auth cleanup cancellation is started before removal, but not awaited**

- **Evidence:** `authCleanup.ts:37-45` calls `queryClient.cancelQueries(...).catch(...)`, then immediately `removeQueries(...)`.
- **What is wrong:** TanStack cancellation should notify queries promptly, but the cleanup helper does not wait for the cancellation promise before removing query records.
- **Impact:** I do not see this as a release blocker because removal/clear and persistence purge still happen, and cancellation errors are now non-noisy. It is worth watching during runtime QA for any late old-user request after sign-out/user switch.
- **Recommended action:** If manual QA still shows late old-user query work, make cancellation awaited in cleanup and retest.

### P4 Notes

**P4-001: Query-key user detection is intentionally conservative**

- **Evidence:** `queryPersistence.ts:50-64` checks known user-ID positions first, then falls back to any UUID in the query key.
- **Impact:** This is privacy-safe, but it may over-remove or avoid persisting some non-user UUID keyed caches. That is acceptable for ORCH-0749 because stale private data is the larger risk.

## 7. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| No prior-user query work on no-session startup | Partial | `authCleanup.ts:31-88`, `useAuthSimple.ts:261-265`, regression gate PASS | P2-001 runtime gate |
| User A to user B removes old user query state | Partial | `useAuthSimple.ts:307-315`, `authCleanup.ts:37-49` | P2-001 runtime gate |
| Pending `userPreferences` not dehydrated | Verified | `queryPersistence.ts:80-81`, regression gate PASS | None |
| Cancellation errors are non-noisy | Verified | `queryClient.ts:143-148`, `queryPersistence.ts:34-48` | None |
| Blocked-users false empty removed | Verified | `friendsService.ts:211-218`, `blockService.ts:121-129` | None |
| Missing preferences row defaults empty | Verified | `useProfileInterests.ts:23-32` | None |
| AppsFlyer stale callback guarded | Verified | `appsFlyerService.ts:89-107` | None |
| `record_engagement` skips unauthenticated | Verified | `cardEngagementService.ts:48-69` | None |
| Profile render storm mitigated | Partial | `AppStateManager.tsx` selectors; `appStore.ts:327-336` | P2-001 runtime gate |
| Apple cancel not error logged | Partial | `useAuthSimple.ts:711-718` | P2-001 runtime gate |
| Missing icon warnings removed | Verified | `Icon.tsx:331`, `Icon.tsx:425-427` | None |
| Repo-running regression tests cover behavior changes | Conditional | `npm run test:orch-0749` PASS | P2-002 |

## 8. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| Logout clears everything | CONDITIONAL PASS | Shared cleanup exists, but runtime auth transitions remain unverified |
| One auth instance | PASS | Only `AppStateManager.tsx` calls `useAuthSimple()` |
| No silent failures | PASS | Blocked-users auth mismatch throws typed cancellation instead of returning false `[]` |
| One owner per truth | PASS | React Query server state cleanup stays in query client/helper; Zustand clears local private state |
| Server state server-side | PASS | No RLS weakening or DB migration added |
| Subtract before adding | PASS | Direct sign-out bypasses removed/routed through cleanup |
| Persisted-state startup | CONDITIONAL PASS | Persistence filter and cleanup implemented; no-session reload still needs runtime verification |

## 9. Security / RLS

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| AppsFlyer stale user write | P0 class if broken | `appsFlyerService.ts:89-107` | Guard present |
| `record_engagement` anon RPC attempt | P1/P2 class if broken | `cardEngagementService.ts:48-69` | Guard present |
| RLS policy relaxation | P0 class if present | No migration in ORCH-0749 scope | No relaxation found |
| Stale persisted private cache | P0/P1 class if leaking | `queryPersistence.ts`, `authCleanup.ts` | Structurally mitigated; runtime pending |

## 10. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Prior logged-in cache + no session + reload | Not run | Unverified | Confirm Welcome state and no old-user query/log storm |
| User A sign-out then User B sign-in | Not run | Unverified | Confirm no A query keys, no stale AppsFlyer RLS write |
| Apple sign-in cancel | Not run | Unverified | Confirm no error breadcrumb dump or alert |
| Profile screen scroll | Not run | Unverified | Confirm render count no longer climbs with scroll writes |
| User with no preferences row | Not run | Unverified | Confirm Profile interests loads without single-row error |

## 11. Required Actions

No P0/P1 rework required from this tester pass.

## 12. Conditional / Recommended Actions

1. Run the five runtime/manual gates listed in Production Verification before orchestrator closes ORCH-0749.
2. Keep `npm run test:orch-0749` in the repo gates for any future auth/cache/RLS cleanup changes.
3. When a JS test harness exists, replace or supplement the static regression script with executable helper/service tests.
4. During runtime QA, watch specifically for late old-user query/network work after `performPrivateAuthCleanup()` because `cancelQueries()` is not awaited before `removeQueries()`.

## 13. Retest Notes

Retest cycle: N/A. This is the first tester pass after implementation.

Recommended retest command set:

```bash
cd app-mobile
npm run test:orch-0749
npx tsc --noEmit
npx expo lint --quiet
```

Expected current result: ORCH gate passes; TypeScript/lint still fail on known baseline unrelated issues until those are separately fixed.
