# QA Report: ORCH-0964 Public-page theme customization retest 2

> Date: 2026-05-26
> Mode: RETEST
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:1 P4:5

## 1. Layman Summary

The ORCH-0964 rework clears the previous implementation blockers. The Android App Links file is now committed and pushed with both Android app targets, the business package is preserved, the consumer package has both provided SHA-256 fingerprints, the META gates are restored and passing, the prior `publicEventsService.ts` `Brand.kind` TypeScript blocker is gone, and a repo-running logout/cache regression now exists and passes.

This is not a full production PASS only because two things remain outside local QA: real Android OS tap verification still needs a deployed site plus signed Android build/device, and `origin/main` advanced by one comms-ledger commit during this retest. A detached proof rebase of the ORCH branch onto current `origin/main` completed cleanly, so this is close/orchestrator housekeeping rather than implementor rework.

## 2. Inputs Reviewed

- Prior retest fail report: `Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_RETEST.md`
- Prior QA fail report: `Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_REPORT.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`
- Branch: `ORCH-0964-public-page-theme-customization`
- Retested commit: `682ede28e ORCH-0964: rework app links and logout cache gates`
- Comms ledger: COMMS-0002, COMMS-0003, COMMS-0004, and COMMS-0005 were acknowledged for `tester+codex (ORCH-0964 RETEST #2)`.

## 3. Hard-Guard Results

| Guard | Result | Evidence |
|---|---|---|
| Rework committed and pushed | PASS | `git rev-parse --short HEAD` and `git rev-parse --short origin/ORCH-0964-public-page-theme-customization` both returned `682ede28e`; `git status --porcelain --untracked-files=no` returned no tracked edits. |
| Business package preserved | PASS | `mingla-business/public/.well-known/assetlinks.json:6-8` contains `com.sethogieva.minglabusiness` and the original business SHA-256 fingerprint. |
| Consumer package added | PASS | `assetlinks.json:16-20` contains `com.mingla.app.v2` with both verified SHA-256 fingerprints. |
| Assetlinks regression is repo-running | PASS | `npm run test:orch-0964-assetlinks` passed: 1 suite, 3 tests. Test file lines 33-68 assert business preservation, consumer exactness, and no duplicate package targets. |
| Current-main rebase proof | CONDITIONAL PASS | `git rev-list --left-right --count origin/main...HEAD` returned `1 19` after this tester acknowledged the comms ledger on `origin/main`. A detached worktree rebase of `682ede28e` onto current `origin/main` succeeded through all 19 commits with no conflicts. |
| META gates restored | PASS | `meta-orch-0972-data-driven-tabs.mjs` and `meta-orch-0972-no-brand-kind-reads.mjs` are present at HEAD and both passed in the strict-grep gate run. |
| `publicEventsService.ts` `Brand.kind` blocker cleared | PASS | The targeted TypeScript filter over `/tmp/orch0964-business-tsc-retest2.log` exited 0; no `publicEventsService.ts` `kind`/`Property 'kind' is missing` errors remain. Mapper returns at `publicEventsService.ts:509-572` and `604-630` no longer include required `kind` returns. |
| Logout/cache regression coverage | PASS | `npm run test:orch-0964-logout-cache` passed all 5 checks. Script lines 31-69 guard `consumerBrand`, `brandTheme`, signed-out `queryClient.clear()`, and persisted React Query AsyncStorage cleanup. |
| Android tap verification | DEPLOY/DEVICE-GATED | `adb devices` returned no connected devices. Real App Links tap verification still requires deployed `.well-known/assetlinks.json` and a signed `com.mingla.app.v2` Android build matching one of the checked fingerprints. |

## 4. Commands Run

| Check | Command | Result |
|---|---|---|
| Branch/remote state | `git fetch origin --prune && git rev-parse --short HEAD && git rev-parse --short origin/ORCH-0964-public-page-theme-customization && git rev-parse --short origin/main && git rev-list --left-right --count origin/main...HEAD && git status --short --branch && git status --porcelain --untracked-files=no` | `HEAD=682ede28e`, remote branch `682ede28e`, current `origin/main=3e2de4357`, divergence `1 19`; no tracked local edits. `mingla-admin/node_modules` remains untracked local residue. |
| Current-main proof rebase | Detached temp worktree from `682ede28e`, then `git rebase origin/main` | PASS: "Successfully rebased and updated detached HEAD." |
| Committed assetlinks content | `git show HEAD:mingla-business/public/.well-known/assetlinks.json` | PASS: business target plus consumer target and both consumer fingerprints are present at committed HEAD. |
| Assetlinks regression | `cd mingla-business && npm run test:orch-0964-assetlinks` | PASS: 1 suite, 3 tests. |
| Logout/cache regression | `cd app-mobile && npm run test:orch-0964-logout-cache` | PASS: L-01 through L-05 passed. |
| Resolver regressions | `cd mingla-business && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand` | PASS: 2 suites, 5 tests. |
| Static gates | Six ORCH-0964 gates plus META-ORCH-0972 data-driven/no-kind gates, ORCH-0863, and ORCH-0963 | PASS: all listed gates passed. |
| Business TypeScript blocker filter | `cd mingla-business && npx tsc --noEmit --pretty false 2>&1 | tee /tmp/orch0964-business-tsc-retest2.log; if rg -n 'publicEventsService\\.ts\\([^)]*\\): error TS.*kind|Property .kind. is missing' /tmp/orch0964-business-tsc-retest2.log; then exit 1; else exit 0; fi` | PASS for the ORCH-specific blocker. Full TypeScript still reports known unrelated/shared-package type debt. |
| Android device availability | `adb devices` | DEPLOY/DEVICE-GATED: no connected devices. |

## 5. Prior FAIL Findings Retest

| Prior finding | Retest verdict | Evidence |
|---|---|---|
| Android App Links rework not committed/pushed | CLEARED | HEAD and origin branch both `682ede28e`; committed assetlinks/test/package changes present in `git show --stat --name-status HEAD`. |
| Required post-main rebase not proven | CLEARED WITH CONDITION | Implementation had `0 19` before this tester's ledger ack. Current divergence is `1 19` because `origin/main` now includes `3e2de4357 COMMS: acknowledge ORCH-0964 retest warnings`; detached rebase onto that current main succeeds cleanly. |
| Business TypeScript `Brand.kind` blocker | CLEARED | Targeted filter found no `publicEventsService.ts` `kind` errors. |
| SC-21 logout-cache regression missing | CLEARED | `app-mobile/scripts/ci/orch-0964-logout-cache-regression-check.mjs` is committed and `npm run test:orch-0964-logout-cache` passes. |
| Consumer Android assetlinks target absent | CLEARED STATICALLY | Committed `assetlinks.json` includes `com.mingla.app.v2` and both provided SHA-256 fingerprints. |
| Production `.well-known` verification | STILL DEPLOY-GATED | Local Vercel/content-type gate passes; production curl waits for merge/deploy. |
| Theme Editor hex entry | STILL OPEN P3 | Prior UX polish issue was not part of this rework retest and does not block close for the named hard guards. |
| Shared chrome tint | NOT RETESTED AS BLOCKER | Prior P2 was not in the user's retest hard-guard list; no new evidence upgrades it to release-blocking here. |

## 6. Findings

### P2-001: Actual branch is one commit behind current `origin/main` after this tester's ledger ack

- **Evidence:** `git rev-list --left-right --count origin/main...HEAD` returned `1 19`; `origin/main` is `3e2de4357 COMMS: acknowledge ORCH-0964 retest warnings`, created during this tester entry to satisfy the mandatory comms-ledger ack requirement.
- **Why this is conditional, not fail:** A detached proof rebase of `682ede28e` onto current `origin/main` completed cleanly through all 19 ORCH commits. The ahead/behind is a ledger-only process drift created by the retest itself, not an unresolved product-code conflict.
- **Required close condition:** Before PR merge/CLOSE, orchestrator should rebase or merge current `origin/main` into the ORCH branch and confirm `git rev-list --left-right --count origin/main...HEAD` returns `0 <ahead>`.

### P2-002: Real Android App Links tap verification remains deploy/device-gated

- **Evidence:** `adb devices` returned only the header with no connected Android device. The branch is not merged/deployed, so Android OS-level verification cannot prove against production `business.usemingla.com`.
- **Required close/release condition:** After merge and Vercel deploy, install a signed Android build for `com.mingla.app.v2` matching one of the two checked fingerprints and tap `https://business.usemingla.com/b/<slug>` from another Android app. Expected result: Android opens the Mingla consumer app directly to the shared consumer brand screen.

### P3-001: Theme Editor hex typing polish remains open

- **Evidence:** Prior QA identified normalization on each keystroke in `ThemeEditorSection.tsx`. This retest did not inspect a new UI fix for that issue.
- **Impact:** This remains UX polish rather than a blocker for the App Links/rebase/logout-cache rework hard guards.

## 7. Security / Privacy

| Check | Result | Evidence |
|---|---|---|
| Android package association exactness | PASS | Assetlinks committed HEAD contains exact package names and fingerprints; Jest exact-match test passed. |
| Existing business Android association preservation | PASS | Business target and SHA-256 fingerprint remain in committed assetlinks and are asserted by the test. |
| Logout cache privacy regression | PASS | The repo-running app-mobile gate checks the public brand/profile cache keys, event theme key, signed-out `queryClient.clear()` path, and persisted React Query snapshot cleanup. |

## 8. Production Gates Still Required

1. After merge/deploy, run `curl -I https://business.usemingla.com/.well-known/assetlinks.json` and verify HTTP 200 plus `Content-Type: application/json`.
2. After merge/deploy, run `curl -I https://business.usemingla.com/.well-known/apple-app-site-association` and verify HTTP 200 plus `Content-Type: application/json`.
3. On a real Android device or emulator with a signed matching build, tap `https://business.usemingla.com/b/<slug>` from another Android app and confirm it opens the consumer brand screen.

## 9. Verdict

`CONDITIONAL PASS`.

The named FAIL blockers are cleared in committed/pushed code at `682ede28e`. The remaining conditions are orchestrator/release gates: refresh the branch against the one new comms-ledger commit on current `origin/main`, then perform production `.well-known` curl checks and real Android tap verification after merge/deploy.

## 10. Downstream Routing

Route to Codex `orchestrator-mingla` for close review with the above conditions. Do not send back to implementor unless orchestrator requires the branch itself to be rebased to include the same-turn comms-ledger commit before PR/close, or if post-deploy Android tap verification fails.
