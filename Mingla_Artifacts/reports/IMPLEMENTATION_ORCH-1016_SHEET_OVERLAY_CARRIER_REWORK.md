# IMPLEMENTATION_ORCH-1016_SHEET_OVERLAY_CARRIER_REWORK

## Status

implemented, partially verified

ORCH-1016 [Consumer Discover Trips tab] had repeated failed fixes because the bottom of the sheets was being treated as a padding problem. The implemented rework changes the ownership model: trip/event sheet groups now render above Mingla's floating bottom nav in a shared RN Modal carrier, so the nav can no longer sit on top of the Reserve/Buy surfaces.

## Root Cause Applied

Forensic input: `Mingla_Artifacts/reports/FORENSIC_ORCH-1016_SHEET_REGRESSION_TRACE.md`.

The failed paths were multi-root sheet groups:

- Trip detail: main trip detail `BaseBottomSheet` + reserve `ExpandedBusinessEventSheet` + cart `TicketCartSheet`.
- Consumer event detail: direct `ExpandedBusinessEventSheet` early return + cart `TicketCartSheet`.

`BaseBottomSheet.wrapInRNModal` lifts one sheet root. These flows need the whole group lifted together. Padding, spacers, `bottomInset`, and inline host height cannot stop a later absolute sibling nav from covering the sheet.

## Changed

- Added `SheetOverlayCarrier`, a small shared RN Modal + `GestureHandlerRootView` carrier for related vanilla gorhom sheet groups.
- Updated `ExpandedBusinessEventSheet` with `renderInOverlayCarrier`, wrapping the EBES + `TicketCartSheet` sibling roots together when used directly from the event detail path.
- Updated `ConsumerTripDetailScreen` so the in-app trip detail presentation wraps the main detail + reserve sheet group together when `tabBarAware=true`. The cold deep-link route still passes `tabBarAware={false}` and does not use the carrier.
- Updated `TicketCartSheet` with `clearFloatingNav`; inline uses still add bottom-nav padding, but overlay-carried uses only safe-area clearance because the nav is behind the modal window.
- Updated ORCH-1016 source-regression tests so they assert group-level sheet ownership and fail if the fix regresses back to padding/inset-only wiring.

## Surface Matrix

| Surface | Impact |
|---|---|
| Consumer iOS / Discover Events | Business-event detail now opens EBES + cart above the nav. |
| Consumer iOS / Discover Trips | Trip detail, Reserve, and cart now share one overlay carrier above the nav. |
| Consumer Android | Same React Native carrier applies; needs tester live-fire for gesture/back parity. |
| Cold trip deep link `/t/...` | Preserved: no app nav, no overlay carrier needed. |
| Chat group-event sheet | Preserved: EBES defaults `renderInOverlayCarrier=false`, so existing MessageInterface behavior remains opt-in unchanged. |
| Business/admin/web/Supabase | Not touched. |

## Verification

Passed:

```bash
node app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx
node app-mobile/src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx
node app-mobile/src/components/expandedCard/__tests__/orch_1016_consumer_intake_renderer.test.tsx
git diff --check
```

Partial / blocked checks:

```bash
cd app-mobile && npx tsc --noEmit --pretty false
```

Result: timed out after 120 seconds with no TypeScript output.

```bash
cd app-mobile && npx eslint <changed files>
```

Result: failed on existing resolver errors for `@mingla/event-rendering` and existing warnings in `ExpandedCardModal`. The new `SheetOverlayCarrier.tsx` did not surface a targeted lint error.

## Manual QA Gate

Tester must verify on a real device or clean simulator:

1. Discover → Trips → open a trip → scroll to the bottom of trip detail. The Reserve footer and bottom content must be fully visible above, or instead of, the app nav; the nav must not cover it.
2. Tap Reserve → scroll to Tickets. The ticket row/Buy action must be fully visible and tappable; the app nav must not cover it.
3. Discover → Events → open an event → scroll to Tickets. Same clearance expectation.
4. From a ticket Buy/Get flow, open cart. The cart CTA must be visible and tappable with safe-area clearance.

## Residual Risk

This is source-verified but not runtime-verified in this pass. The independent tester must confirm iOS and Android gesture behavior because the fix intentionally moves multi-root sheet groups into an RN Modal carrier.
