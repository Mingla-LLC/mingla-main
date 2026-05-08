# QA Report: RevenueCat Anonymous Logout Guard (ORCH-0751)

> Date: 2026-05-07
> Mode: TARGETED / SPEC-COMPLIANCE
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:0 P4:1

## 1. Layman Summary

ORCH-0751 is correctly implemented at the code and repo-gate level. Mingla now checks whether RevenueCat is already anonymous before asking it to log out, treats only RevenueCat's exact anonymous-logout error as a harmless no-op, keeps real errors visible, and preserves the sign-in path that merges purchases into the signed-in user.

This is not a full PASS yet because the device smoke gates were not fully exercised. Android and iOS devices are available and the app is installed, but the non-destructive Android launch landed in the Expo dev launcher and did not prove the no-session/sign-out/sign-in JS runtime behavior.

## 2. Inputs Reviewed

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Tester prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Changed files inspected:
  - `app-mobile/src/services/revenueCatService.ts`
  - `app-mobile/src/utils/authCleanup.ts`
  - `app-mobile/app/index.tsx`
  - `app-mobile/src/hooks/useRevenueCat.ts`
  - `app-mobile/package.json`
  - `app-mobile/scripts/ci/orch-0751-revenuecat-logout-check.mjs`
- Related regression guard: `app-mobile/scripts/ci/orch-0749-regression-check.mjs`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | None | No DB, RLS, migration, RPC, or edge-function change in scope. |
| Services | `revenueCatService.ts` | Guarded helper, exact anonymous classifier, strict logout/login preservation, unknown-error rethrow. |
| Hooks/State/Cache | `useRevenueCat.ts`, `authCleanup.ts` | Sign-out hook uses guarded helper and removes CustomerInfo cache; private cleanup behavior remains routed through ORCH-0749 path. |
| Components/Screens | `app/index.tsx` | Root authenticated branch still logs into RevenueCat; null-user branch no longer strict-logs-out and no longer swallows every error. |
| Business/Admin/Public | N/A | No parity changes required. |
| Tests/Build | `test:orch-0751`, `test:orch-0749`, `tsc --noEmit`, `git diff --check` | New static gate, existing auth/cache guard, TypeScript baseline, whitespace. |
| Runtime | Android emulator / iOS simulator availability | Devices are available, but full JS smoke was not verified. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| `isRevenueCatAnonymousLogoutError()` exists | `revenueCatService.ts:88` | Verified | Exported. |
| Classifier recognizes RevenueCat code `22` | `revenueCatService.ts:100-102`; package constant in `node_modules/@revenuecat/purchases-typescript-internal/dist/errors.js:48` | Verified | RevenueCat constant is `"22"`, matching the implementation after `String(error.code)`. |
| Classifier handles readable error code | `revenueCatService.ts:93-102` | Verified | Checks top-level `readableErrorCode` and `userInfo.readableErrorCode`. |
| Classifier does not treat generic errors as harmless | `revenueCatService.ts:88-103` | Verified | Non-object/generic object without code/readable code returns false. |
| Guarded helper checks anonymous before logout | `revenueCatService.ts:110-117` | Verified | `Purchases.isAnonymous()` precedes `Purchases.logOut()`. |
| Already-anonymous path returns `null` | `revenueCatService.ts:113-114` | Verified | No native logout call after true anonymous check. |
| Race on exact anonymous logout returns `null` | `revenueCatService.ts:116-120` | Verified | Catch narrows through classifier. |
| Unknown RevenueCat failures still surface | `revenueCatService.ts:119-120`; `authCleanup.ts:60-61`; `app/index.tsx:299-300`; `useRevenueCat.ts:244-245` | Verified | Service rethrows; callers warn/error. |
| Strict `logoutRevenueCat()` preserved | `revenueCatService.ts:75-78` | Verified | Existing strict wrapper remains. |
| `loginRevenueCat(user.id)` preserved | `revenueCatService.ts:65-68`; `app/index.tsx:294-296` | Verified | Purchase merge path remains strict. |
| Auth cleanup uses guarded helper | `authCleanup.ts:59-62` | Verified | No strict cleanup logout call found there. |
| Root null-user branch avoids silent strict logout | `app/index.tsx:298-301` | Verified | Uses guarded helper and warning. |
| `useRevenueCatLogout()` uses guarded helper and clears cache | `useRevenueCat.ts:236-242` | Verified | Returns `CustomerInfo | null`; removes CustomerInfo query on success. |
| `test:orch-0751` exists and is meaningful | `package.json:18-19`; `orch-0751-revenuecat-logout-check.mjs:28-90` | Verified | Checks helper/classifier/call-site/cache/script contracts. |
| ORCH-0749 cleanup preserved | `npm run test:orch-0749` | Verified | Existing regression gate passes. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| ORCH-0751 static gate | `cd app-mobile && npm run test:orch-0751` with `/opt/homebrew/bin` on PATH | PASS | 10/10 checks passed. |
| ORCH-0749 regression gate | `cd app-mobile && npm run test:orch-0749` with `/opt/homebrew/bin` on PATH | PASS | 17 checks passed; ORCH-0749 cleanup guard remains green. |
| TypeScript | `cd app-mobile && npx tsc --noEmit` with `/opt/homebrew/bin` on PATH | FAIL, off-scope baseline | Fails only in `ConnectionsPage.tsx` and `HomePage.tsx`; no ORCH-0751 files reported. |
| RevenueCat constant shape | `rg LOG_OUT_ANONYMOUS_USER_ERROR app-mobile/node_modules/@revenuecat/...` | PASS | Package exports `LOG_OUT_ANONYMOUS_USER_ERROR = "22"`. |
| Direct call-site search | `rg "logoutRevenueCat\\(|logoutRevenueCatIfIdentified|isRevenueCatAnonymousLogoutError|loginRevenueCat\\(" app-mobile/src app-mobile/app` | PASS | Strict logout remains only in service; cleanup/root/hook use guarded helper. |
| Whitespace | `git diff --check` | PASS | No whitespace errors. |
| Device availability | `adb devices`; `xcrun simctl list devices booted`; `xcrun simctl get_app_container booted com.mingla.app.v2` | PARTIAL | Android emulator and iOS simulator are available; app installed. |
| Non-destructive Android launch log sniff | `adb logcat -c`; force-stop; launch `com.mingla.app.v2`; collect `adb logcat -d` | PARTIAL | Launch reached Expo dev launcher and reported reconnect retry to `ws://10.0.2.2:8083`; did not prove JS no-session/sign-out behavior. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No silent failures | PASS | Only exact anonymous logout is quiet; unknown failures rethrow/warn in service and call sites. |
| One owner per truth | PASS | RevenueCat auth identity remains owned by existing service/root/hook paths; no new auth owner. |
| One key per entity | PASS | No query key changes; CustomerInfo key reused. |
| Server state server-side | PASS | No server-state ownership changes. |
| Logout clears everything | PASS | ORCH-0749 gate passes and cleanup private clearing remains intact. |
| One auth instance | PASS | No extra Supabase/auth instance introduced. |
| Persisted-state startup | PASS | ORCH-0749 persistence gate still passes; ORCH-0751 does not weaken it. |
| No fabricated data | N/A | No data fabrication path. |
| Currency-aware | N/A | No pricing logic changed. |
| No dead taps / UI accessibility rules | N/A | No UI changes. |

## 7. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: Runtime smoke gates remain unverified**
- **Evidence:** Android emulator is connected and package `com.mingla.app.v2` is installed; iOS simulator has `com.mingla.app.v2` installed. Non-destructive Android launch reached Expo dev launcher and logged a reconnect retry to `ws://10.0.2.2:8083`, so it did not exercise the JS auth cleanup path.
- **What is wrong:** Code/static verification is strong, but the requested fresh no-session, explicit sign-out, and sign-back-in runtime gates were not fully proven.
- **Impact:** ORCH-0751 should not close as full PASS until runtime logs confirm the scary RevenueCat anonymous logout message is gone during real app startup/sign-out.
- **Required fix:** No code rework required from this evidence. Run runtime smoke with Metro/dev client connected or accept this as a manual close condition.
- **Retest:** Fresh no-session startup; authenticated sign-out; sign back in; watch for `[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)`, `LogOut was called but the current user is anonymous`, and `loginRevenueCat(user.id)`.

**P2-002: Full TypeScript gate is still blocked by off-scope baseline errors**
- **Evidence:** `npx tsc --noEmit` fails at `src/components/ConnectionsPage.tsx(2763,52)` and `src/components/HomePage.tsx(246,19)/(249,54)`.
- **What is wrong:** The repo cannot claim a fully green TypeScript build while these remain.
- **Impact:** Not an ORCH-0751 regression, because no ORCH-0751 file appears in the TypeScript failures. It remains a program-level build-health issue.
- **Required fix:** Track and fix separately unless already covered by another ORCH.
- **Retest:** Rerun `cd app-mobile && npx tsc --noEmit`.

### P3 Low

None.

### P4 Notes

**P4-001: First npm attempts failed due shell PATH, not repo failure**
- **Evidence:** Plain `npm` was not on PATH; reruns passed after exporting `/opt/homebrew/bin`.
- **Impact:** Local Codex shell environment note only.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Fresh no-session startup does not strict-log-out while already anonymous | Partial | Static helper and root branch verified; runtime no-session gate not completed. | P2-001 |
| `performPrivateAuthCleanup(initial-no-session)` does not warn for expected anonymous state | Partial | Cleanup uses guarded helper; helper no-ops when anonymous. Runtime log not proven. | P2-001 |
| Explicit sign-out from identified RevenueCat user still logs out | Verified by code | `isAnonymous === false` path calls `Purchases.logOut()` at `revenueCatService.ts:116-117`. | None |
| Duplicate cleanup after `SIGNED_OUT` is quiet if already anonymous | Verified by code | `isAnonymous` true returns `null`; anonymous race returns `null`. | Runtime condition remains. |
| `loginRevenueCat(user.id)` still calls `Purchases.logIn(userId)` | Verified | `revenueCatService.ts:65-68`; `app/index.tsx:294-296`. | None |
| Unknown logout failures still reach warning/error path | Verified | Service throws unknown errors; call sites warn/error. | None |
| CustomerInfo cache is not left stale after hook logout/no-op | Verified | `useRevenueCat.ts:241-242` removes `revenueCatKeys.customerInfo()`. | None |
| `test:orch-0751` and `test:orch-0749` pass | Verified | Both commands PASS. | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Auth identity merge path preserved | None | `loginRevenueCat(userId)` and root `loginRevenueCat(user.id)` remain. | PASS |
| Logout cleanup does not weaken private cache clearing | None | `test:orch-0749` PASS; `authCleanup.ts` still clears store/query/private AsyncStorage. | PASS |
| Error handling does not hide unknown payment SDK failures | None | `throw error` on unknown helper failure; warning/error call sites remain. | PASS |

## 10. UX / Accessibility

No UI changes in scope. UX impact is log/runtime cleanliness during healthy unauthenticated state; runtime confirmation remains a manual condition.

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile code | Yes | PASS | app-mobile implementation verified. |
| Business | N/A | N/A | No changes. |
| Admin | N/A | N/A | No changes. |
| Public/web | N/A | N/A | No changes. |
| Solo/collab | Code only | PASS | Auth cleanup path is not mode-specific. |
| iOS | Availability only | PARTIAL | Simulator booted and app installed; runtime smoke not completed. |
| Android | Partial launch only | PARTIAL | Emulator connected and app installed; non-destructive launch did not exercise JS app because dev launcher could not connect. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Guarded RevenueCat logout | Yes | No | No | No | No | JS/TS-only mobile change. |
| Static regression gate | Yes | No | No | No | No | `test:orch-0751` added under app-mobile. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Fresh no-session startup | Static code + attempted Android launch | PARTIAL | Run app with dev client connected and no session; confirm Welcome state and no RevenueCat anonymous logout noise. |
| Explicit sign-out | Static code | PARTIAL | Sign out from authenticated user; confirm cleanup runs and no duplicate anonymous logout warning. |
| Sign back in | Static code | PARTIAL | Confirm `loginRevenueCat(user.id)` fires and customer-info/purchase flow is normal. |
| RevenueCat product/offering warnings | Artifact/code review | N/A | Treat as ORCH-0752, not ORCH-0751. |

## 14. Required Actions

None for ORCH-0751 code based on current evidence.

## 15. Conditional / Recommended Actions

1. Before orchestrator close, run or accept the ORCH-0751 runtime smoke gates:
   - fresh no-session startup reaches Welcome without `[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)`;
   - no `LogOut was called but the current user is anonymous` caused by app cleanup;
   - authenticated sign-out is quiet after RevenueCat resets;
   - sign-in still triggers `loginRevenueCat(user.id)`.
2. Track the off-scope TypeScript baseline failures separately if not already registered:
   - `src/components/ConnectionsPage.tsx(2763,52)`
   - `src/components/HomePage.tsx(246,19)`
   - `src/components/HomePage.tsx(249,54)`

## 16. Discoveries For Orchestrator

- ORCH-0751 is ready for orchestrator review as CONDITIONAL PASS.
- Runtime smoke is the only ORCH-0751 close condition left.
- Existing TypeScript build failures remain unrelated to ORCH-0751 and should not be charged against this fix, but they continue to block a fully green `tsc`.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| RevenueCat anonymous logout noise at cleanup/root null-user path | Code fixed; runtime pending | Guarded helper and call-site routing verified; static gate PASS. | None found in code. |
| ORCH-0749 auth/cache cleanup risk | Preserved | `test:orch-0749` PASS. | None found. |

Retest cycle: N/A.
