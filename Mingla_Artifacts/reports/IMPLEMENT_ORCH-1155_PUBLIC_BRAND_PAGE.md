# IMPLEMENTATION — ORCH-1155 · Public Brand Page — Direction-A Redesign + All-Surface Parity

**Mode:** IMPLEMENT (mingla-implementor)
**Date:** 2026-06-17
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1155-[brand-page-parity]/` · branch `ORCH-1155-brand-page-parity` (rebased on origin/main `721bf95d3`)
**Status:** implemented, partially verified (automated tests + typecheck + lint green; live 5-surface eyeball is the tester's — bracket-path Metro precluded a local sim/web screenshot, see §9).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1155_PUBLIC_BRAND_PAGE.md` · **Investigation:** `…/investigations/INVESTIGATE_ORCH-1155_PUBLIC_BRAND_PAGE.md` · **Design:** `…/design/ORCH-1138/BRAND_DIRECTION_A_RESPONSIVE.html`

---

## 1. Summary

The single shared public brand renderer (`@mingla/brand-rendering/PublicBrandPage`) was refactored from its hand-rolled flat-banner / About-last / local-palette layout onto the shipped Direction-A foundation — the SAME `ParallaxCoverShell` + `OfferingChrome` + `useResponsiveLayout` + shared `createThemePalette`/`offeringSurfaceStyles` primitives the trip/event/experience pages already use. One file change reaches all five surfaces (buyer-web + business iOS/Android + consumer iOS/Android). Plus two scoped follow-ons: experience cover video (a one-column migration + both data adapters + the card) and consumer brand-badge wiring (swipe-deck badge + experience-detail "Presented by" → `/b/{slug}`, no more dead taps).

What changes for end users: the brand page now reads as a real immersive Direction-A hub — pinned parallax cover, body sliding over the 28px seam, fixed X·Share chrome (plus Mute when the cover is video), an About-first horizontally-scrollable tab bar that only shows tabs the brand actually has, the bio/tagline/contact living inside About (with a Read-more clamp), a proper desktop two-column with a sticky Share + Next-up panel, and experience cards that play video covers. In the consumer app, tapping a brand badge on a swipe card or the "Presented by" lockup now opens that brand's page.

## 2. SPEC success-criteria coverage

| SC | What | Status | Commit |
|----|------|--------|--------|
| SC-1 | About first + default, all 5 (AUTO) | source+structural ✓; tester eyeball | `c6f8c929e` |
| SC-2 | Tabs hide when empty, all 5 (AUTO) | source+structural ✓ | `c6f8c929e` |
| SC-3 | About pane order tagline→bio(clamp+Read more)→contact | source+structural ✓; tester eyeball | `c6f8c929e` |
| SC-4 | Parallax + seam + chrome (X·Share, Mute on video) | source ✓ (shell-composed); tester device | `c6f8c929e` |
| SC-5 | Desktop two-column ≥1024px (sticky Share+Next-up; no Reserve/Follow/contact) | source+structural ✓; tester web | `c6f8c929e` |
| SC-6 | No fabricated Follow | structural ✓ (`not /follow/i` + `/subscrib/i`) | `c6f8c929e` |
| SC-7 | Theming parity via SHARED engine | source ✓ + palette parity test still 5/5 | `c6f8c929e` |
| SC-8 | Anon-safe (no `.from("brands")`) | structural ✓ | `c6f8c929e` |
| SC-9-Web | Experience video cover via `publicEventsService` | source ✓ (needs migration applied); tester web | `f24125173` |
| SC-9-Native | Experience video cover via `useBrandBySlug` | source ✓ (needs migration applied); tester native | `f24125173` |
| SC-10 | Swipe-badge → `/b/{slug}` (not dead tap) | source+test ✓; tester device | `0dc53cfbc` |
| SC-11 | Detail "Presented by" → `/b/{slug}` | source+test ✓; tester device | `0dc53cfbc` |
| SC-12 | No curated regression (byte-identical) | source+test ✓ (bare BrandChip branch) | `0dc53cfbc` |

Runtime-observable criteria (SC-1/3/4/5/9/10/11) are **source-verified + automated-structural-verified** but require the tester's live 5-surface eyeball (and SC-9 the migration applied to prod) for the runtime PASS — I did not capture a sim/web screenshot (bracket-path Metro, §9).

## 3. Files changed (12, all inside the spec allowlist)

| File | Δ | Commit |
|------|---|--------|
| `supabase/migrations/20261013000000_orch_1155_experiences_by_brand_cover_media_type.sql` | NEW (+85) | `f24125173` |
| `packages/brand-rendering/types.ts` | +6 | `f24125173` |
| `mingla-business/src/services/publicEventsService.ts` | +8 | `f24125173` |
| `app-mobile/src/hooks/useBrandBySlug.ts` | +5 | `f24125173` |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | +2 | `f24125173` |
| `packages/brand-rendering/PublicBrandPage.tsx` | rewrite (~1490 → ~990; net −500) | `c6f8c929e` |
| `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` | +~45 | `0dc53cfbc` |
| `app-mobile/src/components/SwipeableCards.tsx` | +~12 | `0dc53cfbc` |
| `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` | +~14 | `0dc53cfbc` |
| `packages/brand-rendering/__tests__/orch_1155_brand_redesign.test.tsx` | NEW | `dd4bb61db` |
| `app-mobile/src/components/__tests__/orch_1155_brand_badge_nav.test.ts` | NEW | `dd4bb61db` |
| `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` | relocated (−26/+~40) | `dd4bb61db` |

## 4. Data-model changes

`pg_public_experiences_by_brand(text)` — added one column `cover_media_type text` to the `RETURNS TABLE` (after `cover_media_url`) + the matching `e.cover_media_type::text` SELECT. Re-emitted from the LIVE PROD body (via MCP `pg_get_functiondef`, read-only) so the ORCH-1076 paid-supply gate / ordering / search_path are byte-preserved. DROP-before-widen (RETURNS TABLE widening). `$function$;` before the GRANT block; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO anon, authenticated`. No RLS/table change. No other DB object touched.

**The two-data-path cover field (the #1 trap, handled):** `cover_media_type` is threaded on BOTH independent paths so the experience video cover ships on web AND in-app (not one or the other):
- **Path 1 (business/web → surfaces 3–5):** `publicEventsService.ts` `PublicExperienceCardRow.cover_media_type` + `PublicExperienceCard.coverMediaType` + `experienceRowToCard` mapper; and the business adapter `components/brand/PublicBrandPage.tsx` `mapExperience` sets `coverMediaType`.
- **Path 2 (consumer in-app → surfaces 1–2):** `useBrandBySlug.ts` `PublicExperienceRow.cover_media_type` + `mapExperience` mapper.
- The shared `PublicBrandExperience` type gained `coverMediaType: PublicMediaType | null`, and `ExperienceMiniCard` now passes `mediaType={experience.coverMediaType}` (was hardcoded `"image"`).

## 5. Edge functions touched

None. (No edge-fn deploy required for this ORCH.)

## 6. Regression tests added

- **Implementor happy-path:** `packages/brand-rendering/__tests__/orch_1155_brand_redesign.test.tsx` — 10/10 PASS. Run: `cd mingla-business && npx jest --roots ../packages/brand-rendering`. (Structural source-text test; no RTL dep, runs under plain ts-jest.)
- **Consumer badge nav:** `app-mobile/src/components/__tests__/orch_1155_brand_badge_nav.test.ts` — PASS. Run: `node app-mobile/src/components/__tests__/orch_1155_brand_badge_nav.test.ts`. (node:assert source-assertions, the app-mobile convention.)
- **Relocated:** `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` — now 4/4 PASS (was 3/4-failing on origin/main). Run: `cd mingla-business && npx jest __tests__/components/PublicBrandPage.dataDriven.test.tsx`.

**fails-on-revert verified at `dd4bb61db`** (post-rebase HEAD `dd4bb61db…`):
- Package test: TRUE LINE-DELETION of `const tabs: Tab[] = ["about"];` → T-1 FAILS (`1 failed, 9 passed`); restored → 10/10 PASS.
- Badge test: TRUE LINE-DELETION of the `onBrandPress={() => { … router.push(\`/b/${s}\`) … }}` block at the SwipeableCards experience mount → the test throws `AssertionError: the experience mount must guard the empty slug then router.push(\`/b/${slug}\`)`; restored → PASS.

Both proved by line deletion (not comment-out). The tester writes the SECOND adversarial render-angle test per spec §9.

## 7. Old → New receipts

### `packages/brand-rendering/PublicBrandPage.tsx`
**Before:** flat `position:absolute;height:380` banner cover; a hand-rolled `<ScrollView paddingTop:284>`; a hand-rolled X+Share chrome row (no mute, `ChromeGlyph`/`ChromeButton`); a 250-line file-LOCAL `createThemePalette` + color-math; `maxWidth:620` everywhere (no desktop two-column); tab order About-LAST in a non-scroll clipped `View`; tagline+bio rendered ABOVE the tabs always-visible; About pane = a duplicate "About" bio block + contact.
**Now:** composes `ParallaxCoverShell` (pinned parallax + −28 seam + body-level fixed chrome) + `OfferingChrome` (X·Share·Mute, Mute gated on `coverType==="video"`); imports the SHARED `createThemePalette`/`offeringSurfaceStyles`/`ThemePalette` and deleted the local engine + color-math; About-FIRST default + a horizontal `ScrollView` tab bar (chips sized to content, edge fade on web-phone, active-chip scroll-into-view via cached offsets); identity (avatar+verified+name+address) + socials + featured teaser above the tabs on phone only; desktop `isDesktop` branch hides the phone identity, overlays verified eyebrow+name+address on the contained 21:9 hero, and renders a sticky brand-summary panel (avatar/name/address/socials + accent **Share** + **Next-up** card — NO Reserve, NO Follow, contact NOT duplicated) with a 2-column offering grid; About pane = tagline → bio (`ClampedBio`, 4-line clamp + Read more/Show less) → contact (email mailto + phone tel) inside About. Real-data-only hiding preserved.
**Why:** SC-1…SC-8, the Direction-A design contract, D-1…D-8.
**Lines:** ~1490 → ~990 (net −500).

### `mingla-business/src/services/publicEventsService.ts`
**Before:** `PublicExperienceCardRow` had no `cover_media_type`; `PublicExperienceCard` no `coverMediaType`; `experienceRowToCard` didn't map it.
**Now:** row + card carry `cover_media_type`/`coverMediaType`; mapper sets it from the RPC row.
**Why:** SC-9-Web. **Lines:** +8.

### `app-mobile/src/hooks/useBrandBySlug.ts`
**Before:** `PublicExperienceRow` no `cover_media_type`; `mapExperience` didn't map it.
**Now:** both carry/map `coverMediaType`.
**Why:** SC-9-Native. **Lines:** +5.

### `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`
**Before:** `BrandChip` rendered as a static `<View accessibilityRole="image">` — a dead tap.
**Now:** optional `onBrandPress?` prop; when present the badge is wrapped in a `TrackedTouchableOpacity` (the wrapper owns the absolute position + is the button) and `BrandChip` renders with `wrapped` (normal-flow layout, `pointerEvents="none"`, a11y-hidden so the wrapper is the single button); when absent the bare `<BrandChip>` renders byte-identically (curated SC-12).
**Why:** SC-10/SC-12. **Lines:** +~45.

### `app-mobile/src/components/SwipeableCards.tsx`
**Before:** experience mount passed `brandExperience` but no nav handle.
**Now:** imports `useRouter`; the experience mount passes `onBrandPress` that reads `currentRec.brandSlug`, guards empty, and `router.push('/b/'+slug)`.
**Why:** SC-10/SC-14. **Lines:** +~12.

### `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`
**Before:** "Presented by {brand}" lockup was a static `<View>`.
**Now:** imports `useRouter`; the lockup is a `<Pressable>` (`accessibilityRole="button"`) that guards `seed.brandSlug` then `router.push('/b/'+seed.brandSlug)`.
**Why:** SC-11. **Lines:** +~14.

## 8. Cross-surface impact

| Surface | Affected | What / parity |
|---------|----------|---------------|
| Consumer iOS | YES | Shared renderer (AUTO) + badge wiring (MANUAL) + experience video cover via `useBrandBySlug` (MANUAL) |
| Consumer Android | YES | Same; Android opaque glass via shared `offeringSurfaceStyles` + `OfferingChrome` fallback |
| Buyer/anon Web | YES | Shared renderer desktop two-column + phone parallax (AUTO) + experience video via `publicEventsService` (MANUAL) |
| Business iOS | YES | Shared renderer, phone single-column (AUTO) |
| Business Android | YES | Same; opaque glass (AUTO) |
| Admin Web | NO | No public brand page |
| Business Web preview (adjacent) | NO | The `/b` web route IS the buyer-web surface |

Manual-parity items (both done): the `coverMediaType` cover field on TWO data paths; consumer badge wiring on surfaces 1–2.

## 9. Smoke result

**No live sim/web screenshot.** The worktree path has brackets which break Metro/expo; a bracket-free checkout + `npm ci` + web export was judged not worth the cost because the visual layer is delivered entirely by the SAME shell/palette primitives already shipping on prod (the brand page composes them with the identical API `TripPreview.tsx` uses). Evidence + the tester's must-eyeball list: `Mingla_Artifacts/evidence/ORCH-1155/VERIFICATION_NOTES.md`. Automated proof run locally: package test 10/10, badge test PASS, relocated dataDriven 4/4, palette parity 5/5; touched-file typecheck clean; no new lint errors.

## 10. Known issues / deferred

1. **Consumer brand page native chrome top-inset.** The consumer adapter `ConsumerBrandProfileScreen.tsx` (DO-NOT-TOUCH per spec — "already correct") does NOT pass `chromeTopOffset`, so the shared page passes `safeAreaTop=0` → the X/Share chrome sits at `12px` from the top on consumer native (it could collide with the notch/status bar). The business adapter passes `chromeTopOffset={insets.top + 8}` so business native + web are fine. Fixing this needs a one-line `chromeTopOffset={insets.top}` in the do-not-touch consumer screen → flagged for the orchestrator rather than widening scope. Low blast radius (cosmetic, consumer native only).
2. **Active-chip scroll-into-view is best-effort on native** (spec OQ-2): implemented via cached per-chip `onLayout` x-offsets + `scrollTo`. The load-bearing requirement (non-clipping horizontal ScrollView) is met. Confirm best-effort is acceptable.
3. **Package tests have no CI runner wired.** The two new package/app-mobile tests run locally (commands in §6) but I found no CI job that executes `packages/**/__tests__` or app-mobile `node:assert` tests — same as the existing `event-rendering`/app-mobile precedents. Flagged for the orchestrator (may want a CI step). The relocated `dataDriven` test DOES run under the business jest.

## 11. Operator action required

1. **Apply the migration to prod** (orchestrator-owned; SC-9 precondition). Via Supabase Management API (CLI drift-wedged; MCP read-only) per `feedback_edge_deploy_and_migration_apply_hazards`. The file also lands in the worktree for CI migration-baseline. Pre-flight probes done read-only: `pg_brand_can_charge` exists; `events.cover_media_type` is `text`; live body re-emitted. No guards/backfills in the migration (pure CREATE OR REPLACE), so no abort risk.
   - If applying via CLI from a bracket-free checkout instead: `cd "<bracket-free worktree>" && /Users/sethogieva/bin/supabase db push --linked` (monotonic prefix `20261013000000` > local/remote/sibling max `20261012000006`).
2. **No edge-fn deploy.** None touched.
3. **OTA after merge** (consumer app-mobile + business per the OTA policy) — both the shared renderer and the badge wiring are pure-JS/RN (no native module), so `eas update` per-platform suffices.
4. **REVIEW then dispatch tester** for the 5-surface live-fire eyeball + the adversarial test (spec §9).

## 12. Discoveries for orchestrator

1. **Pre-existing RED jest suites on origin/main** (NOT caused by ORCH-1155 — confirmed by running them on baseline with my changes absent): `serverDraftLifecycleGuards`, `orch_0893_rework_adversarial_merge_spec`, `TripVisualParity_adversarial`, `eventCoverVideoProcessingService`, `eventCoverMedia` and others (≈13 failing in the brand-name jest sweep). Several trace to a `DraftEvent` type missing `category`/`isRsvp…` fields and a missing `@testing-library/react-native`/`@mingla/payments-native` in the default node jest env. The CI brand-page signal is otherwise green now (the relocated dataDriven test is fixed). Worth a triage ORCH.
2. **Two strict-grep gates fail on baseline too:** `orch-0756a-active-brand-recovery` (flags `BrandSwitcherSheet.tsx` — untouched by me) and `i-proposed-a-brands-deleted-filter` (Node crash). Neither references any ORCH-1155 file. Pre-existing.
3. **`hideFloatingChrome` prop is now effectively unused** (kept in the props type for back-compat; both live callers pass it falsy and the shell always renders chrome). If no embedded chrome-less use ever materializes, a future cleanup could drop it from `PublicBrandPageProps`.
4. **origin/main advanced mid-implementation** (META-ORCH-1148 2.2b #512 merged, touching some of my files); I rebased clean onto `721bf95d3` with no conflicts. The 4 ORCH-1155 commits contain exactly the 12 allowlisted files.

---

**Commits (post-rebase):**
- `f24125173` — migration + both data paths + shared type
- `c6f8c929e` — shared PublicBrandPage refactor onto the Direction-A shell
- `0dc53cfbc` — consumer brand-badge wiring (no dead taps)
- `dd4bb61db` — regression tests + relocated dataDriven test (`[TEST-MOD-APPROVED ORCH-1155]`)

---

## 13. Known-Issue #1 fix — consumer brand-page chrome top-inset (2026-06-17)

**Status:** implemented, code-parity verified (bracket-path Metro precluded a local sim screenshot — see below).

**Root cause.** The consumer brand-page screen is `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (the `/b/{slug}` deep-link target, now also reached by the ORCH-1155 brand-badge taps). It mounted the shared `@mingla/brand-rendering/PublicBrandPage` WITHOUT passing `chromeTopOffset`, so the shared page forwarded `safeAreaTop={chromeTopOffset ?? 0}` = `0` into `ParallaxCoverShell`. The shell positions its body-level fixed chrome (X · Share · Mute) at `safeAreaTop + 12` (`ParallaxCoverShell.tsx:286` web / `:375` native). With `safeAreaTop=0` the chrome sat at a flat `12px` from the top → it could render UNDER the notch / status bar on iOS home-indicator phones and Android. This broke all-surface parity: the business adapter already passes `chromeTopOffset={insets.top + 8}`, and every other Direction-A consumer page (trip/event/experience) offsets its chrome by `insets.top + 12`.

**The renderer already accepted the prop — no renderer change needed.** `PublicBrandPage` declares `chromeTopOffset` (`packages/brand-rendering/PublicBrandPage.tsx:238`) and forwards it with a safe `?? 0` default (`:622`). The fix is purely additive at the consumer route; web/business behavior is unchanged because they already pass their own offset (business) or have a `0` web safe-area top.

**Exact change** — `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (+3 lines, 1 comment block):
- imported `useSafeAreaInsets` from `react-native-safe-area-context`;
- `const insets = useSafeAreaInsets();`;
- passed `chromeTopOffset={insets.top}` to `<PublicBrandPage>`.

**Why `insets.top` (not `insets.top + 12`).** The shared shell ADDS its own `+12` gap on top of `safeAreaTop`. Passing `insets.top` yields an effective chrome top of `insets.top + 12` — byte-identical to `ConsumerTripDetailScreen` (`insets.top + 12`, `:1475`) and `ConsumerExperienceDetailScreen` (`insets.top + 12`, `:594`/`:1142`) native chrome. Passing `insets.top + 12` here would have double-padded to `insets.top + 24`. So this matches the established consumer pattern exactly while letting the shell own the constant gap.

**Web / business unchanged — confirmed.** `git diff --name-only` for this fix shows ONLY `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (+ the new test). The shared renderer `packages/brand-rendering/PublicBrandPage.tsx` and the business adapter `mingla-business/src/components/brand/PublicBrandPage.tsx` are NOT touched. The business adapter keeps `chromeTopOffset={insets.top + 8}`; buyer-web safe-area top is `0` as before.

**Scope.** Chrome top-inset only. No change to the renderer's layout/tabs/theming, `themePalette` math, or the offering-rendering primitives.

**Test added (append-only).** `app-mobile/src/screens/__tests__/orch_1155_brand_chrome_top_inset.test.ts` — node:assert source-assertion (the app-mobile convention; no jest/RTL runner). Asserts the screen imports `useSafeAreaInsets`, reads `insets`, and passes `chromeTopOffset={insets.top}`. Run: `node app-mobile/src/screens/__tests__/orch_1155_brand_chrome_top_inset.test.ts` → PASS.
- **fails-on-revert verified at `6f999cd40`:** TRUE LINE-DELETION of `chromeTopOffset={insets.top}` → test throws `AssertionError: ConsumerBrandProfileScreen must pass chromeTopOffset={insets.top}…` (exit 1); restored → PASS. The existing `orch_1155_brand_badge_nav` test still PASSes (no regression).

**Verification: code-parity, NOT sim.** The bracket worktree path breaks Metro/expo (same constraint noted in §9), so no `consumer_chrome_clears_notch.png` was captured. Proven by code-parity: the consumer brand chrome now resolves to the IDENTICAL effective top offset (`insets.top + 12`) as the trip/experience consumer detail screens that already clear the notch on device. Tester's device eyeball remains the runtime PASS for SC-4 chrome positioning on consumer native.

**Updates Known-Issue #1 in §10:** RESOLVED. (The §10 note assumed the consumer screen was DO-NOT-TOUCH; this scoped follow-up ORCH was dispatched specifically to fix it — additive prop only, web/business untouched.)

**Commit:** `6f999cd40` — consumer brand-page chrome top-inset fix + regression test.
