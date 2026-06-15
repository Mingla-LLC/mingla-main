# IMPLEMENTATION — ORCH-1138 Leg 1C trip-sheet device-regression rework

**Scope:** three consumer-app trip-sheet bugs from Seth's device test. Two are a
regression the Leg-1C change introduced by abandoning the proven ORCH-1016 sheet
pattern (frozen scroll + no floating bar); one is the "Presented by" brand cover
not rendering gif/video. No deploy/merge/close.

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on
`ORCH-1138-trip-page-redesign`. Prior HEAD `052d3097d`. (Working-tree changes —
not yet committed; commit on orchestrator REVIEW.)

---

## 1. Summary

The Leg-1C foundation change mounted `ParallaxCoverShell` as the consumer trip
sheet's scroll host and injected gorhom's `BottomSheetScrollView` as its
`ScrollComponent`. On native, `ParallaxCoverShell` wraps its `<ScrollView>` inside
a `nativeHost` `<View>` — so the gorhom scroll was NO LONGER a DIRECT child of
gorhom's height-bounded `BottomSheetContent`. Per the ORCH-1016/1043 invariant
that makes the viewport `== content`, `maxScroll = 0`, and the body FROZE on
Seth's device. The floating reserve bar, though `position:"absolute"`, lived in
that frozen content-sized host so it wasn't a visible always-floating bar.

The fix restores the PROVEN direct-child structure while keeping the new themed
Direction-A look, and uses the gif/video-aware cover component for the brand chip.

---

## 2. Root cause (proven)

- `packages/offering-rendering/ParallaxCoverShell.tsx` native branch:
  `nativeHost` `<View>` → `{ nativeCover (absolute), <Scroll> , nativeChrome }`.
  The injected `BottomSheetScrollView` is nested inside `nativeHost`, i.e. it is a
  GRANDCHILD of `<BottomSheet>`, not a direct child of `BottomSheetContent`.
- gorhom only bounds the DIRECT child of `BottomSheetContent` to the snap height
  (`i-bottomsheet-inline-scroll-binding` / ORCH-1043). A non-direct scroll host →
  unbounded parent → `viewport == content` → `maxScroll 0` → frozen body.
- This is the exact SPEC §4.5 OQ-3 risk ("if the absolute-overlay-inside-shell
  approach fails device verification … STOP and amend"). It materialized on device.
- `ParallaxCoverShell` is DO-NOT-TOUCH (`packages/*`, SPEC OQ-4) because it ships
  the business/web trip page; editing its native branch could regress the business
  page. So the fix composes AROUND it, it does not edit it.

---

## 3. The structural fix (FIX 1 + 2)

`app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` populated return now
renders, as DIRECT children of `<BaseBottomSheet scrollMode="view" hidesBottomNav>`
(gorhom `BottomSheetContent`):

1. **Pinned cover** — `<View style={nativeCover} position:absolute zIndex:1>` with
   `EventCoverMedia` (gif/video/image-aware) + scrim + `ThemeEntranceAnimation`.
2. **The gorhom scroll host** — `<BottomSheetScrollView style={nativeScroll
   zIndex:2}>` (the SINGLE registered scrollable, a DIRECT child → bounded
   viewport → SCROLLS). Inside it: a cover-height spacer (`coverSpacer`, 4:5) + the
   opaque rounded themed body seam (`nativeBody`, `palette.page` / `palette.panelBorder`,
   `marginTop:-28` seam) holding the hero caption + `bodyChildren`. The content
   container carries `paddingBottom = reserveBarClearance (96 + max(insets.bottom,16))`
   so the last row clears the floating bar.
3. **Chrome** — `<View style={nativeChrome} position:absolute zIndex:70>` with the
   shared `OfferingChrome` (close/share/mute).
4. **Floating reserve bar** — `{floatingReserve}` = the existing
   `ConsumerTripReserveBar` (already `position:"absolute" bottom:0`, zIndex 6) as an
   absolute sibling DIRECT child — ALWAYS visible, NOT `stickyFooter`.

This mirrors `ParallaxCoverShell`'s native LAYOUT inline (same z-order cover 1 <
content 2 < reserve 6 < chrome 70) but with the gorhom scroll as a DIRECT child of
the sheet — restoring the ORCH-1016/1043 contract. The unavailable/bookings-closed
strip variant, the ORCH-1117 price-left/action-right anatomy, the deposit/plan
wiring, `paymentPlanChoice`/`dueTodayCents` threading into `ExpandedBusinessEventSheet`,
and the existing `nativeCheckoutFlow` are all UNCHANGED.

`ParallaxCoverShell` is no longer imported by the screen (it remains the
business/web host — untouched). `OfferingChrome` + `EventCoverMedia` +
`ThemeEntranceAnimation` + `ChipGroup` + `CountAwareGallery` are still consumed
from the shared packages, so parity is still by shared-package convergence.

## 4. Brand cover (FIX 3)

The "Presented by" chip previously rendered an `accentWash` `<View>` tile (no
cover component at all). It now renders the gif/video/image-aware `EventCoverMedia`
(`brandTile` gains `overflow:"hidden"` to clip to the circle). The anon-safe
consumer trip data path (`useConsumerTripDetail`, COMMS-0009 — never reads the
brands table) carries NO brand cover today, so `fnd.brandCoverMediaUrl` /
`brandCoverMediaType` are null → `EventCoverMedia` draws its hue gradient fallback
(rule 9, graceful). Added nullable `brandCoverMediaUrl` / `brandCoverMediaType` to
`ConsumerTripFoundationModel` (mapped null) so a future anon-safe brand-cover field
animates the chip with no further change. No `.from('brands')` added.

---

## 5. SPEC success-criteria coverage

| SC | Status | How |
|----|--------|-----|
| SC-2/3 (Direction-A themed body, brand palette, no `#FF6B35` in body) | ✓ | tests T2a/T2b/T2c; device shot themed body |
| SC-4 (Reserve CTA pinned/floats; body scrolls; pan-down dismisses) | ✓ DEVICE-VERIFIED | iOS sim: scrolled top→deep content→back, bar stayed pinned, swipe-down dismissed |
| SC-5 (tap Reserve → existing checkout, plan threading) | ✓ | tests T4a/T4b — `setReserveSheetVisible(true)` + `paymentPlanChoice`/`dueTodayCents` unchanged |
| SC-6/8 (states + rule 9) | ✓ | loading/error/not-found unchanged; brand cover + sections rule-9 guarded |
| FIX-3 (brand cover gif/video-aware) | ✓ | test T3d; `EventCoverMedia` with graceful hue fallback |

---

## 6. Files changed (working tree)

- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` — imports
  (ParallaxCoverShell→OfferingChrome+EventCoverMedia+ThemeEntranceAnimation),
  brand chip cover, populated return restructured, styles (foundationHost →
  nativeCover/Scroll/Body/Chrome). ~+120/−60.
- `app-mobile/src/hooks/useConsumerTripFoundation.ts` — `brandCoverMediaUrl` /
  `brandCoverMediaType` (nullable, mapped null). ~+18.
- `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts`
  — retargeted T1c/T2a/T3b/T3c/T9 + added T1d/T3d to the new direct-child structure.
- `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx`
  — retargeted R1f/R1f-2 to the direct-child structure (R1f-3/R1f-4 unchanged).

DO-NOT-TOUCH respected: no `packages/offering-rendering/*`, no business/web trip
page, no consumer-checkout change. Generated `app-mobile/ios/` (from a temp
`expo prebuild` for the device build) is gitignored — not committed.

## 7. Regression tests + fails-on-revert

- `orch_1138_consumer_trip_foundation.test.ts` — **28 checks PASS**.
- `orch_1016_consumer_trip_detail.rework_sheet.test.tsx` — **21 checks PASS**.
- **fails-on-revert (true line-deletion) verified:**
  - FIX-1/2: deleting the direct-child `BottomSheetScrollView` (re-nesting under
    ParallaxCoverShell-as-host) FAILS `T3c` (foundation) AND `R1f` (rework_sheet).
  - FIX-3: reverting the brand cover to the plain `accentWash` tile FAILS `T3d`.
  - Restored → all green again. Verified at working-tree state on `052d3097d`.
- Gates green: `orch-1043-sheet-scroll-viewport-check` (10/10),
  `i-bottomsheet-inline-scroll-binding` (PASS), `orch-1028-scroll-policy` (PASS),
  `i-proposed-trip-canonical-columns` (PASS), `orch-1105-web-glass` (PASS).
- `tsc --noEmit` on the two changed source files: **0 errors** (pre-existing
  unrelated Deno/JSX errors elsewhere untouched). eslint `import/no-unresolved` on
  the `@mingla/*` aliases is a pre-existing resolver false-positive (same on
  origin/main; resolves in tsc + Metro).

## 8. SIM verification (MANDATORY — runtime layout bug)

iPhone 17 Pro simulator (UDID 17091E60-…). Built app-mobile from a bracket-free
symlink of the worktree (the `[trip-page-redesign]` brackets corrupt Metro/Haste
entry-point resolution — a documented worktree-path hazard, NOT my code: `expo
export` from the bracket-free path bundled cleanly, 31.6 MB). Ran the offline
Release `.app` (embedded `main.jsbundle`, `SENTRY_DISABLE_AUTO_UPLOAD=true`), no
dev Metro. Metro for the dev attempt ran on isolated port 8094 (8082/8085/8088
parallel sessions left untouched; symlink + 8094 cleaned up after).

Deep-linked `com.mingla.app.v2://t/travelbrand/the-dc-adventure` (a published trip,
gif cover — exercises FIX-3's gif path). Observed (screenshots saved /tmp):

1. **Body SCROLLS** — swiped up: top (hero "The DC Adventure") → deep content
   ("Day 3", "What's included", "What's not included", "Cancellation policy"
   ladder, "HOW YOU PAY" Charged today €500.00); swiped back → returned to top.
   YES, confirmed visually.
2. **Reserve bar FLOATS / always visible** — "All-in, taxes included / From … /
   Reserve my spot →" stayed pinned at the bottom THROUGH the scroll. Chrome
   (X/Share) stayed pinned at top. YES, confirmed visually.
3. **Swipe-down dismisses** — dragging the sheet down moved it through snaps and a
   full swipe-down closed it back to the login screen. YES, confirmed visually.

Result: **implemented and verified** (all three behaviors seen on the sim).

## 9. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | YES | the fix; device-verified |
| Consumer Android | YES (shared RN) | parity automatic (RN); z-order uses explicit zIndex (native ordering); device proof is a TEST-phase item |
| Buyer/anon Web | no | consumer screen is app-mobile-only |
| Business iOS / Android | no | `ParallaxCoverShell` / TripPreview untouched |
| Admin Web / Business Web preview | no | n/a |

## 10. Operator action required

- None for migration/edge (no schema/edge change).
- Route to orchestrator REVIEW → mingla-tester (device proof of scroll-not-frozen +
  floating bar on iOS + Android, esp. the cold deep-link route).

## 11. Discoveries for orchestrator

- **SPEC §4.5 / OQ-3 / OQ-4 are now resolved by the device fact:** ParallaxCoverShell
  CANNOT host the gorhom scroll inside a bottom sheet on native (its `nativeHost`
  View makes the scroll a non-direct child → freeze). The all-surface DRAFT
  invariant `I-PROPOSED-TRIP-PAGE-SHARED-FOUNDATION-ALL-SURFACES` should be flipped
  ACTIVE with wording "business/web render via ParallaxCoverShell; consumer composes
  the same shared primitives (OfferingChrome/EventCoverMedia/ChipGroup/
  CountAwareGallery) around a direct-child gorhom scroll" — NOT "all three mount
  ParallaxCoverShell". The two retargeted tests already encode this.
- **Worktree-path hazard:** the `[trip-page-redesign]` brackets break Metro entry
  resolution (red-box `Unable to resolve module ./mingla-main/.../expo-router/entry`).
  Future device runs from this worktree need a bracket-free symlink (or rename).
- Consumer trip data still has no anon-safe brand cover field (COMMS-0009); the
  brand chip shows the hue fallback until/unless one is added to the anon view.
