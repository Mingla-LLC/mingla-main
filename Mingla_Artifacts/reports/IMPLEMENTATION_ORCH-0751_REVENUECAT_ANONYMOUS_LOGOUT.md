# Implementation Report: RevenueCat Anonymous Logout Guard (ORCH-0751)

> Date: 2026-05-07
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
> Status: implemented, partially verified after runtime rework

## 1. Layman Summary

RevenueCat logout is now guarded for auth cleanup. If RevenueCat is already anonymous, Mingla quietly no-ops instead of asking RevenueCat to log out and then logging the expected SDK rejection. Real RevenueCat failures still surface, and the sign-in path that merges anonymous purchases into the signed-in user was preserved.

Runtime QA found one remaining duplicate sign-out race: two guarded cleanup callers could enter at the same time, the first native logout would succeed, and the second would reach RevenueCat after the SDK had already become anonymous. This rework makes guarded logout share one in-flight native logout promise so duplicate cleanup callers cannot call RevenueCat twice during the same sign-out.

## 2. Request And Context

- **Request:** Implement ORCH-0751 from the orchestrator dispatch.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`.
- **Affected surfaces:** app-mobile RevenueCat service, auth cleanup, root auth effect, RevenueCat hook, package test script, focused CI gate.
- **Runtime rework source:** `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`.
- **Related issues/artifacts:** ORCH-0749 auth/cache cleanup; ORCH-0752 product/store config remains separate.

## 3. Scope

- **In scope:** RevenueCat guarded logout helper/classifier, in-flight logout serialization, cleanup/root/hook call-site routing, `test:orch-0751` static gate, implementation report.
- **Out of scope:** RevenueCat products/offerings/paywalls/store config, Supabase, admin, business app, Google OAuth fallback, unrelated log warnings.
- **Assumptions:** `react-native-purchases` exposes `Purchases.isAnonymous()` and `PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR`, as proven by ORCH-0751 forensics.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` | Binding implementation prompt | Required helper, call sites, tests, report. |
| `Mingla_Artifacts/reports/SPEC_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` | Binding spec | Success criteria and non-goals. |
| `app-mobile/src/services/revenueCatService.ts` | RevenueCat wrapper | Strict logout existed; login path preserved. |
| `app-mobile/src/utils/authCleanup.ts` | Auth cleanup call site | Cleanup called strict logout; now guarded. |
| `app-mobile/app/index.tsx` | Root RevenueCat auth effect | Null-user branch swallowed strict logout; now guarded/warned. |
| `app-mobile/src/hooks/useRevenueCat.ts` | RevenueCat cache hook | Logout hook needed guarded helper and cache removal. |
| `app-mobile/scripts/ci/orch-0749-regression-check.mjs` | Existing gate pattern | New ORCH-0751 gate follows same style. |
| `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` | Tester rework evidence | Explicit sign-out still leaked native anonymous logout due duplicate cleanup race. |
| `app-mobile/package.json` | npm script wiring | Added `test:orch-0751`. |

## 5. Blast Radius

- **Direct changes:** Mobile RevenueCat service/hook/auth cleanup/root auth effect.
- **Cascade changes:** New static test gate and npm script.
- **Parity surfaces:** No business/admin/public changes.
- **Cache impact:** `useRevenueCatLogout()` still removes `revenuecat.customer-info` on success, including anonymous no-op success.
- **State boundaries:** ORCH-0749 private cleanup remains unchanged except RevenueCat integration call target.
- **Auth/RLS/security:** No Supabase/RLS changes.
- **Deploy path:** Mobile JS/TS only; no native dependency, migration, edge deploy, or env var change.

## 6. Old To New Receipts

### `app-mobile/src/services/revenueCatService.ts`

- **Before:** `logoutRevenueCat()` always called strict `Purchases.logOut()`.
- **After:** Added `isRevenueCatAnonymousLogoutError(error)` and `logoutRevenueCatIfIdentified()`. The guarded helper checks `Purchases.isAnonymous()` before native logout, returns `null` if already anonymous, treats exact anonymous logout race as `null`, rethrows unknown failures, and shares a single `guardedLogoutInFlight` promise across concurrent cleanup callers.
- **Why:** Quiet expected duplicate/no-session cleanup while preserving real error visibility, and prevent explicit sign-out from issuing two native `Purchases.logOut()` calls.
- **Approx lines changed:** +58.

### `app-mobile/src/utils/authCleanup.ts`

- **Before:** Dynamic import used strict `logoutRevenueCat()` and warned on every rejection.
- **After:** Dynamic import uses `logoutRevenueCatIfIdentified()` and still warns only if the helper rejects with an unexpected error.
- **Why:** `initial-no-session` cleanup should not warn when RevenueCat is already anonymous.
- **Approx lines changed:** 2.

### `app-mobile/app/index.tsx`

- **Before:** Null-user RevenueCat branch called `logoutRevenueCat().catch(() => {})`, swallowing every strict logout failure.
- **After:** Null-user branch calls `logoutRevenueCatIfIdentified()` and warns on unexpected failure.
- **Why:** Avoid strict anonymous logout and avoid broad silent swallowing.
- **Approx lines changed:** 4 in ORCH-0751 scope. Existing ORCH-0749 query persistence edits in this file were preserved.

### `app-mobile/src/hooks/useRevenueCat.ts`

- **Before:** `useRevenueCatLogout()` used strict logout and returned `UseMutationResult<CustomerInfo, Error, void>`.
- **After:** Hook uses guarded logout, returns `UseMutationResult<CustomerInfo | null, Error, void>`, and still removes CustomerInfo cache on success.
- **Why:** The hook documents Supabase sign-out usage and should share the guarded auth cleanup behavior.
- **Approx lines changed:** 3.

### `app-mobile/package.json`

- **Before:** Had `test:orch-0749` from the prior auth/cache work.
- **After:** Added `test:orch-0751`.
- **Why:** Repo-running regression guard for this contract.
- **Approx lines changed:** 1.

### `app-mobile/scripts/ci/orch-0751-revenuecat-logout-check.mjs`

- **Before:** Did not exist.
- **After:** New static gate verifies guarded helper/classifier, in-flight logout serialization, call-site routing, login preservation, cache removal, and package script.
- **Why:** Prevents direct strict logout from returning to auth cleanup/null-user flows.
- **Approx lines changed:** +104.

## 7. Implementation Details

- **Architecture decisions:** Strict `logoutRevenueCat()` remains available; auth cleanup/sign-out-style paths use `logoutRevenueCatIfIdentified()`.
- **Data flow:** RevenueCat identified users still go through `Purchases.logOut()`. Anonymous users return `null`.
- **Concurrency:** Duplicate guarded logout callers reuse one in-flight promise until the native logout settles; the shared reference is cleared in `finally` only if it still points at that promise.
- **Mutation/query behavior:** `useRevenueCatLogout()` removes `revenueCatKeys.customerInfo()` after guarded logout/no-op success.
- **State handling:** No Zustand/AsyncStorage behavior changed.
- **Error handling:** Only exact anonymous logout is quiet. Unknown RevenueCat errors rethrow from service and warn/log at callers.
- **Copy/accessibility:** None.
- **Analytics/notifications/realtime:** OneSignal, Mixpanel, realtime cleanup preserved.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Guard anonymous RevenueCat logout | `logoutRevenueCatIfIdentified()` | `test:orch-0751` T1/T3 | PASS |
| Narrow anonymous error classifier | `isRevenueCatAnonymousLogoutError()` | `test:orch-0751` T2/T4/T5 | PASS |
| Auth cleanup uses guarded helper | `authCleanup.ts` dynamic import updated | `test:orch-0751` T6 | PASS |
| Root null-user branch uses guarded helper | `app/index.tsx` import/branch updated | `test:orch-0751` T7 | PASS |
| Login merge path preserved | `loginRevenueCat(userId)` unchanged | `test:orch-0751` T8 | PASS |
| Hook/cache aligned | `useRevenueCatLogout()` updated | `test:orch-0751` T9 | PASS |
| Duplicate cleanup race serialized | `guardedLogoutInFlight` shared promise | `test:orch-0751` T11 | PASS |
| ORCH-0749 cleanup preserved | no private cleanup weakening | `test:orch-0749` | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| No silent failures | Yes | Yes | Unknown RevenueCat failures still warn/log. |
| Logout clears everything | Yes | Yes | ORCH-0749 cleanup gate passes. |
| One auth instance | Yes | Yes | No new auth owner introduced. |
| `I-AUTH-PRIVATE-CACHE-CANNOT-OUTLIVE-AUTH-OWNER` | Yes | Yes | `test:orch-0749` PASS. |

## 10. Parity Check

- **Mobile:** Updated.
- **Business app:** No change.
- **Admin:** No change.
- **Public/web:** No change.
- **Solo/collab:** No behavior distinction; auth cleanup path applies globally.
- **Gaps:** Runtime smoke still recommended: fresh no-session startup, explicit sign-out, sign-in.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** `useRevenueCatLogout()` can now resolve `null` for already-anonymous no-op.
- **AsyncStorage/Zustand impact:** None beyond existing ORCH-0749 cleanup.
- **Cold start behavior:** Expected RevenueCat anonymous logout state is quiet.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0751 gate | `cd app-mobile && npm run test:orch-0751` | PASS | 11/11 checks pass, including in-flight guarded logout serialization. |
| ORCH-0749 gate | `cd app-mobile && npm run test:orch-0749` | PASS | Existing auth/cache regression guard still green. |
| TypeScript | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL, off-scope baseline | Same known failures in `ConnectionsPage.tsx` and `HomePage.tsx`, not ORCH-0751 files. |
| Diff whitespace | `git diff --check` | PASS | No whitespace errors. |

TypeScript failures observed:

```text
src/components/ConnectionsPage.tsx(2763,52): error TS2345: Friend from friendsService is not assignable to Friend from connectionsService; missing name, isOnline.
src/components/HomePage.tsx(246,19): error TS2741: Property 'state' is missing in { id, label } but required in SessionSwitcherItem.
src/components/HomePage.tsx(249,54): error TS2741: Property 'state' is missing in { id, label } but required in SessionSwitcherItem.
```

These files were not changed for ORCH-0751.

## 13. Regression Surface

1. RevenueCat sign-out from identified user: guarded helper still logs out when `Purchases.isAnonymous()` is false.
2. Concurrent sign-out cleanup: duplicate guarded callers share one in-flight promise and cannot both call native RevenueCat logout.
3. RevenueCat login/purchase merge: `loginRevenueCat(userId)` and root authenticated effect remain intact.
4. CustomerInfo cache: hook still removes cached customer info on logout/no-op success.
5. ORCH-0749 auth cleanup: private cache cleanup still passes the existing gate.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| TypeScript baseline failures | Full TS gate cannot be claimed green while off-scope errors remain. | Separate fix for `ConnectionsPage.tsx` / `HomePage.tsx` type mismatches. | app-mobile |
| Runtime retest required | Static gates prove the rework contract, but device logs must confirm native RevenueCat no longer emits anonymous logout on explicit sign-out. | Tester reruns Android sign-in -> sign-out -> sign-in smoke. | iOS/Android dev clients |

## 15. Discoveries For Orchestrator

- Existing TypeScript failures remain outside ORCH-0751 scope:
  - `ConnectionsPage.tsx` friend type mismatch.
  - `HomePage.tsx` missing `state` on session switcher items.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** JS/TS-only; OTA-compatible by shape.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
app-mobile: guard RevenueCat anonymous logout

Resolves: ORCH-0751
Evidence: npm run test:orch-0751; npm run test:orch-0749
Deploy: mobile OTA-compatible; no Supabase/native/config changes
```

## Ready-To-Test Checklist

1. Fresh no-session startup: app reaches Welcome without `[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)`.
2. Explicit sign-out from an authenticated account: private cleanup runs and RevenueCat resets without noisy duplicate anonymous logout.
3. Sign in again: `loginRevenueCat(user.id)` still fires and purchase/customer-info behavior remains normal.
4. RevenueCat product/offering warnings, if present, are treated as ORCH-0752 and not as ORCH-0751 regression.
