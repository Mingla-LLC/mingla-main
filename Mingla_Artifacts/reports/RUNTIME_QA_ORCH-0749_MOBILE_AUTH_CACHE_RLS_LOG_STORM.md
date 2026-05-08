# Runtime QA Report: ORCH-0749 Mobile Auth/Cache/RLS Log Storm

> Date: 2026-05-07
> Mode: TARGETED / RUNTIME QA
> Verdict: PASS
> Findings: P0:0 P1:0 P2:2 P3:0 P4:5

## 1. Layman Summary

The device block is cleared. Android Studio and Xcode are now usable from Codex, Android builds and launches on the Pixel emulator, and iOS builds and launches on the iPhone 17 simulator.

The original ORCH-0749 auth/cache failure did not reappear during fresh no-session startup on either platform. I did not see the stale old-user query storm, the repeated `userPreferences` pending-dehydration rejection, or blocked-users `Not authenticated` being cached as a fake successful empty result.

Android native Google sign-in is now unblocked. The failure was Google Cloud OAuth configuration, not app code: a new Android OAuth client was created for `com.mingla.app.v2` and the local debug signing SHA, after which Android Google sign-in completed successfully with no fallback patch.

The operator then completed the remaining manual smoke gates. Two separate runtime noises were observed and should be tracked outside the core ORCH-0749 auth/cache leak: RevenueCat logout is still called while anonymous, and RevenueCat store-product configuration remains noisy on Android/iOS.

## 2. Inputs Reviewed

- Runtime prompt: `Mingla_Artifacts/prompts/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Static QA: `Mingla_Artifacts/reports/QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`
- Tester skill protocol: `.codex/skills/tester-mingla/SKILL.md`

## 3. Environment Results

| Check | Result | Evidence |
|---|---|---|
| Android SDK/emulator | PASS | `Pixel_8_Pro` booted; `adb devices` reported `emulator-5554 device` |
| Android dev build | PASS | `npx expo run:android --port 8083` built and installed `com.mingla.app.v2`; Gradle ended `BUILD SUCCESSFUL` |
| Android Google sign-in | PASS | Native Google sign-in previously failed with `code="10" DEVELOPER_ERROR`; after Google Cloud Android OAuth client creation, logs showed `Auth state change: SIGNED_IN`, `Google sign-in completed successfully`, and Home/Profile loading under user `eff78416-0d36-4bca-b350-10a6c3f046cb` |
| Xcode/simctl | PASS | Xcode `26.4.1`; iOS `26.4.1` runtime installed |
| iOS simulator | PASS | `iPhone 17 (F7ECAC25-2A98-4002-AD17-85AED17AB752) (Booted)` |
| iOS simulator build | PASS | Direct `xcodebuild ... -sdk iphonesimulator26.4 ... build` ended `** BUILD SUCCEEDED **` |
| iOS app launch | PASS | Installed and launched `com.mingla.app.v2` on booted simulator |

## 4. Repo Gate Recheck

| Check | Command | Result | Evidence |
|---|---|---|---|
| ORCH-0749 regression gate | `cd app-mobile && npm run test:orch-0749` | PASS | Re-run after manual smoke tests at `2026-05-07 17:45:45 EDT`; output ended `ORCH-0749 regression gate: PASS` |

The gate still verifies the intended contracts, including no pending query dehydration, auth-scoped query matching, cancellation classification, cleanup of persisted private cache, Apple cancel not logged as app error, blocked-users expected-user checks, missing preferences tolerance, AppsFlyer stale callback no-op, engagement session checks, Zustand/AppState no-op guards, and icon mappings.

## 5. Runtime Gate Results

| Gate | Result | Evidence / reason |
|---|---|---|
| Gate 1: prior user cache + no current session + reload | PASS | Codex-observed fresh Android/iOS startup landed on Welcome with no stale old-user query continuation, no repeated `userPreferences` pending-dehydration rejection, and no blocked-users `Not authenticated` false-success pattern. Operator completed final smoke coverage after Android auth unblock. |
| Gate 2: User A sign-out then User B sign-in | PASS | Android native Google sign-in worked and loaded user-scoped queries under `eff78416-0d36-4bca-b350-10a6c3f046cb`; operator completed User A/User B smoke test with no reported stale-user leakage. |
| Gate 3: Apple sign-in cancel | PASS | Static gate `T19 Apple cancel is not logged as app error` passed; operator completed Apple cancel smoke test. Earlier simulator `ERR_REQUEST_UNKNOWN` is no longer treated as evidence against the cancel path because the operator re-smoked the intended cancel behavior. |
| Gate 4: Profile scroll render storm | PASS | Static gate `T16 tabScroll has no-op guard` passed; operator completed Profile scroll smoke test with no reported render storm. |
| Gate 5: missing preferences row | PASS | Static gate `T10/T11 profile interests tolerate missing preferences row and upsert updates` passed; operator completed missing-preferences smoke test. |

## 6. Findings

### P2-001: RevenueCat logout is still invoked while anonymous during no-session cleanup

- **Evidence:** iOS fresh no-session startup logged `LogOut was called but the current user is anonymous`, followed by `[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)`.
- **Impact:** This is not the original stale-user data leak, but it keeps a red error in Metro during a normal unauthenticated startup.
- **Required rework:** Guard RevenueCat logout so anonymous/no-current-app-user cleanup is treated as a quiet no-op, or classify this exact SDK response as non-error before it reaches `console.error`.

### P2-002: Apple sign-in simulator non-cancel failures can still log as app errors

- **Evidence:** Static gate `T19 Apple cancel is not logged as app error` passed and operator completed the Apple cancel smoke test. Earlier live simulator Apple auth also produced `ERR_REQUEST_UNKNOWN`, which correctly falls outside the cancel-specific contract but still logs loudly.
- **Impact:** The original cancel regression is covered. Non-cancel simulator/provider failures may still create noisy Metro errors.
- **Required follow-up:** If simulator/provider Apple auth errors are common during QA, classify expected non-production simulator failures separately from real auth failures.

### P4-001: The original ORCH-0749 query/cache storm was not observed on fresh no-session startup

- **Evidence:** No repeated `A query that was dehydrated as pending ended up rejecting` and no stale `userPreferences.<oldUserId>` loop appeared during observed Android/iOS no-session startup.

### P4-002: Android is now usable for future runtime checks

- **Evidence:** Pixel emulator build installed and launched `com.mingla.app.v2`; initial no-session app boot reached Welcome.

### P4-003: iOS is now usable for future runtime checks

- **Evidence:** iOS simulator runtime installed, iPhone 17 booted, CocoaPods installed, `Mingla.app` built/installed/launched.

### P4-004: RevenueCat product/offering warnings are external configuration, not ORCH-0749 cache leakage

- **Evidence:** iOS logs warned App Store Connect products are `READY_TO_SUBMIT`; Android logs warned Play Store products are not configured in RevenueCat.
- **Impact:** Purchase QA remains noisy until store configuration is completed, but this does not indicate stale Supabase auth/cache work.

### P4-005: Android native Google sign-in blocker resolved outside app code

- **Evidence:** APK signing SHA-1 was `5e8f16062ea3cd2c4a0d547876baa6f38cabf625`; the old Android OAuth client only covered `44105699ec81a9470abd4558cd1fa95ed78b82d0`. After an Android OAuth client was created in Google Cloud for client ID `169132274606-c5h9f0mu46u4ilusphsock9f3iuaouqq.apps.googleusercontent.com`, native Android sign-in completed successfully.
- **Impact:** Android can now participate in authenticated runtime QA. No app-code fallback was retained.

## 7. Verdict

`PASS`

The environment is no longer blocked, Android native Google auth is usable, operator smoke tests completed the remaining runtime gates, and the repo-running ORCH-0749 regression gate passes. ORCH-0749 is eligible for orchestrator closeout, with RevenueCat anonymous logout/product-configuration noise tracked separately.

## 8. Required Next Test

No further ORCH-0749-specific runtime test is required before orchestrator closeout. Recommended follow-ups belong to separate work items:

- Quiet RevenueCat logout when already anonymous.
- Complete RevenueCat/App Store Connect/Play Store product configuration.
