# QA Report: ORCH-0964 Public Page Theme Customization Retest

> Date: 2026-05-26
> Mode: RETEST
> Verdict: PASS
> Findings: P0:0 P1:0 P2:0 P3:0 P4:3

## 1. Layman Summary

ORCH-0964 passes retest for the shipped branch at `c8d0cc680`. The theme save path, public brand preview, public brand redesign, original-color animation behavior, social icons, public event redesign, presenter photo, maps affordance, event ticket contrast, white event date/time, and React Query cache coverage are verified by code inspection plus focused tests. Runtime EAS/app smoke is still the next release step, not a QA code blocker.

## 2. Inputs Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`
- Prior QA reports: `Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_REPORT.md`, `Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_RETEST_2.md`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`
- Branch/commit: `ORCH-0964-public-page-theme-customization` at `c8d0cc680573ae903f4ceb2e3019a8b80a00afc8`
- Comms ledger: COMMS-0002, COMMS-0003, COMMS-0004, and COMMS-0005 acknowledged by `tester+codex (ORCH-0964 RETEST #3)`.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql` | Nullable theme columns, CHECK constraints, public view theme fields, no new edge-function deploy scope |
| Services | `brandMapping.ts`, `businessEvents.ts`, `publicEventsService.ts` | Brand/event theme mapping, typed column write/read paths, no `brands.kind` dependency regression |
| Hooks/State/Cache | `useBrands.ts`, `useBrandBySlug.ts`, `useEventTheme.ts`, logout-cache regression script | Public preview invalidation, consumer brand/event theme query keys, logout cache clearing |
| Components/Screens | `BrandEditView.tsx`, `ThemeEditorSection.tsx`, shared public brand/event renderers, business adapters, consumer sheet | Save/re-entry theme state, preview controls, liquid-glass brand page, public event cards/maps/photo/date-time |
| Tests/Build | ORCH-0964 Jest suites, logout/cache script, assetlinks script, strict-grep gates, filtered TypeScript | Regression coverage and clean-commit static gates |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Theme save/re-entry persists typed brand columns | `computeDirtyFieldsPatch` includes `theme`; `mapUiToBrandUpdatePatch` writes `theme_color`, `theme_font`, `theme_animation`; brand mapper reads them back | PASS | Evidence: `brandPatch.ts:72-74`, `brandMapping.ts:264-273`, `brandMapping.ts:421-425` |
| Business-app public preview applies saved theme after save | `useUpdateBrand.onSuccess` invalidates `publicEventKeys.brandBySlug(serverBrand.slug)` | PASS | Evidence: `useBrands.ts:385-387`; regression test passed |
| Preview close/share controls remain usable | ORCH-0961 test IDs preserved; hitSlop present; animation overlay is pointer-events none | PASS | Evidence: `PublicBrandPage.tsx:492-503`, `ThemeEntranceAnimation.tsx:42-56` |
| Public brand liquid-glass redesign and premium tabs/cards/buttons shipped | Shared renderer uses `BlurView`, contrast palette, glass panels, segmented tabs, themed social/buttons/cards | PASS | Evidence: `PublicBrandPage.tsx:250-305`, `546-550`, `620-642`, `769-801`, `887-950` |
| Original-color Lottie behavior | Renderer has no `colorFilters`; nine local Lottie files have richer layer counts | PASS | Evidence: `ThemeEntranceAnimation.tsx:48-55`; layer probe showed 22-95 layers per asset |
| Public event redesign, presenter photo, clickable maps, ticket/card contrast, white date/time | Event renderer uses themed palette, brand photo image fallback, maps callback guarded by address privacy, card buttons, white date/time labels | PASS | Evidence: `PublicEventPage.tsx:518-875`, `653-663`, `692-771`, `956-1038`, `538-578` |
| Regression tests are present and not weakened | Focused suites pass; clean-checkout strict-grep gates pass | PASS | Evidence: command outputs in section 5 |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Focused ORCH-0964 Jest suite | `cd mingla-business && npx jest src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/themeAnimations.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts --runInBand` | PASS | 7 suites / 28 tests passed |
| Logout/cache regression | `cd app-mobile && npm run test:orch-0964-logout-cache` | PASS | 5/5 structural checks passed |
| Assetlinks regression from clean commit | `cd /tmp/orch0964-clean-c8d0/mingla-business && npm run test:orch-0964-assetlinks` | PASS | 1 suite / 3 tests passed |
| Strict-grep gates from clean commit | Six ORCH-0964 gates + META-ORCH-0972 data/no-kind gates + ORCH-0963 + ORCH-0863 | PASS | All listed gates passed from `/tmp/orch0964-clean-c8d0` |
| Business filtered TypeScript | `cd mingla-business && npx tsc --noEmit --pretty false` with ORCH-specific error filter | PASS | No `publicEventsService.kind`, `expo-blur`, Lucide, or shared-renderer JSX hits |
| App-mobile filtered TypeScript from clean commit | `cd /tmp/orch0964-clean-c8d0/app-mobile && npx tsc --noEmit --pretty false` with ORCH-specific error filter | PASS | No ORCH-0964 file/shared-renderer hits |
| Branch delta to main | `git log --name-only HEAD..origin/main` | PASS | Behind commits touch only `COMMS_LEDGER.md`; no product-code drift |
| Edge functions | `git diff --name-only origin/main...HEAD -- supabase/functions supabase/migrations` | PASS | Only ORCH-0964 migration appears; no `supabase/functions` changes |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS | Close/share IDs and maps callbacks wired; runtime smoke remains downstream |
| One owner per truth | PASS | `resolveTheme` remains canonical and strict-grep passed |
| No silent failures | PASS | Save patch no longer drops theme-only edits; focused regression passed |
| One key per entity | PASS | Public brand/theme query keys covered by logout/cache regression |
| Server state server-side | PASS | Theme fields are typed DB columns and public views |
| Logout clears everything | PASS | `test:orch-0964-logout-cache` passed |
| No fabricated data | PASS | Renderer uses passed data/fallback labels only |
| Persisted-state startup | PASS static / runtime-gated | Static cache cleanup covered; EAS runtime smoke remains next |

## 7. Findings

### P4 Notes

- The active ORCH worktree contains many untracked duplicate files with names ending in `" 2"`; raw strict-grep and app-mobile filtered TypeScript can fail there because those untracked files include stale code. `git ls-files` confirms those duplicates are not tracked, and the same gates pass from a clean detached checkout of `c8d0cc680`.
- `origin/main` is currently 3 commits ahead of the ORCH branch, but all three are `COMMS_LEDGER.md`-only acknowledgements. No product-code rebase blocker was found.
- Full unfiltered TypeScript still has known unrelated workspace/shared-package debt, so this retest used the same ORCH-specific filtered TypeScript approach documented by implementation.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Theme save/re-entry persistence | PASS | `brandPatch.ts`, `brandMapping.ts`, focused Jest | None |
| Business public preview theme application | PASS | `useBrands.ts` invalidation; public brand tests | None |
| Preview close/share controls | PASS | ORCH-0961 test IDs and hitSlop preserved | None |
| Public brand liquid-glass redesign | PASS | Shared brand renderer + public brand tests | None |
| Original-color Lottie animation behavior | PASS | No `colorFilters`; asset layer probe; animation tests | None |
| Social/link icons | PASS | Lucide social mapping and white icon controls | None |
| Premium tabs/cards/buttons | PASS | Shared renderer palette/tabs/cards/buttons; tests | None |
| Public event redesign | PASS | Shared event renderer and event design tests | None |
| Presenter brand photo | PASS | Brand photo prop and image render path | None |
| Clickable maps location | PASS | `onOpenMaps` host callbacks and hidden-address guard | None |
| Event ticket/card contrast | PASS | Contrast palette + ticket card/button styles; tests | None |
| White event date/time | PASS | `dateLine` and recurrence pill labels use `#ffffff`; tests | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Hidden address privacy on maps | None | `venueMapsQuery` is null when `hideAddressUntilTicket` is true | PASS |
| Android package association exactness | None | Clean assetlinks regression passed | PASS |
| Edge-function deploy guard | None | No `supabase/functions` diff | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Public brand page | Liquid-glass panels, Lucide social buttons, themed tabs/cards/buttons | None | PASS |
| Public event page | Presenter photo, map affordance, ticket CTA contrast, white date/time | None | PASS |
| Public preview chrome | Close/share controls have labels, hit slop, test IDs | None | PASS |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Static + filtered type | PASS | Consumer brand/event theme hooks and event sheet checked |
| Business | Jest + static + filtered type | PASS | Theme editor, adapters, public renderers checked |
| Admin | N/A | N/A | No admin scope |
| Public/web | Static + tests | PASS | Brand/event shared renderers and web adapters checked |
| iOS | Static only | PASS with runtime gate | EAS update and smoke-test remain downstream |
| Android | Static only | PASS with runtime gate | EAS update and smoke-test remain downstream |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Theme columns/resolver | Consumer brand/event theme reads | Brand editor + public preview | N/A | No edge change | Nullable columns + CHECK constraints | PASS |
| Shared public brand/event renderers | Event sheet and brand screen consume shared packages | Public routes consume shared packages | N/A | N/A | Public views provide theme fields | PASS |
| React Query cache | Logout clears consumer public caches | Brand save invalidates public preview cache | N/A | N/A | N/A | PASS |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Business-app EAS update | Not run by tester | DOWNSTREAM | Orchestrator should run fresh business-app EAS Update after review |
| Seth smoke-test | Not run by tester | DOWNSTREAM | Save theme, reopen editor, open public preview, share/close, inspect public brand/event visual changes |
| Android/iOS link tap | Static config/test only | DOWNSTREAM | Validate after fresh build/deploy if close scope still includes App/Universal Links |

## 14. Required Actions

None.

## 15. Conditional / Recommended Actions

1. Clean or ignore the untracked duplicate `" 2"` files before relying on raw local strict-grep/TypeScript output from this worktree.
2. Orchestrator should review this PASS, run the fresh business-app EAS Update, have Seth smoke-test the listed public brand/event flows, then close ORCH-0964 if the smoke-test passes.

## 16. Discoveries For Orchestrator

- No new cross-ORCH comms-ledger entry is needed.
- The only current `origin/main` drift is comms-ledger-only, so product code can proceed to orchestrator review without a product rework loop.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| Theme-only save patch dropped theme | Yes | `brandPatch.ts` + focused Jest | Yes |
| Public preview stale after save | Yes | `useBrands.ts` invalidation + focused Jest | Yes |
| Preview close/share chrome | Yes | ORCH-0961 test IDs + hitSlop + tests | Yes |
| Original-color animation behavior | Yes | No runtime Lottie tinting + layer probe + tests | Yes |
| Public event design/photo/maps/contrast/date-time | Yes | Shared event renderer + 28-test focused suite | Yes |
| SC-21 logout-cache coverage | Yes | `npm run test:orch-0964-logout-cache` | Yes |

Retest cycle: 3. Verdict: PASS.
