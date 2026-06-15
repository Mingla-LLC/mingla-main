# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] · Reserve CTA white-half (two-tone Treatment B)

**Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` · branch `ORCH-1138-trip-page-redesign`
**Type:** style-only change to the already-shipped unified seam-split Reserve CTA (Treatment B). No deploy / merge / close.

## 1. Summary

The "Pay over time" segment of the unified seam-split Reserve control was a too-transparent
`panelStrong` GHOST. It is now a **solid WHITE half with ACCENT-COLORED text** (theme-aware
`palette.accent` — orange for the default Mingla brand, whatever each brand resolves; never a
hardcoded literal). The "Pay in full" half is **unchanged** (accent fill, white text). Net: a
two-tone unified control — accent half (white text) + seam + solid-white half (accent text).
Applied to BOTH surfaces, in BOTH docked + floating forms (a single shared `renderSplitSegment`
covers both forms per surface). A light-theme legibility hairline (accent-tinted, outer edges only)
keeps the white half defined on a near-white brand page.

## 2. Exact style change (per surface, identical)

In `renderSplitSegment`:
- `const SECONDARY_FILL = "#FFFFFF";` (intentional literal — the white half is theme-independent by design, like the seam fold tints).
- `backgroundColor`: secondary `palette.panelStrong` → `SECONDARY_FILL`. Primary unchanged (`palette.accent`).
- `textColor` (amount): secondary `palette.primaryText` → `palette.accent`. Primary unchanged (`palette.accentText`).
- `kickerColor`: secondary `palette.tertiaryText` → `palette.accent`. Primary unchanged (`palette.accentText`).
- Secondary segment gains `styles.segmentSecondaryBorder` + inline `borderColor: palette.accent`.

New style:
```
segmentSecondaryBorder: { borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1 }
```
(Outer edges only — the LEFT edge is the fold-seam, kept clean — so no double line beside the seam.
`borderColor` is the resolved `palette.accent`, theme-aware.)

## 3. Light-theme legibility handling

On a LIGHT brand page, solid-white-on-near-white would vanish. Two layers keep the white half
defined: (a) the shell's existing 1px `palette.panelBorder` wraps the whole control; (b) the new
accent-tinted hairline (`palette.accent`) on the white half's outer three edges crisply separates it
from the page. Verified at 390px on a near-white page — the white half does NOT disappear.

## 4. Files changed (4)

| File | Δ |
|---|---|
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | +54/−… (renderSplitSegment + segmentSecondaryBorder + comment) |
| `mingla-business/src/components/trip/TripReserveBar.tsx` | +57/−… (same) |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_split_buttons.test.ts` | SU3/SU5 updated to the two-tone contract |
| `mingla-business/src/components/trip/__tests__/tripReserveSplitButtons.orch1138.test.ts` | SP-U3/SP-U5 updated to the two-tone contract |

No schema / edge / checkout / dependency change. Both segments still tap straight to cart with their
pay choice (byte-identical — untouched), the no-plan single-button fallback is intact, side-by-side
no-wrap holds, float→dock + above-home-indicator unchanged.

## 5. Regression tests (updated, fails-on-revert proven)

- Consumer: `orch_1138_reserve_split_buttons.test.ts` — SU3 (secondary = `#FFFFFF` + accent hairline) + SU5 (white-half text + kicker = `palette.accent`). 21 assertions pass. **fails-on-revert verified** by true line-deletion of `SECONDARY_FILL`/`textColor` wiring → SU3 fired red; restored → green.
- Business: `tripReserveSplitButtons.orch1138.test.ts` — SP-U3 + SP-U5 (same contract). 14 tests pass. **fails-on-revert verified** by reverting `kickerColor` → SP-U5 fired red; restored → 14/14 green.
- Both carry `[TEST-MOD-APPROVED ORCH-1138]` (modifying the prior assertions for the intentional supersede).

## 6. Gates run (all green)

- `orch-1138-trip-reserve-straight-to-cart.mjs` — PASS
- `orch-1130-no-buyer-tax-form.mjs` — PASS
- `orch-1105-web-glass-opaque-fallback.mjs` — PASS
- Full `mingla-business` `tsc -p tsconfig.json` — ZERO errors for `TripReserveBar.tsx`.

## 7. Verification at 390px (dark + light)

Headless-Chrome render of a 1:1 mirror of the shipping RN StyleSheet values, both themes, both forms:
`Mingla_Artifacts/evidence/ORCH-1138/TREATMENT_B_white_half_390.png` (+ source HTML
`_treatment_b_white_half_render.html`). Confirms: "Pay over time" is solid white with accent text on
BOTH themes and reads clearly (hairline defines it on the light/near-white page); "Pay in full"
unchanged (accent fill, white text); seam intact; no-wrap holds, long deposit string ellipsizes.

NOTE: this is a faithful static mirror, not an on-device/sim capture. The RN component cannot mount
under ts-jest and a full sim run of a plan-trip public page with a theme toggle was out of scope for
a style tweak. Labelled **implemented, verified at the style-render level**; on-device parity is
mechanical (the two ship-files were verified to compile clean + the existing device evidence
03/04/05 PNGs already prove the control renders on web + consumer).

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS / Android | Yes (`ConsumerTripReserveBar`) | manual mirror, matched |
| Buyer/anonymous Web | Yes (`TripReserveBar` via `/t/...`) | shared RN-on-web |
| Business iOS / Android | Yes (`TripReserveBar`) | shared file |
| Admin Web | No — no Reserve bar | — |

## 9. Discoveries for Orchestrator

- `mingla-business/src/components/trip/__tests__/` has ~12 PRE-EXISTING failing suites
  (TripVisualParity, TripCreatorWizard.cover, TripPaymentChoice_orch_1130, EditPublishedTripScreen,
  PaymentPlanEditor, tr2RewordPolish, TripPublishStripeBanner, IntakeTypePickerSheet_orch_0884).
  Proven pre-existing by `git stash` → still red on the unmodified HEAD. Source-string drift in files
  I did NOT touch. NOT caused by this change. Flag for a separate cleanup ORCH.

## 10. Operator action

None for migrations/edge (none touched). Route to REVIEW → tester.
