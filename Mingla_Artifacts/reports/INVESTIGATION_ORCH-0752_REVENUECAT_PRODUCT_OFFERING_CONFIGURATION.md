# Investigation: ORCH-0752 RevenueCat Product/Offering Configuration

Date: 2026-05-07
Mode: `$forensics` INVESTIGATE
Status: COMPLETE

## Verdict

ORCH-0752 is a **mixed external configuration issue**, with no proven app-code product ID bug from local evidence.

- **Android:** confirmed RevenueCat dashboard/store configuration gap. Runtime logs report `PurchasesError(code=ConfigurationError)` because the app is configured with a Play Store SDK key but the current RevenueCat offering has no Play Store products registered for that offering.
- **iOS:** confirmed App Store Connect launch-readiness gap. Runtime logs report RevenueCat can see the configured products, but App Store Connect still has them in `READY_TO_SUBMIT`, so they are not production-ready.
- **App code:** no local source evidence that the mobile app hardcodes `mingla_plus_weekly`, `mingla_plus_monthly`, or `mingla_plus_annual` into purchase flow. The paywall fetches RevenueCat's current offering and purchases the package returned by RevenueCat.
- **Dashboard access limit:** Codex cannot verify RevenueCat dashboard, App Store Connect, or Play Console state directly from this repo. The operator must confirm the checklist below.

Plain English: the app is asking RevenueCat, "What packages can I sell right now?" RevenueCat is answering, "Your store/dashboard setup is incomplete." This is not the old logout bug.

## Feature Boundary

Actor: authenticated Mingla mobile user.
Trigger: user opens a Mingla Plus paywall.
Expected path: mobile app configures RevenueCat -> fetches current offering -> receives weekly/monthly/annual packages -> user buys/restores -> RevenueCat entitlement activates -> app syncs Mingla Plus subscription state.

## Historical Evidence

- `Mingla_Artifacts/MASTER_BUG_LIST.md` registers ORCH-0752 as RevenueCat store products/offering configuration warnings.
- `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md` records iOS `READY_TO_SUBMIT` product warnings and Android Play Store product/offering warnings as separate from ORCH-0749.
- `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` records Android `PurchasesError(code=ConfigurationError)` saying no Play Store products are registered in the RevenueCat dashboard for offerings.
- `Mingla_Artifacts/reports/RETEST_ORCH-0751_REVENUECAT_LOGOUT_SERIALIZATION.md` keeps the Play Store offerings configuration error outside ORCH-0751.

## Current App-Side Identifiers

### RevenueCat SDK keys

Evidence: `app-mobile/src/services/revenueCatService.ts:16-20`.

- The app selects a platform-specific public RevenueCat SDK key through `Platform.select`.
- iOS uses an `appl_...` key.
- Android uses a `goog_...` key.
- Full keys are intentionally not reproduced in this report.

### RevenueCat entitlements

Evidence: `app-mobile/src/services/revenueCatService.ts:22-26`.

- Current paid entitlement expected by app code: `Mingla Plus`.
- Legacy entitlements still recognized for backward compatibility: `Mingla Pro`, `Mingla Elite`.

Dashboard implication: every active subscription product that should unlock paid Mingla features must be attached to `Mingla Plus` in RevenueCat. Legacy entitlements should not be renamed unless a later migration/spec deliberately handles existing subscribers.

### Offering/package behavior

Evidence:

- `app-mobile/src/services/revenueCatService.ts:242-244` calls `Purchases.getOfferings()` and returns `offerings.current`.
- `app-mobile/src/components/CustomPaywallScreen.tsx:93-95` reads `useOfferings(isVisible)` and purchase/restore hooks.
- `app-mobile/src/components/CustomPaywallScreen.tsx:124-130` uses `offering?.availablePackages ?? []` and purchases the selected package or first available package.
- `app-mobile/src/components/CustomPaywallScreen.tsx:67-73` only uses package identifiers to label period text.

The app does **not** locally choose product IDs for purchase. It buys a `PurchasesPackage` returned by RevenueCat.

Recognized package labels:

- `$rc_annual` or identifiers containing `annual` / `yearly`
- `$rc_monthly` or identifiers containing `monthly`
- `$rc_weekly` or identifiers containing `weekly`
- `$rc_lifetime` or identifiers containing `lifetime`

### App bundle/package identity

Evidence:

- `app-mobile/app.json:16-18`: iOS bundle identifier is `com.mingla.app.v2`.
- `app-mobile/app.json:34-43`: Android package is `com.mingla.app.v2`.
- `app-mobile/google-services.json:10-12`: Firebase Android app is also `com.mingla.app.v2`.

Dashboard implication: RevenueCat, App Store Connect, Play Console, and Google service credentials must all point at the same mobile identity: `com.mingla.app.v2`.

### Product IDs

Local source search found no active app-mobile purchase-flow references to:

- `mingla_plus_weekly`
- `mingla_plus_monthly`
- `mingla_plus_annual`

Those product IDs appear in runtime RevenueCat logs and artifacts, not as local product selection logic. That means changing app code is not the first fix unless dashboard verification later proves the app is using the wrong RevenueCat project/key.

## Platform Findings

### Finding 1: Android offerings are missing Play Store products in RevenueCat

Classification: confirmed external configuration bug

- **File/line:** `app-mobile/src/services/revenueCatService.ts:16-20`, `app-mobile/src/services/revenueCatService.ts:242-244`, runtime evidence in ORCH-0751 QA reports.
- **Current behavior:** Android uses a Google/Play RevenueCat key and asks for current offerings. Runtime logs report that no Play Store products are registered in the RevenueCat dashboard for the offerings.
- **Expected behavior:** RevenueCat current offering returns packages containing Android Play products for weekly/monthly/annual Mingla Plus subscriptions.
- **Causal chain:** Android SDK key -> RevenueCat Android app/project -> current offering -> packages -> Play Store products. The chain breaks at RevenueCat offering/product configuration or Play Store product availability, not at local product ID selection.
- **Verification step:** after dashboard/store fixes, open Android paywall in an internal test build and confirm no `ConfigurationError`, packages render, purchase/restore smoke works for a license tester.

### Finding 2: iOS products are not approved/available in App Store Connect

Classification: confirmed external launch-readiness bug

- **File/line:** product IDs are not selected in app code; runtime evidence in ORCH-0749 QA logs.
- **Current behavior:** RevenueCat warns that configured iOS products are still `READY_TO_SUBMIT`.
- **Expected behavior:** App Store Connect products/subscriptions are approved and available for sale before production purchase readiness.
- **Causal chain:** RevenueCat offering can reference iOS products, but App Store Connect product status prevents a production-ready purchase surface.
- **Verification step:** App Store Connect products show an approved/available state, then iOS dev/TestFlight paywall fetches packages without RevenueCat health warnings.

### Finding 3: Entitlement mapping must be dashboard-verified

Classification: open question with high launch impact

- **File/line:** `app-mobile/src/services/revenueCatService.ts:22-26`.
- **Current behavior:** app checks `Mingla Plus` as the active paid entitlement, while legacy IDs remain backward-compatible.
- **Expected behavior:** all active weekly/monthly/annual products for both stores unlock `Mingla Plus`.
- **Causal chain:** even if packages display and purchases succeed, users will not unlock paid features if products are not attached to the entitlement the app checks.
- **Verification step:** RevenueCat dashboard confirms each iOS and Android paid product is attached to `Mingla Plus`; tester purchase activates that entitlement in CustomerInfo and Mingla sync resolves `mingla_plus`.

### Finding 4: Paywall failure handling is operator-quiet, not user-helpful

Classification: production-hardening gap, not root cause

- **File/line:** `app-mobile/src/hooks/useRevenueCat.ts:37-49`, `app-mobile/src/hooks/useRevenueCat.ts:104-122`, `app-mobile/src/components/CustomPaywallScreen.tsx:124-132`.
- **Current behavior:** known offerings configuration errors are converted to `null`, and the paywall eventually has no packages.
- **Expected behavior:** for production, store configuration should be fixed. For development/operator QA, the app could make the exact configuration reason more visible in dev-only logs or tests.
- **Causal chain:** current guard prevents React Query from hard-failing, but it does not make an incomplete dashboard setup actionable in the UI.
- **Verification step:** only consider app-code hardening after RevenueCat/App Store/Play setup is corrected. If the dashboard is fixed and users still see no packages, write a narrow spec for paywall error surfacing and a regression test.

## Official Documentation Cross-Check

RevenueCat's product setup model matches the app's current design: products are what users buy, entitlements are what unlock access, and offerings group products for display. RevenueCat's docs describe the flow as product -> entitlement -> app checks entitlement, and say production products must be configured in the real stores then imported into RevenueCat.

RevenueCat's offerings docs also match this app's approach: an offering contains packages, packages group equivalent products across platforms, and the default offering is returned as `current` from `getOfferings`.

RevenueCat's entitlement docs warn that products must be attached to entitlements, otherwise a purchase may not unlock promised content.

RevenueCat's Google Play credential docs add a separate Android dependency: RevenueCat needs Play service credentials and the right Play Console permissions, and new credentials can take time to validate.

Apple's App Store Connect docs define `Ready to Submit` as metadata complete but not yet submitted for review, while `Approved` means Apple has approved the In-App Purchase to go live with its associated app.

Google Play's subscription docs say base plans must be activated to be available to users.

## Operator Checklist

### RevenueCat dashboard

1. Confirm the project contains separate iOS and Android apps for `com.mingla.app.v2`.
2. Confirm the iOS app uses the public `appl_...` SDK key currently selected by the app.
3. Confirm the Android app uses the public `goog_...` SDK key currently selected by the app.
4. Confirm the current/default offering is the intended production offering, likely `default`.
5. Confirm the offering contains packages for weekly, monthly, and annual plans.
6. Confirm each package contains equivalent iOS and Android products where applicable.
7. Confirm RevenueCat products exist/import correctly for:
   - `mingla_plus_weekly`
   - `mingla_plus_monthly`
   - `mingla_plus_annual`
8. Confirm those products attach to entitlement `Mingla Plus`.
9. Confirm legacy entitlements `Mingla Pro` and `Mingla Elite` remain only for backward compatibility unless intentionally active.
10. Run RevenueCat product/offering health checks until the iOS and Android warnings disappear.

### App Store Connect

1. Confirm bundle identifier `com.mingla.app.v2`.
2. Confirm subscription group and products exist for weekly/monthly/annual Mingla Plus.
3. Move products out of `READY_TO_SUBMIT` by submitting them for review with the correct app version or according to the current App Store Connect workflow.
4. Confirm each product has required metadata, pricing, localization, availability, and review assets.
5. Confirm final product state is approved/available for sale before calling iOS purchases launch-ready.

### Google Play Console

1. Confirm Android package `com.mingla.app.v2`.
2. Confirm subscriptions and base plans exist for weekly/monthly/annual Mingla Plus.
3. Activate required base plans/offers and confirm country/region availability.
4. Confirm the app build used for testing is available through internal/closed/production testing as appropriate.
5. Confirm tester account is licensed/eligible for sandbox purchase testing.
6. Confirm RevenueCat's Play service account is added to the Play app and has the required permissions.
7. Upload/save the correct Play service account JSON in RevenueCat and allow for validation delay if newly created.

## Do We Need App-Code Work?

Not yet.

The first fix path is dashboard/store configuration. The app already follows the recommended pattern: fetch RevenueCat's current offering and purchase the returned package. Local evidence does not show an app-side product ID mismatch.

Possible later app-code work, only if config fixes do not clear the issue:

- Add `no play store products registered` to `isRevenueCatOfferingsConfigError` for clearer classifier coverage.
- Add a dev-only/operator-visible paywall setup warning when `offering` is null because of a configuration error.
- Add a repo-running static test that preserves platform key selection, current offering usage, and `Mingla Plus` entitlement checks.

Those are hardening improvements, not the root fix for empty/misconfigured offerings.

## Required Tester Verification

### iOS

1. Build/run a dev client or TestFlight build for `com.mingla.app.v2`.
2. Sign in with a test user.
3. Open every Mingla Plus paywall entry point.
4. Confirm weekly/monthly/annual packages display with prices.
5. Confirm no RevenueCat warning about `READY_TO_SUBMIT` products.
6. Complete sandbox purchase or restore if purchases are in launch scope.
7. Confirm CustomerInfo has active `Mingla Plus`.
8. Confirm app subscription state syncs to Mingla Plus.

### Android

1. Build/run an internal test build for `com.mingla.app.v2`.
2. Sign in with a Google license tester.
3. Open every Mingla Plus paywall entry point.
4. Confirm weekly/monthly/annual packages display with prices.
5. Confirm no `PurchasesError(code=ConfigurationError)` and no "no Play Store products registered" message.
6. Complete sandbox purchase or restore if purchases are in launch scope.
7. Confirm CustomerInfo has active `Mingla Plus`.
8. Confirm app subscription state syncs to Mingla Plus.

## Severity

- **S1 high** if Mingla Plus subscriptions are required for launch or App Review/TestFlight purchase testing.
- **S2 medium** if paid features are explicitly deferred and the paywall is hidden from production users until store setup is complete.

Do not call subscriptions launch-ready until both stores pass the tester verification above.

## Non-Goals

- No purchase UX redesign.
- No entitlement rename.
- No RevenueCat logout/auth cleanup changes.
- No Supabase subscription schema/RLS changes.
- No App Store Connect, Play Console, or RevenueCat dashboard mutation from Codex.
- No code patch until dashboard/store evidence proves code drift.

## Sources

- RevenueCat offerings overview: https://www.revenuecat.com/docs/offerings/overview
- RevenueCat entitlements: https://www.revenuecat.com/docs/getting-started/entitlements
- RevenueCat configuring products: https://www.revenuecat.com/docs/projects/configuring-products
- RevenueCat Google Play service credentials: https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials
- Apple App Store Connect In-App Purchase statuses: https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-statuses/
- Google Play subscriptions/base plans: https://support.google.com/googleplay/android-developer/answer/140504
