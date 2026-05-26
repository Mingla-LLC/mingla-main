# IMPLEMENTATION REPORT — ORCH-0964 Public-page theme customization + consumer brand screen + deep links

**Status:** implemented, partially verified  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`  
**Branch:** `ORCH-0964-public-page-theme-customization`  
**Latest contract:** base SPEC + Amendments 1, 2, and Amendment 3 post-META-ORCH-0972.

## Summary

ORCH-0964 now adds typed brand/event theme columns, shared theme resolution, themed buyer-web public brand/event rendering, a consumer-app brand screen, consumer event-sheet brand navigation, and Universal/App Link app config. Amendment 3 was applied after rebase: `PublicBrandPage` is data-driven (Upcoming / Events / Trips / Experiences / About), `ExperienceMiniCard` is included in `packages/brand-rendering`, and the hooks use upcoming + experience RPCs without `brands.kind` reads.

## Implemented

- Added migration `supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql`.
  - `brands.theme_color`, `brands.theme_font`, `brands.theme_animation`.
  - `events.theme_color_override`, `events.theme_font_override`, `events.theme_animation_override`.
  - CHECK constraints for hex colors, 14-font whitelist, and 10-animation whitelist.
  - Recreated the three public views without `b.kind`, preserving META-ORCH-0972 view shape and adding theme columns.
- Added shared theme resolver and animation support in `packages/event-rendering`.
- Added `packages/theme-animations` with bundled local Lottie JSON assets.
- Added `packages/brand-rendering` with shared `PublicBrandPage`, `EventMiniCard`, `TripMiniCard`, `ExperienceMiniCard`, and `NextOfferingTeaser`.
- Converted `mingla-business/src/components/brand/PublicBrandPage.tsx` into a thin adapter over the shared package.
- Added `mingla-business/src/components/theme/ThemeEditorSection.tsx` and mounted it in:
  - Brand edit UI for brand default theme.
  - Published event edit UI for per-event overrides with "Use brand default" reset.
- Extended business mapping/service write paths for theme columns and event override columns.
- Added consumer screen and routing:
  - `app-mobile/app/brand/[slug].tsx`
  - `app-mobile/app/b/[slug].tsx`
  - `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx`
  - `app-mobile/src/hooks/useBrandBySlug.ts`
  - `app-mobile/src/hooks/useEventTheme.ts`
- Added consumer event-sheet brand tap navigation to `/brand/<slug>`.
- Registered theme fonts in both app root layouts without mounting a theme provider.
- Added iOS Associated Domains and Android intent filters for `/b/*` links.
- Added consumer iOS app ID to `mingla-business/public/.well-known/apple-app-site-association` for `/b/*`.
- Added six ORCH-0964 strict-grep gates and workflow jobs.
- Updated ORCH-0863 backend allowlist for the ORCH-0964 migration.
- Preserved the META-ORCH-0972 data-driven public-page contract inside `packages/brand-rendering/PublicBrandPage.tsx`; this ORCH branch does not wire the global META hub gate because it is not rebased onto the full META-ORCH-0972 source cleanup.

## Guard Verification

- No theme keys are written to `events.theme` JSONB; event overrides write typed columns only.
- No theme provider was mounted in `mingla-business/app/_layout.tsx`; only fonts are registered.
- `packages/brand-rendering` has no `mingla-business/src` or `app-mobile/src` imports.
- `PublicBrandPage` has no `isTripBrand`, `brand.kind`, `brand_kind`, or `b.kind` branch.
- `supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql` has no `b.kind` or `brand_kind` references.
- Edge functions from META-ORCH-0972 Sub-D were not touched or redeployed.
- `app-mobile/app/brand/[slug].tsx` and `app-mobile/app/b/[slug].tsx` both export the same `ConsumerBrandProfileScreen`; both routes therefore mount the same screen and use the same `useBrandBySlug` hook with no divergent screen logic.

## Verification Run

Passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand
```

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs
```

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs
```

Migration history:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && /Users/sethogieva/bin/supabase migration list --linked
```

Result: first run exposed remote-only `20260729000000` and `20260729000001` from META-ORCH-0972. Those already-applied migration files were source-reconciled from `origin/main`, then the rerun showed local and remote aligned through `20260729000001`; new local-only migration is `20260729000002_orch_0964_brand_event_theme_columns.sql`. No remote-only migration rows were present after reconciliation.

Full TypeScript:

```bash
cd mingla-business && npx tsc --noEmit --pretty false
cd app-mobile && npx tsc --noEmit --pretty false
```

Result: failed. Failures include existing app-level type debt plus shared-package module resolution from `../packages/*` not seeing app-local `react`, `react-native`, `expo-haptics`, `lottie-react-native`, and payment package types. A targeted filter found no ORCH-0964-specific errors in business files after the event theme patch; app-mobile still reports shared-package resolution noise.

## Step 0.5 Regression Test

Implemented happy-path resolver regression:

- `mingla-business/src/utils/__tests__/themeResolver.orch_0964.test.ts`
- Covers default fallback, partial event override inheritance, foreground flip, and invalid DB values falling through safely.

Fails-on-revert verified at `9d3ce22e68c0fe977b9b346205fdb473ecbc4c43`.

Proof run:

```bash
cd "/tmp/orch0964-revert-proof.8QYRHo/mingla-business" && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand
```

Result: FAIL, with one assertion failing in `event overrides win partially and inherit unset brand/default fields`. The proof commit reverted `packages/event-rendering/themeResolver.ts` so event override color no longer won over brand color; the test expected `#2563eb` and received `#ff6f00`.

Restored run:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand
```

Result: PASS, 4 tests passed.

## Migration Apply Command

Seth must apply the migration with:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && /Users/sethogieva/bin/supabase db push --linked
```

No data pre-flight probe is required: all new columns are nullable, CHECK constraints allow NULL, and no backfill or cleanup predicate can abort on existing rows.

## Remaining Inputs / Gaps

- Android App Links require the production SHA256 fingerprint for `com.mingla.app.v2`; `assetlinks.json` was not safely extended without it.
- `usemingla.com` host repo still needs confirmation before adding `.well-known` files there. Current checked-in `.well-known` coverage is `mingla-business` / `business.usemingla.com`.
- EAS build queue IDs are not produced yet. Because this ORCH adds fonts, Lottie, a native route, and associated domains, both native apps require EAS builds before ship.
- Full TypeScript remains blocked by existing workspace/shared-package type-resolution debt; targeted resolver and strict-grep gates passed.

## Downstream Routing

Next: Claude `mingla-orchestrator` REVIEW should inspect this implementation against Amendment 3, decide whether the remaining App Link SHA / `usemingla.com` host input blocks promotion, and either route back for rework or send Seth to run the Supabase migration command above. After migration and `.well-known` deployment verification, route to Claude `mingla-tester` TEST with the 4-device matrix.
