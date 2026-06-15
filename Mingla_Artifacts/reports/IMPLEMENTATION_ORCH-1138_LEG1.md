# IMPLEMENTATION — META-ORCH-1138 Leg 1 [Shared Direction-A Foundation + Public TRIP Page]

**Status:** implemented and verified (gates green; RT-1..RT-4 fails-on-revert proven). NOT deployed / merged / closed.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`.
**Final commit:** `3ec03e8e2` (WIP baseline `00a9b1b07`).
**SPEC (binding):** `Mingla_Artifacts/specs/SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` (+ in-file amendments A-1, A-2 authored by the implementor).
**Open-question defaults used (orchestrator-approved):** Q1 = new `@mingla/offering-rendering` package; Q2 = collapse to 2 days + "Show all N" at 5+ days; Q3 = multi-tier OUT; Q4 = Mute only toggles EventCoverMedia's existing muted state.

---

## 1. Summary (plain English)

The public trip page (`/t/{brandSlug}/{tripSlug}`) is rebuilt to the approved "Direction A" immersive look: a full-bleed parallax cover, fixed X/Share/Mute chrome that stays put while the body slides over the cover, brand-color theming everywhere (was hardcoded warm orange), a real per-day itinerary with count-aware photo galleries (1=full / 2=split / 3+=swipe), ✓/✗ included/not-included chips, and a desktop two-column layout with a sticky booking panel. It is built on a NEW shared foundation (`@mingla/offering-rendering`) plus the brand-theming engine extracted out of the event page — so the event/experience/brand pages can snap onto the same primitives in later legs. The payment block (ORCH-1130) is wrapped with an additive theming prop so the checkout payment screen + wizard stay byte-identical. No database, view, RLS, or edge-function change.

---

## 2. SPEC success-criteria coverage

| SC | Status | Evidence (commit `3ec03e8e2`) |
|---|---|---|
| SC-1 (theming) | ✓ | Route resolves `resolveTheme(brand.theme, themeOverrides)` → `createThemePalette` → palette threaded through TripPreview/chips/spine/payment/Reserve. RT-1 proves crimson/teal/etc. palettes. |
| SC-2 (contrast / light page) | ✓ | RT-1 `navy #1e3a8a → light page, primaryText==='#000000'`, secondary/tertiary dark, white-on-accent ≥4.5:1 asserted. |
| SC-3 (palette parity, A1) | ✓ | RT-1 byte-identical palette across the fixed matrix; PublicEventPage render output unchanged (only the moved decls removed). Fails-on-revert proven. |
| SC-4 (per-day itinerary, real fields) | ✓ | `DayByDay` renders ordinal/date/title/narrative (narrative omitted when null) + `CountAwareGallery(day.media)`; NO stops (RT-4). T-5/T-6 prove 1/2/3+/empty layouts. |
| SC-5 (chips) | ✓ | `ChipGroup` ✓ accent-wash / ✗ muted; empty list → null. |
| SC-6-Web (parallax + chrome) | ✓ (source-verified; runtime web mount needs tester) | `ParallaxCoverShell` web phone branch: `position:fixed` cover z1 < body z2 < chrome z70; chrome → `OfferingChrome`; Share → `ShareModal`. **Unverified on a real browser** (no RN web-mount in the node/ts-jest env). |
| SC-7-Web (desktop two-column) | ✓ (source-verified) | Desktop branch: centered ≤1200 shell, grid `1fr/360`, sticky panel, floating bar hidden (`!isDesktop`). **Runtime web layout needs tester.** |
| SC-8-native (immersive single col) | ✓ (source-verified) | Native branch: absolute-pinned cover + `safeAreaTop` chrome; no two-column. **Device mount needs tester (iOS build broken team-wide — COMMS-0030).** |
| SC-9 (ORCH-1130 wrap additive) | ✓ | RT-2: `palette?` optional, `paletteOverrides(undefined)={}`, protected callers pass no palette. Fails-on-revert proven. |
| SC-10 (sold-out wiring) | ✓ | Hook folds `pg_public_ticket_types_remaining` per ticket type (fail-open); route + TripPreview show sold-out banner + "Sold out · N of N" + non-tappable CTA. |
| SC-11 (every state) | ✓ (source-verified) | Loading/error(PostgrestError)/not-found/closed/deadline/not-bookable/free/installments-toggle/theme-absent all handled in route + TripPreview. **Skeleton is a spinner+label (not a shimmer skeleton) — see Known issues.** |
| SC-12 (currency) | ✓ | `Intl.NumberFormat` with tier currency; "Free" path; no hardcoded glyph/GBP. |
| SC-13 (no dead taps) | ✓ | Chrome/brand-View/Reserve/payment segments/Read more/day expand all have handlers + a11y labels; map block is static info (no tap promised). |
| SC-14 (foundation fit, design-review) | ✓ | Prop contracts abstract the page-specific panel via `stickyPanel`/`children`; the ticket (event), date-pick+book (experience), and summary (brand) panels all fit as a passed-in `stickyPanel`. Confirmed on paper; no event/experience/brand code written. |

---

## 3. Files changed (vs origin/main)

**Part A — foundation (NEW package + extraction):**
- `packages/event-rendering/themePalette.ts` — NEW (+255). `createThemePalette` + `ThemePalette` + color-math helpers + `resolveOfferingSurface` (moved VERBATIM) + the new `offeringSurfaceStyles` helper.
- `packages/event-rendering/PublicEventPage.tsx` — −176/+11. Removed the moved decls; imports them from `./themePalette`. Render output unchanged.
- `packages/event-rendering/index.ts` — +9. Exports the palette engine + surface helper.
- `packages/offering-rendering/` — NEW package: `package.json`, `tsconfig.json`, `index.ts`, `ParallaxCoverShell.tsx`, `OfferingChrome.tsx`, `CountAwareGallery.tsx`, `galleryLayout.ts`, `ChipGroup.tsx`, `useResponsiveLayout.ts`.
- `mingla-business/metro.config.js` — +9. `@mingla/offering-rendering` alias.
- `mingla-business/tsconfig.json` — +2. `@mingla/offering-rendering` paths.

**Part B — trip page:**
- `mingla-business/src/hooks/usePublicTripBySlug.ts` — theme fetch+map (brand `theme_*` + trip `theme_*_override` → ThemeInputs) + sold-out wiring (`pg_public_ticket_types_remaining` folded into the existing Promise.all, fail-open).
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — rewritten: resolve theme→palette→surface; foundation chrome via TripPreview; ShareModal; Mute state; sold-out CTA; floating bar hidden on desktop; desktop sticky booking panel + Reserve control.
- `mingla-business/src/components/trip/TripPreview.tsx` — rebuilt to the approved mockup (FOUNDATION mode on the primitives) with the LEGACY inline mode preserved byte-stable for the wizard caller.
- `mingla-business/src/components/trip/TripPaymentChoice.tsx` — additive optional `palette` prop (+ exported `paletteOverrides`).
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — additive optional `palette` passthrough.

**Tests (5 new + 3 amendment-authorized modifications):**
- NEW: `createThemePalette.parity.orch1138.test.ts` (RT-1), `tripPaymentAdditivePalette.orch1138.test.ts` (RT-2), `offeringRenderingIsolation.orch1138.test.ts` (RT-3), `tripNoFabricatedFields.orch1138.test.ts` (RT-4), `countAwareGallery.orch1138.test.ts` (T-5/T-6).
- MODIFIED (token `[TEST-MOD-APPROVED ORCH-1138]`): `PublicEventPage.orch_0964_design_rework.test.ts` (3 palette assertions repointed to themePalette.ts — amendment A-1); `TripVisualParity.test.ts` + `TripVisualParity_adversarial.test.ts` (SC-17 + A-11 chrome assertions IconChrome→OfferingChrome — amendment A-2).

**Spec:** `SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` — amendments A-1 + A-2 appended.

---

## 4. Data-model changes applied

NONE. No migration, view, RLS, or schema change. All three data-layer changes are TypeScript fetch-mapper edits in `usePublicTripBySlug.ts` (brand theme select+map, trip override map, remaining-RPC fold). Confirmed: the columns (`brands.theme_*`, `events.theme_*_override`) and the anon RPC (`pg_public_ticket_types_remaining`) already exist per SPEC §3.

## 5. Edge functions touched

NONE.

---

## 6. Regression tests added — fails-on-revert PROVEN

All proven at final commit **`3ec03e8e2`**:

- **RT-1** `mingla-business/src/components/trip/__tests__/createThemePalette.parity.orch1138.test.ts` (5 tests). Pins the exact palette output across teal/navy(light)/default/crimson + the AA white-on-accent assertion. **fails-on-revert:** altering the page-mix amount (`useDark ? 0.1 → 0.25`) → 3 tests fail; restore → 5 pass.
- **RT-2** `tripPaymentAdditivePalette.orch1138.test.ts` (4 tests). Palette optional; `paletteOverrides(undefined)` empty; protected callers pass no palette; passthrough present. **fails-on-revert:** deleting the `if (palette === undefined) return {};` early-out → 1 fails; restore → 4 pass.
- **RT-3** `offeringRenderingIsolation.orch1138.test.ts` (3 tests). No app-src imports in offering-rendering or themePalette; only allowed specifiers. **fails-on-revert:** adding `import … from "../../mingla-business/src/…"` to a package file → 2 fail; restore → 3 pass.
- **RT-4** `tripNoFabricatedFields.orch1138.test.ts` (4 tests). No `day.stops` render, no trip-level gallery, map gated on lat/lng. **fails-on-revert:** adding a `day.stops.map(...)` to TripPreview → 1 fails; restore → 4 pass.
- **T-5/T-6** `countAwareGallery.orch1138.test.ts` (6 tests). `pickGalleryLayout` 1→one / 2→two / 3+→slider / 0→none.

Total ORCH-1138 tests: **22 passed, 0 failed.**

---

## 7. Old → New receipts (key surfaces)

### packages/event-rendering/themePalette.ts (NEW) + PublicEventPage.tsx
- **Before:** `createThemePalette`/`ThemePalette`/color-math/`resolveOfferingSurface` lived privately inside `PublicEventPage.tsx`; only `resolveOfferingSurface` was exported (via index from PublicEventPage).
- **After:** moved VERBATIM into the exported `themePalette.ts`; PublicEventPage imports them; index re-exports `createThemePalette`/`ThemePalette`/`resolveOfferingSurface`/`offeringSurfaceStyles`. Render output byte-identical.
- **Why:** SC-3 / A1 — one theming engine for all four offering pages.

### usePublicTripBySlug.ts
- **Before:** brand select omitted theme cols; trip override cols dropped by the mapper; `ticketsRemaining` hardcoded `null` (`:259`).
- **After:** brand select adds `theme_color/font/animation`; payload carries `brand.theme` + `themeOverrides` (guarded via the package guards); `ticketsRemaining` is the real per-ticket remaining (fail-open) folded into the existing Promise.all.
- **Why:** B1 (theming source) + B2 (real sold-out) — no schema change.

### app/t/[brandSlug]/[tripSlug].tsx
- **Before:** bespoke `IconChrome` close/share overlays + hardcoded `surface="dark"` floating bar; no theming; payment block below TripPreview.
- **After:** resolves theme→palette→surface; mounts TripPreview FOUNDATION mode (shell + OfferingChrome); ShareModal preserved; Mute toggles cover state; floating bar uses the resolved surface + hidden on desktop; desktop sticky booking panel + Reserve control.
- **Why:** B3 + the Direction-A redesign.

### TripPreview.tsx
- **Before:** flat 220px cover + warm-orange accents + inline day gallery; single layout.
- **After:** FOUNDATION mode composes `ParallaxCoverShell` (parallax cover, fixed chrome, two-column desktop), brand-themed meta chips / brand chip / route / about / day-by-day spine with `CountAwareGallery` / ✓✗ `ChipGroup` / gated map / refund strips; LEGACY inline mode preserved for the wizard.
- **Why:** B4 — the approved mockup.

### TripPaymentChoice.tsx / TripCheckoutFlow.tsx
- **Before:** hardcoded `rgba(235,120,37,…)` orange selected-state.
- **After:** additive optional `palette` prop; when present the segments/dots/amount derive from the palette; when absent byte-identical (early-out empty overrides).
- **Why:** B5 — theme the trip page's payment without touching the checkout/wizard callers.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Buyer/anonymous Web (`/t/`) | YES — the redesigned trip page | shared RN-web (automatic) |
| Business Web preview (wizard Step-5) | NO behavior change — LEGACY TripPreview mode preserved byte-stable | shared code |
| Business iOS / Android | YES if the route is opened in-app (native single-column immersive branch) | shared code (automatic) |
| Consumer iOS / Android | NO — consumer app-mobile trip detail is out of scope (Leg 1) | n/a |
| Admin Web | NO — different app | n/a |
| Event page (`/e/`) | NO render change — A1 extraction is behavior-neutral (RT-1) | shared engine |

---

## 9. Smoke / gate results

- **mingla-business jest (full suite):** 155 failing tests — **byte-identical failing-test set to the origin/main baseline** (captured via a detached `origin/main` worktree run). **ZERO new failures, zero regressions.** The pre-existing reds are unrelated stale source-string tests (event/brand `_0964` BlurView/recurrence, `tripsService`, `PaymentPlanEditor`, etc.).
- **ORCH-1138 tests:** 22/22 pass.
- **Strict-grep package isolation gate** (`meta-orch-0827-package-isolation.mjs`): **PASS** (offering-rendering + themePalette pure).
- **Tests-append-only check:** **PASS** (3 modified tests carry the override token; 5 added).
- **ORCH-1083 `__common` web bundle-budget gate:** **PASS** — `npm run web:export` succeeded; initial payload 2,944,759 B (ceiling 9,405,478), 134 chunks, 0 deferred specifiers in the entry, **__common within cap**. (Required installing the declared-but-uninstalled `lucide-react@0.577.0` into the worktree node_modules — a pre-existing install gap, `--no-save`, no lockfile drift.)
- **Runtime UX (web browser + device):** NOT run here. The RN components cannot mount under the node/ts-jest config, and the team-wide iOS build is broken (COMMS-0030). Source-verified only; the tester must flip every state on `/t/...` (web + native), verify the parallax/chrome stacking + desktop two-column on a real browser, and confirm the event page renders byte-identical post-extraction.

---

## 10. Known issues / deferred

- **Loading state is a spinner + "Loading trip…", not the shimmer skeleton named in SC-11.** The pre-1138 route already used this spinner; I preserved it (out of strict scope to build a new skeleton). Tester/orchestrator may register a skeleton follow-up.
- **Wizard Step-5 preview keeps the LEGACY (warm-orange, non-immersive) render.** The SPEC §4.4 aspiration that the wizard preview ALSO get the immersive layout would require touching `TripCreatorStep5Review.tsx` (NOT in the §12 allowlist) and would break its framed presentation (nested ScrollView + fixed cover escaping the wizard frame). FOUNDATION mode activates only when the route passes the full palette/theme/chrome context; the wizard passes none → byte-stable. Flagged for orchestrator: a later leg can theme the wizard preview if desired.
- **Mute (Q4)** toggles `EventCoverMedia`'s existing muted state only; no new audio engine.
- **Map block** is a static "Where you'll be" card (pin + caption), gated on real lat/lng — NOT an interactive map (no Mapbox tile in scope; rule 9 — no placeholder).

---

## 11. Operator action required

- **No migration. No edge-function deploy.** This leg is render-only.
- **Route to tester** for runtime verification (web browser: parallax/chrome stacking, desktop two-column sticky panel, every state, light-brand contrast, sold-out fail-open; prove the event page is byte-identical post-extraction; prove `/checkout-trip/.../payment` + wizard Step-5 unchanged).
- **At CLOSE:** flip the I-PROPOSED-1138-* invariants ACTIVE; OTA/deploy decision (pure-JS/RN → `eas update`, per memory).

---

## 12. Discoveries for Orchestrator

1. **Two stale event/brand `_0964` source tests are ALREADY RED on origin/main** (independent of ORCH-1138): `PublicEventPage.orch_0964_design_rework.test.ts` ("cover-scroll glass sheet" + "date/time white") and `PublicBrandPage.orch_0964_smoke_rework.test.ts` ("liquid glass panels") assert `import { BlurView } from "expo-blur"` which a prior event/brand refactor removed from both rendering packages. Recommend a cleanup ORCH to repoint or retire those assertions.
2. **The mingla-business trip test corpus is broadly red on origin/main** (155 failing tests baseline; e.g. `TripVisualParity` wizard IconChrome, the post-ORCH-1114 `Share.share()` legacy-API assertion, `tripsService`, `PaymentPlanEditor`). Not introduced here, but a large latent debt the orchestrator may want to triage.
3. **Worktree node_modules was missing `lucide-react`** (a declared dep) — the web build/budget gate can't run until it's installed. Likely an incomplete `npm install` in the spawned worktree; flag for the spawn/install step.
4. **SPEC §4.4 wizard-preview-immersive aspiration vs the §12 allowlist** conflict — resolved by FOUNDATION-mode gating (see Known issues). If Seth wants the wizard preview themed too, that's a follow-on touching `TripCreatorStep5Review.tsx`.
