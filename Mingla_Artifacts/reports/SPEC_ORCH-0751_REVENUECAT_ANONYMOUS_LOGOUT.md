# Spec: RevenueCat Anonymous Logout Guard (ORCH-0751)

> Date: 2026-05-07
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
> Root cause: RC-1 and RC-2
> Status: SPEC READY

## 1. Layman Summary

Normal unauthenticated startup should not look broken. Today the app sometimes asks RevenueCat to log out when RevenueCat is already anonymous, and RevenueCat correctly rejects that request. The fix is to make auth cleanup ask RevenueCat to log out only when RevenueCat is identified, and to treat the exact "already anonymous" RevenueCat error as a quiet no-op.

This must not hide real RevenueCat errors, and it must not touch purchase login/merge behavior.

## 2. User Story

As a Mingla mobile user, I want startup and sign-out cleanup to run quietly when no account is active, so that healthy unauthenticated app state does not produce red payment/auth logs.

## 3. Scope

- **In scope:**
  - `app-mobile/src/services/revenueCatService.ts`
  - `app-mobile/src/utils/authCleanup.ts`
  - `app-mobile/app/index.tsx`
  - `app-mobile/src/hooks/useRevenueCat.ts`
  - `app-mobile/package.json`
  - New focused static gate under `app-mobile/scripts/ci/`
- **Non-goals:**
  - No RevenueCat product, offering, paywall, entitlement, App Store, or Play Store config changes.
  - No Supabase schema, RLS, edge function, admin, business, or public web changes.
  - No Google OAuth fallback changes.
  - No `expo-av` migration or unrelated warning cleanup.
  - No broad suppression of RevenueCat errors.
- **Assumptions:**
  - Installed `react-native-purchases` remains `9.12.0` or compatible with `Purchases.isAnonymous()` and `PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR`.
  - ORCH-0749 private cleanup remains the canonical cleanup path for no-session and sign-out private data.
- **Dependencies:**
  - Existing ORCH-0749 regression gate: `cd app-mobile && npm run test:orch-0749`.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Guard RevenueCat logout when already anonymous | ORCH-0751 RC-1; `authCleanup.ts:59-62`; `revenueCatService.ts:74-76` | H |
| Use SDK identity pre-check | ORCH-0751 RC-2; SDK `Purchases.isAnonymous()` evidence | H |
| Classify only RevenueCat anonymous logout error | ORCH-0751 Finding 3; SDK code `22` / `LOG_OUT_ANONYMOUS_USER_ERROR` | H |
| Preserve `loginRevenueCat(user.id)` | ORCH-0751 Finding 4; `app/index.tsx:291-297` | H |
| Remove direct strict null-user logout | ORCH-0751 Finding 2; `app/index.tsx:298-300` | H |
| Keep ORCH-0749 private cleanup intact | ORCH-0749 closeout + invariant `I-AUTH-PRIVATE-CACHE-CANNOT-OUTLIVE-AUTH-OWNER` | H |

## 5. Success Criteria

1. Fresh no-session startup does not call strict RevenueCat `Purchases.logOut()` when the SDK is already anonymous.
2. `performPrivateAuthCleanup({ reason: 'initial-no-session', currentUserId: null })` does not warn for the expected RevenueCat anonymous logout state.
3. Explicit sign-out from an identified RevenueCat user still logs RevenueCat out to an anonymous user.
4. A duplicate cleanup after Supabase `SIGNED_OUT` is quiet if RevenueCat is already anonymous.
5. `loginRevenueCat(user.id)` still calls `Purchases.logIn(userId)` and remains the authenticated merge path.
6. Unknown RevenueCat logout failures still reach a warning/error path.
7. CustomerInfo cache is not left stale after logout-like cleanup.
8. `test:orch-0751` and `test:orch-0749` both pass.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| README Constitution #3: No silent failures | Only exact anonymous-logout error is quiet; unknown RevenueCat errors still surface. | `test:orch-0751` checks classifier narrowness and unexpected-error surfacing. |
| README Constitution #6: Logout clears everything | Do not remove ORCH-0749 private cleanup steps; only quiet expected RevenueCat anonymous state. | `test:orch-0749` plus `test:orch-0751`. |
| README Constitution #11: One auth instance | Do not add another auth owner; route RevenueCat auth identity transitions through existing root/cleanup paths. | Static gate checks call-site ownership. |
| `I-AUTH-PRIVATE-CACHE-CANNOT-OUTLIVE-AUTH-OWNER` | Preserve query/cache/AsyncStorage cleanup behavior in `authCleanup.ts`. | `npm run test:orch-0749`. |

### New Invariants

No new global invariant is required. This is a narrow RevenueCat cleanup contract covered by `test:orch-0751`.

## 7. Database / RLS / Migration

None.

- RLS policies: None.
- Backfill/data migration: None.
- Indexes/constraints: None.
- Rollback: Revert mobile JS/TS changes only.

## 8. Edge Functions / RPCs / Webhooks

None.

## 9. Service Layer

### `isRevenueCatAnonymousLogoutError`

- **Path:** `app-mobile/src/services/revenueCatService.ts`
- **Signature:** `export function isRevenueCatAnonymousLogoutError(error: unknown): boolean`
- **Behavior:**
  - Return `true` only for RevenueCat's anonymous logout error.
  - Must recognize code `PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR` / `"22"`.
  - May also recognize `userInfo.readableErrorCode === 'LOG_OUT_ANONYMOUS_USER_ERROR'` or a matching top-level `readableErrorCode`.
  - Must return `false` for unknown errors, network errors, configuration errors, product/offering errors, purchase errors, and generic `Error` objects.
- **Import contract:**
  - Prefer importing `PURCHASES_ERROR_CODE` from `react-native-purchases` if the package exports it in the current TypeScript build.
  - If TypeScript import compatibility is awkward, matching string `"22"` and readable error code is acceptable, but the code must make the RevenueCat code reference explicit in comments or constant naming.

### `logoutRevenueCatIfIdentified`

- **Path:** `app-mobile/src/services/revenueCatService.ts`
- **Signature:** `export async function logoutRevenueCatIfIdentified(): Promise<CustomerInfo | null>`
- **Behavior:**
  - If `_configured` is false, preserve the existing strict service posture: throw `new Error('[RevenueCat] Not configured')`.
  - Call `Purchases.isAnonymous()` before attempting native logout.
  - If `isAnonymous()` returns `true`, return `null` without warning or native `logOut()`.
  - If `isAnonymous()` returns `false`, call `Purchases.logOut()` and return the resulting `CustomerInfo`.
  - If `Purchases.logOut()` throws and `isRevenueCatAnonymousLogoutError(error)` returns true, return `null`.
  - If `Purchases.isAnonymous()` itself throws, do not blindly swallow it. The implementation may:
    - rethrow the error, or
    - attempt strict `Purchases.logOut()` and then use the same narrow anonymous-error classifier.
  - Unknown failures must reject so callers can warn.
- **Existing strict helper:**
  - Keep `logoutRevenueCat(): Promise<CustomerInfo>` as the strict native logout wrapper unless the implementor proves no callers need strict semantics.
  - Do not change `loginRevenueCat(userId)` except imports/types needed for the new helper.

## 10. Hook / State / Cache Layer

### `performPrivateAuthCleanup`

- **Path:** `app-mobile/src/utils/authCleanup.ts`
- **Current behavior:** Dynamically imports `{ logoutRevenueCat }`, calls it, and warns on every rejection.
- **Required behavior:**
  - Import `{ logoutRevenueCatIfIdentified }` instead.
  - Call `logoutRevenueCatIfIdentified()`.
  - Warn only if that helper rejects with an unexpected error.
  - Do not change:
    - `store.clearUserData()`
    - query cancellation/removal predicate behavior
    - `queryClient.clear()` when no current user
    - OneSignal logout
    - Mixpanel logout tracking
    - realtime queue cleanup
    - private AsyncStorage cleanup
  - Keep `includeIntegrations: false` behavior for user switch paths.

### Root RevenueCat auth effect

- **Path:** `app-mobile/app/index.tsx`
- **Current behavior:** Authenticated branch calls `loginRevenueCat(user.id)`; null-user branch calls `logoutRevenueCat().catch(() => {})`.
- **Required behavior:**
  - Keep the authenticated branch and warning behavior for `loginRevenueCat(user.id)`.
  - Replace the null-user strict logout call with `logoutRevenueCatIfIdentified().catch(...)` or remove the null-user call if cleanup ownership is documented in code.
  - If the null-user branch remains, unexpected errors should warn with a RevenueCat-specific message. Do not swallow all errors silently.
  - If removed, the implementor report must state why cleanup ownership is sufficient for no-session and sign-out paths.
- **Recommended path:** keep the null-user branch but route it through `logoutRevenueCatIfIdentified()` with narrow unexpected-error warning. This is safest for root auth-state parity and avoids relying on cleanup timing.

### `useRevenueCatLogout`

- **Path:** `app-mobile/src/hooks/useRevenueCat.ts`
- **Current behavior:** Uses strict `logoutRevenueCat()` and logs every error.
- **Required behavior:**
  - Align this hook with the guarded helper because its comment says it is for Supabase sign-out.
  - Update mutation result type from `CustomerInfo` to `CustomerInfo | null`.
  - Use `logoutRevenueCatIfIdentified()` as the mutation function.
  - Remove CustomerInfo query on success even when returned value is `null`.
  - If an unexpected error occurs, keep logging `[RevenueCat] Logout failed:` or equivalent.
  - Keep `useRevenueCatLogin()` strict and unchanged except import adjustments.

### CustomerInfo cache

- **Query key:** `revenueCatKeys.customerInfo()`
- **Required behavior:**
  - After guarded logout succeeds or no-ops because RevenueCat is already anonymous, remove the cached customer info in hook usage.
  - Auth cleanup's broader `queryClient.clear()` on no-user already clears private query state; do not weaken it.

## 11. Component / Screen Layer

None. No UI copy, visual state, accessibility, or navigation behavior changes are required.

## 12. Business / Admin / Public Parity

- Business app changes: None.
- Admin changes: None.
- Public/web changes: None.
- Operational dependency: None.

## 13. Realtime / Notifications / Analytics

- Realtime: Preserve existing realtime queue cleanup in `authCleanup.ts`.
- Notifications: Preserve existing OneSignal logout behavior.
- Analytics: Preserve Mixpanel logout tracking. Do not change AppsFlyer behavior.
- RevenueCat telemetry/logging: Expected anonymous logout state should be quiet; unexpected RevenueCat failures should still warn.

## 14. Implementation Order

1. Update `app-mobile/src/services/revenueCatService.ts`:
   - add anonymous logout classifier
   - add `logoutRevenueCatIfIdentified()`
   - preserve `loginRevenueCat()` and strict `logoutRevenueCat()`
2. Update `app-mobile/src/utils/authCleanup.ts` to call the guarded helper.
3. Update `app-mobile/app/index.tsx` RevenueCat import and null-user branch.
4. Update `app-mobile/src/hooks/useRevenueCat.ts` to align `useRevenueCatLogout()` with guarded logout and cache removal.
5. Add `app-mobile/scripts/ci/orch-0751-revenuecat-logout-check.mjs`.
6. Add `test:orch-0751` to `app-mobile/package.json`.
7. Run verification commands and write implementation report.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T1 | Service exposes guarded helper | Read `revenueCatService.ts` | `logoutRevenueCatIfIdentified` exported | Service | `test:orch-0751` |
| T2 | Service exposes classifier | Read `revenueCatService.ts` | `isRevenueCatAnonymousLogoutError` exported | Service | `test:orch-0751` |
| T3 | Anonymous pre-check exists | Read helper source | `Purchases.isAnonymous()` checked before `Purchases.logOut()` in guarded helper | Service | `test:orch-0751` |
| T4 | Anonymous error is recognized | Read classifier source | Code `22` / `LOG_OUT_ANONYMOUS_USER_ERROR` handled | Service | `test:orch-0751` |
| T5 | Unknown errors still surface | Read guarded helper/callers | Unexpected errors are thrown/rejected to caller warning path | Service/logging | `test:orch-0751` |
| T6 | Auth cleanup avoids strict logout | Read `authCleanup.ts` | No direct integration cleanup call to strict `logoutRevenueCat()` | Auth cleanup | `test:orch-0751` |
| T7 | Auth cleanup preserves private cache clear | Read `authCleanup.ts` | ORCH-0749 cleanup markers still present | Auth/cache | `test:orch-0749` |
| T8 | Root null-user branch avoids strict logout | Read `app/index.tsx` | No `logoutRevenueCat().catch(() => {})` null-user branch | Root auth effect | `test:orch-0751` |
| T9 | Login merge path preserved | Read `revenueCatService.ts` and `app/index.tsx` | `Purchases.logIn(userId)` and root `loginRevenueCat(user.id)` remain | Purchase identity | `test:orch-0751` |
| T10 | Hook logout is aligned | Read `useRevenueCat.ts` | `useRevenueCatLogout()` uses guarded helper and removes CustomerInfo cache on success | Hook/cache | `test:orch-0751` |
| T11 | ORCH-0749 stays green | Existing gate | Auth/cache regression guard still passes | Auth/cache | `test:orch-0749` |

## 16. Regression Prevention

- **Structural safeguard:** Strict native logout remains available, but auth cleanup and sign-out-style hook paths use guarded logout.
- **Test:** New `test:orch-0751` static gate plus existing `test:orch-0749`.
- **Protective comment / documentation:** Add one concise comment near `logoutRevenueCatIfIdentified()` explaining that RevenueCat rejects logging out anonymous users and code `22` is expected during duplicate cleanup races.
- **Artifact update:** Implementor must write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`.

## 17. Rollback And Deploy Safety

- **Migration order:** None.
- **Edge function deploy:** None.
- **Mobile OTA vs native build:** JS/TS-only mobile app change. OTA-compatible unless implementation discovers a native dependency change, which is not expected and should be treated as scope creep.
- **Business/admin web deploy:** None.
- **Env vars/secrets:** None.
- **Partial rollback risk:** Low. Reverting restores noisy RevenueCat anonymous logout behavior but should not affect Supabase auth or purchases.
- **Runtime smoke after implementation:** Fresh no-session startup, explicit sign-out from an authenticated account, then sign-in again to confirm `loginRevenueCat(user.id)` still fires without new errors.

## 18. Required Verification Commands

Implementor must run:

```bash
cd app-mobile && npm run test:orch-0751
cd app-mobile && npm run test:orch-0749
```

Implementor should also run:

```bash
cd app-mobile && npx tsc --noEmit
```

If TypeScript has pre-existing baseline failures, the implementation report must list them separately and prove ORCH-0751 did not introduce new ones.

## 19. Common Mistakes

1. Do not solve this by deleting RevenueCat logout entirely. Identified users still need RevenueCat reset on sign-out.
2. Do not silence all RevenueCat errors. Only code `22` / `LOG_OUT_ANONYMOUS_USER_ERROR` is expected.
3. Do not alter `loginRevenueCat(user.id)`. That path preserves anonymous purchase merge behavior.
4. Do not weaken ORCH-0749 cleanup to avoid the warning. The private cache cleanup must remain.
5. Do not leave `app/index.tsx` swallowing strict logout errors with `.catch(() => {})`.

## 20. Handoff To Implementor

Implement the smallest RevenueCat auth-cleanup guard. Start in `revenueCatService.ts`, add the guarded helper and narrow classifier, then route `authCleanup.ts`, the root null-user RevenueCat branch, and `useRevenueCatLogout()` through the guarded helper. Add `test:orch-0751` as a static regression gate and keep `test:orch-0749` passing. Do not touch purchase products, entitlement names, Supabase, admin, business, or store configuration.

## 21. Remaining Follow-Ups

- ORCH-0752 remains the bucket for RevenueCat product/offering/App Store/Play Store configuration warnings.
- The stale `authService.ts` sign-out ownership comment discovered in forensics can be handled in a later documentation drift pass; it is not part of this implementation unless the implementor naturally touches that file for a directly related reason, which is not expected.

`SPEC READY`
