# IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Sub-scope:** Sub-B Android runtime rework after QA failure  
**Implementor:** Codex `implementor-mingla`  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`  
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`  
**Baseline under rework:** `c9741eb52`  
**Required preserved commit:** `411925909` preserved (`git merge-base --is-ancestor 411925909 HEAD` PASS)

## Verdict

**IMPLEMENTED WITH ANDROID RETEST REQUIRED.**

The Android startup graph no longer includes the real Stripe Connect web SDK packages. The likely startup-freeze trigger from QA was the Expo Router native graph evaluating web-only Connect routes that imported `@stripe/react-connect-js` and `@stripe/connect-js`; those packages are browser/DOM-facing and aligned with the prior Android log warning, `[ReferenceError: Property 'document' doesn't exist]`.

I moved the real Stripe Connect Embedded Components pages to `.web.tsx`, replaced the native route entrypoints with a React Native fallback, and added a native Metro resolver stub for the Stripe Connect web packages. Automated regression and Android export checks pass. The refreshed Android live-fire evidence is included, but the last emulator run was blocked by `10.0.2.2:8097` Metro connectivity/system UI instability rather than the previous bundled JS path; route back to tester for Sub-B Android retest before Sub-C.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry before other work. Relevant open WARN entries addressed to ALL were already acknowledged for this Sub-B line and were factored into the rework:

- COMMS-0002 - backend strict-grep warning; no backend files touched.
- COMMS-0003 - external API docs gate; no Stripe API endpoint, payload, enum, or account-controller semantics changed. This rework only isolates Stripe web SDK module resolution from native Android bundling.
- COMMS-0004 - intake collision SOP; not applicable to this targeted implementation.

## Inputs Read

- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_REPORT.md`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-logcat-excerpt.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-*.png`
- Current Sub-B implementation at `3414ea6b8`, tester adversarial commit `411925909`, and QA report commit `c9741eb52`

## Root Cause

The app had three route files documented as web-only Stripe Connect Embedded Components pages:

- `mingla-business/app/connect-onboarding.tsx`
- `mingla-business/app/connect-account-management.tsx`
- `mingla-business/app/connect-tax-registrations/index.tsx`

Even though users reach these through hosted web or browser flows, Expo Router still includes route modules in the native graph. On Android, that allowed the real Stripe Connect web packages to enter the bundle and made a DOM-dependent SDK visible during native startup. That matched QA's Android runtime symptom: React bootstrap/auth starts, then native UI never becomes usable and logcat reports `document` is missing.

## Files Changed

| File | Change |
|---|---|
| `mingla-business/app/connect-onboarding.tsx` | Native-safe fallback route only. |
| `mingla-business/app/connect-account-management.tsx` | Native-safe fallback route only. |
| `mingla-business/app/connect-tax-registrations/index.tsx` | Native-safe fallback route only. |
| `mingla-business/app/connect-onboarding.web.tsx` | Real Stripe Connect onboarding web page preserved. |
| `mingla-business/app/connect-account-management.web.tsx` | Real Stripe Connect account-management web page preserved. |
| `mingla-business/app/connect-tax-registrations/index.web.tsx` | Real Stripe Connect tax-registration web page preserved. |
| `mingla-business/src/components/stripe/NativeConnectWebOnlyFallback.tsx` | Shared native fallback UI with back/account navigation. |
| `mingla-business/src/shims/stripeConnectNativeStub.js` | Native stub for Stripe Connect web packages. |
| `mingla-business/metro.config.js` | Native resolver maps `@stripe/connect-js` and `@stripe/react-connect-js` to the stub when `platform !== "web"`. |
| `mingla-business/__tests__/androidWebOnlyConnectRoutes.test.ts` | Regression coverage for native route safety, web route preservation, and Metro native aliasing. |

## Regression Coverage

`mingla-business/__tests__/androidWebOnlyConnectRoutes.test.ts` would have failed before this rework because:

- the base native startup routes imported `@stripe/react-connect-js` / `@stripe/connect-js`;
- no native Stripe Connect shim existed;
- Metro did not alias the Connect web packages away from native Android bundling;
- duplicate `.native.tsx` route entries would have remained possible if the first attempted approach had stayed in place.

The test now asserts:

- native route files do not import Stripe Connect web SDKs or raw DOM tags;
- `.web.tsx` route files still keep the real Stripe Connect web implementation;
- native Metro resolution returns the local `stripeConnectNativeStub.js`;
- web Metro resolution does not return the native stub.

## Verification

| Gate | Command | Result |
|---|---|---|
| Focused Sub-B + new regression + venue claim regression | `npx jest --runInBand __tests__/androidWebOnlyConnectRoutes.test.ts __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx src/services/__tests__/venueClaimService.test.ts` from `mingla-business/` | PASS - 4 suites, 16 tests |
| Android dev export | `npx expo export --platform android --dev --output-dir /tmp/mingla-business-android-export-after3` from `mingla-business/` | PASS - Android bundle emitted |
| Android export real Stripe package guard | `rg` against `/tmp/mingla-business-android-export-after3/_expo/static/js/android/index-d41d8cd98f00b204e9800998ecf8427e.js` | PASS - `node_modules/@stripe/react-connect-js 0`, `node_modules/@stripe/connect-js 0`, `src/shims/stripeConnectNativeStub.js 1`, `__minglaNativeStub 1` |
| Required commit preserved | `git merge-base --is-ancestor 411925909 HEAD` | PASS |
| Hard forbidden-path guard | `git diff --name-only fee178634..HEAD \| rg '(^supabase/|^\\.github/scripts/strict-grep/meta-orch-0972-|PublicBrandPage|publicEventsService|ExperienceMiniCard|useUpcomingFeed|EventMiniCard|TripMiniCard)'` | PASS - empty output |
| DB / edge / strict-grep touch guard | `git diff --name-only fee178634..HEAD -- supabase .github/scripts/strict-grep` | PASS - empty output |
| Brand.kind reintroduction guard | `git diff --unified=0 fee178634..HEAD -- mingla-business mingla-admin \| rg '^\\+.*(Brand\\.kind|brand\\.kind|currentBrand\\.kind)'` | PASS - empty output |

## Refreshed Android Evidence

New evidence produced during this rework:

- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-logcat-initial.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-after-initial-export.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-warm-launch.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-warm-launch-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-post-stub-home.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-after-stub-launch.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-after-stub-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-rework-export-grep-after-stub.txt`

The post-stub export evidence is the strongest code-level proof: the Android bundle no longer contains the real Stripe Connect web package module paths and contains the native stub instead.

The final live-fire attempt did not produce a clean Android PASS. Logcat shows repeated dev-client failure to fetch the bundle from Metro:

- `URL: http://10.0.2.2:8097/index.bundle?...`
- `failed to connect to /10.0.2.2 (port 8097) ... after 5000ms`
- later System UI ANRs followed the dev-client error loop.

That remaining live-fire blocker is different from the original suspected JS startup path. Tester should retest on a fresh/stable Android runner before approving Sub-B.

## Constraints Held

- No DB, migration, or edge-function files changed.
- No forbidden public-page files changed.
- No META-ORCH-0972 strict-grep scripts changed.
- No `Brand.kind`, `brand.kind`, or `currentBrand.kind` reintroduced.
- No Sub-A rewrite was performed.
- Stripe web behavior is preserved in `.web.tsx`; native Android only receives a fallback route and no real Stripe Connect web SDK.

## Downstream Routing

Route to `tester-mingla` for Sub-B Android retest. Do not dispatch Sub-C until Android dev-client live-fire passes from a stable runner and the tester verifies no `document` ReferenceError or real Stripe Connect web SDK package path appears in Android startup evidence.
