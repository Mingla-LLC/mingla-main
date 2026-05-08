# Close Report: ORCH-0752 RevenueCat Android Billing Config

Date: 2026-05-07
Mode: `$orchestrator` CLOSE
Verdict: CLOSED PASS for Android internal-test billing/configuration
Decision: DEC-131

## Plain-English Result

The Android billing blocker is closed. The app was not fundamentally unable to bill; the failing purchase screenshot came from an ineligible/local install path and then stale app data kept the paywall stuck on package loading. After the app was verified as installed from Google Play internal testing and app data was cleared, the user confirmed the Billing/paywall package path works.

## Evidence

- Installed package verification before clearing data:
  - `versionCode=12`
  - `versionName=1.0.0`
  - `installerPackageName=com.android.vending`
  - `initiatingPackageName=com.android.vending`
  - no `DEBUGGABLE` flag in package output
- App data/cache reset:
  - `adb shell pm clear com.mingla.app.v2` returned `Success`
  - `adb logcat -c` cleared stale logs
  - app relaunched with `adb shell monkey -p com.mingla.app.v2 -c android.intent.category.LAUNCHER 1`
- User runtime confirmation after reset:
  - "It works now. all good."

## What Changed In Reality

The earlier Play Billing error was tied to test/install eligibility and stale local state, not an app-side product-id bug. RevenueCat product/offering configuration had already progressed far enough for Android packages to resolve. Clearing app data removed stale cached/null offering or session state, allowing the current Play-installed build to fetch/display packages again.

## Scope And Non-Scope

Closed:

- ORCH-0752 Android internal-test Play Billing/package-loading blocker.
- ORCH-0752B purchase-version gate for the currently tested Play-installed build.

Still separate:

- ORCH-0752A Billing sheet UX redesign remains open. The sheet can still be improved to present weekly/monthly/annual price cadence and value more clearly.
- iOS App Store Connect product approval remains an external release-readiness task if production iOS purchases are launch scope.
- No product-code patch was required for this close.

## Deploy Notes

No app deploy, Supabase migration, edge function deploy, native dependency change, or env var change belongs to this close.

## Follow-Up Recommendation

Keep ORCH-0752A as the next user-facing subscription work: redesign/spec the Billing sheet so it truthfully shows plan options, prices, current-plan state, loading/unavailable states, restore/manage actions, and value messaging.
