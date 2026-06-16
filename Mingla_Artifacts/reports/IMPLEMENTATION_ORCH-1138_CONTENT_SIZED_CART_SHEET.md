# IMPLEMENTATION — ORCH-1138 [content-sized cart sheet]

**Scope:** consumer ticket CART sheet (`TicketCartSheet`) opened a fixed-height
(92%) sheet, leaving a large empty black gap below short carts with the "Continue
to Payment" CTA stranded mid-screen. Fix: size the sheet to its content (gorhom
dynamic sizing, capped at 92%) so short carts are short with the CTA anchored at
the content bottom, while tall carts cap at 92% and scroll. SHARED cart — events,
trips, and experiences all use this one component.

**Status:** implemented and verified (iOS sim, real device renderer).
**Layout / sheet-sizing only. No checkout/logic, no schema, no edge change.**

---

## 1. Summary (plain English)

Tapping "Get tickets" / "Reserve" opened the cart at a fixed 92%-of-screen height.
Because the whole cart (header + ticket rows + recap + CTA) renders as one
scrollable block, a short single-ticket cart sat at the top of that 92% viewport
and the bottom ~30-40% was empty black — the CTA ended in the middle of the
screen. The fix makes the sheet measure its own content and open exactly that
tall (no more, no less), capped at 92% for long multi-tier carts which then scroll
to reach Pay (unchanged behavior). Same component serves events, trips, and
experiences, so all three are fixed at once.

---

## 2. Root cause (file:line + snap config)

- `app-mobile/src/components/expandedCard/TicketCartSheet.tsx:88` (pre-fix):
  `const SHEET_SNAP_POINTS = ["92%"];` — a SINGLE FIXED snap point.
- `TicketCartSheet` renders with `scrollMode="scroll"` and passes
  `{header}{body}{stickyFooter}` as `children` with NO `header`/`stickyFooter`
  PROPS (lines ~795-814). BaseBottomSheet therefore takes the bare
  `case 'scroll'` / `hasHeader=false` branch and wraps EVERYTHING (including the
  "Continue to Payment" CTA) in ONE `BottomSheetScrollView`.
- With a fixed `["92%"]` snap, gorhom's `BottomSheetContent` is always 92% of the
  window tall. The single scrollable fills it. When the scroll CONTENT is shorter
  than 92% (a 1-2 tier cart), it sits at the top of the viewport → the remaining
  height is empty `#15181f` sheet canvas → the visible "empty black gap"; the CTA,
  being the last scroll child, lands mid-screen.
- This is PRE-EXISTING and SHARED. `TicketCartSheet` is the sole consumer cart;
  it is opened identically by `ConsumerEventDetailScreen.tsx:853`,
  `ConsumerTripDetailScreen.tsx:1505`, and `ExpandedBusinessEventSheet.tsx:664`
  (experiences) — all pass `clearFloatingNav={false}` and no per-kind layout. Seth
  noticed it via the new event flow; trips + experiences had the same gap.
  Evidence: `Mingla_Artifacts/evidence/ORCH-1138-event/BEFORE_fixed-92pct-snap-empty-gap-below-cta.png`
  (a 2-tier cart captured during Leg-2 with the old snap — CTA mid-screen, ~20%
  empty below).

---

## 3. The fix (gorhom v5 dynamic sizing, clamped)

gorhom v5 (`@gorhom/bottom-sheet@5.2.8`) supports content-driven sizing: with
`enableDynamicSizing`, `BottomSheetScrollView` reports its CONTENT height via
`onContentSizeChange → setContentSize → animatedLayoutState.contentHeight`
(`useBottomSheetContentSizeSetter.ts`), and `useAnimatedDetents.ts:79-86` derives
a `dynamicSnapPoint = containerHeight − min(contentHeight + handle, maxDynamicContentSize)`.
The provided `["92%"]` detent is kept as the upper bound; the sheet opens at the
dynamic detent (`index=0` resolves to the shortest/topmost-position detent).

Because the CTA is the LAST child of that single scroll block, the measured
`contentHeight` INCLUDES the CTA — so a short cart's dynamic snap fits header +
rows + recap + breakdown + CTA exactly (CTA anchored at the content bottom, no
gap). When content exceeds the cap (`maxDynamicContentSize ≈ 0.92 × windowHeight`),
the snap clamps to ~92% and the inner `BottomSheetScrollView` scrolls — preserving
the ORCH-1016/1043 scroll-to-Pay behavior verbatim.

**Why not naive `enableDynamicSizing` alone / a smaller fixed snap:**
- The codebase deliberately avoids unclamped dynamic sizing (see
  `PairRequestModal.tsx:51`, `CustomHolidayModal.tsx:19`, `ProposeDateTimeModal.tsx:26`,
  `PreferencesSheet.tsx:74` — "Batch-3 lesson: content-height sheets can measure
  children below the viewport and snap off-screen-bottom"). The
  `maxDynamicContentSize` clamp + the explicit `["92%"]` max detent prevent that.
- A smaller fixed snap would not ADAPT (single vs 8-tier cart need different
  heights). Dynamic sizing is the only content-adaptive option.

### Changed surfaces

#### `app-mobile/src/components/ui/BaseBottomSheet.tsx`
**Before:** exposed `enableDynamicSizing` but never forwarded
`maxDynamicContentSize` to `<BottomSheet>`, so dynamic sizing could not be
clamped.
**Now:** adds an optional `maxDynamicContentSize?: number` prop (typed +
documented), destructures it, and forwards it verbatim to `<BottomSheet>`. Purely
additive — the body-composition `useMemo` (locked by the ORCH-1043 gate) is
untouched.
**Why:** lets the cart cap dynamic growth at the 92% ceiling.
**Lines changed:** +12.

#### `app-mobile/src/components/expandedCard/TicketCartSheet.tsx`
**Before:** `<BaseBottomSheet snapPoints={["92%"]} …>` — fixed 92% open height.
**Now:** same `snapPoints={["92%"]}` (now the MAX detent) PLUS
`enableDynamicSizing` + `maxDynamicContentSize={maxDynamicContentSize}`, where
`maxDynamicContentSize = round(windowHeight × 0.92)` via `useWindowDimensions()`.
Added the `MAX_DYNAMIC_FRACTION` const + updated the snap-point comment block to
explain content-sizing. No change to the body tree, scroll wiring, CTA, pricing,
checkout, or state.
**Why:** SC-1/SC-2/SC-3 — content-sized sheet, CTA anchored, scroll preserved.
**Lines changed:** +36 / −4 (mostly comment).

---

## 4. Data-model changes applied

None. No migration, no schema, no RLS.

## 5. Edge functions touched

None.

---

## 6. SPEC success-criteria coverage

This was a direct bug-fix dispatch (no formal SPEC); criteria are the dispatch's
hard requirements.

| SC | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Short cart sizes to content; no large empty bottom | ✓ verified | `01_SHORT_cart_content_sized_cta_anchored.png` (1-tier: CTA at sheet bottom, no gap) vs `BEFORE_*.png` |
| SC-2 | "Continue to Payment" anchored at the bottom of the content-sized sheet | ✓ verified | `01_SHORT_*` (CTA flush at sheet bottom) |
| SC-3 | Tall cart grows + scrolls; scroll-to-Pay preserved (ORCH-1016/1043) | ✓ verified | `02_TALL_cart_caps_at_92pct.png` + `03_TALL_cart_scrolls_to_cta.png` (scrolled to reach CTA) |
| SC-4 | Shared-safe across events/trips/experiences (no per-kind regression) | ✓ verified (source) | one shared component, identical props at all 3 call sites; render has no kind branch — §8 |
| SC-5 | No checkout/logic/schema/edge change | ✓ | diff is 2 layout files + 1 test |
| SC-6 | Honor sheet-scroll invariants + gorhom sole-consumer | ✓ | ORCH-1043 gate 10/10, inline-scroll-binding gate OK, sole-consumer gate OK (§ gates) |
| SC-7 | Regression assertion w/ fails-on-revert | ✓ | §6 below, `fails-on-revert verified` |

---

## 6. Regression tests added

- **Path:** `app-mobile/src/components/expandedCard/__tests__/orch_1138_cart_sheet_content_sized.test.ts`
- **Convention:** `node:assert` source-assertion (app-mobile has no jest runner;
  matches repo precedent, e.g. `orch_1138_reserve_straight_to_cart.test.ts`).
- **Coverage:** 10 assertions — cart enables `enableDynamicSizing` +
  `maxDynamicContentSize` (T1), the clamp is window-derived (T2), the single-scroll
  structure that makes content-sizing correct is intact (T3), and BaseBottomSheet
  declares/destructures/forwards `maxDynamicContentSize` (T4).
- **Passing run:** `10 assertions passed (ORCH-1138 content-sized cart sheet).`
- **fails-on-revert verified at `1267d7877`** — TRUE LINE DELETION of the
  `enableDynamicSizing` + `maxDynamicContentSize={maxDynamicContentSize}` lines
  (TicketCartSheet 831-832) → `AssertionError: FAIL T1a the cart's BaseBottomSheet
  enables dynamic (content) sizing`. Lines restored → 10/10 pass again.

---

## 7. Old → New receipts

See §3 (BaseBottomSheet, TicketCartSheet). No other files touched.

---

## 8. Cross-surface impact

| Surface | Affected | What changes / why not |
|---|---|---|
| Consumer iOS | YES | cart sheet sizes to content (events/trips/experiences). Verified on iPhone 17 Pro sim. |
| Consumer Android | YES (parity automatic) | same shared RN component + gorhom; opaque-glass policy untouched (no Android fill change). Unverified on Android device — see Known issues. |
| Buyer/anonymous Web | NO | `TicketCartSheet` is app-mobile only; the web buyer cart is `mingla-business`, untouched. |
| Business iOS / Android | NO | not importers of this component. |
| Admin Web | NO | unrelated. |
| Business Web preview | NO | unrelated. |

Parity across events/trips/experiences is AUTOMATIC: a single `TicketCartSheet`
with no per-kind layout branch, opened with identical props (`clearFloatingNav={false}`)
from all three screens. The sim proof rendered the exact same component.

---

## 9. Smoke result (iOS sim — real device renderer)

- Build: pure-JS change; per the runbook (§145) no native rebuild needed. Served
  the worktree's app-mobile via an isolated Metro on port 8094 from a bracket-free
  detached verification worktree (`/tmp/orch1138-wt`, APFS-cloned node_modules —
  the `[event-page]` bracket path otherwise breaks Metro's `expo-router/entry`
  resolution), into the installed consumer dev client (`com.mingla.app.v2`).
  Bundle: HTTP 200, app boots to sign-in (`00_app_boots_with_fix.png`).
- The deck → event → Get-tickets path is OAuth-gated and could not be automated on
  the sim (no stored session, Apple/Google sign-in only). Verified instead by a
  THROWAWAY harness route (in the discarded /tmp worktree, never committed) that
  mounts the SHARED `TicketCartSheet` directly with mock tickets, driven via
  Maestro (no osascript):
  - **SHORT cart (1 tier):** `01_SHORT_cart_content_sized_cta_anchored.png` — sheet
    starts ~mid-screen, content fills it, "Continue to Payment" anchored at the
    sheet bottom, NO empty gap. (Contrast `BEFORE_*.png`.)
  - **TALL cart (8 tiers):** `02_TALL_cart_caps_at_92pct.png` — sheet caps at the
    92% ceiling; `03_TALL_cart_scrolls_to_cta.png` — after scrolling, lower tiers +
    recap + "What's included" + Subtotal + CTA are all reachable (ORCH-1016/1043
    scroll-to-Pay preserved).
- Evidence dir: `Mingla_Artifacts/evidence/ORCH-1138-event/`.

### Gates (all green)
- `orch-1043-sheet-scroll-viewport-check.mjs`: 10/10.
- `i-bottomsheet-inline-scroll-binding.mjs`: OK.
- `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`: OK (BaseBottomSheet sole
  gorhom importer).
- New regression test: 10/10, fails-on-revert proven.
- Existing cart tests still pass: `orch_1138_reserve_straight_to_cart`,
  `orch_1138_reserve_split_buttons`, `orch_1138_reserve_float_dock`,
  `orch_1025_seamless_native_cart`.
- `tsc --noEmit`: 0 errors in the 2 touched files (410 pre-existing repo errors
  elsewhere, unchanged).

---

## 10. Known issues / deferred

- Android device proof not run (sim was iOS). Parity is automatic via shared RN +
  gorhom; recommend the tester confirm on an Android device.
- The live OAuth-gated deck→event→cart path was not auto-driveable on sim; the
  shared-component harness proof is equivalent (same component, same props), but a
  human spot-check on a signed-in device through the real event/trip/experience
  flows is worthwhile at TEST.

## 11. Operator action required

- None for migrations/edge (none exist).
- Route to orchestrator REVIEW → tester. Do NOT deploy/merge/close (per dispatch).

## 12. Discoveries for orchestrator

- **Sibling worktree `ORCH-1147-[cart-true-price]`** is also working on the cart.
  My change is layout/sheet-sizing ONLY (no pricing/checkout logic, no shared
  arithmetic) and touches `TicketCartSheet.tsx` + `BaseBottomSheet.tsx` only —
  ORCH-1147 (cart true price) likely edits the pricing useMemo / breakdown. Flag
  for merge-order coordination: both touch `TicketCartSheet.tsx`. No logical
  conflict, but a textual merge conflict in that file is possible; whichever lands
  second should re-run the ORCH-1138 content-sizing test + the ORCH-1043 gate.
- `maxDynamicContentSize` is now a reusable BaseBottomSheet capability — other
  content-short sheets currently stuck on fixed snaps (e.g. share/filter sheets)
  could adopt the same pattern in a future polish ORCH if Seth wants.
