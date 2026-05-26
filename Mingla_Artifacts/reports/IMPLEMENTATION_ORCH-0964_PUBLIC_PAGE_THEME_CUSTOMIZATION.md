# IMPLEMENTATION REPORT — ORCH-0964 Public-page theme customization + consumer brand screen + deep links

**Status:** implemented, partially verified  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`  
**Branch:** `ORCH-0964-public-page-theme-customization`  
**Latest contract:** base SPEC + Amendments 1, 2, and Amendment 3 post-META-ORCH-0972.

## Summary

ORCH-0964 now adds typed brand/event theme columns, shared theme resolution, themed buyer-web public brand/event rendering, a consumer-app brand screen, consumer event-sheet brand navigation, and Universal/App Link app config. Amendment 3 was applied after rebase: `PublicBrandPage` is data-driven (Upcoming / Events / Trips / Experiences / About), `ExperienceMiniCard` is included in `packages/brand-rendering`, and the hooks use upcoming + experience RPCs without `brands.kind` reads.

## Smoke-Test Rework — P0/P1 operator findings

Operator smoke-test rework was implemented in two scoped commits:

- `a71648342` — fixes F-A write path by adding `theme` to `computeDirtyFieldsPatch`, so a public-page theme-only edit no longer produces an empty mutation patch.
- `4e57df035` — fixes F-B/F-C/F-D preview rendering/chrome by applying the resolved theme to the shared hero band, keeping the entrance animation `pointerEvents="none"`, threading a safe top offset from the business adapter, restoring ORCH-0961 brand chrome test IDs, adding hit slop/elevation, and replacing the bad `up` text glyph with a self-contained share glyph.

Mandatory DB probe result:

```sql
select id, slug, name, theme_color, theme_font, theme_animation, updated_at
from public.brands
order by updated_at desc nulls last
limit 20;
```

Result summary: the 20 most recently updated production brand rows all had `theme_color = null`, `theme_font = null`, and `theme_animation = null`; the newest row was `22a18413-bfbf-4087-9ba7-45f70deba0f3` / `leggothis` / `Leggo This` at `2026-05-26 06:34:08.726161+00`, also all-null. That localizes F-A to suspect 1 from the dispatch: the write-side diff patch dropped `theme` before `useUpdateBrand`/`mapUiToBrandUpdatePatch` could write typed columns. I did not mutate production to create a fresh post-fix row; the operator EAS smoke-test remains the production write/read proof after a new bundle is pushed.

Finding outcomes:

- F-A (P0): root cause confirmed as diff-patch drop. `BrandEditView` called `onSave(draft)`, but `computeDirtyFieldsPatch(next, brand)` skipped `theme`, so theme-only edits short-circuited as a no-op while the view still showed "Saved".
- F-B (P1): downstream of F-A for saved values, plus renderer hardening. The business adapter already passed `theme={theme}` into the shared page; the shared hero band now carries `backgroundColor: heroColor`, so the selected theme color is the band fallback instead of black/default.
- F-C (P1): preview close wiring was present, but the extracted shared chrome had lost the ORCH-0961 test IDs and had a smaller/no explicit hit-slop contract. The shared close/share buttons now preserve `orch-0961-public-brand-close` / `orch-0961-public-brand-share`, use `hitSlop={8}`, `elevation: 8`, `pointerEvents="box-none"` on the row, and the animation overlay remains non-interactive.
- F-D (P1): root cause confirmed as the shared chrome rendering the share glyph as text `"up"`. The share button now renders a self-contained share-node glyph using React Native views.

New regression tests:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 2 suites / 5 tests passed.

F-A fails-on-revert proof: created detached proof worktree at `a71648342`, removed only the `theme` comparison block from `mingla-business/src/utils/brandPatch.ts`, symlinked the existing `mingla-business/node_modules`, and ran:

```bash
cd "/tmp/orch0964-fa-proof.q2WLUT/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts --runInBand
```

Result: FAIL as expected. Both tests failed because `computeDirtyFieldsPatch(...)` returned `{}` instead of `{ theme: ... }` / `{ theme: null }`.

Rework verification run:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 4 suites / 10 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed gates passed.

iOS simulator availability check:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && xcrun simctl list devices booted
```

Result: PASS; iPhone 17 Pro and iPhone 17 simulators were booted. I did not run the full in-app smoke flow because no local Expo/dev-client session was active in this Codex turn, and production DB mutation is reserved for the operator smoke-test after the fresh business-app EAS Update.

TypeScript note: full `mingla-business` TypeScript remains blocked by the same existing app/shared-package resolution debt documented below; this rework did not add a new package dependency.

## Smoke-Test Follow-Up — saved theme still not visible

Seth re-smoked after `b4c5c670d` and confirmed theme values now save, but the public brand page still showed no noticeable visual change. A follow-up production DB probe confirmed the saved theme reached typed columns:

```sql
select id, slug, name, theme_color, theme_font, theme_animation, cover_media_url, updated_at
from public.brands
where theme_color is not null or theme_font is not null or theme_animation is not null
order by updated_at desc nulls last
limit 10;
```

Result summary: `22a18413-bfbf-4087-9ba7-45f70deba0f3` / `leggothis` / `Leggo This` had `theme_color = '#9333ea'`, `theme_font = 'playfair_display'`, `theme_animation = 'confetti'`, and a GIPHY `cover_media_url`. That localized the remaining problem to read/render freshness and cover-media visual masking, not the DB write path.

Follow-up fixes:

- `useUpdateBrand.onSuccess` now invalidates `publicEventKeys.brandBySlug(serverBrand.slug)`, so the in-app `/b/{slug}` preview does not reuse a fresh-but-stale public brand query after saving the private brand editor form.
- `packages/brand-rendering/PublicBrandPage.tsx` now applies a theme-color tint over hero cover media, plus theme-tinted social buttons and tab band accents. This makes brand theme visible even when a cover image/GIF fills the hero.

Follow-up regression tests:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 2 suites / 6 tests passed.

Full focused rework check:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 13 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed gates passed.

## Smoke-Test Design Rework — premium theme-owned public page + animation replay

Seth confirmed theme colors now save and appear, then requested a stronger public-brand-page design pass: the page should feel modern, premium, and customizable, with the full background/text system matching the chosen theme instead of only placing the accent color in a few controls. The rework stays inside the existing ORCH-0964 surface and does not add a migration or new DB column.

Design/implementation changes:

- `packages/brand-rendering/PublicBrandPage.tsx` now derives a full `ThemePalette` from `ResolvedTheme`, including light/dark page background, cover wash, profile panel, profile-photo ring, readable primary/secondary/tertiary text, tab band, cards, and about blocks.
- The page background can flip between a premium light surface and near-black surface based on the existing foreground-contrast resolver, so chosen theme colors can support either white-leaning or black-leaning public pages without adding schema.
- Cover media now receives a theme-owned wash and scrim, the brand profile photo is larger with a themed ring/shadow, and brand title/tagline/bio/card text all use palette-derived readable colors.
- Event/trip/upcoming/experience cards, empty states, the next-offering teaser, social buttons, and about/contact panels now use palette colors instead of fixed dark glass/text.
- `packages/event-rendering/ThemeEntranceAnimation.tsx` adds optional `replayOnMount`; `PublicBrandPage` passes it with a session key containing brand slug + color + font, so public brand animations replay when the page mounts while the event page keeps the old one-play-per-session default.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 1 suite / 5 tests passed. The test now guards the palette-owned page surface/card/text treatment and the public-brand-only animation replay contract.

Focused rework check:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 14 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

TypeScript note: full `mingla-business` TypeScript remains blocked by existing unrelated app/shared-package type debt, including pre-existing `home.tsx`, checkout, ComposerV2, payment package, old test fixture `category`, and shared-package module-resolution errors. This rework did not introduce a new package dependency; focused regression and strict-grep gates are the release proof for this scoped pass.

## Smoke-Test Design Rework #2 — contrast solver + full-page animation overlay

Seth re-smoked the first design pass and reported that the page still needed better color science and that the animation still did not show. The second design rework keeps the same ORCH-0964 scope and existing DB fields, but changes the renderer from a foreground-flag palette to a contrast-measured palette.

Follow-up changes:

- `packages/brand-rendering/PublicBrandPage.tsx` now computes relative luminance and contrast ratio for the saved theme color against light and dark page surfaces.
- The renderer chooses the better light/near-black page base for the selected brand color, then adjusts the displayed accent toward white or black until it reaches a minimum contrast target against the page.
- The contrast-adjusted accent now drives badges, profile-photo ring/shadow, social glyphs, selected tab underline, date labels, contact links, next-offering affordances, and pinned CTA pills; CTA text uses a separately computed `accentText`.
- `ThemeEntranceAnimation` is no longer mounted inside the cover band. `PublicBrandPage` mounts it as a root-level overlay after the scroll view, passes the contrast-adjusted accent through `colorOverride`, and `ThemeEntranceAnimation` now supports that override with Android elevation.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 1 suite / 5 tests passed. The test now guards the contrast solver primitives, the adjusted accent/color override contract, and the root-level page overlay mount.

Focused rework check:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 14 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #3 — full public brand page redesign

Seth requested a total public-brand-page redesign: preserve the same public brand/event/trip/experience/about data, but change the rendering from a basic profile/list into a sophisticated theme-owned page with more dramatic ticket CTAs. This rework stays in `packages/brand-rendering/PublicBrandPage.tsx`; no data model, migration, RPC, or edge function changed.

Design/implementation changes:

- The cover now behaves as a taller editorial stage with page-level theme washes above and below the content.
- The old centered identity stack is replaced by a masthead card with a left-aligned avatar/title/address hierarchy, followed by theme-font tagline and bio inside the masthead.
- Social links, next-offering teaser, tabs, tab bodies, empty states, and about blocks now align to a consistent 620pt content rail instead of floating as unrelated rows.
- Tabs now render as a segmented control with the active tab filled by the contrast-adjusted theme accent.
- Event/trip/upcoming/experience cards now render as vertical feature cards with full-width cover media, stronger typography, and more editorial spacing.
- The first three event cards keep the ORCH-0963 pinned-ticket contract but render the ticket affordance as a large full-width themed `Buy tickets` button inside the card body instead of a small absolute pill.
- Trip scarcity/closed badges now use palette-derived backgrounds/text so they remain legible on both light and dark surfaces.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 15 tests passed. The public-page test now guards the editorial masthead, secondary page wash, vertical feature cards, and large non-absolute themed ticket CTA.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #4 — solid surface, real cover section, icon links

Seth rejected the decorative static background/parallax feel from the prior pass and clarified the desired premium direction: a solid surface, a clear cover section, and link buttons that render as actual icons. This rework keeps the same data and callbacks but removes the visual mechanics that made the page feel artificially layered.

Follow-up changes:

- Removed the angled page wash background views; the page now uses a single solid theme-computed surface.
- Moved the cover from an absolute layer behind the scroll into the scroll content itself, so it reads as a clear cover section instead of a parallax/static background layer.
- Kept the cover media treatment simple: cover image/fallback color, theme tint, and readable scrim inside that cover section only.
- Replaced social-link initials with `SocialIcon` view-drawn glyphs for website, Instagram, TikTok, X, Facebook, YouTube, LinkedIn, and Threads without adding a new package dependency.
- Added regression assertions that the decorative wash views are gone, the cover is not absolute-positioned, and social buttons no longer render `entry.label.charAt(0)`.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 1 suite / 7 tests passed.

Focused rework check:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 16 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #5 — white branded controls, premium switcher, native animations

Seth requested a final polish pass on social icons, control foregrounds, the tab switcher, alignment, and the animation variants. The key product decision in this pass is that brand color owns boxes/buttons, while foregrounds inside branded controls stay white.

Follow-up changes:

- The contrast solver now darkens light theme colors as needed so white text/icons on branded controls remain legible.
- Social buttons now render as brand-colored circular buttons with white icon glyphs.
- The next-offering teaser, active tab switcher, and `Buy tickets` CTA use brand-colored control surfaces with white foregrounds.
- The tab switcher is now a single branded segmented control with white labels and a translucent active segment, instead of a lightly tinted strip.
- The cover and main content rail are aligned to the same 620pt max width.
- `ThemeEntranceAnimation` no longer applies a blanket Lottie `colorFilters` override. Confetti, fireworks, balloons, and other saved animations now keep their native artwork, so the selected animation should look distinct instead of monochrome.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 17 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #8 — real original-color Lottie animations

Seth reported that the selected public-page animations still looked fake and carried Mingla orange. Root cause: animation selection was correct, but the bundled Lottie files were generated from only three generic `tintable` layers per animation. Seth then clarified that animations should keep their original artwork colors instead of inheriting the chosen brand color.

Animation selection contract:

- The brand editor saves the selected animation slug to the brand theme.
- Public brand and event views call `resolveTheme(...)`.
- `resolveTheme` chooses the event override animation first, then the brand animation, then `none`.
- `ThemeEntranceAnimation` uses that resolved slug as `LOTTIE_BY_SLUG[theme.animation]`.

Follow-up changes:

- Replaced all nine bundled Lottie files with richer in-house vector animations:
  - `confetti`: 46 falling/fluttering pieces.
  - `fireworks`: 95 burst core/ray layers.
  - `balloons`: balloon bodies, highlights, and strings.
  - `sparkles`: star twinkles.
  - `glitter_shower`: falling glitter shards.
  - `snowfall`: drifting snowflake stars.
  - `falling_petals`: petal-shaped falling elements.
  - `hearts`: floating heart paths.
  - `shimmer_reveal`: sweeping shimmer bands and glints.
- Removed runtime `colorFilters` so each selected Lottie keeps its original colors.
- Added `themeAnimations.orch_0964_smoke_rework.test.ts` to prove selection is slug-driven, renderer tinting is absent, and bundled assets are no longer three generic tintable layers.
- Updated the animation package README to document the data-driven slug selection and original-color rendering contract.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/themeAnimations.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 2 suites / 13 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/themeAnimations.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 6 suites / 22 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #7 — liquid glass, full-width cover, cut-out cards

Seth requested a stronger premium material pass: the public brand page should feel liquid-glass, the cover should read as a true full-width cover, and upcoming/event cards should feel cut out from the themed background.

Follow-up changes:

- Added `expo-blur` to the shared brand renderer surface and declared it as a `packages/brand-rendering` peer dependency; both host apps already carry `expo-blur`.
- Added narrow `expo-blur` TypeScript path aliases in both host apps, matching the earlier Lucide shared-package alias pattern.
- Reworked the cover from a constrained 620pt card into a full-width 332pt cover band that bleeds past the page gutters and lets the identity glass card overlap it.
- Added `BlurView` liquid-glass layers to the identity card, tab switcher, next-event banner, event/trip/experience/upcoming cards, and about/contact panels.
- Updated event/upcoming/trip/experience cards to use translucent glass fills, brighter cutout borders, larger cover media, deeper shadows, and larger spacing so they lift off the background instead of blending into it.
- Extended the ORCH-0964 public-page smoke test to fail if the page loses the full-width cover, `expo-blur` glass layer, or cut-out event-card treatment.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 1 suite / 11 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 20 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && if rg -n 'expo-blur|lucide-react-native|packages/brand-rendering/PublicBrandPage\.tsx.*(JSX element type|not assignable|has no construct|has no call)' /tmp/orch0964-glass-business-tsc.log; then exit 1; else exit 0; fi
```

Result: PASS for the new `expo-blur` / shared-renderer surface. Full TypeScript still has the previously documented shared-package `react` / `react-native` module-resolution debt, but no `expo-blur`, Lucide, or shared-renderer JSX errors are present.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/app-mobile" && if rg -n 'expo-blur|lucide-react-native|packages/brand-rendering/PublicBrandPage\.tsx.*(JSX element type|not assignable|has no construct|has no call)' /tmp/orch0964-glass-app-tsc.log; then exit 1; else exit 0; fi
```

Result: PASS for the new `expo-blur` / shared-renderer surface.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #6 — Lucide links, event banner, premium brand masthead

Seth requested a tighter premium pass after reviewing the latest public brand page: social links needed real Lucide icons, the next-event unit needed to feel like a marketing banner instead of a button, and the brand photo/name/description block needed stronger typography and styling.

Follow-up changes:

- Replaced the custom-drawn social glyphs with `lucide-react-native` icons (`Globe2`, `Instagram`, `Music2`, `X`, `Facebook`, `Youtube`, `Linkedin`, `AtSign`) in the shared renderer.
- Added `lucide-react-native` to `mingla-business` and declared it as a peer for `packages/brand-rendering`; `app-mobile` already carried the dependency.
- Added narrow `tsconfig` path aliases in both host apps so the shared package resolves `lucide-react-native` from each app's local dependency during TypeScript checks.
- Kept social link buttons brand-colored with white icon strokes, preserving the product rule that foregrounds inside branded controls stay white.
- Reworked the next offering into a full-width rectangular `NEXT EVENT` promo banner with two-line event copy and a subtle white "View" action chip.
- Upgraded the identity block with larger avatar/photo treatment, stronger name typography, roomier spacing, and shadowed card depth while keeping the content rail aligned to the cover and tabs.
- Extended the ORCH-0964 public-page smoke test to fail if the page falls back to custom icon shapes, a compact next-event pill, or the smaller identity-card treatment.

Regression coverage:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts --runInBand
```

Result: PASS, 1 suite / 10 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 5 suites / 19 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx tsc --noEmit --pretty false 2>&1 | tee /tmp/orch0964-lucide-public-page-tsc.log >/dev/null; if rg -n 'lucide-react-native|packages/brand-rendering/PublicBrandPage\.tsx.*(JSX element type|not assignable|has no construct|has no call)' /tmp/orch0964-lucide-public-page-tsc.log; then exit 1; else exit 0; fi
```

Result: PASS for the new Lucide/shared-renderer surface. Full TypeScript still has the previously documented shared-package module-resolution debt, but no `lucide-react-native` or Lucide JSX errors are present.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/app-mobile" && npx tsc --noEmit --pretty false 2>&1 | tee /tmp/orch0964-app-lucide-public-page-tsc.log >/dev/null; if rg -n 'lucide-react-native|packages/brand-rendering/PublicBrandPage\.tsx.*(JSX element type|not assignable|has no construct|has no call)' /tmp/orch0964-app-lucide-public-page-tsc.log; then exit 1; else exit 0; fi
```

Result: PASS for the new Lucide/shared-renderer surface.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Rework Update — Android App Links consumer target

Seth provided the verified consumer Android package fingerprints after the first QA pass. `mingla-business/public/.well-known/assetlinks.json` now preserves the existing business-app target for `com.sethogieva.minglabusiness` and adds a second Android App Links target for `com.mingla.app.v2` with both verified SHA-256 fingerprints:

- `06:4E:20:DE:0E:A7:4E:AC:72:9D:D7:68:66:5E:B2:70:56:3E:5B:9C:65:C9:12:B5:AC:E5:D6:A0:84:47:7A:BC`
- `90:28:F8:B1:A5:80:79:26:73:AE:DF:DE:00:C3:3D:C1:BC:0A:2A:C6:A3:B2:C0:5B:56:6F:97:67:53:48:0E:02`

Added `mingla-business/__tests__/assetlinks.consumerAppLinks.test.ts` plus `npm run test:orch-0964-assetlinks` so the business target, consumer target, exact fingerprint set, and duplicate-package guard are repo-running checks.

## Rework Update — FAIL retest blockers cleared

The branch was rebased onto current `origin/main` and reports `0 19` from `git rev-list --left-right --count origin/main...HEAD` after the final rework commit. Rebase conflicts were resolved by preserving META-ORCH-0972's data-driven public/hub tab contract while keeping ORCH-0964's shared themed renderer extraction; the two META strict-grep scripts were restored after the older ORCH-0964 branch had deleted them.

`publicEventsService.ts` no longer has the ORCH-specific `Brand.kind` TypeScript errors from QA. Full `mingla-business` TypeScript still fails on pre-existing/shared-package noise, but the filtered check against `/tmp/orch0964-business-tsc.log` found no `publicEventsService.ts` `kind` errors.

Added `app-mobile/scripts/ci/orch-0964-logout-cache-regression-check.mjs` plus `npm run test:orch-0964-logout-cache`. This locks SC-21 by proving the new `['consumerBrand', slug]` and `['brandTheme', eventId]` cache keys are covered by the signed-out `queryClient.clear()` path and by the persisted React Query AsyncStorage cleanup.

Real Android tap verification remains intentionally deploy/device-gated: the code now serves both Android package associations, but OS-level App Links proof still requires a deployed `business.usemingla.com/.well-known/assetlinks.json` and a signed Android build matching one of the two `com.mingla.app.v2` fingerprints.

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

Rework verification:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npm run test:orch-0964-assetlinks
```

Result: PASS, 3 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('mingla-business/public/.well-known/assetlinks.json','utf8')); JSON.parse(fs.readFileSync('mingla-business/package.json','utf8')); console.log('assetlinks.json and package.json parse')" && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs
```

Result: PASS, both JSON files parse and the existing well-known content-type gate passes.

Fails-on-revert proof: ran the same Jest test against the pre-change `HEAD:mingla-business/public/.well-known/assetlinks.json` through `ORCH_0964_ASSETLINKS_PATH`. Result: expected failure, 2/3 tests failed because `com.mingla.app.v2` was absent.

Retest rework verification:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && git rev-list --left-right --count origin/main...HEAD
```

Result after final rework commit: PASS, `0 19`.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/app-mobile" && npm run test:orch-0964-logout-cache
```

Result: PASS, 5/5 structural regression checks passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts --runInBand
```

Result: PASS, 2 suites / 5 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs
```

Result: PASS, all listed strict-grep gates passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx tsc --noEmit --pretty false 2>&1 | tee /tmp/orch0964-business-tsc.log; if rg -n 'publicEventsService\.ts\([^)]*\): error TS.*kind|Property .kind. is missing' /tmp/orch0964-business-tsc.log; then exit 1; else exit 0; fi
```

Result: PASS for the ORCH-specific blocker: full TypeScript still reports existing/shared-package debt, but no `publicEventsService.ts` `Brand.kind` errors remain.

Migration history:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && /Users/sethogieva/bin/supabase migration list --linked
```

Result after this rebase/rework: local and remote are aligned through `20260729000002`; no remote-only rows were present and the ORCH-0964 migration is already present on the linked remote.

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

No migration apply is pending from this rework because `/Users/sethogieva/bin/supabase migration list --linked` shows `20260729000002` present on both Local and Remote. If this branch is replayed against a different linked project that has not received the ORCH-0964 migration, apply with:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && /Users/sethogieva/bin/supabase db push --linked
```

No data pre-flight probe is required: all new columns are nullable, CHECK constraints allow NULL, and no backfill or cleanup predicate can abort on existing rows.

## Remaining Inputs / Gaps

- Android App Links static config for `business.usemingla.com` now includes `com.mingla.app.v2` with both verified fingerprints. Runtime Android App Links verification still requires post-merge Vercel deploy and a real Android device tap test.
- `usemingla.com` host repo still needs confirmation before adding `.well-known` files there. Current checked-in `.well-known` coverage is `mingla-business` / `business.usemingla.com`.
- EAS build queue IDs are not produced yet. Because this ORCH adds fonts, Lottie, a native route, and associated domains, both native apps require EAS builds before ship.
- Full TypeScript remains blocked by existing workspace/shared-package type-resolution debt; targeted resolver and strict-grep gates passed.

## Smoke-Test Design Rework #9 — Public Event Premium Pass

User-visible changes:

- Public event pages now keep the proven cover-under-scroll interaction but render the content as a premium glass sheet over the cover.
- Ticket options now render as individual larger cards with price pills and full-width theme-colored purchase actions instead of compact divider rows.
- Event brand and venue affordances now use the selected theme color in boxes/icons/buttons, not only small text accents.
- Public brand pages now use the same cover-under-scroll structure as public events: the cover sits behind the page and the profile/details scroll up over it.

Design evidence:

- Used `ui-ux-mingla` and its React Native guidance to preserve `resizeMode="cover"` for media and keep small floating controls touch-safe.
- Kept public event data, callbacks, state precedence, ORCH-0961 brand close/share test IDs, ORCH-0961 `hideFloatingChrome`, and animation color behavior unchanged.

Regression coverage added/updated:

- `mingla-business/src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts`
- `mingla-business/src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts`

Verification:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts src/components/brand/__tests__/themeAnimations.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts --runInBand
```

Result: PASS, 7 suites / 25 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

Full TypeScript note: the known workspace/shared-package type-resolution debt remains. A focused business `tsc` run still fails before reaching useful ORCH-specific signal because `../packages/*` cannot resolve app-local `react` / `react-native` types and existing app test fixtures still carry unrelated errors.

## Smoke-Test Design Rework #10 — Public Event Presenter Photo + Maps

User-visible changes:

- The public event "Presented by" card now renders the brand profile photo when the brand has one; otherwise it keeps the themed initial fallback.
- The public event location card now reads as a tappable location box and shows an "Open maps" affordance when the event has a visible physical location.
- Maps opening is host-wired: iOS uses Apple Maps (`maps://`), Android uses the native geo intent, and web/fallback uses Google Maps search.
- Address privacy remains intact: when `hideAddressUntilTicket` is true, the card still shows "Address shared after ticket purchase" and does not expose/open the hidden address.

Regression coverage added/updated:

- `mingla-business/src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts`

Verification:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/themeAnimations.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts --runInBand
```

Result: PASS, 7 suites / 27 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Smoke-Test Design Rework #11 — Public Event Contrast + Button Weight

User-visible changes:

- Public event ticket cards now have a darker, higher-contrast glass surface with a themed accent strip at the top of each ticket card.
- Ticket purchase buttons now read as stronger primary actions: larger height, heavier border, stronger shadow/glow, and contrast-aware border/text pairing from the resolved theme foreground color.
- The event location "Open maps" control now uses the same high-contrast button treatment instead of a subtle translucent pill.
- The page body sheet was deepened slightly so white text, ticket cards, and buttons separate more clearly from the cover.

Regression coverage updated:

- `mingla-business/src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts`

Verification:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/mingla-business" && npx jest src/components/brand/__tests__/PublicEventPage.orch_0964_design_rework.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts src/components/brand/__tests__/themeAnimations.orch_0964_smoke_rework.test.ts src/utils/__tests__/themeResolver.orch_0964.test.ts src/utils/__tests__/themeResolver.adversarial.orch_0964.test.ts src/utils/__tests__/brandPatch.orch_0964_smoke_rework.test.ts src/hooks/__tests__/useBrands.orch_0964_public_theme_cache.test.ts --runInBand
```

Result: PASS, 7 suites / 27 tests passed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && node .github/scripts/strict-grep/orch-0964-theme-typed-columns.mjs && node .github/scripts/strict-grep/orch-0964-theme-resolver-canonical.mjs && node .github/scripts/strict-grep/orch-0964-theme-foreground-computed.mjs && node .github/scripts/strict-grep/orch-0964-checkout-no-brand-theme.mjs && node .github/scripts/strict-grep/orch-0964-brand-rendering-self-contained.mjs && node .github/scripts/strict-grep/orch-0964-well-known-json-content-type.mjs && node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs && node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs && node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS, all listed strict-grep gates passed.

## Downstream Routing

Next: Codex `tester-mingla` RETEST should verify this rework against `Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_RETEST.md`, including committed assetlinks content, rebase proof, restored META gates, the cleared `publicEventsService.ts` `Brand.kind` TypeScript blocker, and `npm run test:orch-0964-logout-cache`. Android OS tap verification remains post-merge/deploy/device-gated.
