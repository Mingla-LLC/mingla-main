# Investigation Report: RevenueCat Anonymous Logout Noise (ORCH-0751)

> Date: 2026-05-07
> Source: Orchestrator dispatch from ORCH-0749 runtime QA
> Confidence: H - current app call paths, installed SDK typings, native bridge code, and runtime QA evidence all agree
> Status: root cause proven

## 1. Layman Summary

The app is doing the right broad cleanup after auth changes, but one cleanup step is too blunt: it asks RevenueCat to log out even when RevenueCat is already anonymous. RevenueCat rejects that as a real SDK error, so a healthy unauthenticated startup can still print a scary warning.

This is not the old stale-user Supabase/cache leak from ORCH-0749, and it is not the RevenueCat product/offering configuration issue from ORCH-0752. It is auth-cleanup log hygiene and integration hardening.

Recommended direction: keep private auth cleanup intact, but add a RevenueCat-specific quiet logout path that first checks whether the SDK is anonymous and narrowly classifies RevenueCat error code `22` (`LOG_OUT_ANONYMOUS_USER_ERROR`) as a no-op. Unknown RevenueCat errors must still surface.

## 2. Scope

- **Feature / issue:** RevenueCat logout during no-session and sign-out cleanup.
- **Actor:** Mobile app user on iOS/Android, especially fresh unauthenticated startup or sign-out.
- **Environment:** `app-mobile`, `react-native-purchases` `9.12.0`.
- **Success definition:** Normal no-session startup and duplicate sign-out cleanup do not warn/error when RevenueCat is already anonymous; true RevenueCat failures still warn/error.
- **Assumptions:** Runtime QA log from ORCH-0749 is accurate evidence of the observed symptom.
- **Out of scope:** Product approval/store setup warnings, entitlement/product IDs, Supabase auth behavior, Google OAuth, App Store/Play Store config.

## 3. Intended Journey

Fresh no-session startup:

`app mount -> Supabase session check returns no session -> private auth cleanup clears user-owned state -> integration cleanup logs out only identified SDK sessions -> Welcome screen appears with no red error`

Explicit sign-out:

`signed-in user taps sign out -> private app/query/cache state clears -> RevenueCat resets from identified user to anonymous -> Supabase signs out -> duplicate auth listener cleanup is quiet if RevenueCat is already anonymous`

Expected failure behavior: if RevenueCat is configured but an unexpected logout failure occurs, the app should keep logging it. Only the known "already anonymous" response should be quiet.

## 4. Historical Context

- `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md` recorded P2-001: iOS no-session startup logged `LogOut was called but the current user is anonymous`, followed by `[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)`.
- The same report passed ORCH-0749's core stale-auth/cache gates and explicitly separated this issue from the stale-user query storm.
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` now tracks ORCH-0751 as the investigation-first follow-up for this exact RevenueCat noise.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` | Process | Required mission and non-goals. |
| 2 | `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md` | Runtime evidence | Original observed symptom and severity. |
| 3 | `app-mobile/src/utils/authCleanup.ts` | Auth cleanup | Primary cleanup caller that logs the warning. |
| 4 | `app-mobile/src/hooks/useAuthSimple.ts` | Auth lifecycle | Fresh no-session, user switch, and signed-out triggers. |
| 5 | `app-mobile/app/index.tsx` | Root app integration wiring | RevenueCat configure/login/logout effects. |
| 6 | `app-mobile/src/services/revenueCatService.ts` | Integration service | RevenueCat API wrapper behavior. |
| 7 | `app-mobile/src/hooks/useRevenueCat.ts` | Query/cache/hooks | CustomerInfo cache and logout mutation blast radius. |
| 8 | `react-native-purchases` installed package files | SDK | Identity APIs, logout semantics, and error shape. |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs/artifacts | This is a remaining P2 log-noise issue after ORCH-0749, not the stale cache leak. | ORCH-0749 runtime QA lines 58-62. | Yes |
| Schema/RLS | No database or RLS change is involved. | All traced code is mobile SDK/auth cleanup only. | Yes |
| Code | Cleanup calls `logoutRevenueCat()` without checking RevenueCat identity state. | `authCleanup.ts:59-62`, `app/index.tsx:291-300`. | Yes |
| Runtime/tests | Runtime QA saw the exact anonymous logout error during no-session startup. | ORCH-0749 runtime QA lines 58-62. | Yes |
| Data/cache | Private cache cleanup is separate and must remain intact. | `authCleanup.ts:34-49`, `authCleanup.ts:79-86`. | Yes |

**Contradiction:** The service comment says RevenueCat logout should be called after Supabase sign-out, but current callers also invoke it during startup no-session cleanup and after the SDK is already anonymous.

## 7. Findings

### Finding 1: No-session auth cleanup logs out RevenueCat while already anonymous

- **Severity:** P2
- **Type:** production-hardening gap
- **Confidence:** proven
- **Broken journey step:** Fresh unauthenticated startup cleanup.
- **Evidence:** `useAuthSimple.ts:261-264` calls `performPrivateAuthCleanup({ reason: 'initial-no-session', currentUserId: null })`; `authCleanup.ts:59-62` imports `logoutRevenueCat()` and warns on any rejection; `revenueCatService.ts:74-76` calls `Purchases.logOut()` unconditionally.
- **Current behavior:** A normal no-session boot can call RevenueCat logout even though `configureRevenueCat(null)` configured an anonymous SDK user.
- **Expected behavior:** No-session cleanup should treat already-anonymous RevenueCat as a quiet no-op.
- **Causal chain:** No Supabase session -> `initial-no-session` cleanup -> integration cleanup -> unconditional RevenueCat `logOut()` -> SDK rejects anonymous logout -> app logs `[AUTH_CLEANUP] RevenueCat logout failed`.
- **User impact:** Red Metro error/warning during healthy startup, reducing signal in QA and production logging.
- **Fix direction:** Add a dedicated quiet/guarded RevenueCat logout helper for auth cleanup.
- **Missing test or guardrail:** A static repo gate that fails if auth cleanup directly calls strict `logoutRevenueCat()`.
- **Invariant involved:** Preserves ORCH-0749 private cleanup invariant; no stale private cache should survive auth owner changes.

### Finding 2: Root app auth effect is a second RevenueCat logout authority

- **Severity:** P2
- **Type:** production-hardening gap
- **Confidence:** proven
- **Broken journey step:** Auth state settles to unauthenticated.
- **Evidence:** `app/index.tsx:291-300` logs in on `user?.id`, but calls `logoutRevenueCat().catch(() => {})` when there is no user.
- **Current behavior:** The root effect can call strict RevenueCat logout after `isLoadingAuth` becomes false and `user` is null. It swallows the JS rejection, but the native SDK still performs the invalid logout attempt and can emit SDK logs.
- **Expected behavior:** There should be one consistent RevenueCat identity transition helper, and the unauthenticated branch should be quiet when already anonymous.
- **Causal chain:** App configures RevenueCat once -> auth state resolves no-user -> root effect invokes strict logout -> SDK rejects if anonymous -> rejection swallowed.
- **User impact:** Extra SDK work and native log noise; makes auth cleanup ownership harder to reason about.
- **Fix direction:** Route this branch through the same guarded helper or remove the redundant no-user logout if cleanup owns sign-out integration reset.
- **Missing test or guardrail:** Static gate should assert `app/index.tsx` does not call strict `logoutRevenueCat()` from the null-user branch.
- **Invariant involved:** One owner per truth/transition; integration cleanup should not have multiple divergent behaviors.

### Finding 3: RevenueCat provides safe identity and error signals for a narrow fix

- **Severity:** P3
- **Type:** production-hardening gap
- **Confidence:** proven
- **Evidence:** Installed `react-native-purchases` is `9.12.0`. Typings expose `Purchases.isAnonymous(): Promise<boolean>` and document it as whether the `appUserID` was generated by RevenueCat (`purchases.d.ts:423-426`). The SDK exports `PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR = "22"` (`errors.d.ts:5-29`). Native iOS and Android bridges expose `isAnonymous` without a CustomerInfo fetch (`RNPurchases.m:243-247`, `RNPurchasesModule.java:341-344`).
- **Current behavior:** App uses neither the pre-check nor the narrow error code.
- **Expected behavior:** Auth cleanup can pre-check identity and also catch code `22` as a race-safe no-op.
- **Causal chain:** SDK has exact identity/error affordances -> service wrapper omits them -> all callers see anonymous logout as generic failure.
- **User impact:** Avoidable noisy logs.
- **Fix direction:** Prefer service-level helper `logoutRevenueCatIfIdentified()` plus `isRevenueCatAnonymousLogoutError(error)` so all callers share the same classification.
- **Missing test or guardrail:** Gate should verify the service references `Purchases.isAnonymous()` and classifies `PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR` or `"22"`.

### Finding 4: Purchase merge path is not the source and must be preserved

- **Severity:** P3
- **Type:** production-hardening gap
- **Confidence:** proven
- **Evidence:** `revenueCatService.ts:64-67` calls `Purchases.logIn(userId)` and returns `customerInfo`; `app/index.tsx:291-297` still calls `loginRevenueCat(user.id)` whenever an authenticated user exists. Service comments correctly state this merges anonymous purchases into the identified account.
- **Current behavior:** Login/merge path is separate from logout, and should remain strict.
- **Expected behavior:** Any fix should not change `loginRevenueCat(user.id)` or anonymous-to-identified merge semantics.
- **Causal chain:** User signs in -> root effect calls `loginRevenueCat(user.id)` -> RevenueCat links anonymous purchases to Supabase user -> customer info updates.
- **User impact:** Breaking this would risk purchase entitlement loss or account merge bugs.
- **Fix direction:** Do not suppress or alter login; scope changes to quiet logout only.
- **Missing test or guardrail:** Gate should assert `loginRevenueCat` still calls `Purchases.logIn(userId)` and the authenticated branch in `app/index.tsx` still calls it.

### Finding 5: `useRevenueCatLogout()` has the same strict anonymous-error exposure if used later

- **Severity:** P3
- **Type:** production-hardening gap
- **Confidence:** proven
- **Evidence:** `useRevenueCat.ts:236-247` wraps `logoutRevenueCat()` and logs `[RevenueCat] Logout failed:` on any error.
- **Current behavior:** If this hook is used for auth logout later, it will recreate the anonymous logout noise.
- **Expected behavior:** Hook behavior should align with service-level classification and still clear cached CustomerInfo on a real logout or a quiet anonymous no-op.
- **Causal chain:** Hook calls strict logout -> anonymous SDK rejects -> hook logs error.
- **User impact:** Future regression risk even if current primary call sites are fixed.
- **Fix direction:** Either keep the hook strict and document it is not for auth cleanup, or update it to use the same quiet helper and remove/invalidate customer info on settled cleanup.
- **Missing test or guardrail:** Gate should cover the hook if it remains exported as an auth logout helper.

## 8. Root Cause Proof

### RC-1: Strict RevenueCat logout is called from normal no-session cleanup

- **File + line:** `app-mobile/src/hooks/useAuthSimple.ts:261-264`; `app-mobile/src/utils/authCleanup.ts:59-62`; `app-mobile/src/services/revenueCatService.ts:74-76`.
- **Exact code/schema:** `performPrivateAuthCleanup({ reason: 'initial-no-session', currentUserId: null })` then `logoutRevenueCat().catch(...)`, and `logoutRevenueCat()` returns `Purchases.logOut()`.
- **What it does:** Calls RevenueCat native `logOut()` even when no user is signed in and the SDK is already anonymous.
- **What it should do:** Skip RevenueCat logout when the SDK is anonymous, or classify the exact anonymous logout rejection as a no-op.
- **Causal chain:** Fresh startup has no Supabase session -> auth initialization runs cleanup -> cleanup calls strict RevenueCat logout -> RevenueCat rejects anonymous logout -> app warning is printed.
- **Verification step:** ORCH-0749 runtime QA observed the exact `initial-no-session` warning; static trace proves the only cleanup path that can emit that exact warning.

### RC-2: The SDK exposes a precise safe guard, but the app wrapper does not use it

- **File + line:** `app-mobile/node_modules/react-native-purchases/dist/purchases.d.ts:423-426`; `app-mobile/node_modules/@revenuecat/purchases-typescript-internal/dist/errors.d.ts:5-29`; `app-mobile/src/services/revenueCatService.ts:74-76`.
- **Exact code/schema:** SDK: `static isAnonymous(): Promise<boolean>` and `LOG_OUT_ANONYMOUS_USER_ERROR = "22"`; app: `return Purchases.logOut()`.
- **What it does:** App treats all RevenueCat logout failures as generic errors.
- **What it should do:** Use `Purchases.isAnonymous()` before cleanup logout, and classify code `22` as the expected race/no-op fallback.
- **Causal chain:** Missing wrapper logic -> anonymous state not detected -> SDK rejection bubbles to cleanup warning.
- **Verification step:** Add a targeted gate that inspects the wrapper for `Purchases.isAnonymous()` and `LOG_OUT_ANONYMOUS_USER_ERROR` handling, then run the existing ORCH-0749 gate to prove private cleanup remains intact.

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Direct strict logout in cleanup | `authCleanup.ts` | Lines 59-62 call `logoutRevenueCat()` and warn on every rejection. | P2 | production-hardening gap |
| Second strict logout authority | `app/index.tsx` | Lines 291-300 call strict logout when `user` is null. | P2 | production-hardening gap |
| Future hook regression path | `useRevenueCat.ts` | Lines 236-247 logs every logout error. | P3 | production-hardening gap |
| Broad swallowing in root effect | `app/index.tsx` | Line 299 catches and ignores all logout errors. | P3 | production-hardening gap |

No schema, RLS, service-role, or privacy security gap was found for ORCH-0751.

## 10. Blast Radius

- **Auth cleanup:** Must preserve `store.clearUserData()`, query cancel/remove, `queryClient.clear()` for no current user, realtime queue cleanup, and private AsyncStorage removal.
- **Explicit sign-out:** A signed-in RevenueCat user should still be logged out/reset to anonymous once.
- **Duplicate sign-out cleanup:** A second cleanup after Supabase `SIGNED_OUT` should no-op quietly if RevenueCat is already anonymous.
- **User switch:** Existing `includeIntegrations: false` for `auth-user-switch` should remain; RevenueCat login to the new user is handled by the root authenticated effect.
- **Purchases/paywall/subscriptions:** `loginRevenueCat(user.id)`, `getCustomerInfo`, offerings, purchases, restore, and entitlement helper behavior should not change.
- **React Query cache:** CustomerInfo cache should still be removed/invalidated after logout-like cleanup so stale entitlements are not displayed.
- **Business/admin/Supabase:** No direct impact.
- **Deployment:** Mobile JS/TypeScript change only; no migration, edge deploy, or env var needed.

## 11. Required Tests For Later Spec

Add a focused repo-running gate, recommended name:

`app-mobile/scripts/ci/orch-0751-revenuecat-logout-check.mjs`

Recommended npm script:

`test:orch-0751`

The gate should fail before the fix and pass after by checking:

- `revenueCatService.ts` exports a quiet/guarded auth-cleanup helper, recommended `logoutRevenueCatIfIdentified(): Promise<CustomerInfo | null>`.
- The helper uses `Purchases.isAnonymous()` before calling native `logOut()`.
- The service has an `isRevenueCatAnonymousLogoutError(error)` classifier that matches `PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR` or code `"22"` and/or `userInfo.readableErrorCode`.
- Unknown RevenueCat logout errors are not swallowed.
- `authCleanup.ts` does not directly call strict `logoutRevenueCat()` for integration cleanup; it calls the quiet helper and only warns on unexpected failures.
- `app/index.tsx` null-user branch does not call strict `logoutRevenueCat().catch(() => {})`; it either calls the quiet helper or delegates to cleanup ownership.
- `loginRevenueCat(user.id)` still calls `Purchases.logIn(userId)` and the root authenticated branch still invokes it.
- `useRevenueCatLogout()` either uses the same quiet helper and clears CustomerInfo on settled cleanup, or is explicitly kept strict and no auth cleanup path uses it.

Also require:

- `cd app-mobile && npm run test:orch-0749`
- `cd app-mobile && npm run test:orch-0751`

If existing tests encode direct strict logout from cleanup, they must be rewritten. The new durable contract is: auth cleanup may reset RevenueCat from identified to anonymous, but already-anonymous cleanup is not an app error.

## 12. Production Readiness Verdict

- **Ready / not ready:** Not ready for closeout until the quiet RevenueCat logout contract and test gate exist.
- **Launch blockers:** Not a data/security blocker, but a QA/log-hygiene blocker for clean auth startup.
- **Residual risks:** RevenueCat product/offering warnings remain separate ORCH-0752 work.
- **Telemetry/monitoring gaps:** Current cleanup logs cannot distinguish expected anonymous logout from real RevenueCat failures.
- **Missing tests:** ORCH-0751 gate described above.
- **Fastest next verification:** Implement guarded helper, run `test:orch-0751` and `test:orch-0749`, then smoke fresh no-session startup and explicit sign-out.

## 13. Discoveries For Orchestrator

- `app-mobile/src/services/authService.ts` contains stale commentary implying sign-out ownership lives elsewhere; actual sign-out/cleanup paths are in `useAuthSimple.ts`, `AppStateManager.tsx`, and `authCleanup.ts`. Not part of ORCH-0751, but worth cleaning during a documentation drift pass.
- ORCH-0752 remains the right bucket for RevenueCat product/offering store configuration warnings.

## 14. Recommended Next Step

`INVESTIGATION COMPLETE`

Proceed to orchestrator review, then SPEC mode for ORCH-0751. The spec should be narrow: add a RevenueCat auth-cleanup logout helper, route the two null-user cleanup call sites through it, preserve login/merge behavior, and add the ORCH-0751 regression gate while keeping ORCH-0749 green.
