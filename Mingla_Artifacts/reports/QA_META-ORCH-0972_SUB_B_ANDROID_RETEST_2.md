# QA Report: META-ORCH-0972 Sub-B Android Retest 2

> Date: 2026-05-25
> Mode: RETEST
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:1 P3:0 P4:3

## 1. Layman Summary

Sub-C remains blocked. Rework #2 successfully moved native Stripe out of the root startup graph at the source/test/export level, and the fresh Pixel 7 AVD reached the unauthenticated login screen without Stripe/document/ANR log signatures. The authenticated Pixel 8 Pro live-fire still produced a blocking Android "Process system isn't responding" dialog while Home was visible, and Hub could not be reached; that fails the requested no-ANR clean Home-to-Hub gate.

## 2. Inputs Reviewed

- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK_2.md`
- `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_SUB_B_ANDROID_REWORK_2.md`
- `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_ANDROID_RETEST.md`
- Raw rework #2 evidence under `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`, especially `android-rework2-emulator-name.txt`, `android-rework2-auth.png`, `android-rework2-hub.png`, `android-rework2-logcat-grep.txt`, and `android-rework2-logcat-full.txt`
- Current worktree `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`

## 3. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Commit `411925909` remains preserved | `git merge-base --is-ancestor 411925909 HEAD && echo PASS` | PASS | HEAD before tester commit was `19adf8004`; after tester test commit, `411925909` still remains an ancestor. |
| Focused 7-suite Jest gate is green | `npx jest --runInBand ...` required 7 suites | PASS | 7 suites passed, 30 tests passed. `KeyboardRoot.adversarial.test.tsx` emitted its existing web-export prerequisite warning and still passed. |
| Tester-owned adversarial regression exists and passes | `mingla-business/__tests__/androidRootStripeTransitiveGraph.adversarial.test.ts` | PASS | New test attacks native root transitive import graph, not only direct root strings. Test commit: `39b59a36f`. |
| Implementor regression fails on revert | Baseline probe against `c9741eb52` | PASS | Expected fail: root layout contained `StripeProviderWrapper`; event/trip checkout lacked `NativeCheckoutPaymentBoundary`; both imported `nativeCheckoutFlow` directly. |
| Android dev export passes | `npx expo export --platform android --dev --output-dir /tmp/mingla-business-android-export-retest2` | PASS | Android bundled 3134 modules and exported successfully. |
| Android Connect SDK absent from produced bundle package paths | `android-retest2-export-grep.txt` | PASS WITH NOTE | `node_modules/@stripe/react-connect-js=0`, `node_modules/@stripe/connect-js=0`, stub path and `__minglaNativeStub` each `1`. Loose source-label strings remain (`@stripe/react-connect-js=5`, `@stripe/connect-js=3`). |
| Fresh non-Pixel AVD startup is clean | New `META_ORCH_0972_Pixel_7_API35` AVD, wiped data | PARTIAL | Clean unauthenticated login reached. No persisted auth means Home/Hub could not be tested there. |
| Authenticated Android Home and Hub are clean with no ANR | Existing Pixel 8 Pro AVD with stored session | FAIL | Home rendered behind a blocking Android "Process system isn't responding" dialog; Hub tap was blocked by the same dialog. |

## 4. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Hard guard: no DB/migrations/edge/strict-grep changes | `git diff --name-only fee178634 -- supabase .github/scripts/strict-grep` | PASS | Empty output. |
| Hard guard: forbidden public-page/feed files untouched | `git diff --name-only fee178634 -- \| rg '(^supabase/\|^\.github/scripts/strict-grep/meta-orch-0972-\|PublicBrandPage\|publicEventsService\|ExperienceMiniCard\|useUpcomingFeed\|EventMiniCard\|TripMiniCard)'` | PASS | Empty output. |
| Hard guard: no Brand.kind reintroduction | `git diff --unified=0 fee178634 -- mingla-business mingla-admin \| rg '^\+.*(Brand\.kind\|brand\.kind\|currentBrand\.kind)'` | PASS | Empty output. |
| Hard guard: no payment SDK version bump | `git diff --name-only c9741eb52 -- mingla-business/package.json mingla-business/package-lock.json package.json package-lock.json yarn.lock pnpm-lock.yaml` | PASS | Empty output. |
| Hard guard: no tester-side metro rewrite | `git diff --name-only 19adf8004..HEAD -- mingla-business/metro.config.js` | PASS | Empty output. Cumulative diff from `c9741eb52` still includes the prior rework #1 native Connect alias. |
| Required Jest suite | 7 required suites | PASS | 7 passed / 30 tests. |
| Required suite plus tester test | 8 suites including new adversarial test | PASS | 8 passed / 31 tests. |
| Fresh Pixel 7 live-fire | Created `META_ORCH_0972_Pixel_7_API35`, installed dev client, launched from ORCH Metro URL | PARTIAL | Login screen reached; no auth session available on wiped AVD. |
| Pixel 8 Pro authenticated live-fire | Existing AVD, installed dev client, launched from ORCH Metro URL | FAIL | System ANR dialog visible on Home; Hub not reachable. |

## 5. New Tester Regression

Path: `mingla-business/__tests__/androidRootStripeTransitiveGraph.adversarial.test.ts`

Commit: `39b59a36f` (`META-ORCH-0972 tester adversarial Stripe root graph test`)

Pass output:

```text
PASS __tests__/androidRootStripeTransitiveGraph.adversarial.test.ts
Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
```

Why it is adversarial: the test performs native-platform relative import resolution from `app/_layout.tsx` and fails if the root graph transitively reaches `StripeProviderWrapper.native.tsx`, `NativeCheckoutPaymentBoundary.native.tsx`, `nativeCheckoutFlow.native.ts`, `@stripe/stripe-react-native`, or `@mingla/payments-native`. This catches a different regression angle than the implementor's direct root string checks.

Fails-on-revert proof for implementor regression:

```text
EXPECTED_FAIL c9741eb52
- root layout contains StripeProviderWrapper
- event checkout lacks NativeCheckoutPaymentBoundary
- trip checkout lacks NativeCheckoutPaymentBoundary
- event checkout imports nativeCheckoutFlow directly
- trip checkout imports nativeCheckoutFlow directly
exit_status=42
```

## 6. Android Evidence

| AVD | Evidence | Result |
|---|---|---|
| Fresh Pixel 7 (`META_ORCH_0972_Pixel_7_API35`) | `android-retest2-pixel7-emulator-name.txt`, `android-retest2-pixel7-auth-or-home.png`, `android-retest2-pixel7-logcat-grep.txt` | PARTIAL PASS: clean unauthenticated screen, no Stripe/document/ANR log signatures; could not test Home/Hub because wiped AVD had `INITIAL_SESSION hasSession: false, hasUser: false`. |
| Pixel 8 Pro | `android-retest2-pixel8-after-launch.png`, `android-retest2-pixel8-after-wait.png`, `android-retest2-pixel8-hub-attempt.png`, `android-retest2-pixel8-window.xml`, `android-retest2-pixel8-logcat-full.txt`, `android-retest2-pixel8-logcat-grep.txt` | FAIL: authenticated Home appears behind blocking "Process system isn't responding" dialog; Hub tap did not land. |

Pixel 8 UI proof:

- `android-retest2-pixel8-window.xml` contains `Process system isn't responding`, `Close app`, and `Wait`.
- `android-retest2-pixel8-after-wait.png` shows authenticated Home (`Travel Brand`) behind the blocking dialog.
- `android-retest2-pixel8-hub-attempt.png` still shows Home with the same dialog after the Hub tap attempt.

Logcat pattern counts on Pixel 8:

```text
ANR in com.sethogieva.minglabusiness=0
Input dispatching timed out=0
document=0
ReferenceError=0
forwardRef render functions=0
StripeResponse=0
StripePushProvisioning=0
Loading brands=0
```

Important nuance: the app-specific Stripe/document signatures are gone, but the user-visible Android ANR dialog is still present. The dispatch required clean Home and Hub with no ANR dialog, not merely zero app-process ANR text in logcat.

## 7. Findings

### P1-001: Authenticated Android still fails the no-ANR live-fire gate

- **Evidence:** `android-retest2-pixel8-after-launch.png`, `android-retest2-pixel8-after-wait.png`, `android-retest2-pixel8-hub-attempt.png`, `android-retest2-pixel8-window.xml`.
- **What is wrong:** The Pixel 8 Pro session reached authenticated Home, but Android displayed `Process system isn't responding` with `Close app` / `Wait`. The dialog blocks interaction, so Hub could not be verified.
- **Impact:** Sub-C cannot be safely dispatched because the Sub-B Android release gate explicitly required clean Home and Hub with no ANR dialog.
- **Required fix:** Rework #3 must make the authenticated dev-client path reach Home and Hub without any blocking Android ANR dialog on this AVD. Do not touch DB, public-page/feed files, strict-grep scripts, Sub-A, package versions, or the rework #1 Metro alias.
- **Retest:** Tester must relaunch from a clean Metro state, capture authenticated Home and Hub screenshots with no ANR dialog, and provide full logcat plus focused grep receipt.

### P2-001: Fresh non-Pixel AVD could not complete authenticated Home/Hub coverage

- **Evidence:** `android-retest2-pixel7-auth-or-home.png`, `android-retest2-pixel7-logcat-grep.txt`.
- **What is wrong:** A wiped Pixel 7 AVD has no persisted Supabase auth session, so it only proves clean unauthenticated startup.
- **Impact:** The AVD-agnostic startup signal is useful, but it does not satisfy the requested authenticated Home/Hub proof.
- **Required fix:** Rework/retest #3 should either seed a safe test auth session on the fresh non-Pixel AVD or provide a documented tester-safe credential/OTP path before the retest.

## 8. What Passed

- Source architecture now keeps native Stripe out of root startup by direct and transitive checks.
- Required 7-suite Jest gate is green.
- Tester adversarial test is committed and green.
- Android dev export is green.
- Native Connect SDK package paths are absent from the Android bundle.
- Fresh Pixel 7 unauthenticated startup reached login with zero `document`, `ReferenceError`, Stripe `forwardRef`, `StripeResponse`, `StripePushProvisioning`, `Loading brands`, app ANR, or input-timeout grep hits.
- Hard guards held: no DB/migration/edge changes, no forbidden public-page/feed files, no strict-grep script edits, no Brand.kind-style reintroduction, no SDK version bump, preserved `411925909`, and no tester-side `metro.config.js` change.

## 9. Close-Orchestrator Note

The eventual PR squash-merge commit body MUST contain:

```text
[TEST-MOD-APPROVED META-ORCH-0972]
```

Reason: the cumulative diff deletes lines in `mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` and `mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts`. The test changes appear justified by the route-scoped provider architecture, but the close commit still needs the tag.

## 10. Verdict and Routing

**Verdict: FAIL.**

Route back to `implementor-mingla` for narrowly scoped Android REWORK #3. Do not dispatch Sub-C until tester can independently capture clean authenticated Home and Hub on Android with no blocking ANR dialog.
