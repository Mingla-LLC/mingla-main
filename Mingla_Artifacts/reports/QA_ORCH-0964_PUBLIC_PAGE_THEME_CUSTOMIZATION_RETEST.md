# QA Report: ORCH-0964 Public-page theme customization + Android App Links retest

> Date: 2026-05-26
> Mode: RETEST
> Verdict: FAIL
> Findings: P0:0 P1:4 P2:4 P3:2 P4:5

## 1. Layman Summary

ORCH-0964 is still not ready to close. The local Android App Links rework is directionally correct: it preserves the business Android target, adds `com.mingla.app.v2`, includes both provided SHA-256 fingerprints, and has a passing regression test. However, that rework is only present as uncommitted local files, while the pushed branch still lacks the consumer target; the earlier rebase, TypeScript, and logout-cache blockers also remain open.

Real Android tap verification is treated as deploy/device-gated per dispatch, not as a local-code failure. It still must happen after merge/deploy on a real Android device.

## 2. Inputs Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
- Prior QA report: `Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_REPORT.md`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`
- Branch: `ORCH-0964-public-page-theme-customization`
- Current branch HEAD: `3199fb0e1`
- Comms ledger: COMMS-0002, COMMS-0003, COMMS-0004, and COMMS-0005 were already acknowledged by `tester+codex (ORCH-0964)` and were factored into the retest.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Public web infra | `mingla-business/public/.well-known/assetlinks.json`, `mingla-business/vercel.json` | Business target preservation, consumer target, exact fingerprints, JSON content-type config |
| Tests/build | `mingla-business/__tests__/assetlinks.consumerAppLinks.test.ts`, `mingla-business/package.json`, resolver Jest tests, strict-grep scripts, TypeScript | New App Links regression, existing resolver coverage, static gates, business/mobile type failures |
| Hooks/state/cache | `app-mobile/src/utils/authCleanup.ts`, `app-mobile/src/hooks/useBrandBySlug.ts`, `app-mobile/src/hooks/useEventTheme.ts` | Whether SC-21 has repo-running logout/cache regression coverage |
| Services/types | `mingla-business/src/services/publicEventsService.ts`, `mingla-business/src/types/brand.ts` | Prior `Brand.kind` TypeScript blocker |
| Git/process | `origin/main...HEAD`, pushed branch vs local diff, throwaway rebase | Whether the branch is rebased and whether rework is committed/pushed |
| Runtime/deploy | `adb devices`, Vercel header config | Android tap and production `.well-known` checks gated on deploy/device |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| `assetlinks.json` preserves the existing business target | Local file lines 1-10; Jest test lines 33-46 | Verified locally / not committed | Local content is correct. Branch HEAD still has only the business target. |
| `assetlinks.json` adds `com.mingla.app.v2` | Local file lines 12-22; Jest test lines 48-60 | Verified locally / not committed | Both provided fingerprints are present locally. |
| Both provided consumer fingerprints are required | Local file lines 17-20; Jest constants lines 17-21 | Verified locally / not committed | Exact values match dispatch/implementation report. |
| Duplicate Android package targets are guarded | Jest test lines 62-68 | Verified locally / not committed | Test enforces exactly `[business, consumer]`. |
| `npm run test:orch-0964-assetlinks` is repo-running | `mingla-business/package.json` line 21; command run | Verified locally / not committed | Script is local only until committed. |
| Real Android tap verification is local-testable now | `adb devices`; no connected device; deploy not merged | Deploy/device-gated | Not a local failure, but remains a release/manual gate. |
| Prior P1 rebase blocker is fixed | `git rev-list --left-right --count origin/main...HEAD`; throwaway rebase | Refuted | Still `5 18`; rebase conflicts immediately in `Mingla_Artifacts/WORLD_MAP.md`. |
| Prior P1 TypeScript blocker is fixed | `cd mingla-business && npx tsc --noEmit --pretty false` | Refuted | Same `publicEventsService.ts` missing `kind` errors at lines 512, 546, 609. |
| Prior P1 SC-21 logout-cache coverage is fixed | `rg` over app-mobile tests for `consumerBrand`, `brandTheme`, `performPrivateAuthCleanup` | Refuted | No repo-running test coverage found. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Git state | `git fetch origin --prune`; `git status --short --branch`; `git rev-parse --short HEAD`; `git rev-parse --short origin/ORCH-0964-public-page-theme-customization` | FAIL process | HEAD and origin are both `3199fb0e1`, but assetlinks rework is uncommitted: modified implementation report, package.json, assetlinks.json; untracked assetlinks test. |
| Pushed branch assetlinks content | `git show HEAD:mingla-business/public/.well-known/assetlinks.json` | FAIL | HEAD contains only `com.sethogieva.minglabusiness`; no `com.mingla.app.v2`. |
| Local assetlinks static content | `nl -ba mingla-business/public/.well-known/assetlinks.json` | PASS local | Business package at lines 6-8; consumer package at line 16; required fingerprints at lines 18-19. |
| Assetlinks regression | `cd mingla-business && npm run test:orch-0964-assetlinks` | PASS local | 1 suite passed, 3 tests passed. |
| Resolver regressions | `cd mingla-business && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand` | PASS | 2 suites passed, 5 tests passed. |
| Static gates | Six ORCH-0964 gates + ORCH-0863 + ORCH-0963 | PASS | All ORCH-0964 gates passed; ORCH-0863 C1-C7 passed; ORCH-0963 2/2 passed. |
| Rebase proof | `git rev-list --left-right --count origin/main...HEAD`; throwaway `git rebase origin/main` | FAIL | Branch is `5 18`; rebase conflicts on first commit in `Mingla_Artifacts/WORLD_MAP.md`. |
| Business TypeScript | `cd mingla-business && npx tsc --noEmit --pretty false` | FAIL | Same ORCH-specific `Brand.kind` errors at `publicEventsService.ts(512,3)`, `(546,3)`, `(609,3)`. |
| Consumer TypeScript | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL | Existing app/test/shared-package errors persist; shared package resolution remains noisy. |
| Logout/cache regression search | `rg -n "consumerBrand|brandTheme|authCleanup|performPrivateAuthCleanup|queryClient\\.clear|shouldRemoveForAuthChange" app-mobile -g '*test*' -g '*spec*'` | FAIL | No test/spec hits found. |
| Android device availability | `adb devices` | DEPLOY/DEVICE-GATED | No connected Android device. Real tap verification remains post-deploy/manual. |
| Well-known content type | `rg` in `mingla-business/vercel.json`; strict-grep content-type gate | PASS static / deploy-gated | Vercel headers configure JSON content type locally; production curl waits for merge/deploy. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | BLOCKED | Real Android `/b/<slug>` tap remains deploy/device-gated. |
| One owner per truth | PASS | Resolver tests and canonical strict-grep gate passed. |
| No silent failures | BLOCKED | Runtime save/link failure paths were not retested because this retest focused on assetlinks plus prior FAIL criteria. |
| One key per entity | FAIL | `consumerBrandKeys` exists, but logout-specific regression coverage is missing. |
| Server state server-side | PASS | No new local-only theme truth found in retest scope. |
| Logout clears everything | FAIL | SC-21 still lacks repo-running regression coverage. |
| Label temporary | N/A | No temporary UI label scope in this retest. |
| Subtract before adding | PASS | Shared rendering package and canonical resolver pattern remain intact. |
| No fabricated data | PASS | Resolver tests pass fallback/invalid-input behavior. |
| Currency-aware | PASS static | No new currency surface touched by the assetlinks rework. |
| One auth instance | PASS static | No new auth client touched by the assetlinks rework. |
| Validate at right time | PASS static / P2 UX issue | DB/static validation remains, but manual hex entry UX issue persists. |
| Exclusion consistency | PASS | Checkout no-brand-theme gate passed. |
| Persisted-state startup | BLOCKED | Fresh native startup and font/runtime checks remain device/build-gated. |

## 7. Findings

### P1 High

**P1-001: Android App Links rework is not committed or pushed, so the branch still lacks the consumer target**

- **Evidence:** `git status --short --branch` shows modified `mingla-business/public/.well-known/assetlinks.json`, modified `mingla-business/package.json`, modified implementation report, and untracked `mingla-business/__tests__/assetlinks.consumerAppLinks.test.ts`. `git show HEAD:mingla-business/public/.well-known/assetlinks.json` contains only `com.sethogieva.minglabusiness`.
- **What is wrong:** The local file is correct, but the actual branch/remote at `3199fb0e1` does not include the rework or its regression test.
- **Impact:** Any PR/merge/deploy from the pushed branch would still fail Android App Links for `com.mingla.app.v2`.
- **Required fix:** Commit and push the assetlinks JSON, package script, test file, and implementation-report update in the scoped ORCH branch.
- **Retest:** `git status --short --branch` should show no uncommitted rework; `git show HEAD:mingla-business/public/.well-known/assetlinks.json` should include both Android targets; `npm run test:orch-0964-assetlinks` should pass from committed HEAD.

**P1-002: Required post-main rebase is still not proven and still conflicts**

- **Evidence:** After `git fetch origin --prune`, `git rev-list --left-right --count origin/main...HEAD` returned `5 18`. A throwaway `git rebase origin/main` failed on the first rebased commit with a conflict in `Mingla_Artifacts/WORLD_MAP.md`.
- **What is wrong:** The branch remains behind current `origin/main`, so META-ORCH-0972 compatibility and mergeability are not proven.
- **Impact:** The branch cannot safely close or promote because it may regress current main artifacts/gates after conflict resolution.
- **Required fix:** Rebase the ORCH branch onto current `origin/main`, resolve conflicts while preserving META-ORCH-0972 invariants and ORCH-0964 theme/shared-rendering work, then rerun required gates on the actual branch.
- **Retest:** `git rev-list --left-right --count origin/main...HEAD` should show `0 <ahead>`, and the required ORCH-0964 plus META gates should pass.

**P1-003: Business TypeScript still has the same ORCH-specific `Brand.kind` incompatibility**

- **Evidence:** `cd mingla-business && npx tsc --noEmit --pretty false` reports `src/services/publicEventsService.ts(512,3)`, `(546,3)`, and `(609,3)`: `Property 'kind' is missing ... but required in type 'Brand'`. The `Brand` interface still requires `kind` at `mingla-business/src/types/brand.ts:201`.
- **What is wrong:** Public mapper returns still omit `kind` while their return type requires it.
- **Impact:** This remains the same post-META compatibility failure called out in the prior QA report.
- **Required fix:** Resolve the public mapper/type contract during the real rebase so the branch has no ORCH-specific `publicEventsService.ts` TypeScript failures.
- **Retest:** Business `tsc` may still expose known unrelated debt, but it must no longer report these ORCH-0964 `publicEventsService.ts` `kind` errors.

**P1-004: SC-21 logout-cache regression coverage is still missing**

- **Evidence:** `consumerBrandKeys` is defined in `app-mobile/src/hooks/useBrandBySlug.ts:20-23`; `eventThemeKeys` is defined in `app-mobile/src/hooks/useEventTheme.ts:14-17`; `performPrivateAuthCleanup` clears the whole query client only when `currentUserId` is absent at `app-mobile/src/utils/authCleanup.ts:47-49`. `rg` found no app-mobile tests/specs for `consumerBrand`, `brandTheme`, or `performPrivateAuthCleanup`.
- **What is wrong:** The behavior may be incidentally covered by `queryClient.clear()`, but the required repo-running regression is still absent.
- **Impact:** SC-21 and the regression-test habit remain failed for an auth/cache path.
- **Required fix:** Add a repo-running app-mobile regression test proving logout removes `['consumerBrand', slug]` and preferably `['brandTheme', eventId]`, including the signed-out path used by `performPrivateAuthCleanup`.
- **Retest:** Run the new logout/cache test and cite its command/output in the implementation report.

### P2 Medium

**P2-001: Real Android App Links tap remains deploy/device-gated**

- **Evidence:** `adb devices` returned only the header with no connected devices. The PR is not merged/deployed, so `business.usemingla.com/.well-known/assetlinks.json` cannot represent this branch.
- **Impact:** Local static config cannot prove Android OS-level verification or tap routing.
- **Required condition:** After merge and Vercel deploy, install a build signed for one of the two provided `com.mingla.app.v2` fingerprints and tap a `https://business.usemingla.com/b/<slug>` link from another Android app.

**P2-002: Production `.well-known` header verification remains deploy-gated**

- **Evidence:** `mingla-business/vercel.json:51-59` configures JSON content-type headers, and the local strict-grep gate passed. Production curl is invalid before merge/deploy.
- **Impact:** Bad deployment/header behavior would break Universal/App Links despite correct local files.
- **Required condition:** After deploy, run `curl -I https://business.usemingla.com/.well-known/apple-app-site-association` and `curl -I https://business.usemingla.com/.well-known/assetlinks.json`; both should return HTTP 200 and `Content-Type: application/json`.

**P2-003: Theme Editor hex input still normalizes on every keystroke**

- **Evidence:** `mingla-business/src/components/theme/ThemeEditorSection.tsx:114-117` uses `value={value?.color ?? ""}` and `onChangeText={(text) => commit({ color: normalizeColor(text) })}`.
- **Impact:** Manual typing of a partial hex value can reset to null before the user completes the color.
- **Required fix:** Keep a local draft string and validate on blur/save, while preserving explicit reset behavior.

**P2-004: Shared brand close/share chrome still does not use themed foreground color**

- **Evidence:** `packages/brand-rendering/PublicBrandPage.tsx:273-277` renders `ChromeButton` without theme props; `ChromeButton` at lines 374-386 uses static `styles.chromeIcon`.
- **Impact:** Close/share icon contrast can degrade on some theme backgrounds.
- **Required fix:** Thread `resolvedTheme.foregroundColor` into `ChromeButton`.

### P3 Low

**P3-001: Theme editor preview still lacks foreground sample text on the chosen background**

- **Evidence:** Prior finding remains in `ThemeEditorSection`; the assetlinks retest did not include a UI rework for this.
- **Impact:** The editor does not visually demonstrate foreground contrast as completely as the spec intended.

**P3-002: Installed simulator builds are still stale for Universal/App Link entitlement testing**

- **Evidence:** Native rebuild/EAS IDs were not produced in this retest; iOS simulators are booted, but Android/device testing is deploy/build-gated.
- **Impact:** Runtime link entitlement checks before fresh builds are not release evidence.

### P4 Notes

- The local assetlinks JSON exactly preserves the existing business package `com.sethogieva.minglabusiness` and business SHA-256 fingerprint.
- The local assetlinks JSON includes both provided `com.mingla.app.v2` fingerprints and the standard `delegate_permission/common.handle_all_urls` relation.
- The new local Jest test is well-targeted: it checks business target preservation, consumer target exactness, and duplicate package guards.
- ORCH-0964 resolver tests and static strict-grep gates passed during this retest.
- `usemingla.com` host coverage remains out of current checked-in scope unless future generated links use that domain for `/b/<slug>`.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-17 Android App Link cold start | FAIL static branch / local PASS / runtime gated | Local assetlinks lines 1-23; HEAD assetlinks lacks consumer target; no Android device | P1-001, P2-001 |
| Preserve business target | PASS local / FAIL branch | Local assetlinks lines 6-8; local Jest lines 33-46 | P1-001 |
| Add `com.mingla.app.v2` with both provided fingerprints | PASS local / FAIL branch | Local assetlinks lines 16-20; local Jest lines 48-60 | P1-001 |
| SC-21 logout clears `consumerBrand` cache | FAIL | No repo-running test found | P1-004 |
| Post-main rebase proof | FAIL | `5 18`; throwaway rebase conflict | P1-002 |
| Business TypeScript compatibility | FAIL | `publicEventsService.ts` missing `kind` errors | P1-003 |
| SC-22 well-known production headers | STATIC PASS / DEPLOY-GATED | Vercel config lines 51-59; content-type gate passed | P2-002 |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Android package association exactness | P1 process / static local PASS | Local assetlinks and Jest test exact-match fingerprints | Correct locally, but not committed/pushed |
| Fingerprint set completeness | P1 process / static local PASS | Both provided fingerprints are present locally | Correct locally, but not committed/pushed |
| Logout cache privacy | P1 | Missing `consumerBrand`/`brandTheme` logout-cache regression | Fails regression gate |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Business Theme Editor | Hex field normalizes every keystroke | P2 | Still open |
| Public brand chrome | Close/share icon tint not theme-aware | P2 | Still open |
| Theme Editor preview | Foreground contrast sample incomplete | P3 | Still open |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Partial static/type | FAIL | Consumer TypeScript still has existing/shared-package noise; runtime not rebuilt. |
| Business | Partial static/type | FAIL | Business TypeScript still has ORCH-specific `publicEventsService` errors. |
| Admin | N/A | N/A | No admin scope. |
| Public/web | Static only | FAIL branch / PASS local assetlinks | Branch HEAD lacks Android consumer target; local file correct. |
| iOS | Not runtime-tested | BLOCKED | Fresh native build/deploy required. |
| Android | Not runtime-tested | DEPLOY/DEVICE-GATED | `adb devices` had no connected device; real tap waits for deploy/device. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Android assetlinks consumer target | Needs signed Android tap after deploy | Hosted by business web public folder | N/A | N/A | N/A | Correct locally, absent from branch HEAD |
| Logout/cache coverage | Consumer app cache privacy | N/A | N/A | N/A | N/A | Missing regression remains blocker |
| Rebase conflict | Mobile/shared packages may need conflict resolution | Business public page/service needs conflict resolution | N/A | N/A | Artifact conflicts first | Cannot close until actual branch rebased |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Android OS App Links | Real Android device tap from another app to `https://business.usemingla.com/b/<slug>` | DEPLOY/DEVICE-GATED | Must run after merge, Vercel deploy, and installation of a signed `com.mingla.app.v2` build matching one of the provided fingerprints. |
| Production `assetlinks.json` | `curl -I https://business.usemingla.com/.well-known/assetlinks.json` | DEPLOY-GATED | Must return HTTP 200 and `Content-Type: application/json`; body must include business + consumer targets. |
| Production AASA | `curl -I https://business.usemingla.com/.well-known/apple-app-site-association` | DEPLOY-GATED | Must return HTTP 200 and `Content-Type: application/json`. |

## 14. Required Actions

1. **P1-001:** Commit and push the Android App Links rework and regression test; verify the pushed branch HEAD contains the consumer target and both fingerprints.
2. **P1-002:** Rebase the branch onto current `origin/main`, resolve conflicts, and rerun the ORCH-0964 plus META-ORCH-0972 gates on the actual branch.
3. **P1-003:** Fix the ORCH-specific `publicEventsService.ts` / `Brand.kind` TypeScript errors.
4. **P1-004:** Add repo-running app-mobile logout-cache regression coverage for `consumerBrand` and preferably `brandTheme`.

## 15. Conditional / Recommended Actions

1. After merge/deploy, run the real Android App Links tap test on a physical device or emulator with a signed build matching one of the provided fingerprints.
2. After merge/deploy, curl production `.well-known` URLs and verify HTTP 200 plus `Content-Type: application/json`.
3. Fix the Theme Editor manual hex-entry UX and brand chrome foreground tint before final customer-facing launch if they remain in ORCH-0964 scope.

## 16. Discoveries For Orchestrator

- No new cross-ORCH comms-ledger entry is needed; the actionable blockers are inside ORCH-0964.
- The Android App Links code shape is acceptable once committed, but the branch itself is not yet the source of truth for that fix.
- Treat real Android tap verification as a deploy/device gate, not as a blocker that implementor can solve locally.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| P1-001 required post-main rebase not proven | No | `5 18`; throwaway rebase conflicts in `WORLD_MAP.md` | Needs post-rebase gate run |
| P1-002 business TypeScript `Brand.kind` errors | No | Same `publicEventsService.ts(512,3)`, `(546,3)`, `(609,3)` errors | Needs type/rebase fix |
| P1-003 SC-21 logout cache coverage missing | No | No test/spec hits for `consumerBrand`, `brandTheme`, or cleanup behavior | Needs new repo-running test |
| P2-001 consumer Android assetlinks target absent | Locally yes / branch no | Local file/test pass; HEAD file lacks consumer target | Must commit/push |
| P2-002 production `.well-known` verification | Still gated | Vercel config static pass; no deploy | Manual post-deploy gate |
| P2-003 Theme Editor hex entry | No | Same on-change normalize pattern | Needs UI fix |
| P2-004 chrome tint | No | Same static ChromeButton icon style | Needs UI fix |

Retest cycle: 2. Route back to implementor for rework, then retest from a clean committed branch.
