# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] · Unified Seam-Split Reserve CTA (Treatment B)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`
**New HEAD:** `275cf74b4f5785b869f66574bfdf99e227f7d296`
**Rebased onto origin/main** at start (21 commits replayed cleanly).
**Status:** implemented and verified (web render at real phone widths; source + jest/node gates green; fails-on-revert proven both surfaces).
**Design contract:** `Mingla_Artifacts/design/ORCH-1138/SPLIT_CTA_OPTIONS.html` → Treatment B "Seam-split, full-side primary".

---

## 1. Summary

The trip-page Reserve CTA was two DETACHED side-by-side buttons ("Pay in full" + "Pay over
time"). Replaced with the approved **Treatment B** unified seam-split control: ONE rounded,
bordered, overflow-clipped shell holding an **accent-FILLED primary** segment ("Pay in full",
flex 1.15, leads the eye) + a **crisp fold-seam** (1px dark crease + 1px light highlight) + a
**GHOST secondary** segment ("Pay over time", panelStrong fill), side by side, never wrapping.
It reads unmistakably as ONE control with two segments. Both segments remain independent,
real CTAs — each tap routes STRAIGHT to cart/checkout with its pay choice. Applied to **both
surfaces** (consumer app + business/public web). Docked (full-width, flush) and floating
(compact) forms both rebuilt; the rule-9 single-button fallback ("Reserve my spot →") for
no-plan / closed / sold-out trips is unchanged.

**No schema / edge / checkout / dependency change.** The component props (`splitCtas`,
`variant`, `palette`, …) are byte-identical, so the call sites and the checkout request are
untouched — the redesign is purely the internal render of the split path.

---

## 2. SPEC / dispatch success-criteria coverage

| # | Criterion | Status | Where (commit `275cf74b4`) |
|---|-----------|--------|----------------------------|
| SC-1 | Unified seam-split control (one shell, two segments, fold-seam) | ✓ | `renderSplitShell` + `renderSeam` + `splitShell`/`segment*`/`seam*` styles, both files |
| SC-2 | Left = accent-filled primary; right = ghost secondary | ✓ | `backgroundColor: isPrimary ? palette.accent : palette.panelStrong`; `segmentPrimary{flex:1.15}` / `segmentSecondary{flex:1}` |
| SC-3 | Both segments independently tappable → straight to cart w/ pay choice | ✓ | `renderSplitSegment` per-segment `Pressable` + `btn.onPress()` (routing unchanged in screen/route) |
| SC-4 | Docked (full-width, flush) form | ✓ | docked branch → `renderSplitShell(splitCtas, false)` |
| SC-5 | Floating (compact, no full-width opaque bar) form; float→dock swap kept | ✓ | floating branch → `renderSplitShell(splitCtas, true)`; `onDockLayout`/variant logic untouched |
| SC-6 | Rule 9: single-button fallback when no plan / closed / sold-out | ✓ | `ctaBody`/`floatBody` single path intact; gating in screen/route unchanged |
| SC-7 | No wrap / no stack at 360–390px; text shrink/ellipsis | ✓ | shell `flexDirection:"row" flexWrap:"nowrap"`; segment text `numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} ellipsizeMode="tail"` |
| SC-8 | Theme-aware (light + dark) | ✓ | accent/accentText/panelStrong/panelBorder/primaryText/tertiaryText from resolved `ThemePalette`; verified light + dark renders |
| SC-9 | All-surface parity (consumer + business/web) | ✓ | identical refactor in both `ConsumerTripReserveBar.tsx` + `TripReserveBar.tsx` |
| SC-10 | Byte-identical checkout (no schema/edge/dep change) | ✓ | props unchanged; route `handleTripReserve`/screen `openCartWithChoice` untouched; no new request field (SP8 / S7) |
| SC-11 | Android opaque-glass policy honored | ✓ | `Platform.select` Android `elevation:0, shadowOpacity:0`, opaque fills under `overflow:"hidden"` |
| SC-12 | Verified at real phone width (390 + 360) | ✓ | 6 screenshots in `Mingla_Artifacts/evidence/ORCH-1138/` (see §9) |

---

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | ~ +110 / −95 | split path → unified seam-split shell (docked + floating); styles swapped |
| `mingla-business/src/components/trip/TripReserveBar.tsx` | ~ +110 / −95 | identical refactor (parity mirror) |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_split_buttons.test.ts` | rewritten | asserts unified control; `[TEST-MOD-APPROVED ORCH-1138]` |
| `mingla-business/src/components/trip/__tests__/tripReserveSplitButtons.orch1138.test.ts` | rewritten | asserts unified control; `[TEST-MOD-APPROVED ORCH-1138]` |

No other files touched. Call sites (`app/t/[brandSlug]/[tripSlug].tsx`,
`ConsumerTripDetailScreen.tsx`) NOT changed — props are byte-identical.

---

## 4. Data-model changes applied

None. No migration, no schema, no RLS. (Pure presentational refactor.)

## 5. Edge functions touched

None. Checkout request byte-identical; `ticket-checkout-create` / pay-choice plumbing untouched.

---

## 6. Regression tests added/updated

- `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_split_buttons.test.ts` (21 node:assert assertions — PASS)
- `mingla-business/src/components/trip/__tests__/tripReserveSplitButtons.orch1138.test.ts` (14 jest assertions — PASS)

Both rewritten (under `[TEST-MOD-APPROVED ORCH-1138]`, which the local
`.github/scripts/test-append-only-check.js` accepts — "26 passed, 0 failed") because the prior
tests asserted the OLD two-detached-buttons structure (`splitRow`/`splitButton`/`floatSplitButton`/
`splitLabel`/`splitPrice`) this ORCH intentionally removes. The new tests assert the unified
control: one shell (no-wrap row, rounded, bordered, `overflow:"hidden"`), accent-primary lead
(flex 1.15) + ghost secondary (panelStrong, flex 1), the fold-seam (dark crease + light
highlight), theme-aware text colors, byte-identical routing, and the rule-9 single fallback.

**fails-on-revert verified at `275cf74b4`:**
- Consumer: TRUE LINE DELETION of `renderSeam` → assertion SU4 FAILS; restored → 21 pass.
- Business: TRUE LINE DELETION of `splitShell`'s `overflow:"hidden"` → SP-U2 FAILS (13 pass / 1 fail); restored → 14 pass.

The tester writes the second, adversarial test.

---

## 7. Old → New receipts

### ConsumerTripReserveBar.tsx / TripReserveBar.tsx (identical change)
**Before:** the `splitCtas` path rendered TWO separate accent-filled `Pressable` buttons
(`renderSplitButton` × 2) in a `splitRow` (docked, `gap:10`) or `floatSplitWrapper` (floating,
`gap:10`); both buttons identical accent fill, each its own rounded border, centered text.
**Now:** the `splitCtas` path renders ONE `renderSplitShell` — a single rounded, bordered,
overflow-clipped shell containing `[primary segment | renderSeam() | secondary segment]`. The
primary segment is accent-filled and wider (flex 1.15); the secondary is a `panelStrong` ghost
(flex 1); a 2px fold-seam (1px `rgba(0,0,0,0.22)` crease + 1px `rgba(255,255,255,0.10)`
highlight) divides them. Compact (floating) variant uses the same shell with tighter radius/
padding and inline amount. `renderSplitButton` removed; `splitRow`/`splitButton`/
`floatSplitButton`/`splitLabel`/`splitPrice` styles replaced by `splitShell`/`splitShellCompact`/
`segment`/`segmentCompact`/`segmentPrimary`/`segmentSecondary`/`segmentPressed`/`seam`/
`seamHighlight`/`segmentKicker`/`segmentAmount`/`segmentAmountCompact`.
**Why:** Treatment B contract — read as ONE premium control, accent used once decisively, both
halves honest CTAs.
**Lines:** ~110 added / ~95 removed per file.

---

## 8. Cross-surface impact

| Surface | Affected | Detail |
|---------|----------|--------|
| Consumer iOS | YES | `ConsumerTripReserveBar.tsx` — trip detail reserve CTA |
| Consumer Android | YES | same shared RN component; Android opaque-glass honored |
| Buyer/anon Web | YES | `TripReserveBar.tsx` rendered on web via the public trip route (anon-tolerant; no `useAuth`) |
| Business iOS | YES | `TripReserveBar.tsx` |
| Business Android | YES | same |
| Admin Web | NO | no admin surface renders this bar |
| Business Web preview | YES | same `TripReserveBar.tsx` on web |

Parity is **automatic within each codebase** (one shared RN component per app) and **manually
mirrored across the consumer↔business boundary** (the two files cannot import each other —
`I-MOR-0827-PACKAGE-ISOLATION`); both edited identically this turn. Events + experiences
untouched (they use `FloatingOfferingBar`, not this trip bar).

---

## 9. Smoke / render result (real phone width)

Real resolved `ThemePalette` (via the SAME `createThemePalette`) → an HTML harness transcribing
the committed RN StyleSheet values 1:1 → Playwright/Chromium screenshots at exact widths.
Files in `Mingla_Artifacts/evidence/ORCH-1138/` (dir is `.gitignore`d — evidence stays local,
per repo convention):

- `TREATMENT_B_docked_390.png` — one shell, accent "Pay in full €500" lead + seam + ghost "Pay over time / From €125 today", side by side, no wrap. ✓
- `TREATMENT_B_docked_360.png` — same; "From €125 today" ellipsizes ("From €125 to…") — no wrap, no stack, control integrity holds (on-device `adjustsFontSizeToFit` shrinks before ellipsizing). ✓
- `TREATMENT_B_floating_390.png` / `_360.png` — compact form: shorter, tighter radius, inline amount, same seam-split anatomy. ✓
- `TREATMENT_B_docked_light_390.png` — light brand theme: dark-gold accent primary (white text) + near-white ghost (BLACK resolved text). Theme-aware proven. ✓
- `TREATMENT_B_noplan_single.png` — rule-9 fallback: single full-width accent "All-in, taxes included / €500 … Reserve my spot →". ✓

Reproducible via `_render_harness.ts` + `harness.html` (kept in the evidence dir).

Native on-device sim render not run this turn (no native change; pure JS/RN style refactor →
OTA-eligible, no rebuild needed). Web render is the load-bearing geometry proof.

---

## 10. Known issues / deferred

- **PRE-EXISTING (not mine):** `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` case **T3a** fails — it asserts `styles.wrapper` with `bottom: wrapperBottom`, but the component has used `styles.floatWrapper` since before this turn (verified `styles.wrapper` count = 0 at the worktree HEAD `8544ca293` BEFORE my edit). A stale assertion from a prior leg. Did NOT touch it (out of scope; different leg's test).
- **PRE-EXISTING (not mine):** broad `mingla-business/src/components/trip/__tests__/` failures (`TripVisualParity`, `PaymentPlanEditor`, `tr2RewordPolish`, `TripPaymentChoice_orch_1130_*`, `EditPublishedTripScreen.*`, etc.) — none reference `TripReserveBar`; they assert source strings in OTHER files I never touched. Unrelated to this ORCH.

## 11. Operator action required

- **No migration. No edge deploy.** Pure JS/RN style refactor.
- Route back to the **orchestrator for REVIEW**, then **tester dispatch** (adversarial test +
  on-device parity verification on consumer iOS/Android + business iOS/Android/web).
- Ship path on close: **OTA** (`eas update`, per-platform) — no native rebuild required.

## 12. Discoveries for Orchestrator

1. The in-flight `orch_1138_consumer_trip_foundation.test.ts` T3a is stale (`styles.wrapper`
   never existed; component uses `styles.floatWrapper`). Pre-dates this turn — flag the owning
   leg to fix/retire it.
2. Large pre-existing red surface in `mingla-business/src/components/trip/__tests__/` unrelated
   to the reserve bar (visual-parity / payment-plan / 1130 tests asserting evolved source
   strings). Worth a sweep ORCH.
