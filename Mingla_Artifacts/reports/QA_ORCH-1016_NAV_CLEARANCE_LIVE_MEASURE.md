# QA_ORCH-1016_NAV_CLEARANCE_LIVE_MEASURE

## Verdict

FAIL.

The live app still renders the trip reserve/event detail bottom content underneath Mingla's floating bottom nav. This was reproduced on a clean separate simulator after a native rebuild and a fresh Metro bundle.

## Scope

- ORCH-1016 [Consumer Discover Trips tab]
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]`
- Branch: `ORCH-1016-consumer-discover-trips-tab`
- HEAD: `a436b0b10 ORCH-1016 REWORK-6: ROOT-CAUSE fix — reserve/event sheet Buy button blocked by bottom nav`

## Environment

- Simulator used: iPhone 17e `37F202F2-ABB5-4AA8-860D-1AADB70A7AEF`
- Seth's active sim was not touched for this retest: iPhone 17 Pro Max `2C3312D9-EE52-4EBD-9704-15811D49A2EC`
- Native rebuild needed: yes
- Native rebuild evidence: `/tmp/orch1016_17e_xcodebuild.log` contains `** BUILD SUCCEEDED **`
- Dedicated Metro: port `8216`, cwd `/Users/sethogieva/Desktop/mingla-main/app-mobile`
- Fresh bundle evidence: `/tmp/orch1016_metro_8216.log` shows a fresh `iOS Bundled 43060ms node_modules/expo-router/entry.js (5039 modules)` and signed-in runtime logs for user `c727d491-4884-4e72-b467-d6c124b9a8b9`

## Evidence Screenshots

- Trip reserve initial: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_live/trip_reserve_initial_iphone17e.png`
- Trip reserve blocked after scroll attempts: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_live/trip_reserve_nav_blocked_iphone17e.png`
- Event detail blocked after scroll attempts: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_live/event_detail_nav_blocked_iphone17e.png`

## Live Result

### Trip

Path tested:

1. Explore -> Discover.
2. Trips.
3. Open `The Sone`.
4. Tap `Reserve`.
5. Attempt repeated scroll/swipe gestures from above the nav.

Result: FAIL. The `Tickets` heading and ticket/button area are visibly under the floating nav. Repeated `scroll`, `scrollUntilVisible`, and explicit swipe attempts did not move the tickets area fully above the nav.

Live measurement from screenshot:

- Screenshot size: `1170 x 2532`.
- Rendered nav capsule occupies the lower screen region and overlays the sheet content.
- The `Tickets` section begins behind/under the nav's top edge in `trip_reserve_nav_blocked_iphone17e.png`; the visible page bottom does not clear the nav.
- The sheet still accepts taps behind/near the nav poorly: one scroll attempt on the center path hit `Open maps`, proving the nav/sheet/content lower hit area is still not separated from blocked controls.

### Event

Path tested:

1. Explore -> Discover.
2. Events.
3. Open `Vibes and Stuff`.
4. Attempt repeated scroll/swipe gestures from above the nav.

Result: FAIL. The lower event-detail content remains under the floating nav. The address card bottom is covered by the nav in `event_detail_nav_blocked_iphone17e.png`, and repeated swipes from the left side of the sheet did not move the lower content clear.

Live measurement from screenshot:

- Screenshot size: `1170 x 2532`.
- The event detail body continues beneath the nav capsule.
- The nav is a later, absolute sibling and visually/gesture-wise overlays the expanded event sheet.

## Source-Cause Finding

The REWORK-6 spacer exists, but it fixes the wrong layer.

Evidence:

- `ExpandedBusinessEventSheet.tsx:392-420` injects `SheetScrollHost` and appends a real `<View style={{ height: bottomPad }} />` as the final `BottomSheetScrollView` child.
- `PublicEventPage.tsx:492-915` renders the shared event page inside the injected `ScrollComponent`.
- Both trip reserve and consumer event detail use the shared `ExpandedBusinessEventSheet` host:
  - `ConsumerTripDetailScreen.tsx` passes the reserve sheet into the same expanded business event sheet path.
  - `ExpandedCardModal.tsx:1708-1719` renders `ExpandedBusinessEventSheet` for consumer event details and passes `bottomContentInset={BOTTOM_NAV_CONTENT_HEIGHT + insets.bottom + 32}`.
- `BaseBottomSheet.tsx:587-605` does not pass gorhom's `bottomInset` or any equivalent container offset to `<BottomSheet>`.
- `app/index.tsx:118-124` and `app/index.tsx:2508-2512` render `GlassBottomNav` as an absolute sibling above page content; `GlassBottomNav.tsx:303-307` makes the capsule 72pt tall.

Measured cause:

The bottom sheet viewport itself still extends behind the floating nav. REWORK-6 adds scrollable content height inside the `BottomSheetScrollView`, but the sheet's visible lower viewport and hit region are still underneath the nav because `BaseBottomSheet` never offsets the gorhom sheet container above the nav. A spacer can add trailing content, but it cannot move the viewport or touch target region out from under a later absolute sibling.

## Required Fix

Implement at the sheet-container layer, not only inside scroll content:

1. Add a nav-aware container offset to `BaseBottomSheet`, preferably by passing gorhom `bottomInset` when a sheet is rendered below the visible `GlassBottomNav`.
2. Thread that offset through the shared `ExpandedBusinessEventSheet` path used by both trip reserve and consumer event detail.
3. Use the actual rendered nav footprint, not `BOTTOM_NAV_CONTENT_HEIGHT` alone. The nav capsule is `glass.chrome.nav.capsuleHeight` (72pt) and is positioned at `navBottom` (`11` on iOS, `insets.bottom + 6` on Android), so the clearance source should account for the capsule height plus the nav bottom offset/breathing room.
4. Keep the REWORK-6 spacer if desired, but do not treat it as sufficient. The acceptance condition is visual: the Tickets section/Buy CTA/page bottom must be fully above the nav in a screenshot.
5. Add a regression test that would fail on this exact miss: assert the shared expanded event sheet either passes a nav-aware `bottomInset`/container offset into `BaseBottomSheet` or renders above the nav via `wrapInRNModal`, and assert the test covers both mount sites.

## Automated Checks Run

Passed source-assertion checks:

```bash
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx
node app-mobile/src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx
```

Result: all passed.

Test gap: these tests do not catch the live failure because they assert scroll-host/spacer/source wiring, not the actual gorhom sheet viewport offset relative to the floating nav.

## Prior Rework Quick Visual Pass

- Trips tab renders with the paper-plane travel icon.
- Trip detail opens and Reserve opens the shared sheet.
- Events tab opens `Vibes and Stuff`.
- Friend-card pills were visible in the signed-in Friends flow and stayed contained.
- Filter keyboard avoidance was not fully re-smoked in this pass because the nav-clearance failure reproduced before proceeding to keyboard QA.

## Final QA Outcome

FAIL.

One-line measured root cause: the sheet viewport is still rendered underneath the absolute floating `GlassBottomNav`; REWORK-6 only adds inner scroll content height and never offsets the gorhom sheet container above the nav.
