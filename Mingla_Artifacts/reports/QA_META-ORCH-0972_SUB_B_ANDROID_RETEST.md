# QA_META-ORCH-0972_SUB_B_ANDROID_RETEST

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Sub-scope:** Sub-B Android dev-client live-fire retest after Android rework  
**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`  
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`  
**Mode:** RETEST

## Verdict

**FAIL - do not dispatch Sub-C.**

The Android rework removed the originally suspected web-only Stripe Connect startup path: the Android export no longer contains `@stripe/react-connect-js` or `@stripe/connect-js`, the native stub is present, and the refreshed Android logcat did not reproduce `Property 'document' doesn't exist`.

Android still fails the live-fire release gate. The Pixel 8 Pro dev-client reached React bootstrap and authenticated session recovery, but it also produced ANR dialogs and never reached a clean, usable authenticated Home/Hub state. The best screenshot shows authenticated Home behind a `System UI isn't responding` dialog, stuck on `Loading brands`; this does not satisfy the required "authenticated Home/Hub and no startup freeze/ANR" condition.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before other work. Relevant open WARN entries addressed to ALL were acknowledged for this retest and factored in:

- COMMS-0002 - backend strict-grep warning; no backend, migration, or edge files touched.
- COMMS-0003 - external API docs gate; no external API endpoint, enum, payload, or provider contract changed by this tester retest.
- COMMS-0004 - intake collision SOP; not applicable to this targeted retest.

## Inputs

- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK.md`
- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_REPORT.md`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`
- Current worktree at branch `meta-orch-0972-brand-kind-decommission-universal-features`

## Automated / Source Verification

| Gate | Command | Result |
|---|---|---|
| Focused Sub-B regression suite | `npx jest --runInBand __tests__/androidWebOnlyConnectRoutes.test.ts __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx src/services/__tests__/venueClaimService.test.ts` from `mingla-business/` | PASS - 4 suites, 16 tests |
| Android dev export | `npx expo export --platform android --dev --output-dir /tmp/mingla-business-android-export-retest` from `mingla-business/` | PASS - bundle emitted |
| Android export Stripe Connect guard | `rg` counts against `/tmp/mingla-business-android-export-retest/_expo/static/js/android/index-d41d8cd98f00b204e9800998ecf8427e.js` | PASS - `node_modules/@stripe/react-connect-js` 0, `node_modules/@stripe/connect-js` 0, `src/shims/stripeConnectNativeStub.js` 1, `__minglaNativeStub` 1 |
| Required adversarial commit preserved | `git merge-base --is-ancestor 411925909 HEAD` | PASS |
| DB / edge / strict-grep guard | `git diff --name-only fee178634 -- supabase .github/scripts/strict-grep` | PASS - empty output |
| Forbidden public-page guard | `git diff --name-only fee178634 \| rg '(^supabase/|^\.github/scripts/strict-grep/meta-orch-0972-|PublicBrandPage|publicEventsService|ExperienceMiniCard|useUpcomingFeed|EventMiniCard|TripMiniCard)'` | PASS - empty output |
| Brand.kind reintroduction guard | `git diff --unified=0 fee178634 -- mingla-business mingla-admin \| rg '^\+.*(Brand\.kind|brand\.kind|currentBrand\.kind)'` | PASS - empty output |

## Android Live-Fire Evidence

Fresh evidence written during this retest:

- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-launch.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-after-wait.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-mainactivity.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-mainactivity-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-expo-a.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-expo-a-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-post-bundle.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-post-bundle-logcat.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-after-anr-wait.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-final-after-anr-wait-logcat.txt`

Key observations:

- Expo launched the dev-client on `Pixel_8_Pro` using `exp+mingla-business://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8097`.
- Metro completed the Android bundle after `91245ms` for `index.js (3204 modules)`.
- Logcat later showed `Running "main"` and `[auth] auth-event { event: 'INITIAL_SESSION', hasSession: true, hasUser: true }`.
- Logcat search found no `Property 'document' doesn't exist`, `document doesn't exist`, or `ReferenceError` hits in the final Android evidence.
- The screen still showed ANR dialogs:
  - `android-retest-final-expo-a.png`: `Process system isn't responding`.
  - `android-retest-final-post-bundle.png`: `Process system isn't responding`.
  - `android-retest-final-after-anr-wait.png`: authenticated Home visible behind `System UI isn't responding`, stuck at `Loading brands`.
- Logcat contains `ANR in com.sethogieva.minglabusiness` and later input/System UI ANR entries. The emulator then disconnected before a second wait cycle could prove recovery to usable Home/Hub.

## Findings

### P1 - Android dev-client still fails the no-freeze/no-ANR live-fire gate

**Evidence:** `android-retest-final-after-anr-wait.png`, `android-retest-final-after-anr-wait-logcat.txt`, `android-retest-final-post-bundle-logcat.txt`.

Android did not reproduce the old `document` crash, but it still produced ANR dialogs during startup. The app reached authenticated Home only behind a blocking system ANR dialog and remained on `Loading brands`; Hub was not reachable and the emulator disconnected before a clean recovery could be observed. This fails the requested gate: authenticated Home/Hub must be reachable and the document startup freeze/ANR must not reproduce.

### P2 - Android startup emits an unrelated Stripe native React warning/error

**Evidence:** Metro output during final Android launch reported `ERROR forwardRef render functions accept exactly two parameters... Code: StripeNativeProvider.tsx` with the stack through `@stripe/stripe-react-native`.

This is not the prior web Connect `document` failure, and it did not stop auth bootstrap from running. It is still Android startup error noise on the payment provider path and should be reviewed during the next Android rework or a follow-up payment-native cleanup.

## What Passed

- The original suspected `document` crash path is not present in refreshed Android evidence.
- Android export proves the real Stripe Connect web SDK packages are not in the Android bundle and the native stub is present.
- Focused regression tests pass.
- Hard constraints held: no DB/migrations/edge, no forbidden public-page files, no META-ORCH-0972 strict-grep script touch, no `Brand.kind` / `brand.kind` / `currentBrand.kind` reintroduction, and no Sub-A rewrite.

## What Remains Unverified

- A clean Android dev-client session reaching authenticated Home and Hub without ANR.
- Android navigation from Home to Hub after authenticated brand loading completes.
- Android absence of startup ANR on a stable runner after any next rework.

## Required Next Step

Route back to `implementor-mingla` for bounded Android rework. Do not dispatch Sub-C until tester can capture Android screenshots/logcat showing:

1. Dev-client launch from the META-ORCH-0972 worktree.
2. Authenticated Home rendered without ANR dialogs.
3. Hub reachable and rendered without ANR dialogs.
4. No `document` ReferenceError and no real Stripe Connect web SDK package path in Android startup/export evidence.
