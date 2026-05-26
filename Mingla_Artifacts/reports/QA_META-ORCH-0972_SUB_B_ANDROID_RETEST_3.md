# QA Report: META-ORCH-0972 Sub-B Android Retest 3

> Date: 2026-05-25
> Mode: RETEST
> Verdict: PASS
> Findings: P0:0 P1:0 P2:0 P3:0 P4:1

## 1. Layman Summary

Sub-B Android retest #3 passes. The rebuilt Android dev client reached authenticated Home with no blocking ANR dialog before the first app interaction, then reached Hub after tapping the bottom Hub tab. The remaining cold-boot `System UI isn't responding` dialog reproduced once before Metro finished bundling, but the clean post-Metro relaunch had no dialog and the final app-process logcat had zero ANR/input-timeout/error signatures.

Sub-C can unblock from the Android runtime gate. The eventual PR squash body still needs `[TEST-MOD-APPROVED META-ORCH-0972]`.

## 2. Inputs Reviewed

- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK_3.md`
- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_ANDROID_RETEST_2.md`
- Fresh `android-rework3-*` evidence under `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`
- Current worktree: `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
- Branch/commit: `meta-orch-0972-brand-kind-decommission-universal-features` at `1b560d66938afd15b2d0b41165013bac68e08f93`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `supabase`, migrations | Rework #3 diff did not touch DB, migrations, edge functions, or RLS surfaces. |
| Edge/RPC/Webhooks | `supabase/functions` | No rework #3 changes. |
| Services | `appsFlyerService.ts`, `oneSignalService.ts`, `revenueCatService.ts` | Env guards prevent optional native module requires when env keys are absent. |
| Hooks/State/Cache | Auth/current brand persisted session | Existing authenticated Pixel 8 Pro session reached Home. |
| Components/Screens | `app/_layout.tsx`, Home, Hub | Optional SDK initialization is deferred; Home and Hub rendered cleanly. |
| Business/Admin/Public | `mingla-business` Android dev client | Runtime verified on Android. |
| Tests/Build | Jest, Expo export/config/autolinking, Android rebuild/install | Focused automated gates and rebuilt dev client passed. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Worktree is at requested commit | `git rev-parse HEAD` | PASS | `1b560d66938afd15b2d0b41165013bac68e08f93`. |
| `411925909` remains preserved | `git merge-base --is-ancestor 411925909 HEAD` | PASS | Command returned `411925909_ANCESTOR=PASS`. |
| Rework #3 did not touch DB/migration/edge/RLS/forbidden public-page/feed files | `git diff --name-only HEAD^..HEAD -- supabase **/migrations/** .github/scripts/strict-grep ...` | PASS | Empty output for hard-guarded paths. |
| No package/payment SDK version bump | `git diff --unified=0 HEAD^..HEAD -- package files` | PASS | Only Android autolinking exclusions were added in `mingla-business/package.json`; dependency versions unchanged. |
| Metro native Connect alias preserved | `rg` in `mingla-business/metro.config.js` | PASS | Existing `stripeConnectNativeStub.js` / `@stripe/react-connect-js` resolver branch remains present. |
| Optional native startup plugins filtered when env absent | `npx expo config --json` | PASS | `react-native-appsflyer=0`, `onesignal-expo-plugin=0`; Stripe/native required plugins still present. |
| Optional install/revenue SDKs excluded from Android autolinking | `npx expo-modules-autolinking resolve --platform android --json` | PASS | `react-native-appsflyer=0`, `react-native-onesignal=0`, `react-native-purchases=0`, `@stripe/stripe-react-native=0`. |
| Rebuilt Android dev client reaches Home and Hub without blocking app ANR | Pixel 8 Pro clean relaunch evidence | PASS | Home and Hub XML contain no ANR dialog strings; final logcat has zero app ANR/input-timeout/error signatures. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Focused Sub-B + Android startup Jest suite | `npx jest --runInBand __tests__/androidOptionalSdkStartupIsolation.test.ts __tests__/androidRootStripeProviderIsolation.test.ts __tests__/androidRootStripeTransitiveGraph.adversarial.test.ts __tests__/androidWebOnlyConnectRoutes.test.ts __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx src/services/__tests__/venueClaimService.test.ts src/payments/__tests__/native_checkout_flow_parity.test.ts src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` | PASS | 9 suites, 36 tests passed. Existing web-export prerequisite warning in `KeyboardRoot.adversarial.test.tsx` remained non-failing. |
| Android dev export | `rm -rf /tmp/mingla-business-android-export-retest3 && npx expo export --platform android --dev --output-dir /tmp/mingla-business-android-export-retest3` | PASS | Android bundled 3207 modules and exported. |
| Expo config plugin receipt | `npx expo config --json` plus plugin extraction | PASS | AppsFlyer/OneSignal plugins absent with env missing; required Stripe/ADI/bracket-safe plugins present. |
| Android autolinking receipt | `npx expo-modules-autolinking resolve --platform android --json` | PASS | Optional native SDK modules and Stripe native module absent from Android autolinking receipt. |
| Android dev-client rebuild/install | `npx expo run:android --variant debug` | PASS | Gradle `BUILD SUCCESSFUL`; debug APK installed on Pixel 8 Pro. Expo detected anchor Metro on `8081`, so runtime proof used separate worktree Metro on `8082`. |
| Runtime launch source isolation | `RCT_METRO_PORT=8082 npx expo start --dev-client --port 8082 --host lan --clear`; `adb reverse tcp:8082 tcp:8082`; launch URL `10.0.2.2:8082` | PASS | Runtime bundle came from the META-ORCH-0972 worktree, not the anchor checkout's `8081` Metro. |
| Authenticated Home before first interaction | Force-stop app, clear logcat, launch dev client URL, wait 22s, capture XML/screenshot before any tap | PASS | `android-retest3-pixel8-clean-relaunch-first-paint.png/.xml`; no dialog strings, `Travel Brand=2`, `Home=2`, `Hub=2`, `Sign in=0`. |
| Hub after first interaction | Tap Hub tab, wait 8s, capture XML/screenshot/logcat | PASS | `android-retest3-pixel8-clean-relaunch-hub.png/.xml`; `hub-universal-creator-button=1`; no dialog strings. |
| Final app-process grep | Pattern-count receipt | PASS | `android-retest3-pixel8-clean-relaunch-grep.txt` shows all ANR/input-timeout/error/Stripe startup/Loading brands counts at `0`. |

## 6. Android Evidence

Evidence folder: `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`

| File | Observation |
|---|---|
| `android-retest3-pixel8-first-paint.png` / `.xml` | Initial cold-boot launch reproduced `System UI isn't responding` before Metro finished bundling. |
| `android-retest3-pixel8-after-wait.png` / `.xml` | After selecting `Wait`, authenticated Home was visible with no dialog strings. |
| `android-retest3-pixel8-hub-after-tap.png` / `.xml` | Hub was reachable after the dialog was cleared; no dialog strings. |
| `android-retest3-pixel8-clean-relaunch-first-paint.png` / `.xml` | Decisive clean post-Metro relaunch: authenticated Home before first interaction with no ANR dialog. |
| `android-retest3-pixel8-clean-relaunch-hub.png` / `.xml` | Decisive Hub proof after first interaction; `hub-universal-creator-button=1`, no dialog strings. |
| `android-retest3-pixel8-clean-relaunch-final-logcat.txt` | Final app logcat from clean relaunch through Hub. |
| `android-retest3-pixel8-clean-relaunch-grep.txt` | Focused receipt: app ANR, input timeout, system dialog, ReferenceError, Stripe startup strings, fatal exception, ReactNativeJS error, and `Loading brands` all count `0`. |

Key clean-relaunch receipt:

```text
final_log:ANR in com.sethogieva.minglabusiness=0
final_log:Input dispatching timed out=0
final_log:Process system isn't responding=0
final_log:System UI isn't responding=0
final_log:ReferenceError=0
final_log:StripeResponse=0
final_log:StripePushProvisioning=0
final_log:Loading brands=0
final_log:FATAL EXCEPTION=0
final_log:ReactNativeJS: Error=0
home_xml:Travel Brand=2
home_xml:Home=2
home_xml:Hub=2
hub_xml:hub-universal-creator-button=1
```

## 7. Findings

### P4 Notes

**P4-001: Pixel 8 Pro cold boot still produced a system-process ANR dialog once before Metro completed.**

- **Evidence:** `android-retest3-pixel8-first-paint.xml` contains `System UI isn't responding`, `Close app`, and `Wait`.
- **Why it does not block this retest:** The decisive post-Metro clean relaunch used the same rebuilt dev client and authenticated AVD, captured Home before first interaction with no dialog, then reached Hub with a final logcat receipt showing zero app-process ANR/input-timeout/error signatures. The cold-boot dialog is still useful environment evidence for orchestrator, but this retest found no app-process blocker to send back to implementor.

## 8. Hard Constraints

| Constraint | Result | Evidence |
|---|---|---|
| No DB/migration/edge/RLS changes in rework #3 | PASS | `git diff --name-only HEAD^..HEAD -- supabase **/migrations/**` empty. |
| No forbidden public-page/feed files in rework #3 | PASS | Hard-guarded path diff empty. |
| Preserve `411925909` | PASS | Ancestor check passed. |
| Preserve Metro native Connect alias | PASS | `metro.config.js` still contains native stub resolver for Connect JS. |
| No package/payment SDK bumps | PASS | No dependency version changes; only autolinking exclusions added. |
| Keep `[TEST-MOD-APPROVED META-ORCH-0972]` for eventual PR squash body | PASS | Requirement carried forward. |

## 9. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| Retest #2 P1: authenticated Android Home showed blocking ANR dialog and Hub could not be reached | YES | Clean relaunch Home/Hub screenshots/XML plus final grep receipt | Covered by new `androidOptionalSdkStartupIsolation.test.ts` and live Android retest. |
| Retest #2 P2: fresh non-Pixel AVD could not complete authenticated coverage | ACCEPTED LIMIT | Pixel 8 Pro retained authenticated session; Pixel 7 remains unauthenticated without credentials | No app-process blocker found; orchestrator can decide whether to require separate credential seeding later. |

## 10. Verdict and Routing

**Verdict: PASS.**

Route to `orchestrator-mingla` to unblock META-ORCH-0972 Sub-C. Do not route back to implementor: this retest found no app-process ANR, input timeout, fatal exception, Stripe startup regression, `ReferenceError`, or Home/Hub runtime blocker on the decisive clean Android relaunch.
