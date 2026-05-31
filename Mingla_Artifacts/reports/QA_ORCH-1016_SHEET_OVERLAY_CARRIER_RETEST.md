# QA_ORCH-1016_SHEET_OVERLAY_CARRIER_RETEST

## Verdict

BLOCKED/UNVERIFIED.

The source-level rework now matches the forensic root cause: it lifts the full trip/event sheet group above Mingla's floating bottom nav instead of trying to pad the content underneath it. I could not produce a runtime PASS, because the dedicated iOS simulator could not be driven into signed-in Discover/Trips/Events after the 8216 bundle attempts, and the plugged-in iPhone was visible to Apple device listing but not available to Maestro/xctrace for automated driving.

This is not a visual PASS. The manual gate remains: run a fresh dev build bundle and confirm the trip detail, trip Reserve sheet, event detail, and cart CTA all clear the nav.

## Scope

- ORCH-1016 [Consumer Discover Trips tab]
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]`
- Branch: `ORCH-1016-consumer-discover-trips-tab`
- Input reports:
  - `Mingla_Artifacts/reports/FORENSIC_ORCH-1016_SHEET_REGRESSION_TRACE.md`
  - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1016_SHEET_OVERLAY_CARRIER_REWORK.md`
  - `Mingla_Artifacts/reports/QA_ORCH-1016_NAV_CLEARANCE_LIVE_MEASURE.md`

## Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| BLOCKING GATE | Runtime visual proof is still missing for the current overlay-carrier rework. | iPhone 17e simulator loaded the dev client but either rendered a blank Explore shell or stayed on the Expo Development Build launcher; no path reached Trips/Events. Physical iPhone was `available (paired)` in `devicectl`, but `xctrace` listed it offline and Maestro listed only simulators. | Tester/manual retest must verify fresh 8216 bundle on a usable signed-in device before close/merge. |
| P2 | TypeScript full check still did not finish inside the local 120 second cap. | `cd app-mobile && timeout 120 npx tsc --noEmit --pretty false` exited `124` with no output. This matches the implementor report's partial verification note. | Do not use this as a PASS gate. Either run a longer full typecheck before PR, or keep scoped source tests plus manual visual gate. |
| P3 | Some comments still describe the old padding/inset mental model even though the actual fix is group-level overlay ownership. | `ExpandedBusinessEventSheet.tsx` still comments that the spacer carries nav footprint; `ConsumerTripDetailScreen.tsx` comments include older footer/nav-clearance wording. Runtime behavior is not driven by comments. | Optional cleanup before PR to reduce future misdiagnosis. |

## Claim Table

| Claim | Status | Evidence |
|---|---|---|
| The fix addresses the true root cause by lifting the whole sheet group above the nav. | Verified by source. | `SheetOverlayCarrier.tsx` wraps children in RN `Modal` + `GestureHandlerRootView`; `ConsumerTripDetailScreen.tsx:196-202` wraps the in-app trip sheet group; `ExpandedCardModal.tsx:1706-1718` passes `renderInOverlayCarrier` for business-event detail; `ExpandedBusinessEventSheet.tsx:455-500` keeps EBES and `TicketCartSheet` in one sibling group. |
| Trip detail + Reserve now share one carrier when the app nav is present. | Verified by source. | `ConsumerTripDetailScreen.tsx:510-547` returns main detail `BaseBottomSheet` and Reserve `ExpandedBusinessEventSheet` inside `renderSheetGroup(...)`; source test `orch_1016_consumer_trip_detail.rework_sheet.test.tsx` passed R2a/R2b. |
| Consumer event detail now uses the group carrier instead of an inline early-return sheet below the nav. | Verified by source. | `ExpandedCardModal.tsx:1706-1718` returns `ExpandedBusinessEventSheet` with `renderInOverlayCarrier`. Source test `orch_1016_nav_container_clearance.test.tsx` passed N5. |
| Cart CTA avoids double fake nav padding when the group is already in a modal above the nav. | Verified by source. | `TicketCartSheet.tsx:188-193` defines `clearFloatingNav`; `ExpandedBusinessEventSheet.tsx:484-498` passes `clearFloatingNav={!renderInOverlayCarrier}`; `TicketCartSheet.tsx:437-447` conditionally adds `BOTTOM_NAV_CONTENT_HEIGHT`. |
| Trip/event/ticket bottoms visually clear the nav on device. | Unverified. | Simulator retest could not reach the flows. Seth's supplied screenshots in this artifact folder still show the failure on a real device, but I cannot prove whether those screenshots were from before or after the overlay-carrier build. |

## Platform Matrix

| Platform | Result | Evidence / reason |
|---|---|---|
| iOS simulator | BLOCKED/UNVERIFIED | Used iPhone 17e `37F202F2-ABB5-4AA8-860D-1AADB70A7AEF`, avoiding Seth's active iPhone 17 Pro Max simulator. Bundle/dev-client attempts did not reach signed-in Discover content. Screenshots are in `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/`. |
| iOS physical device | BLOCKED/UNVERIFIED | `devicectl list devices` showed `Seth's iPhone` available/paired with app `com.mingla.app.v2` installed. `xctrace list devices` showed the same phone offline, and Maestro did not list the real device as a target, so I could not drive/capture it. |
| Android | UNVERIFIED | The failing report and available screenshots are iOS. The RN carrier should apply cross-platform, but Android needs a separate gesture/back-button pass before close. |
| Web/browser | N/A | Native RN bottom-sheet/nav issue; no web sheet surface changed. |

## Commands Run

```bash
node app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx
```

Result:

```text
ORCH-1016 sheet/nav ownership regression - 7 checks PASS
```

```bash
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx
```

Result:

```text
# ORCH-1016 consumer-trip-detail REWORK-2 (frozen-scroll fix + Trips plane icon) - 22 checks PASS
```

```bash
node app-mobile/src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx
```

Result:

```text
ORCH-1016 REWORK-4 - 16 checks PASS
```

```bash
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx
```

Result:

```text
# ORCH-1016 consumer-trip-detail adversarial - 18 checks PASS
```

```bash
node app-mobile/src/components/expandedCard/__tests__/orch_1016_consumer_intake_renderer.test.tsx && git diff --check
```

Result:

```text
14 checks PASS
```

`git diff --check` produced no output.

```bash
cd app-mobile && timeout 120 npx tsc --noEmit --pretty false
```

Result:

```text
exit 124, no TypeScript output before timeout
```

## Runtime Attempts

### Dedicated iOS simulator

- Simulator: iPhone 17e `37F202F2-ABB5-4AA8-860D-1AADB70A7AEF`
- Metro: port `8216`
- Evidence copied to:
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/00_launch_black.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/01_blank_explore_after_8216_deeplink.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/02_maps_permission_overlay.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/03_dev_launcher_after_permission.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/04_dev_launcher_stuck.png`

Observed state: the dev build/deep link did not reach a usable signed-in Discover surface. The app either rendered a blank Explore shell with only the nav or returned to Expo's Development Build launcher.

### Seth's supplied real-device screenshots

- `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/user_real_device_trip_blocked.png`
- `Mingla_Artifacts/reports/qa_evidence_orch1016/sheet_overlay_carrier_retest/user_real_device_event_blocked.png`

Observed state: both screenshots show the old user-facing failure: lower trip/event content is covered by bottom chrome/nav. Because I could not drive the current fresh build on the real device, I am treating these as evidence that the bug is real, not as proof that the latest overlay-carrier rework failed.

## Regression Coverage

The new source regression test is meaningful: it would catch reverting the fix back to content padding, `bottomSheetInset`, or a single-root modal escape hatch. It specifically asserts group-level sheet ownership across both failing mount sites.

Remaining gap: there is still no automated pixel/geometry test proving `last meaningful bottom <= navTop - 8` on a live device. That is why this retest cannot be PASS without manual/runtime evidence.

## Required Manual Gate

On a fresh dev build/bundle, verify:

1. Discover -> Trips -> open `The Sone` -> scroll trip detail bottom. The Reserve footer and bottom content must be fully visible and tappable without the app nav covering them.
2. Tap `Reserve my spot`/`Reserve` -> scroll to tickets. Ticket row and Buy/Get action must be fully visible and tappable above the nav.
3. Discover -> Events -> open `Vibes and Stuff` or any ticketed event -> scroll to Tickets. The ticket row and Buy action must clear the nav.
4. Open the cart from a ticket Buy/Get flow. The cart CTA must clear the safe area and nav.

PASS condition: screenshots from the current bundle show all four surfaces clear the bottom nav.

## Final Outcome

BLOCKED/UNVERIFIED.

The code is now pointed at the right mechanism, and all targeted source regressions pass. The release gate is still closed until a signed-in real-device or clean-simulator visual pass proves the bottom of the trip/event sheets actually clears the floating nav.
