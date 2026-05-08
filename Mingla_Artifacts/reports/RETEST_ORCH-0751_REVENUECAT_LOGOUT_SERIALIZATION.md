# RETEST ORCH-0751 RevenueCat Logout Serialization

Date: 2026-05-07
Mode: RETEST
Verdict: PASS

## Scope

Verify the ORCH-0751 rework fixed the Android/iOS auth cleanup race where multiple sign-out cleanup paths could call native RevenueCat logout after the first caller had already moved RevenueCat back to anonymous.

Prior runtime failure signature:

```text
[RevenueCat] Logged out successfully
[RevenueCat] Called logOut but the current user is anonymous
```

## Static Evidence

- `app-mobile/src/services/revenueCatService.ts` now keeps a module-level `guardedLogoutInFlight: Promise<CustomerInfo | null> | null`.
- `logoutRevenueCatIfIdentified()` returns the existing in-flight promise before starting a second native logout.
- The helper checks `Purchases.isAnonymous()` before `Purchases.logOut()`.
- It still swallows only RevenueCat anonymous logout errors and rethrows unknown logout failures.
- The in-flight promise is cleared in `finally` only if it still owns the current guarded promise.
- `app-mobile/scripts/ci/orch-0751-revenuecat-logout-check.mjs` includes T11, which would fail if the serialization guard is removed.

## Automated Gates

All requested repo-running gates passed:

```text
cd app-mobile && npm run test:orch-0751
PASS 11/11
ORCH-0751 RevenueCat logout gate: PASS
```

```text
cd app-mobile && npm run test:orch-0749
PASS
```

```text
git diff --check
PASS
```

## Android Runtime Retest

Device:

```text
Android emulator: emulator-5554
App package: com.mingla.app.v2
Expo dev client via Metro port 8082
Focused log stream: adb logcat -v time ReactNativeJS:V '*:S'
```

Runtime sequence tested:

1. Clean logged-out launch to Welcome.
2. Google sign-in with remembered Android Google account.
3. RevenueCat anonymous-to-identified login.
4. Profile sign-out.
5. RevenueCat logout during auth cleanup.
6. Return to Welcome.
7. Google sign-in again.
8. RevenueCat anonymous-to-identified login again.

Key log evidence:

```text
05-07 19:26:17.723 [RevenueCat] Logging in from $RCAnonymousID:71716db0d7864988b744f423a5938ad2 -> eff78416-0d36-4bca-b350-10a6c3f046cb
05-07 19:26:18.304 [RevenueCat] Logged in successfully as eff78416-0d36-4bca-b350-10a6c3f046cb. Created: false
05-07 19:30:00.755 [ACTION] Sign out pressed
05-07 19:30:01.405 [RevenueCat] Logged out successfully
05-07 19:30:02.207 [AUTH] Auth state change: SIGNED_OUT | hasSession=false, userId=undefined
05-07 19:32:44.458 [RevenueCat] Logging in from $RCAnonymousID:8d5a7575647047b397817eaff6e2b20c -> eff78416-0d36-4bca-b350-10a6c3f046cb
05-07 19:32:44.714 [RevenueCat] Logged in successfully as eff78416-0d36-4bca-b350-10a6c3f046cb. Created: false
```

Negative log checks:

```text
adb logcat -d -v time ReactNativeJS:V '*:S' | grep -F 'Called logOut but the current user is anonymous'
NO MATCH
```

```text
adb logcat -d -v time ReactNativeJS:V '*:S' | grep -E '\[AUTH_CLEANUP\] RevenueCat logout failed|logoutRevenueCatIfIdentified failed'
NO MATCH
```

## Notes Outside ORCH-0751

Android still shows RevenueCat Play Store offerings configuration errors:

```text
Error fetching offerings - PurchasesError(code=ConfigurationError, ... no Play Store products registered in the RevenueCat dashboard ...)
```

That is not the ORCH-0751 logout serialization bug. It is separate RevenueCat Android product/offering configuration debt and should remain tracked separately.

## Verdict

PASS.

The original runtime regression was reproduced through the same high-risk auth cycle and did not recur. Static coverage now includes an explicit serialization regression gate, and runtime evidence confirms sign-out produces one successful RevenueCat logout without the prior duplicate anonymous logout warning. This is ready for orchestrator closeout.
