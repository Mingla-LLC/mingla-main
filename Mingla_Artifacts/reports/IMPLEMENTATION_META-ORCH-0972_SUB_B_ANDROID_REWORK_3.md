# IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK_3

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Sub-scope:** Sub-B Android rework #3  
**Implementor:** Codex `implementor-mingla`  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`  
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`  
**Baseline:** `c2e1850cd`

## 1. Verdict

**IMPLEMENTED; ANDROID RETEST #3 REQUIRED.**

This rework removes env-absent optional install/revenue SDK native startup work from the Android dev-client path and defers the remaining optional JS initialization until after first paint. The rebuilt authenticated Pixel 8 Pro path reached Home and Hub with clean post-interaction app evidence, but the same AVD still produced an Android `System UI isn't responding` dialog immediately after emulator reboot before the app became usable. That residual dialog is system-process/environmental evidence rather than an app-process ANR, so tester must rerun the gate on a clean Android runner or fresh authenticated AVD before Sub-C unblocks.

## 2. Comms Ledger Ack

- COMMS-0002 — acknowledged as `implementor+codex` for META-ORCH-0972 Sub-B Android rework #3; no backend, DB, migration, edge, or RLS files were touched.
- COMMS-0003 — acknowledged as `implementor+codex` for META-ORCH-0972 Sub-B Android rework #3; no external API contract or SDK package version was changed.
- COMMS-0004 — acknowledged as `implementor+codex` for META-ORCH-0972 Sub-B Android rework #3; no intake or cross-ORCH shared intake surface was changed.

## 3. Inputs Read

- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_ANDROID_RETEST_2.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK_2.md`
- `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_SUB_B_ANDROID_REWORK_2.md`
- Retest #2 Android evidence under `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`

## 4. Root Cause Analysis

Rework #2 removed native Stripe root evaluation, and tester retest #2 confirmed source, Jest, and Android export gates were green. The remaining live-fire failure was a user-visible Android system dialog while authenticated Home was already visible. Retest #2 logcat had no `ANR in com.sethogieva.minglabusiness`, no input-dispatch timeout, and no Stripe/document crash signatures, but it still showed env-absent optional SDK startup activity around the cold launch path.

The narrow app-owned fix for rework #3 is to keep optional install/revenue SDKs out of Android native startup when their env keys are absent, then initialize the JS service wrappers only after the first interaction frame. This reduces Android startup work without touching Home/Hub data contracts, Stripe checkout architecture, public feed files, database surfaces, or package versions.

## 5. Files Changed

| File | Change |
|---|---|
| `mingla-business/app.config.ts` | Filters `react-native-appsflyer` and `onesignal-expo-plugin` config plugins when their env keys are absent. |
| `mingla-business/package.json` | Adds Android autolinking excludes for optional install/revenue SDK native modules: AppsFlyer, OneSignal, and RevenueCat. No dependency version changed. |
| `mingla-business/app/_layout.tsx` | Defers optional AppsFlyer, Mixpanel, RevenueCat, and OneSignal initialization through `InteractionManager.runAfterInteractions` plus a zero-delay timer. |
| `mingla-business/src/services/appsFlyerService.ts` | Guards the native module require behind the full AppsFlyer env set, preserving explicit env-missing warning behavior. |
| `mingla-business/src/services/oneSignalService.ts` | Guards the native module require behind `EXPO_PUBLIC_ONESIGNAL_APP_ID`. |
| `mingla-business/src/services/revenueCatService.ts` | Guards the native module require behind `EXPO_PUBLIC_REVENUECAT_API_KEY`. |
| `mingla-business/__tests__/androidOptionalSdkStartupIsolation.test.ts` | Adds regression coverage for config filtering, Android autolinking exclusion, deferred root initialization, and env-gated native requires. |

## 6. Regression Coverage

New regression:

```bash
cd mingla-business && npx jest --runInBand __tests__/androidOptionalSdkStartupIsolation.test.ts
```

Fails-on-revert annotation is in `mingla-business/__tests__/androidOptionalSdkStartupIsolation.test.ts`.

Pre-fix behavior at `c2e1850cd`: app config always carried the env-absent AppsFlyer and OneSignal config plugins, package config did not exclude optional Android install SDK native modules from autolinking, root layout ran optional SDK initialization immediately at mount, and optional SDK services required native modules before checking env keys.

## 7. Verification Gates

| Gate | Command | Result |
|---|---|---|
| Focused Sub-B + Android startup Jest suite | `cd mingla-business && npx jest --runInBand __tests__/androidOptionalSdkStartupIsolation.test.ts __tests__/androidRootStripeProviderIsolation.test.ts __tests__/androidRootStripeTransitiveGraph.adversarial.test.ts __tests__/androidWebOnlyConnectRoutes.test.ts __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx src/services/__tests__/venueClaimService.test.ts src/payments/__tests__/native_checkout_flow_parity.test.ts src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` | PASS — 9 suites, 36 tests. Existing `KeyboardRoot.adversarial.test.tsx` web-export prerequisite warning still emitted and the suite passed. |
| Android dev export | `cd mingla-business && rm -rf /tmp/mingla-business-android-export-rework3-final && npx expo export --platform android --dev --output-dir /tmp/mingla-business-android-export-rework3-final` | PASS — Android bundled 3207 modules and exported to `/tmp/mingla-business-android-export-rework3-final`. |
| Expo config plugin receipt | `cd mingla-business && npx expo config --json` plus plugin-name extraction | PASS — config excludes `react-native-appsflyer` and `onesignal-expo-plugin` with env absent; keeps `@stripe/stripe-react-native`, `./plugins/withAdiRegistration`, and `./plugins/withAndroidBracketSafeCmake`. |
| Android optional SDK autolinking receipt | `cd mingla-business && npx expo-modules-autolinking resolve --platform android --json` plus module-name extraction | PASS — `react-native-appsflyer=0`, `react-native-onesignal=0`, and `react-native-purchases=0`. |
| Android dev-client rebuild/install | `cd mingla-business && npx expo run:android --variant debug` | PASS — Gradle build successful in 4m 37s; debug APK installed on Pixel 8 Pro. Build output did not show AppsFlyer, OneSignal, or RevenueCat native module tasks. |
| Final Android app-process grep receipt | `android-rework3-pixel8-rebuilt-after-reboot-grep.txt` | PASS WITH ENV NOTE — app-process ANR, input timeout, dialog strings, `ReferenceError`, Stripe startup strings, and `Loading brands` all count `0`; env-missing AppsFlyer, OneSignal, and RevenueCat JS warnings each count `1` after the app is usable. |
| Android authenticated Home/Hub UI after clearing system dialog | Pixel 8 Pro screenshots/XML after tapping `Wait` on the system-process dialog | PASS WITH ENVIRONMENTAL NOTE — Home and Hub are reachable with no dialog strings in the post-Wait XML. Initial post-reboot `System UI isn't responding` dialog means tester retest #3 remains mandatory. |

## 8. Android Evidence

Evidence folder: `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`

| File | Observation |
|---|---|
| `android-rework3-pixel8-rebuilt-after-reboot-logcat.txt` | Captures the initial post-reboot path where Android raised a `System UI isn't responding` dialog. App-process ANR signatures were absent. |
| `android-rework3-pixel8-rebuilt-after-reboot-post-wait.png` | Authenticated Home visible for `Travel Brand` after selecting `Wait` on the system dialog. |
| `android-rework3-pixel8-rebuilt-after-reboot-post-wait.xml` | Home XML contains no `Process system isn't responding`, `System UI isn't responding`, `Close app`, or `Wait` dialog strings. |
| `android-rework3-pixel8-rebuilt-after-reboot-hub.png` | Hub reachable from Home after the rebuilt dev-client launch. |
| `android-rework3-pixel8-rebuilt-after-reboot-hub.xml` | Hub XML shows `hub-universal-creator-button`, `Travel Brand`, selected `Hub`, and no dialog strings. |
| `android-rework3-pixel8-rebuilt-after-reboot-final-logcat.txt` | Final app logcat after Home-to-Hub interaction. |
| `android-rework3-pixel8-rebuilt-after-reboot-grep.txt` | Focused receipt: app ANR, input timeout, dialog strings, Stripe startup strings, `ReferenceError`, and `Loading brands` all count `0`; `INITIAL_SESSION=1`. |

Key receipt:

```text
final_log:ANR in com.sethogieva.minglabusiness=0
final_log:Input dispatching timed out=0
final_log:Process system isn't responding=0
final_log:System UI isn't responding=0
final_log:ReferenceError=0
final_log:StripeResponse=0
final_log:StripePushProvisioning=0
final_log:Loading brands=0
final_log:INITIAL_SESSION=1
hub_xml:hub-universal-creator-button=1
```

## 9. Constraints Held Checklist

- No DB, migration, Supabase edge function, RLS, or backend file changes.
- No `PublicBrandPage.tsx`, `publicEventsService.ts`, `ExperienceMiniCard`, `useUpcomingFeed`, `EventMiniCard`, or `TripMiniCard` changes.
- No META-ORCH-0972 strict-grep script changes.
- No Sub-A rewrites.
- No package/payment SDK version bumps; `package.json` changed only Expo Android autolinking configuration.
- Prior native Connect Metro alias remains unchanged.
- `git merge-base --is-ancestor 411925909 HEAD` remains PASS.
- `[TEST-MOD-APPROVED META-ORCH-0972]` remains required in the eventual PR squash body because the cumulative branch includes approved test modifications.

## 10. Retest #3 Routing

Route back to tester for Android retest #3. The retest should rebuild/install the current dev client, use a clean Android runner or fresh AVD with an authenticated session, and verify authenticated Home and Hub are reachable without any blocking ANR dialog before first interaction. If the only recurring blocker is an Android `System UI isn't responding` dialog with zero `com.sethogieva.minglabusiness` ANR/input-timeout evidence, route to orchestrator for an environment decision; otherwise return to implementor with the app-process evidence.

Sub-C remains blocked until tester records PASS.
