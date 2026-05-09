# Investigation: ORCH-0752B Android Play Billing Purchase Version Gate

Date: 2026-05-07
Mode: `$forensics` INVESTIGATE
Status: CLOSED BY RUNTIME RETEST

## 2026-05-07 Close Addendum

This report's original root cause was correct for the screenshot-era install, but the tested state changed afterward.

Later ADB verification showed the installed Mingla package was no longer a local/debug/sideload build:

- `versionCode=12`, `versionName=1.0.0`
- `installerPackageName=com.android.vending`
- `initiatingPackageName=com.android.vending`
- no `DEBUGGABLE` flag in package output

The remaining "loading packages" symptom cleared after `adb shell pm clear com.mingla.app.v2`, logcat reset, relaunch, and user sign-in/retry. User confirmation: "It works now. all good."

Updated verdict: ORCH-0752B is closed for the currently tested Android Play/internal build. The old billing error was an install/test eligibility + stale app-state problem, not a current RevenueCat product-ID bug. ORCH-0752A remains separate for Billing sheet UX clarity.

## Verdict

Android purchase is now blocked by the **Google Play app-version/tester gate**, not by missing RevenueCat products.

Plain English: RevenueCat and Google Play can now see the three subscription products and prices. The failure happens one step later, when Google Play tries to start the purchase flow and says this installed copy of Mingla is not allowed to bill through Google Play.

## Screenshot Symptom

User screenshot: Android Play purchase sheet error:

> This version of the application is not configured for billing through Google Play.

## Runtime Evidence

Installed package evidence from `adb dumpsys package com.mingla.app.v2`:

- Package: `com.mingla.app.v2`
- Version: `versionCode=1`, `versionName=1.0.0`
- Build flags include `DEBUGGABLE`
- `installerPackageName=null`
- `initiatingPackageName=com.android.shell`
- APK path under `/data/app/.../com.mingla.app.v2...`

This means the currently tested binary is a local/sideloaded debug/dev install, not an app version installed from a Play testing track.

RevenueCat / Play product evidence from `adb logcat`:

- RevenueCat fetched offerings successfully.
- Store product query returned all three products:
  - `mingla_plus_annual`, base plan `annual`, `$39.99`, `P1Y`
  - `mingla_plus_monthly`, base plan `monthly`, `$4.99`, `P1M`
  - `mingla_plus_weekly`, base plan `weekly-mingla`, `$1.99`, `P1W`
- RevenueCat logged: `Building offerings response with 3 products`

Purchase failure evidence from `adb logcat`:

- `ProxyBillingActivity: Activity finished with resultCode 3 and billing's responseCode: 5`
- `BillingWrapper purchases failed to update: DebugMessage: Please ensure the specific App version has been published.. ErrorCode: DEVELOPER_ERROR`
- `PurchasesError(code=PurchaseInvalidError, underlyingErrorMessage=Error updating purchases. DebugMessage: Please ensure the specific App version has been published.. ErrorCode: DEVELOPER_ERROR...)`

## Root Cause

Classification: confirmed external test/distribution configuration gate

- **Current behavior:** app displays products/prices, but Google Play rejects purchase launch with `DEVELOPER_ERROR`.
- **Expected behavior:** a license tester or internal-track tester can launch the Google Play sandbox purchase flow.
- **Causal chain:** local debug install/versionCode 1 -> Play Billing launch -> Google Play checks whether this package/account/version is eligible for billing -> account/version is not recognized as eligible -> Play returns the user-visible billing configuration error.
- **Why this is not the old ORCH-0752 product issue:** products are no longer empty. Product details return successfully before purchase.

## Official Documentation Cross-Check

Google's Play Billing test docs say license testers can sideload debug builds only when the package name matches the Play app and the Google account is registered as a license tester. They also say test-track validation requires publishing the app to a test track and having testers opt in.

Play Console Help says the app must be published to an open, closed, internal test, or production track, testers must be eligible for that release, and one-time products/subscriptions must be published before they can be tested.

## Most Likely Fix

1. In Play Console, add the exact Google account logged into the Android emulator's Play Store under **Settings -> License testing**.
2. Make sure the same account is also on the Mingla **Internal testing** tester list, then save.
3. On the emulator/device, use that same Google account in the Play Store. If multiple Google accounts are on the device, remove the others temporarily or make sure the tester account is the Play Store billing account.
4. Clear Google Play Store cache/data, then retry the purchase from the current debug install.
5. If it still fails, publish a fresh `com.mingla.app.v2` Android App Bundle to the internal test track and install Mingla from the Play internal-test opt-in link, then retry.

## Required Retest

Retest Android purchase only after the tester/account or track-install condition is satisfied:

1. Open Mingla on Android.
2. Confirm weekly/monthly/annual packages still display.
3. Tap monthly purchase.
4. Expected: Google Play sandbox purchase sheet appears with a test payment instrument.
5. Complete purchase using a license tester test card.
6. Confirm RevenueCat CustomerInfo activates `Mingla Plus`.
7. Confirm app tier resolves `mingla_plus`.

## Sources

- Android Developers, Play Billing testing: https://developer.android.com/google/play/billing/test
- Play Console Help, Test in-app billing with application licensing: https://support.google.com/googleplay/android-developer/answer/6062777
