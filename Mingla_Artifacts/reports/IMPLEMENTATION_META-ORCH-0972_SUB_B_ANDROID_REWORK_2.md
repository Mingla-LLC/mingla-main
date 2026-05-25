# IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK_2

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Sub-scope:** Sub-B Android rework #2
**Implementor:** Codex `implementor-mingla`
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Baseline:** `c9741eb52`

## 1. Verdict

**IMPLEMENTED WITH ANDROID RETEST REQUIRED.**

Android Home and Hub now render on the Pixel_8_Pro dev-client path without ANR dialogs and without the `Loading brands` stall. The bounded fix was to remove native Stripe provider evaluation from the root app shell and scope it to lazy checkout payment boundaries.

## 2. Comms Ledger Ack

- COMMS-0002 — acknowledged as `implementor+codex`; no backend, DB, migration, edge, or RLS files were touched.
- COMMS-0003 — acknowledged as `implementor+codex`; N/A because no external API contract or SDK version was changed.
- COMMS-0004 — acknowledged as `implementor+codex`; N/A because this rework did not alter intake or cross-ORCH shared intake surfaces.

## 3. Inputs Read

- `Mingla_Artifacts/prompts/IMPLEMENTOR_META-ORCH-0972_SUB_B_ANDROID_REWORK_2.md`
- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_ANDROID_RETEST.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK.md`
- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_REPORT.md`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-after-anr-wait-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-post-bundle-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-expo-a-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-after-anr-wait.png`

## 4. Root Cause Analysis

**Proven blocker: §3.2 root-layout `StripeProviderWrapper.native` cold initialization on the post-auth startup path.**

The original Android evidence showed the app entering an ANR before it could become usable: `android-retest-final-post-bundle-logcat.txt:4805` logged `Skipped 2120 frames`, and `android-retest-final-post-bundle-logcat.txt:5129-5134` logged `ANR in com.sethogieva.minglabusiness` for PID `4295`. The later raw tail proved React and auth were alive but the Stripe native SDK was still evaluating on startup: `android-retest-final-after-anr-wait-logcat.txt:11224` logged `Running "main"`, `:12096-12097` logged `StripePushProvisioning dependency not found` plus the Stripe `forwardRef` warning, `:12476-12501` logged auth bootstrap through `INITIAL_SESSION hasUser: true`, and `:12513` logged `StripeResponse` verification. That sequence matches root provider/module evaluation, not a Home-only data fan-out.

The source path matched the logs: before this rework, `mingla-business/app/_layout.tsx` imported and mounted `StripeProviderWrapper` above the navigation tree, which evaluates `StripeProviderWrapper.native.tsx`, `@mingla/payments-native`, and `@stripe/stripe-react-native` on every native startup. The fix removes that provider from root and makes checkout payment routes lazy-load `NativeCheckoutPaymentBoundary`; the native boundary owns `useNativeCheckoutFlow` plus `StripeProviderWrapper`, so Home/Hub do not evaluate the payment SDK. Final logcat confirms the exact Stripe startup signatures are absent: `android-rework2-logcat-grep.txt` shows `forwardRef`, `StripeResponse`, `StripePushProvisioning`, `ReferenceError`, `document`, `Loading brands`, and `ANR in com.sethogieva.minglabusiness` all at count `0`.

## 5. Files Changed

| File | Change |
|---|---|
| `mingla-business/app/_layout.tsx` | Removed root `StripeProviderWrapper` import/mount so the app shell can commit Home without initializing the native payment SDK. |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | Replaced static native checkout imports with a lazy `NativeCheckoutPaymentBoundary` wrapper and passed `nativeCheckout` into the existing payment screen content. |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | Mirrored the event checkout lazy boundary for trip checkout payment parity. |
| `mingla-business/src/payments/NativeCheckoutPaymentBoundary.native.tsx` | Added the native route-scoped boundary that mounts `StripeProviderWrapper` and supplies `useNativeCheckoutFlow`. |
| `mingla-business/src/payments/NativeCheckoutPaymentBoundary.tsx` | Added the web-safe boundary/type surface; web continues to use the hosted checkout branch. |
| `mingla-business/src/payments/StripeProviderWrapper.native.tsx` | Updated comments to document route-scoped native payment ownership. |
| `mingla-business/src/payments/StripeProviderWrapper.tsx` | Updated comments to match route-scoped checkout ownership. |
| `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | Updated comments to clarify this hook is imported by checkout boundaries, not root startup. |
| `mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts` | Updated parity assertions for route-scoped native PaymentSheet ownership. |
| `mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` | Updated root-layout assertion now that `KeyboardRoot` is no longer nested inside the Stripe provider. |
| `mingla-business/__tests__/androidRootStripeProviderIsolation.test.ts` | Added the rework #2 regression test proving root isolation and checkout-scoped native Stripe ownership. |

## 6. Regression Coverage

New regression:

```bash
cd mingla-business && npx jest --runInBand __tests__/androidRootStripeProviderIsolation.test.ts
```

Pre-fix result at the original baseline behavior: **FAIL** — root layout still imported/mounted `StripeProviderWrapper`, and checkout payment routes did not own a scoped provider wrapper.

HEAD result: **PASS**.

Required annotation is in `mingla-business/__tests__/androidRootStripeProviderIsolation.test.ts`:

```text
fails-on-revert verified at c9741eb52: root layout still imported and
mounted StripeProviderWrapper, while checkout payment routes did not own a
scoped provider wrapper.
```

## 7. Verification Gates

| Gate | Command | Result |
|---|---|---|
| Focused Sub-B + rework Jest suite | `cd mingla-business && npx jest --runInBand __tests__/androidRootStripeProviderIsolation.test.ts __tests__/androidWebOnlyConnectRoutes.test.ts __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx src/services/__tests__/venueClaimService.test.ts src/payments/__tests__/native_checkout_flow_parity.test.ts src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` | PASS — 7 suites, 30 tests. `KeyboardRoot.adversarial.test.tsx` emitted its existing TA-1 web-export prerequisite warning and still passed. |
| Android dev export | `cd mingla-business && rm -rf /tmp/mingla-business-android-export-rework2-final && npx expo export --platform android --dev --output-dir /tmp/mingla-business-android-export-rework2-final` | PASS — Android bundled in 46070ms, 3207 modules, export written to `/tmp/mingla-business-android-export-rework2-final`. |
| Export grep receipt | `rg` counts recorded in `android-rework2-export-grep.txt` | PASS WITH NOTE — native Connect stub is present once and runtime live-fire is clean. Dev bundle string counts still include web Connect/Stripe module names because Expo Router dev export retains route module records and source/module labels; final logcat proves those modules are not evaluated on Home/Hub startup. |
| Adversarial commit preserved | `git merge-base --is-ancestor 411925909 HEAD && echo PASS` | PASS. |
| Forbidden path guard | `git diff --name-only fee178634 -- \| rg '(^supabase/\|^\\.github/scripts/strict-grep/meta-orch-0972-\|PublicBrandPage\|publicEventsService\|ExperienceMiniCard\|useUpcomingFeed\|EventMiniCard\|TripMiniCard)'` | PASS — empty output. |
| DB / edge / strict-grep touch guard | `git diff --name-only fee178634 -- supabase .github/scripts/strict-grep` | PASS — empty output. |
| Brand.kind reintroduction guard | `git diff --unified=0 fee178634 -- mingla-business mingla-admin \| rg '^\\+.*(Brand\\.kind\|brand\\.kind\|currentBrand\\.kind)'` | PASS — empty output. |
| Package version guard | `git diff --name-only c9741eb52 -- mingla-business/package.json mingla-business/package-lock.json package.json package-lock.json yarn.lock pnpm-lock.yaml` | PASS — empty output. |
| Metro rework #2 guard | Source review plus final diff | PASS WITH NOTE — this rework did not modify `mingla-business/metro.config.js`; the already-present native Connect alias from the prior Android rework remains intact. |

## 8. Refreshed Android Evidence

Evidence folder: `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`

| File | Observation |
|---|---|
| `android-rework2-emulator-name.txt` | Pixel_8_Pro AVD, `emulator-5554`, Android 15, physical size `1344x2992`, dev-client URL via `10.0.2.2:8097`. |
| `android-rework2-launch.png` | Dev-client launch captured on the Pixel_8_Pro AVD. |
| `android-rework2-auth.png` | Authenticated Home rendered for `Travel Brand`; no ANR dialog and no `Loading brands` stall. |
| `android-rework2-home-clean.png` | Same clean authenticated Home state retained for tester convenience. |
| `android-rework2-hub.png` | Hub reachable; Trips tab and secondary filters visible; no ANR dialog. |
| `android-rework2-logcat-full.txt` | Full logcat from launch through Hub capture. |
| `android-rework2-logcat-grep.txt` | Focused grep receipt: `ANR`, `Input dispatching timed out`, `document`, `ReferenceError`, Stripe `forwardRef`, `StripeResponse`, `StripePushProvisioning`, and `Loading brands` all count `0`; `INITIAL_SESSION hasSession: true, hasUser: true` at line `1014`; max 3-digit skipped-frame window is `171`, inside the prompt tolerance. |
| `android-rework2-export-grep.txt` | Android dev export string-count receipt. |

Key final logcat lines:

- `android-rework2-logcat-full.txt:929` — `Running "main"` with Fabric.
- `android-rework2-logcat-full.txt:997-1014` — auth bootstrap through `INITIAL_SESSION hasSession: true, hasUser: true`.
- `android-rework2-logcat-full.txt:344` — only 3-digit skipped-frame window, `171` frames.

## 9. Constraints Held Checklist

- No DB, migration, Supabase edge function, RLS, or backend file changes.
- No `PublicBrandPage.tsx`, `publicEventsService.ts`, `ExperienceMiniCard`, `useUpcomingFeed`, `EventMiniCard`, or `TripMiniCard` changes.
- No META-ORCH-0972 strict-grep script changes.
- No `Brand.kind`, `brand.kind`, or `currentBrand.kind` reintroduction in business/admin diffs since `fee178634`.
- No Sub-A rewrites.
- No `@stripe/*` or other payment SDK version bumps.
- No rework #2 change to `metro.config.js`; the prior native Connect alias remains intact.
- `git merge-base --is-ancestor 411925909 HEAD` remains PASS.
- Changes stay in `mingla-business/` plus `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/` and this implementation report.

## 10. Downstream Routing

Return control to Claude `mingla-orchestrator` for REVIEW of this implementation report, code diff, and Android evidence. After orchestrator review, route to Claude `mingla-tester` for Android retest #2 on a fresh AVD. Sub-C remains blocked until tester independently captures clean authenticated Home to Hub Android evidence without ANR and without the `Loading brands` stall.
