# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] device-rework #3: Reserve CTA float→dock

Seth's device-screenshot feedback: the trip-page Reserve CTA was a fixed full-width OPAQUE
orange bar pinned at the bottom, with a large BLACK EMPTY GAP between the "Choose how you pay"
card and that bar. This iteration refines the Reserve CTA behavior on ALL surfaces (consumer
app + business/web public trip page) for parity.

## 1. Summary

The Reserve CTA now has two render modes driven by a `variant` prop, identical on both surfaces:

- **DOCKED (resting position)** — the CTA is rendered as the FINAL element INSIDE the scroll
  content, in NORMAL FLOW (not absolute), so it sits flush just beneath the last "Choose how
  you pay" section with NO black void. At rest its background/bar is allowed; it pads its own
  safe-area bottom so the whole button clears the home indicator.
- **FLOATING (while scrolling)** — JUST the button (a pill), with NO full-width opaque bar
  background. Shown ONLY while the in-content docked button is scrolled OUT of view; it HIDES
  once the docked button scrolls into view. Tracked via `onScroll` (scroll offset) + `onLayout`
  (viewport height) + the docked button's `onLayout` (its `y` within the content): the pill is
  visible while `dockTopY > scrollY + viewportH - REVEAL_MARGIN`.

The oversized `paddingBottom` that created the black void is removed: the scroll content now
reserves only a small tail (consumer `8`, business `spacing.md`); the docked card carries its
own safe-area bottom padding. The sheet body keeps scrolling — the docked CTA lives INSIDE the
single registered gorhom scrollable, and the floating pill is an absolute sibling that never
touches the scroll, so the ORCH-1016/1043 scroll-freeze is NOT reintroduced.

Deposit/pay-state copy ("From €500" / "From €125 today" + "All-in, taxes included" / "Due today ·
deposit") is correct in BOTH states because both variants render ONE shared `ctaBody`.

UI-only. NO new dependency, NO schema/edge/checkout change.

## 2. SPEC success-criteria coverage

The dispatch (Seth's device feedback + recommended mechanism) is the binding contract for this
iteration.

| SC | Status | Evidence |
|----|--------|----------|
| Floating = pill only, NO full-width opaque bar bg | ✓ | `variant="floating"` renders `floatPill` in `floatWrapper` (no `backgroundColor` band) — both surfaces; tests DR3b/DR3b2 |
| At end: docks flush beneath "Choose how you pay", NO black gap | ✓ | docked bar is the LAST scroll child (consumer: after `{bodyChildren}`; business: after the phone payment block in TripPreview); tests DR3d/DR3e |
| Whole button above the home indicator (safe-area kept) | ✓ | docked pads `safeBottom + 8` (consumer) / `insets.bottom + 8` (business); floating lifts `safeBottom + overshoot + gap` |
| Sheet body keeps scrolling (no ORCH-1016/1043 freeze) | ✓ | docked is inside the single gorhom scrollable; floating is an absolute sibling; sim-verified |
| ALL-surface parity (consumer + business/web) | ✓ | identical mechanism on both `ConsumerTripReserveBar` + `TripReserveBar` |
| Floating pill hides when docked visible | ✓ | `floatingPillVisible` predicate; behavioral tests B1–B4c / DR3h–DR3i |
| No oversized paddingBottom void | ✓ | consumer `reserveBarClearance = 8`; business `contentBottomInset={spacing.md}`; tests DR3f/B6/DR3g |
| Deposit/pay copy correct in both states | ✓ | one shared `ctaBody`; test B7 |
| No new dep / schema / edge / checkout change | ✓ | `git diff` is UI/test only |

## 3. Files changed

Per surface:

**Consumer (app-mobile):**
- `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` — added `variant` (docked|floating), shared `ctaBody`, docked in-flow card + floating pill (no full-width bg), `onDockLayout`.
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` — float→dock visibility state (`dockTopY`/`scrollY`/`viewportH` + `floatingPillVisible`), docked bar as last scroll child, conditional floating pill, `onScroll`/`onLayout` wiring, removed oversized clearance.
- `app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts` — FIX5 block rewritten for the docked/floating mechanism (DR3a–DR3f).
- `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_float_dock.test.ts` (NEW) — behavioral float→dock predicate + structure (11 assertions).

**Business / web (mingla-business + packages):**
- `mingla-business/src/components/trip/TripReserveBar.tsx` — added `variant`, shared `ctaBody`, docked/floating modes (mirror of consumer).
- `mingla-business/src/components/trip/TripPreview.tsx` — `dockedReserve` slot rendered as last phone-body child; `onScroll`/`onScrollViewLayout` passthrough to ParallaxCoverShell.
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — float→dock state, docked bar built + passed as `dockedReserve`, floating bar conditional + `variant="floating"`, reduced `contentBottomInset`.
- `packages/offering-rendering/ParallaxCoverShell.tsx` — optional `onScroll` + `onScrollViewLayout` passthrough to the phone/native Scroll (additive; absent ⇒ byte-identical for event/experience callers).
- `mingla-business/src/components/trip/__tests__/tripReserveFloatDock.orch1138.test.ts` (NEW) — source + behavioral float→dock gate (9 tests).

## 4. Data-model changes

None.

## 5. Edge functions

None touched.

## 6. Regression tests

- Consumer: `orch_1138_trip_parity_fixes.test.ts` (31 assertions PASS) + `orch_1138_reserve_float_dock.test.ts` (11 assertions PASS).
- Business: `tripReserveFloatDock.orch1138.test.ts` (9 tests PASS) + the existing `tripPageParityRework.orch1138.test.ts` / `tripParityFixes.orch1138.test.ts` / `tripNativeRenderParity.orch1138.test.ts` / `ParallaxCoverShell_native_stacking.test.ts` (32 tests) still PASS.

Fails-on-revert (true LINE DELETION):
- Consumer: deleted `{dockedReserve}` from the scroll body → DR3d FAILS; restored → PASS.
- Business: deleted the `dockedReserve` render line in TripPreview → DR3e FAILS; restored → PASS.

fails-on-revert verified at commit 8f1352510.

## 7. Old → New receipts

### ConsumerTripReserveBar.tsx / TripReserveBar.tsx
- Before: a single always-absolute bar with a full-width page-colored `fade` background pinned at the bottom (the opaque bar Seth flagged).
- Now: `variant`-driven — `docked` is an in-flow card (bg ok at rest, last scroll child); `floating` is just the pill (no full-width bg). Shared `ctaBody` keeps the copy identical.

### ConsumerTripDetailScreen.tsx / [tripSlug].tsx
- Before: always rendered the absolute floating bar; reserved a bar-sized `paddingBottom` (the black void).
- Now: renders the docked bar as the last scroll child + a conditional floating pill (hidden when docked is on-screen); reserves only a small tail pad.

### TripPreview.tsx
- Before: no docked slot; the floating bar was rendered by the route as an absolute overlay only.
- Now: accepts a `dockedReserve` node rendered as the LAST phone-body child + forwards scroll/layout to ParallaxCoverShell.

### ParallaxCoverShell.tsx
- Before: no scroll-awareness passthrough.
- Now: optional `onScroll` + `onScrollViewLayout` forwarded to the phone/native Scroll (additive — event/experience callers byte-identical).

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | YES | float→dock Reserve CTA |
| Consumer Android | YES (parity automatic — shared RN) | Android opaque-glass preserved (accent fill, no shadow under the rounded fill); gate `orch-1105-web-glass-opaque-fallback` PASS |
| Buyer/anon Web | YES | same float→dock via ParallaxCoverShell web-phone branch |
| Business iOS | YES (parity automatic — same RN code) | TripReserveBar variant |
| Business Android | YES (parity automatic) | same |
| Admin Web | NO | n/a |
| Business Web preview | NO direct change | wizard preview uses LEGACY TripPreview path (no palette) — untouched |

## 9. Smoke result

iOS simulator (iPhone 17 Pro, iOS 26), consumer app trip detail `/t/travelbrand/the-dc-adventure`,
native dev-build rebuilt from the worktree (BUILD SUCCEEDED, frameworks embedded). The worktree
`node_modules` symlink to the anchor broke Metro's module-graph root (it resolved
`./mingla-main/app-mobile/node_modules/expo-router/entry` and red-screened) — fixed by replacing the
symlink with a REAL `node_modules` copy in the worktree (node_modules is gitignored), after which the
device bundled the worktree JS (5077 modules). Screenshots in `Mingla_Artifacts/evidence/ORCH-1138/`:
- `DR3_float_pill_midscroll.png` — mid-scroll, the floating PILL over content (just the pill — page
  content/brand row visible around it, NO full-width opaque bar bg).
- `DR3_docked_flush_no_gap.png` — scrolled to end, the docked button flush beneath "Choose how you
  pay", NO black gap, fully above the home indicator.

A live on-device value probe (since removed) confirmed the visibility predicate flips correctly:
at top `dy=1556 sy=0 vh=763 vis=true` (pill shows); at end `dy=1556 sy=1406 vh=763 vis=false`
(pill hides, docked button is the only CTA). Swipe-down-to-dismiss still works (gorhom owns the
single registered scrollable — no ORCH-1016/1043 freeze).

SIM-PROOF NOTE / hooks-order fix: the first sim run red-screened with "Rendered more hooks than
during the previous render" — the new `useState`/`useCallback` were placed AFTER the
loading/error/not-found early returns. Fixed by hoisting them above the early returns (Rules of
Hooks); the derived `floatingPillVisible` stays after the returns. Caught and fixed ON DEVICE.

## 10. Known issues / deferred

- The MANDATORY sim proof was run on the CONSUMER iOS surface (the screen Seth screenshotted).
  The business/web public trip page uses the SAME RN code path (TripReserveBar variant, the
  ParallaxCoverShell passthrough) and the same `floatingPillVisible` predicate, covered by the
  business jest gate; it was NOT separately sim-driven this pass. The tester should drive the
  business iOS + anon-web public trip page to confirm parity (it is `implemented, partially
  verified` for business/web; `implemented and verified` for consumer iOS).

## 11. Operator action required

None for deploy (no migration/edge). Route to tester for adversarial verification (consumer iOS +
business iOS + business Android + anon web), then orchestrator REVIEW. Do NOT merge/deploy/close.

## 12. Discoveries for Orchestrator

- `packages/offering-rendering/ParallaxCoverShell.tsx` does NOT typecheck under the
  `mingla-business` tsconfig (cannot resolve `react` cross-package — pre-existing, affects ALL its
  props, not just mine); it typechecks clean under its OWN `packages/offering-rendering/tsconfig.json`.
  Pre-existing cross-package resolution gap, not introduced here.
- app-mobile worktree `node_modules` is a symlink to the anchor; the bracketed worktree path breaks
  the Metro module-graph root (resolves `node_modules` back to the anchor) — confirms the dispatch's
  warning. A native rebuild from the worktree is the reliable sim-proof path. Worth a dev-tooling note.
