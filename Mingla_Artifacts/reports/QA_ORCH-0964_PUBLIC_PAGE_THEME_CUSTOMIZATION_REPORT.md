# QA Report: ORCH-0964 Public-page theme customization + consumer brand screen + Universal/App Links

> Date: 2026-05-26
> Mode: SPEC-COMPLIANCE + TARGETED
> Verdict: FAIL
> Findings: P0:0 P1:3 P2:4 P3:2 P4:4

## 1. Layman Summary

ORCH-0964 is not ready to close or deploy. The schema, resolver tests, and static theme guardrails are mostly in place, but the branch cannot currently prove the required post-main rebase and it has ORCH-specific TypeScript failures tied to the META-ORCH-0972 brand-kind removal. Deep-link runtime checks also remain blocked until the PR is merged/deployed and Seth provides the consumer-app Android SHA-256 fingerprint.

## 2. Inputs Reviewed

- Dispatch: `Mingla_Artifacts/prompts/TESTER_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
- Binding specs: `SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`, Amendment 1, Amendment 2, Amendment 3.
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
- Review report: `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
- Worktree/branch: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`, `ORCH-0964-public-page-theme-customization`
- QA HEAD after tester adversarial test: `ee175d53e0c2c6bb73bc5d4d6ca582059678477c`
- Comms ledger: COMMS-0002/0003/0004/0005 acknowledged as `tester+codex (ORCH-0964)`.

## 3. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Step 0.5 fails-on-revert rerun | Checkout `9d3ce22e68c0fe977b9b346205fdb473ecbc4c43`; run `cd mingla-business && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand`; restore branch; rerun on `51a32af357dcab7993506a062159245d461257d6` | PASS proof | Revert commit failed 1/4: expected event override color `#2563eb`, received brand color `#ff6f00`; current HEAD passed 4/4. |
| Tester adversarial regression | Added `mingla-business/src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts`; ran with happy-path resolver suite | PASS | Commit `ee175d53e`; `2 passed, 5 tests passed`. Temporary mutation to threshold `0.185` failed at `#767676`, then restored. |
| ORCH-0964 strict-grep gates | Ran six ORCH-0964 gates plus ORCH-0863 and ORCH-0963 gate | PASS | All six ORCH-0964 gates passed; ORCH-0863 C1-C7 passed; ORCH-0963 2/2 passed. |
| Known ORCH-0962 field-map gate | `node .github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` | FAIL, pre-existing | Fails stale assertions including `row.brand_kind`; matches REVIEW D-1 main-branch issue, not ORCH-0964 fix scope. |
| Remote schema read-only verification | Supabase MCP read-only catalog queries | PASS | Theme columns exist on `brands`/`events`; CHECK constraints exist; public views expose theme columns. |
| D-2 double-route verification | Read `app-mobile/app/brand/[slug].tsx`, `app-mobile/app/b/[slug].tsx`, `ConsumerBrandProfileScreen.tsx`, `useBrandBySlug.ts` | PASS | Both route files export the same `ConsumerBrandProfileScreen`; the shared screen calls the same `useBrandBySlug` hook and passes the same props to `PublicBrandPage`. |
| Required post-rebase proof | Throwaway worktree `/tmp/orch0964-rebase-proof`, `git rebase origin/main` | FAIL/BLOCKED | Conflicts in `WORLD_MAP.md`, `meta-orch-0972-data-driven-tabs.mjs`, workflow YAML, then `mingla-business/src/components/brand/PublicBrandPage.tsx`. No runnable rebased tree produced. |
| Business TypeScript | `cd mingla-business && npx tsc --noEmit --pretty false` | FAIL | ORCH-specific errors: `publicEventsService.ts` returns `Brand` objects without required `kind` at lines 512, 546, 609, plus existing/shared-package type debt. |
| Consumer TypeScript | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL | Existing app debt plus shared-package resolution/type errors. |
| Device availability | `xcrun simctl list devices`, `adb devices` | PARTIAL | iPhone 17 / 17 Pro sims available and app bundles installed; no Android emulator connected. |
| Installed iOS app associated-domain entitlement | `xcrun simctl get_app_container` + `PlistBuddy` on installed consumer app | BLOCKED | Installed simulator app exists, but Info.plist has no `com.apple.developer.associated-domains`; native rebuild still required. |

## 4. Findings

### P1-001 — Required post-main rebase is not proven and currently conflicts

- Evidence: `git rev-list --left-right --count origin/main...HEAD` returned `5 17`; throwaway `git rebase origin/main` conflicted in `WORLD_MAP.md`, `.github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs`, `.github/workflows/strict-grep-mingla-business.yml`, and `mingla-business/src/components/brand/PublicBrandPage.tsx`.
- Impact: The branch cannot prove the dispatch's required post-rebase gate run, and the PR may not merge or may regress META-ORCH-0972's data-driven tab gate.
- Required fix: Rebase the ORCH branch onto current `origin/main`, resolve conflicts by preserving META-ORCH-0972 data-driven tab invariants and ORCH-0964 shared-package extraction, then rerun the six ORCH-0964 gates plus the two META-ORCH-0972 gates on the actual branch.
- Retest: `git rev-list --left-right --count origin/main...HEAD` should show `0 <ahead>` and all required gates should pass.

### P1-002 — Business TypeScript has ORCH-specific brand-kind incompatibilities

- Evidence: `cd mingla-business && npx tsc --noEmit --pretty false` reports `src/services/publicEventsService.ts(512,3)`, `(546,3)`, `(609,3)`: `Property 'kind' is missing ... but required in type 'Brand'`.
- Impact: This is exactly the post-META seam Amendment 3 was meant to absorb. The branch removes `kind` reads from mappers while still compiling against a branch-local `Brand` type that requires `kind`.
- Required fix: Resolve via the real rebase onto META-ORCH-0972 main or update the branch type contract so public mappers no longer need/return `kind` while preserving `meta-orch-0972-no-brand-kind-reads`.
- Retest: Business `tsc` should have no ORCH-0964-specific `publicEventsService` errors.

### P1-003 — SC-21 logout cache contract lacks repo-running regression coverage

- Evidence: `consumerBrandKeys` is defined only in `app-mobile/src/hooks/useBrandBySlug.ts`; no tests mention `consumerBrand`, `performPrivateAuthCleanup`, or the new key. `performPrivateAuthCleanup` uses broad `queryClient.clear()` on logout, which likely clears it, but the SC required unit/hook verification.
- Impact: Consumer brand data is a private/profile-adjacent cache. Tester directive 12 treats missing automation on auth/cache paths as release-failing unless impossible and converted to an explicit manual gate.
- Required fix: Add a repo-running test proving logout removes `['consumerBrand', slug]` (and ideally `['brandTheme', eventId]`) from React Query cache.
- Retest: Run the new logout-cache test and cite it in implementation report.

### P2-001 — Consumer Android App Links are not implementable yet because `assetlinks.json` lacks the consumer app target

- Evidence: `mingla-business/public/.well-known/assetlinks.json` contains only `package_name: "com.sethogieva.minglabusiness"`. SC-17 requires `com.mingla.app.v2` and Seth's Play Console SHA-256.
- Impact: Android cold App Links to `/b/<slug>` cannot open the consumer brand screen until the consumer target is added and deployed.
- Required fix: Add the `com.mingla.app.v2` relation after Seth provides Google Play App signing SHA-256. Tester asked Seth for the consumer-app SHA during this pass.
- Retest: Real Android device tap from another app after deploy.

### P2-002 — `.well-known` production verification is blocked until PR merge + Vercel deploy

- Evidence: Dispatch says SC-22 must be `BLOCKED-pending-CLOSE`; local `vercel.json` has JSON content-type headers, but production curl is not valid until merged/deployed.
- Impact: Universal/App Link association may still fail in production if headers or deployment routing differ.
- Required fix: After PR merge and Vercel deploy, run `curl -I https://business.usemingla.com/.well-known/apple-app-site-association` and `curl -I https://business.usemingla.com/.well-known/assetlinks.json`.

### P2-003 — Business Theme Editor hex input is hard to type manually

- Evidence: `ThemeEditorSection.tsx` line 116 calls `commit({ color: normalizeColor(text) })` on every keystroke; partial values normalize to `null`, so typing `#FF6F00` character-by-character resets the input until a full valid string is pasted/entered atomically.
- Impact: Color control may technically save a pasted valid hex, but normal manual entry is poor and can appear broken on mobile.
- Required fix: Keep a local draft input string, validate on blur/save, and only commit `null` when the user explicitly resets.

### P2-004 — Shared brand close/share chrome is not tinted by theme foreground

- Evidence: `packages/brand-rendering/PublicBrandPage.tsx` lines 273-277 render floating chrome; `ChromeButton` lines 374-386 does not receive `ResolvedTheme` and uses static `styles.chromeIcon`.
- Impact: Amendment 1 required close icon tint to use `theme.foregroundColor`; on certain hero/theme colors, chrome readability can degrade.
- Required fix: Thread `resolvedTheme.foregroundColor` into `ChromeButton`.

### P3-001 — Theme editor preview does not show foreground sample text on the chosen background

- Evidence: `ThemeEditorSection.tsx` preview band lines 72-75 contains only the Lottie overlay; sample text is below the band, not on the chosen background.
- Impact: Spec wanted a foreground contrast preview swatch. Resolver is tested, but the edit UI does not visually demonstrate it.

### P3-002 — Installed simulator builds are stale for Universal/App Link entitlement testing

- Evidence: Installed consumer app exists on booted simulator, but `PlistBuddy` found no `com.apple.developer.associated-domains` entry in the installed app Info.plist.
- Impact: Simulator/runtime link checks before native rebuild are not meaningful.

### P4 Notes

- D-2 double-route pattern is clean: `/brand/[slug]` and `/b/[slug]` both export the same screen.
- Remote migration is applied and catalog-visible: nullable columns, CHECK constraints, and view theme columns exist.
- ORCH-0964 strict-grep gates pass on the non-rebased branch.
- `usemingla.com` host placement remains N/A for current production links unless future generated URLs use `usemingla.com/b/<slug>`.

## 5. Success Criteria Matrix

| SC | Status | Evidence | Notes |
|---|---|---|---|
| SC-1 | BLOCKED | Code paths exist; no live app/browser smoke due FAIL blockers | Needs post-rebase runnable build/device smoke. |
| SC-2-buyer-web | BLOCKED | No Playwright/Safari proof on runnable rebased tree | Rebase conflict prevents meaningful final parity proof. |
| SC-2-consumer-iOS | BLOCKED | iOS sims available; installed app stale | Native rebuild/update required. |
| SC-2-consumer-Android | BLOCKED | `adb devices` empty | Needs Pixel 8 Pro emulator/device running plus build. |
| SC-3 | BLOCKED | Resolver unit verifies override precedence; runtime not smoke-tested | Step 0.5 proof confirms core resolver behavior. |
| SC-4-business-iOS | BLOCKED | ThemeEditorSection exists | No business iOS simulator flow; also hex UX issue P2-003. |
| SC-4-business-Android | BLOCKED | ThemeEditorSection exists | No Android emulator connected. |
| SC-5 | PASS | Jest happy-path suite | `#FFFF00 -> #000000`; `#000080 -> #ffffff`. |
| SC-6 | PASS | Jest happy-path suite | `resolveTheme(null, null)` returns Mingla default. |
| SC-7 | PASS | Jest happy-path suite + Step 0.5 proof | Partial override inherits brand/default. |
| SC-8 | PASS static / BLOCKED runtime | `orch-0964-checkout-no-brand-theme` passed | Runtime screenshot not taken. |
| SC-9 | PASS catalog | Supabase catalog shows `brands_theme_color_hex_chk` and `events_theme_color_override_hex_chk` | Read-only catalog verification; no destructive test write. |
| SC-10 | PASS catalog | Supabase catalog shows font whitelist constraints | Read-only catalog verification. |
| SC-11 | PASS catalog | Supabase catalog shows animation whitelist constraints | Read-only catalog verification. |
| SC-12 | BLOCKED | No EAS build size IDs | Native rebuild deferred. |
| SC-13 | BLOCKED | Installed sim build stale | Needs fresh native build/font cache check. |
| SC-14 | PASS unit-level / BLOCKED runtime | `ThemeEntranceAnimation` session set prevents replay by key | No Maestro runtime replay check. |
| SC-15 | PASS | Jest happy-path suite | Invalid resolver inputs fall through to default. |
| SC-16 | BLOCKED | Real iPhone required post-deploy | Requires PR merge, Vercel deploy, fresh signed app. |
| SC-17 | BLOCKED operator input | `assetlinks.json` lacks consumer app target; asked Seth for consumer app SHA-256 | Conditional-pass-aware item, but still unverified. |
| SC-18 | BLOCKED | Real uninstall/browser fallback required post-deploy | Not reproducible from current branch. |
| SC-19 | BLOCKED | Event sheet code navigates to `/brand/<slug>`; no Maestro/device flow | Needs iOS + Android runtime flow. |
| SC-20 | BLOCKED | Shared `@mingla/brand-rendering` supports parity | No side-by-side screenshot diff. |
| SC-21 | FAIL | No repo-running logout cache test for `consumerBrand` | P1-003. |
| SC-22 | BLOCKED-pending-CLOSE | Local headers exist; production curl intentionally deferred | Must curl after PR merge + Vercel deploy. |
| SC-23 | PASS | `orch-0964-brand-rendering-self-contained` passed; D-2 clean | Shared package has no business/app-mobile src imports. |

## 6. Discovery D-2 Verification

Verified clean. `app-mobile/app/brand/[slug].tsx` and `app-mobile/app/b/[slug].tsx` are identical thin exports of `ConsumerBrandProfileScreen`. `ConsumerBrandProfileScreen` resolves the slug once, calls `useBrandBySlug`, and passes `brand`, `events`, `trips`, `experiences`, `upcoming`, `upcomingHasMore`, and `resolvedTheme` to the shared `PublicBrandPage`. No divergent loading, error, or props path exists between `/brand/*` and `/b/*`.

## 7. Step 0.5 Independent Re-run

- Current QA-start HEAD: `51a32af357dcab7993506a062159245d461257d6`.
- Revert proof commit checked out: `9d3ce22e68c0fe977b9b346205fdb473ecbc4c43`.
- Command: `cd mingla-business && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand`.
- Revert result: FAIL, 1 failed / 4 total. Failed assertion: `event overrides win partially and inherit unset brand/default fields`; expected color `#2563eb`, received `#ff6f00`.
- Restored branch result on `51a32af357dcab7993506a062159245d461257d6`: PASS, 4/4.
- Tester adversarial test commit: `ee175d53e0c2c6bb73bc5d4d6ca582059678477c`.
- Fails-on-mutation proof: temporarily changed resolver cutoff `0.179 -> 0.185`; adversarial test failed at `#767676` expected black, received white; restored and reran both suites PASS 5/5.

Proof phrase: fails-on-revert verified at `9d3ce22e68c0fe977b9b346205fdb473ecbc4c43`; tester adversarial boundary proof verified at `ee175d53e0c2c6bb73bc5d4d6ca582059678477c`.

## 8. Constitution 14-Rule Matrix

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | BLOCKED | Event-sheet and theme-editor taps not runtime-tested. |
| One owner per truth | PASS | Theme resolver centralized in `@mingla/event-rendering`; strict-grep gate passed. |
| No silent failures | BLOCKED | Runtime save/link failures not exercised. |
| One key per entity | FAIL | `consumerBrand` cache key exists but logout-specific regression missing. |
| Server state server-side | PASS | Theme columns and public views are DB-backed; no local-only theme truth found. |
| Logout clears everything | FAIL | Missing required repo-running regression for `consumerBrand` logout clearing. |
| Label temporary | N/A | No temporary UI labels introduced for this scope. |
| Subtract before adding | PASS | Shared package extraction reduces duplicate public brand renderers. |
| No fabricated data | PASS | Resolver defaults to Mingla default; no fake brand theme generated. |
| Currency-aware | PASS static | Existing currency fields preserved in cards; no new hardcoded price currency found in theme paths. |
| One auth instance | PASS | No new Supabase auth client found; hooks import existing `supabase`. |
| Validate at right time | PASS DB/static | DB CHECK constraints plus UI validation exist; hex typing UX still P2. |
| Exclusion consistency | PASS static | Checkout theme exclusion gate passed. |
| Persisted-state startup | BLOCKED | Font/native startup not runtime-tested. |

## 9. 4-Device Matrix

| Device | Result |
|---|---|
| Buyer-web Chromium + Safari | BLOCKED. No runnable rebased branch; no Playwright/Safari screenshot proof. |
| iOS Simulator | BLOCKED. iPhone 17 and 17 Pro sims available, but installed app build is stale for associated-domain/native checks. |
| Android Emulator | BLOCKED. Pixel 8 Pro AVD exists, but `adb devices` had no connected device during QA. |
| Seth physical iPhone | BLOCKED. Universal Link checks require post-merge Vercel deploy and fresh signed app. |

## 10. Discoveries For Orchestrator

- D-QA-1: The branch still needs a real rebase and conflict resolution before any PR/close path. This is now a QA blocker, not just a procedural note.
- D-QA-2: The `Brand.kind` type mismatch is a concrete post-META compatibility failure on the current branch. It may disappear after rebase, but that must be proven.
- D-QA-3: Existing `orch-0962-brand-field-map-coverage` remains stale on the branch and should be handled by the orchestrator-owned follow-up already identified as REVIEW D-1.
- D-QA-4: Consumer Android SHA-256 remains the required operator input for SC-17. Tester asked Seth for the consumer app package `com.mingla.app.v2` fingerprint.

## 11. Required Actions

1. Rebase `ORCH-0964-public-page-theme-customization` onto current `origin/main`, resolve conflicts, and rerun ORCH-0964 + META-ORCH-0972 gates on the actual branch.
2. Fix the ORCH-specific business TypeScript errors in `publicEventsService.ts` / `Brand` contract after rebase.
3. Add repo-running logout-cache regression coverage for `['consumerBrand', ...]`.
4. Add consumer app `com.mingla.app.v2` to `assetlinks.json` once Seth provides the Google Play SHA-256 fingerprint.

## 12. Retest Notes

Retest cycle: 1. Next tester pass should start from the rebased branch, rerun the two resolver suites, run business TypeScript enough to prove ORCH-specific errors are gone, then execute the device matrix after fresh native builds and Vercel deploy.
