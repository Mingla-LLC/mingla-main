# QA — ORCH-1083 [Business web app slow/unreliable load]

- **Mode:** TEST / adversarial verification only
- **Tester:** Codex `tester-mingla`
- **Date:** 2026-06-05
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]/` on branch `ORCH-1083-business-web-load-perf`
- **Base:** `8781d6d1f`
- **Implemented commits verified:** `61a73060`, `55ba4ca8`, `db114f9da`
- **Verdict:** **CONDITIONAL PASS**

## 1. Verdict

**CONDITIONAL PASS.** No P0/P1 release blockers were found. I do **not** fail this close for the missed SC-1/SC-2 numeric targets because Seth already accepted the honest ~1% safe-cut result; my independent re-measure corroborates that the numbers were not fudged.

Close is reasonable if the orchestrator accepts the documented residual gates:

1. Feature-level native iOS parity for authenticated flows (Stripe onboarding, non-default themed public page, share-modal QR) still needs a signed-in brand/test-data smoke pass. I verified iOS startup from this worktree bundle, native export, native route non-touch, and source-level QR/font safety, but not authenticated feature taps.
2. The implementation report slightly overstates the Stripe SDK split: the eager `__common` script still contains `@stripe/connect-js` / `loadConnectAndInitialize` in a small 17.7 KB shared chunk. This is not a close blocker because the measured initial payload includes that chunk, the guard caps `__common`, and TA-05 proves a route-shell static import fails the budget guard.

## 2. Findings

| Severity | Finding | Evidence | Release impact |
|---|---|---|---|
| P0 | None | No crash/security/data-loss/payment-integrity issue found. | None. |
| P1 | None | Scope guard, bundle guard, fallback, web lazy chunks, and iOS startup passed. | None. |
| P2 | Native feature-level parity is partially verified, not fully exercised. | `npx expo export -p ios --output-dir /tmp/orch1083-ios-export` passed; dev-client launch against this worktree Metro on port 8082 bundled and bootstrapped auth without crash; Maestro hierarchy saw the app root. Authenticated Stripe/share/theme flows were not tappable without a signed-in business state/test data. | Conditional manual gate before claiming full SC-6 feature parity. |
| P2 | `__common` still eagerly contains small Stripe Connect web SDK code despite the implementation report saying the heavy Connect loader is in split chunks. | Fresh export: initial scripts are runtime 3,802 B, `__common` 17,651 B, main 9,110,080 B. Grep of `__common` found `@stripe/connect-js`, `loadConnectAndInitialize`, and `ConnectComponentsProvider`; main entry had none. | Not blocking because the byte/time math remains honest and M-3 still catches the route-shell regression, but the report/guard wording should not be read as "zero Stripe code in all initial scripts." |
| P3 | Global `npx tsc --noEmit` is still red on unrelated repo debt. | Command returned exit 2 with errors in `app/(tabs)/account.tsx`, checkout buyer files, marketing rich editor, `packages/*`, and pre-existing tests. Filtering touched ORCH-1083 files found no touched-file errors. | Non-blocking for this ORCH, but SC-8 "clean tsc" is not literally achieved at repo level. |
| P4 | Measurement result is independently corroborated, with small baseline variance. | My M-1 baseline archive measured 9,250,540 B before vs 9,131,533 B after = 1.29%; implementation reported 9,236,985 B before vs 9,131,533 B after = 1.14%. Both prove the same ~1% safe cut. | Supports close with the accepted numeric miss. |

## 3. Claim Table

| Claim | QA result | Evidence |
|---|---|---|
| C-1 route shells have no static `@stripe/*` import. | Verified. | `npx jest __tests__/orch_1083_web_load_perf.test.tsx --runInBand` passed 10/10; source grep shows `@stripe/*` imports only in `src/components/stripe/connect-pages/*Body.web.tsx`, not route shells. |
| C-1 connect bodies lazy-load and fallback is visible, not blank. | Verified for browser fallback/body mount. | Playwright delayed `ConnectOnboardingBody-*.js` by 1.5s; Chromium and WebKit both observed visible `Loading…`, then invalid-link body branch. |
| C-2 root no longer eager-loads 14 theme fonts. | Verified structurally and by entry grep. | Jest passed root/useFonts/static-import assertions; fresh main entry grep had no `@expo-google-fonts/` specifier. |
| C-3 QR renderer is lazy. | Verified structurally and by test. | Jest passed `ShareModal` assertions: no static `react-native-qrcode-svg` import; `React.lazy` + `Suspense` + `qrFallback`. |
| M-3 guard exists and bites. | Verified. | Clean export guard passed. Temporary route-shell static import of `@stripe/connect-js` caused `ORCH-1083 bundle-budget FAIL ... leaked back into the MAIN entry chunk`; probe removed and clean export passed again. |
| SC-1/SC-2 numeric misses are honest. | Verified. | Independent M-1/M-2 re-runs corroborate ~1% reduction. No evidence of fudged before/after math. |
| Hard guard: no `web.output`, `asyncRoutes`, `vercel.json`, routing, or auth changes. | Verified. | `git diff 8781d6d1f..HEAD -- mingla-business/app.json mingla-business/app.config.ts mingla-business/vercel.json mingla-business/app/+html.tsx mingla-business/scripts/inject-mobile-blur-css.mjs mingla-business/src/context/AuthContext.tsx` produced no diff. |
| Native unaffected. | Partially verified. | iOS export passed; installed business dev build launched against worktree Metro, bundled, and reached auth no-session state. Native feature taps still need authenticated manual gate. |

## 4. Platform Matrix

| Platform | Result | Evidence |
|---|---|---|
| Business web Chromium | PASS | Connect pages loaded lazy body chunks; delayed fallback visible; M-2 timing harness passed; cold/warm connect route had 0 chunk failures. |
| Business web WebKit | PASS | All 5 `/connect-*` pages loaded their lazy body chunks and rendered invalid-link body branches; delayed onboarding fallback visible. |
| Business iOS simulator | CONDITIONAL PASS | Booted iPhone 17 Pro (`17091E60-C3B6-4167-980D-60C348E177F6`); `npx expo start --dev-client --localhost --clear --port 8082` bundled current code and app launched as `com.sethogieva.minglabusiness: 49127`; logs reached `[auth] bootstrap-no-session`; Maestro hierarchy saw root accessibility text `Business`. Authenticated feature taps not completed. |
| Business Android | N/A for this dispatch | User specifically emphasized iOS sim; no Android runtime required in the prompt. Source changes are web-only connect shells plus platform-neutral font/QR code. |
| Admin/consumer apps | N/A | Not touched. |

## 5. TA-01..TA-08

| Test | Result | Evidence |
|---|---|---|
| TA-01 connect pages mount | PASS for lazy body mount/error branch; live Stripe session not exercised | Chromium + WebKit `/connect-onboarding`, `/connect-account-management`, `/connect-partner-onboarding`, `/connect-partner-account-management`, `/connect-tax-registrations` all loaded matching `Connect*Body-*.js` chunks and rendered invalid-link body branches. Live `Connect*` component requires real session secret/test brand state. |
| TA-02 public themed page web | PASS structural; manual visual gate remains | `PublicBrandPage.tsx` and `PublicEventPage.tsx` call `useThemeFont(...)`; entry chunk has no font package specifier. No live non-default themed slug was available in this local unauthenticated pass. |
| TA-03 ThemeEditor picker | PASS structural; manual visual gate remains | `ThemeEditorSection.tsx` calls `useThemeFont(theme.fontFamilyValue)` and Jest verified no root 14-font load. Cycling all 14 in UI requires authenticated editor access. |
| TA-04 native parity | CONDITIONAL PASS | iOS export and iOS simulator startup passed; full authenticated Stripe/theme/share QR taps remain manual gate. |
| TA-05 budget guard bite | PASS | Temporary static import in `app/connect-onboarding.web.tsx` + re-export caused M-3 exit 1 with `@stripe/connect-js` leaked into main entry. Probe was removed; clean export M-3 passed. |
| TA-06 measurement honesty | PASS | M-1 before archive 9,250,540 B; after 9,131,533 B; delta 1.29%. M-2 before median 47,336 ms; after median 46,794 ms; delta 1.15%. Implementation's 1.14% / 1.07% is corroborated within small environment variance. |
| TA-07 fallback not blank | PASS | Delayed `ConnectOnboardingBody-*.js`; both Chromium and WebKit saw visible `Loading…` before body branch. |
| TA-08 cold vs warm | PASS | Chromium cold and second visit to `/connect-onboarding` both rendered body branch; initial script/chunk responses all HTTP 200; failures=0. |

## 6. Commands Run

All commands ran from `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1083-[business-web-load-perf]` unless a `mingla-business` package cwd is stated.

```bash
sed -n '1,240p' /Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md
```

Read first. Carried COMMS-0015/0018: do not deploy/OTA/merge/reap; deploy only from merged main.

```bash
git status --short --branch
git log --oneline --decorate --max-count=12
git diff --name-status 8781d6d1f..HEAD
```

Confirmed branch `ORCH-1083-business-web-load-perf`, commits `61a73060/55ba4ca8/db114f9da`, and scoped diff.

```bash
git diff 8781d6d1f..HEAD -- mingla-business/app.json mingla-business/app.config.ts mingla-business/vercel.json mingla-business/app/+html.tsx mingla-business/scripts/inject-mobile-blur-css.mjs mingla-business/src/context/AuthContext.tsx
```

Output: no diff.

```bash
cd mingla-business
npx jest __tests__/orch_1083_web_load_perf.test.tsx --runInBand
```

Output: `Test Suites: 1 passed, 1 total`; `Tests: 10 passed, 10 total`.

```bash
cd mingla-business
node scripts/ci/orch-1083-initial-bundle-budget.mjs --self-test
```

Output: `ORCH-1083 bundle-budget self-test PASS.`

```bash
cd mingla-business
npx tsc --noEmit
```

Output: exit 2, pre-existing/unrelated TypeScript errors. Touched-file filter found no ORCH-1083 touched-file errors.

```bash
node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs
node .github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs
node .github/scripts/strict-grep/orch-1056-connect-page-shared-styles.mjs
node .github/scripts/strict-grep/i-proposed-o-stripe-no-webview-wrap.mjs
node .github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs --self-test
node .github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs
```

Outputs:

- `ORCH-0778 web Stripe native import gate passed.`
- `ORCH-0802 strict-grep PASS — 3/3 checks (scanned 1099 files).`
- `ORCH-1056 connect-page-shared-styles strict-grep PASS — all 4 connect-*.web.tsx pages import shared helpers.`
- `I-PROPOSED-O gate: scanned 1029 .ts/.tsx files · 0 violations · 0 read failures`
- `ORCH-1001 gate self-test PASS (5/5 cases).`
- `ORCH-1001 gate PASS: no eager native-only TurboModule imports in web-reachable mingla-business code...`

```bash
cd mingla-business
rm -rf web-build && npm run web:export
node scripts/ci/orch-1083-initial-bundle-budget.mjs
```

Output:

- Export passed, `Web Bundled ... index.js (4272 modules)`.
- `ORCH-1083 bundle-budget PASS — initial payload 9131533 bytes (ceiling 9405478), 26 chunk files, 0 deferred specifiers in the main entry chunk, __common within cap.`

After M-1 script:

```text
/_expo/static/js/web/__expo-metro-runtime-...js raw=3802 gzip=1570 modules=0
/_expo/static/js/web/__common-...js raw=17651 gzip=4496 modules=2
/_expo/static/js/web/index-ac4553...js raw=9110080 gzip=1874446 modules=4066
TOTAL_INITIAL_RAW=9131533
TOTAL_INITIAL_GZIP=1880512
CHUNK_COUNT=26
```

Deferred-specifier scan of initial scripts:

```text
runtime: no deferred specifier hits
__common: @stripe/connect-js
main entry: no deferred specifier hits
```

```bash
cd mingla-business
ORCH_1083_LABEL=after-qa ORCH_1083_ITERS=5 ORCH_1083_OUT=/tmp/orch1083-after-load.txt npx playwright test -c playwright/orch-1083-load-perf.config.ts
```

Output: `ORCH-1083 M-2 [after-qa] iters=5 firstRootChild_ms samples=[47312,46813,46272,46450,46794] median=46794 DCL_ms median=46196`; `1 passed`.

Before archive measurement:

```bash
tmp=$(mktemp -d /tmp/orch1083-before.XXXXXX)
git archive 8781d6d1f | tar -x -C "$tmp"
ln -s "$current_worktree/mingla-business/node_modules" "$tmp/mingla-business/node_modules"
cp current playwright/orch-1083-load-perf.* "$tmp/mingla-business/playwright/"
cd "$tmp/mingla-business"
npm run web:export
```

Output:

```text
/_expo/static/js/web/index-d7dabc5d...js raw=9250540 gzip=1904082 modules=4262
TOTAL_INITIAL_RAW=9250540
TOTAL_INITIAL_GZIP=1904082
CHUNK_COUNT=4
```

```bash
cd "$tmp/mingla-business"
ORCH_1083_LABEL=before-qa ORCH_1083_ITERS=5 ORCH_1083_PORT=43184 ORCH_1083_OUT=/tmp/orch1083-before-load.txt npx playwright test -c playwright/orch-1083-load-perf.config.ts
```

Output: `ORCH-1083 M-2 [before-qa] iters=5 firstRootChild_ms samples=[48003,47879,47311,47304,47336] median=47336 DCL_ms median=46759`; `1 passed`.

TA-05 adversarial probe:

```bash
# Temporary probe only, removed afterward:
# import { loadConnectAndInitialize as __orch1083BudgetProbe } from "@stripe/connect-js";
rm -rf web-build && npm run web:export && node scripts/ci/orch-1083-initial-bundle-budget.mjs
```

Output: `ORCH-1083 bundle-budget FAIL: deferred specifier(s) leaked back into the MAIN entry chunk ... @stripe/connect-js`. Probe removed; `git diff -- mingla-business/app/connect-onboarding.web.tsx` returned no diff; clean export/budget passed.

Connect browser pass:

```bash
node playwright/manual-connect-pass.js # one-off inline Playwright script, not committed
```

Key output:

```text
chromium /connect-onboarding delayed chunk fallbackSeen=true bodyText=Invalid onboarding link ...
chromium /connect-account-management ... chunkHits=ConnectAccountManagementBody-...
chromium /connect-partner-onboarding ... chunkHits=ConnectPartnerOnboardingBody-...
chromium /connect-partner-account-management ... chunkHits=ConnectPartnerAccountManagementBody-...
chromium /connect-tax-registrations ... chunkHits=ConnectTaxRegistrationsBody-...
webkit /connect-onboarding delayed chunk fallbackSeen=true ...
webkit /connect-account-management ... chunkHits=ConnectAccountManagementBody-...
webkit /connect-partner-onboarding ... chunkHits=ConnectPartnerOnboardingBody-...
webkit /connect-partner-account-management ... chunkHits=ConnectPartnerAccountManagementBody-...
webkit /connect-tax-registrations ... chunkHits=ConnectTaxRegistrationsBody-...
```

Cold/warm:

```text
cold: visible invalid-link branch; chunkResponses=200 __common...; 200 index...; 200 ConnectOnboardingBody...; failures=0
warm-second-visit: visible invalid-link branch; chunkResponses=200 __common...; 200 index...; 200 ConnectOnboardingBody...; failures=0
```

iOS/native:

```bash
xcrun simctl list devices available
xcrun simctl get_app_container booted com.sethogieva.minglabusiness
npx expo export -p ios --output-dir /tmp/orch1083-ios-export
npx expo start --dev-client --localhost --clear --port 8082
xcrun simctl openurl booted 'mingla-business://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082'
xcrun simctl launch booted com.sethogieva.minglabusiness
~/.maestro/bin/maestro --device 17091E60-C3B6-4167-980D-60C348E177F6 hierarchy
```

Key output:

```text
iOS Bundled ... index.js (5079 modules)
Exported: /tmp/orch1083-ios-export
iOS Bundled 12290ms index.js (4786 modules)
INFO [auth] bootstrap-start
INFO [auth] bootstrap-no-session
com.sethogieva.minglabusiness: 49127
Maestro hierarchy root accessibilityText: Business
```

Fail-on-revert:

```bash
# In temporary 8781d6d1f archive, with only the new ORCH-1083 test and budget script copied in:
npx jest __tests__/orch_1083_web_load_perf.test.tsx --runInBand
```

Output: `FAIL`; `9 failed, 1 passed, 10 total`; `ORCH1083_FAIL_ON_REVERT_JEST_EXIT=1`.

## 7. Measurement Math

| Metric | Before QA | After QA | Delta | Implementation claim | QA conclusion |
|---|---:|---:|---:|---:|---|
| M-1 initial raw JS | 9,250,540 B | 9,131,533 B | -1.29% | -1.14% | Corroborated; small baseline variance, same conclusion. |
| M-1 gzip | 1,904,082 B | 1,880,512 B | -1.24% | gzip context only | Corroborated. |
| M-1 chunks | 4 | 26 | +22 | 4 to 26 | Corroborated. |
| M-2 first root child median | 47,336 ms | 46,794 ms | -1.15% | -1.07% | Corroborated; no fudging found. |

## 8. Regression Coverage

- **Repo-running test added:** `mingla-business/__tests__/orch_1083_web_load_perf.test.tsx`.
- **Passing on current branch:** 10/10.
- **Fail-on-revert proof:** copied the new test and budget script into a temporary `8781d6d1f` archive; 9/10 tests failed.
- **TA-05 adversarial proof:** temporary static route-shell import of `@stripe/connect-js` caused the generated main entry to contain the specifier and M-3 failed. This is separate from fail-on-revert: fail-on-revert proves the test catches the original source pattern; TA-05 proves the export-time budget guard bites on a future static-import regression.
- **CI wiring:** `.github/workflows/web-build-check.yml` runs `ORCH_1083_WEB_BUILD=/tmp/web-build-check node scripts/ci/orch-1083-initial-bundle-budget.mjs`.

## 9. Deploy / Close Readiness

- **No deploy/OTA/merge/reap performed.**
- COMMS-0015/0018 carried: any eventual deploy must happen only after PR merge, from merged `main`, never from this worktree.
- The branch is close-ready from a tester perspective if the orchestrator accepts the P2 residual manual gates above and documents that SC-1/SC-2 were accepted misses for Phase 1.
- Recommended downstream: orchestrator CLOSE with a follow-on architecture ORCH for real load improvement (`asyncRoutes` / `web.output:"static"`), plus a signed-in business iOS smoke test before claiming full native feature parity.

