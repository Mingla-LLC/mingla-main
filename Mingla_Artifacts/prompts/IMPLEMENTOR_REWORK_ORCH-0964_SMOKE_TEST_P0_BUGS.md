# REWORK DISPATCH — ORCH-0964 [Public-page theme customization] — Smoke-test P0/P1 bugs

**Dispatched:** 2026-05-26 by Claude `mingla-orchestrator` after operator smoke-test
**Target skill:** Codex `implementor-mingla` (the same session that did the prior rework)
**Trigger:** operator smoke-test surfaced 4 product bugs after tester returned CONDITIONAL PASS. Halts CLOSE.
**Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/`
**Branch:** `ORCH-0964-public-page-theme-customization` (HEAD at time of dispatch: `682ede28e`)
**Surface where ALL bugs are visible:** business-app **"View Public Page"** preview button. The business app received a successful EAS Update push earlier today (group `3113e1ba`), so it is running the LATEST JS bundle. These are real bugs in current code, not stale-bundle artifacts.

---

## 1. Goal

Investigate, root-cause, and fix the 4 findings below. Do NOT re-architect — preserve the typed-column schema, the `packages/brand-rendering/` extraction, Amendment 3 data-driven tabs, ORCH-0961 `hideFloatingChrome` opt-out, and all META-ORCH-0972 invariants. After fix, retest end-to-end on iOS sim (your shortest verification loop) and push a commit + bump the implementation report Step 0.5 section with new fails-on-revert proofs if any test files change.

## 2. Operator-observed findings

### F-A (P0) — Theme save doesn't persist on re-entry

**Observed:** Operator opens Business app → Brand → Edit Brand → "PUBLIC PAGE THEME" section → picks color `#8B5CF6` (or similar memorable hex), font `Playfair Display`, animation `Fireworks` → taps Save. Success toast fires. Operator navigates away, returns to Edit Brand. Theme section shows **defaults** again, not the values just saved.

**What I (orchestrator) already verified by code-reading and DO NOT need re-checked:**
- `mingla-business/src/services/brandMapping.ts:421-424` — `mapUiToBrandUpdatePatch` includes `theme_color/theme_font/theme_animation` when `patch.theme !== undefined`. Looks correct.
- `mingla-business/src/services/brandMapping.ts:264-271` — `mapBrandToUi` unpacks the columns from row back into `brand.theme`. Looks correct.
- `mingla-business/src/services/brandsService.ts:300` — `getBrand` / `getBrands` use `.select("*")`. All columns return.
- `mingla-business/src/components/theme/ThemeEditorSection.tsx:51-71` — `commit` handler properly fires `onChange(next)` with merged values.
- `mingla-business/src/components/brand/BrandEditView.tsx:604-606` — ThemeEditorSection mounted with `value={draft.theme}` + `onChange={(theme) => setDraft({ ...draft, theme })}`. Looks correct.

**So the mechanical wiring SHOULD work but doesn't.** Investigate ONE of these three suspects:

1. **Diff-based patch path drops theme** — somewhere between `setDraft({ ...draft, theme })` and the `useUpdateBrand` mutation call, a diff-style patch builder may compare `draft.theme` vs `originalBrand.theme` by reference equality, decide nothing changed, and omit `theme` from the patch entirely. **Look at:** the save handler at `BrandEditView.tsx:296` (`await onSave(draft)`), trace `onSave` to wherever it converts draft → mutation patch, verify `theme` survives.

2. **React Query cache stale after save** — the mutation succeeds, DB has theme, but `useUpdateBrand`'s optimistic update or cache invalidation strips/skips `theme`. On re-entry, BrandEditView reads from stale cache with `theme = null` and re-initializes draft. **Look at:** `useUpdateBrand` mutation in `mingla-business/src/hooks/useBrands.ts`. Specifically the `onMutate` optimistic shape, the `onSuccess` invalidation, and any `setQueryData` calls. Verify whether the mutation's optimistic merge preserves `theme` and whether the subsequent refetch's query key matches BrandEditView's read key.

3. **Initial draft hydration ignores theme** — when BrandEditView mounts/re-mounts, the `draft` is seeded from props.brand. If the seed logic spreads brand but defaults `theme` to `null` or `undefined` instead of `brand.theme`, the saved value is never read into the form. **Look at:** `BrandEditView.tsx` initial state for `draft`, specifically how `draft.theme` is initialized.

**Mandatory diagnostic before fixing — run this DB probe to localize:**

```bash
# Pick a brand_id you tested with, replace <BRAND_ID>:
PGPASSWORD=$SUPABASE_DB_PASSWORD psql "<production-db-url>" -c "SELECT id, slug, theme_color, theme_font, theme_animation FROM brands WHERE id = '<BRAND_ID>';"
```

OR equivalent via `mcp__supabase__execute_sql` if available OR via the Management API per `feedback_supabase_mcp_workaround.md`. Capture the output in the implementation report.

- **If theme_color is NULL or empty after Seth's save** → suspect 1 (write-side patch drops theme).
- **If theme_color contains Seth's hex** → suspect 2 or 3 (cache/re-hydration side).

### F-B (P1) — "View Public Page" preview in business app shows no theme

**Observed:** Operator taps "View Public Page" button in business app (from BrandEditView or brand detail screen — confirm exact button location). The preview that opens shows:
- Black/default background instead of the operator-chosen color
- No animation playing
- Default font on headings

**Likely root cause class:** the business-app preview either (a) mounts `packages/brand-rendering/PublicBrandPage.tsx` WITHOUT passing the resolved theme prop, OR (b) passes the theme prop but the shared component doesn't actually apply `theme.color` to hero background / `theme.fontFamilyValue` to headings / `theme.animation` to entrance Lottie.

**Investigate:**

1. Find the "View Public Page" button in business app code. Likely in `BrandEditView.tsx` near the close, or a `BrandPreviewSheet` component. Trace what component it mounts and what props it passes.
2. If the preview mounts shared `PublicBrandPage`, verify it computes `resolvedTheme = resolveTheme(brand.theme ?? null, null)` from `@mingla/event-rendering` and passes it down.
3. Open `packages/brand-rendering/PublicBrandPage.tsx`. Verify:
   - Hero band element has `style={{ backgroundColor: theme.color }}` (NOT a hardcoded color or `theme.foregroundColor` by accident)
   - Headings have `style={{ fontFamily: theme.fontFamilyValue }}`
   - `<ThemeEntranceAnimation theme={theme} sessionKey="..." />` is mounted ONCE somewhere visible at first render
4. If F-A is a write-side bug (theme never reached DB), then F-B is downstream — fixing F-A should fix F-B automatically. Confirm by re-testing after F-A fix.

**The black background specifically is suspicious.** The default Mingla theme color is `#eb7825` (orange) per `MINGLA_DEFAULT_THEME` in `packages/event-rendering/designTokens.ts`. If operator sees BLACK, it's not falling through to the Mingla default either — something is overriding to a literal black or no background. Trace.

### F-C (P1) — X close button not tappable

**Observed:** On the same "View Public Page" preview, the X button to close the preview is visible but tapping it does nothing.

**Context:** ORCH-0961 (closed 2026-05-25) added Close+Share `IconChrome` to the public brand page with explicit `testID` handles + `router.canGoBack()` fallback chain. ORCH-0964 extracted `PublicBrandPage` into `packages/brand-rendering/`. Either:

1. **`onClose` callback not threaded** — the business-app preview mounts shared `PublicBrandPage` with `onClose` prop missing or `undefined`. The X is rendered but its `onPress` no-ops because the handler is missing.
2. **Hit area collapsed** — the IconChrome wraps a Pressable but a parent View has `pointerEvents="none"` or zero hit area.
3. **Wrong layering** — another absolutely-positioned element (the hero band? the entrance-animation overlay?) is on TOP of the close button and intercepting taps.

**Investigate:**

1. Open `packages/brand-rendering/PublicBrandPage.tsx`, find the close button definition. Confirm `onClose` is a prop (not a hardcoded handler).
2. Open the business-app preview component (likely `BrandEditView.tsx` or a `BrandPreviewSheet`). Confirm it passes `onClose={() => /* close preview */}` to PublicBrandPage.
3. Verify the entrance-animation Lottie overlay has `pointerEvents="none"` so it doesn't intercept taps on the chrome behind it.

### F-D (P1) — Up-arrow icon where share should be

**Observed:** Upper right of the "View Public Page" preview shows what looks like an up-arrow glyph (↑) instead of a share icon (the iOS share-square or similar).

**Likely root cause:** wrong icon-name string passed to `IconChrome` (or whatever icon primitive the chrome uses). The icon set probably has "share-outline", "share-2", "ios-share", or similar — if Codex used a slightly wrong name, the icon library either substitutes a default OR the name happens to resolve to an up-arrow glyph.

**Investigate:**

1. Find where the share icon is set in `packages/brand-rendering/PublicBrandPage.tsx`. Look for `<IconChrome icon="..." />` or equivalent in the floating chrome row.
2. Check which icon-set the project uses (likely `@expo/vector-icons` Ionicons or Feather). Cross-reference the icon name against the icon set's catalog.
3. Compare against the buyer-web version on `main` (commit `dd49d6d2b` ORCH-0963 close + ORCH-0961 close PR #213) — verify which icon name was working there before the package extraction.
4. **Suggested correct names:** Ionicons `share-outline` or `share-social-outline`; Feather `share-2` or `share`. Pick whichever matches the existing project convention.

## 3. Bundle scope to NOT touch (preserve)

- `packages/brand-rendering/PublicBrandPage.tsx` data-driven tabs — Upcoming / Events / Trips / Experiences / About per Amendment 3 + META-ORCH-0972's `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` invariant.
- `packages/brand-rendering/` MUST stay self-contained — zero imports from `mingla-business/src` or `app-mobile/src`. The `orch-0964-brand-rendering-self-contained.mjs` strict-grep gate enforces.
- `<TripMiniCard>` / `<ExperienceMiniCard>` "Booking closed" / "Sold out" badges — DO NOT theme; they keep destructive-state colors per Amendment 3 §2 Action 3.
- DB migration `20260729000002` — already applied. No new migration unless absolutely necessary; if needed, follow the migration-collision-scan procedure.
- ORCH-0961 `hideFloatingChrome` opt-out — preserve. Theme prop is additive.
- Step 0.5 happy-path test at `themeResolver.orch_0964.test.ts` — append-only.
- 6 ORCH-0964 strict-grep gates — must remain PASS after rework.
- META-ORCH-0972 `meta-orch-0972-no-brand-kind-reads.mjs` + `meta-orch-0972-data-driven-tabs.mjs` — must remain PASS.
- ORCH-0962 `orch-0962-brand-field-map-coverage.mjs` — already broken on main per prior REVIEW D-1; not your fix scope here.

## 4. Verification before re-handing off to orchestrator

1. **F-A re-test:** save theme in BrandEditView → toast fires → navigate away → return → confirm theme values STILL show in the section. Capture screenshot or video.
2. **F-A DB probe** post-fix: confirm `brands.theme_color` column contains the saved hex.
3. **F-B re-test:** tap "View Public Page" preview → confirm hero background = chosen color, NOT black, NOT default orange (unless operator picked orange). Headings render in chosen font. Entrance animation plays once.
4. **F-C re-test:** tap X close button on preview → preview dismisses. Verify `testID` selectors still match (do NOT change them — they're load-bearing for tester automation per ORCH-0961).
5. **F-D re-test:** verify upper-right icon is the correct share glyph (looks like share, not arrow).
6. **All 6 ORCH-0964 strict-grep gates + 2 META-ORCH-0972 gates + ORCH-0963 gate** PASS post-fix.
7. **Step 0.5 happy-path test still PASSES** (and add a new test that exercises F-A specifically — diff-based-patch test OR cache-invalidation test, whichever applies).
8. **Update implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` with new section "Smoke-Test Rework" naming the 4 findings, root causes confirmed, and the DB-probe result.

## 5. Hard guards — DO NOT

- DO NOT touch tests + scripts that already PASS — append, don't modify (`tests-append-only.yml` enforces; if you must modify, you need `[TEST-MOD-APPROVED ORCH-0964]` in the commit body).
- DO NOT widen scope beyond these 4 bugs.
- DO NOT remove `hideFloatingChrome` opt-out for ORCH-0961.
- DO NOT add a new DB migration unless F-A's root cause GENUINELY requires schema change (it almost certainly does not).
- DO NOT change the `testID` strings on close/share icons — tester automation depends on them.
- DO NOT redeploy any edge functions — META-ORCH-0972 Sub-D versions (parse-restaurant-menu v39, parse-play-activities v38, agent-chat v72, agent-confirm-action v67) must stay.
- DO NOT skip the DB probe for F-A — it determines which of suspects 1/2/3 is the actual root cause and prevents fixing the wrong thing.

## 6. Expected output

- Commits on per-ORCH branch with clear segmentation (e.g., one commit per finding OR one commit for write-path + one for render-path).
- Push to `origin/ORCH-0964-public-page-theme-customization`.
- Updated `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` with the "Smoke-Test Rework" section.
- Updated regression test(s) with `fails-on-revert verified at <commit>` proof for the F-A fix.
- Status reply to orchestrator confirming all 4 findings cleared on iOS sim.

## 7. Downstream routing

After Codex pushes + reports completion:
1. Claude `mingla-orchestrator` (this skill) re-REVIEWS.
2. Orchestrator publishes a fresh EAS Update to the development channel for the BUSINESS app.
3. Operator (Seth) re-runs smoke-test Step 1 (theme save round-trip) + smoke-test Step 4-equivalent ("View Public Page" preview rendering).
4. If operator confirms PASS → orchestrator runs CLOSE protocol (rebase + commit + PR + merge + Vercel deploy + EAS production builds queue).
5. If any of the 4 still broken → re-dispatch with specific failure details.

## 8. Workspace-symlink note (orchestrator side-task, not yours)

The CONSUMER app's EAS Update is currently failing on the orchestrator's local Mac because `mingla-business/node_modules/@mingla/` doesn't have workspace symlinks. Orchestrator will fix this independently via `pnpm install` (or equivalent) — does NOT block your rework. Your fixes ship through the BUSINESS app's already-working EAS Update channel.
