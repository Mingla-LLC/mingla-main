# QA_ORCH-1016_NAV_CLEARANCE_RETEST

## Verdict

FAIL.

The ORCH-1016 nav-clearance rework still does not meet the user-visible acceptance condition. On a clean iPhone 17e simulator, both the consumer event detail sheet and the trip Reserve sheet still render the lower Tickets area underneath Mingla's floating bottom nav.

## Scope

- ORCH-1016 [Consumer Discover Trips tab]
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]`
- Branch: `ORCH-1016-consumer-discover-trips-tab`
- Implementation report reviewed: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1016_NAV_CLEARANCE_REWORK.md`
- Prior fail report reviewed: `Mingla_Artifacts/reports/QA_ORCH-1016_NAV_CLEARANCE_LIVE_MEASURE.md`

## Environment

- Simulator used: iPhone 17e `37F202F2-ABB5-4AA8-860D-1AADB70A7AEF`
- Seth's active simulator was not touched: iPhone 17 Pro Max `2C3312D9-EE52-4EBD-9704-15811D49A2EC`
- Native rebuild: reused prior successful dev build on the iPhone 17e (`/tmp/orch1016_17e_xcodebuild.log` contains `** BUILD SUCCEEDED **`)
- Metro: fresh ORCH worktree Metro on port `8216`
- Metro workaround: temporary local symlink `app-mobile/mingla-main -> /Users/sethogieva/Desktop/mingla-main` was needed because this worktree's `node_modules` symlink made Expo resolve `expo-router/entry` as `./mingla-main/app-mobile/node_modules/expo-router/entry`. The symlink was removed before this report.

## P0/P1 Findings

### P1 — Trip Reserve sheet still leaves the ticket area/Buy CTA under the floating nav

Evidence:

- Screenshot: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_retest/trip_reserve_initial_iphone17e.png`
- Screenshot after two upward swipes: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_retest/trip_reserve_scrolled_blocked_iphone17e.png`
- Runtime path: Discover -> Trips -> `The Sone` -> Reserve.
- The ticket card reaches the nav region; the lower CTA area is hidden behind the nav even after swipes from `50%,70%` to `50%,30%`.

Impact:

The original reported issue remains: the bottom of the Reserve page does not clear the nav menu.

### P1 — Consumer event detail still leaves the Tickets area under the floating nav

Evidence:

- Screenshot: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_retest/event_initial_iphone17e.png`
- Screenshot after repeated upward swipes: `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_retest/event_scrolled_blocked_iphone17e.png`
- Runtime path: Discover -> Events -> `Vibes and Stuff`.
- The ticket card remains in the nav region and repeated swipes did not move the lower content clear.

Impact:

The shared `ExpandedBusinessEventSheet` path remains blocked for event detail as well as trip Reserve.

## Source-Cause Finding

The implementor threaded `bottomSheetInset` correctly through the app code, but the selected gorhom prop does not affect this inline sheet layout.

Verified app-code evidence:

- `app-mobile/src/hooks/useAppLayout.ts:30-48` defines `getFloatingBottomNavSheetInset(...)` from the real nav capsule height plus platform bottom offset.
- `app-mobile/src/components/ui/BaseBottomSheet.tsx:184-189` exposes `bottomSheetInset?: number`.
- `app-mobile/src/components/ui/BaseBottomSheet.tsx:603-608` forwards it as `<BottomSheet bottomInset={bottomSheetInset}>`.
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:71-76, 157-165, 444-455` accepts and passes the prop.
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx:538-551` passes the inset for trip Reserve.
- `app-mobile/src/components/ExpandedCardModal.tsx:1713-1724` passes the inset for event detail.

Verified gorhom behavior:

- `app-mobile/node_modules/@gorhom/bottom-sheet/src/hooks/useAnimatedLayout.ts:51-53` and `80-83` subtract `bottomInset` only when `modal` is true.
- `app-mobile/node_modules/@gorhom/bottom-sheet/src/components/bottomSheet/BottomSheet.tsx:190-195` passes `$modal` into `useAnimatedLayout`.
- This app uses the plain inline `<BottomSheet>` in `BaseBottomSheet`, not gorhom modal mode, so `$modal` is false.
- `useAnimatedDetents.ts:55-56` only applies `bottomInset` to the closed detent when `$modal || detached`; it does not lift the visible inline viewport above the nav.

Measured cause:

`bottomSheetInset` reaches the `<BottomSheet>` component, but gorhom does not use it to reduce the visible inline sheet container. The sheet still lays out to the bottom of the screen, and the later absolute `GlassBottomNav` still overlays the lower content.

## Claim Table

| Claim | Result | Evidence |
|---|---:|---|
| BaseBottomSheet forwards `bottomSheetInset` to gorhom `bottomInset`. | Verified | Source lines above plus regression `N2` passed. |
| Both trip Reserve and event detail pass a nav-aware inset into the shared sheet. | Verified | Source lines above plus regression `N4/N5` passed. |
| The change fixes trip Reserve nav clearance. | Refuted | `trip_reserve_scrolled_blocked_iphone17e.png`. |
| The change fixes event detail nav clearance. | Refuted | `event_scrolled_blocked_iphone17e.png`. |
| Regression tests cover the original source miss. | Partial | New source test catches missing prop threading, but runtime proves the chosen gorhom prop is not sufficient for inline sheets. |

## Commands / Checks Run

Passed source-regression checks:

```bash
node app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx
node app-mobile/src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx
node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx
```

Result:

- `ORCH-1016 REWORK-7 nav-container-clearance — 6 checks PASS`
- `ORCH-1016 consumer-trip-detail REWORK-2 ... — 22 checks PASS`
- `ORCH-1016 REWORK-4 — 16 checks PASS`
- `ORCH-1016 consumer-trip-detail adversarial — 18 checks PASS`

Runtime commands used:

```bash
EXPO_NO_TELEMETRY=1 CI=1 npx expo start --dev-client --port 8216 --clear --host localhost
~/.maestro/bin/maestro --device 37F202F2-ABB5-4AA8-860D-1AADB70A7AEF test <flow>
xcrun simctl io 37F202F2-ABB5-4AA8-860D-1AADB70A7AEF screenshot <path>
```

Maestro confirmed completed taps/swipes/screenshots for the event and trip flows.

## Platform Matrix

| Platform | Result | Evidence |
|---|---:|---|
| iOS simulator | FAIL | iPhone 17e screenshots listed above. |
| Android emulator | Not run | iOS already fails the core acceptance gate; Android parity should be retested after the next rework. |
| Web/browser | N/A | Native sheet host only; shared web renderer was not changed. |
| Business/admin surfaces | N/A | Consumer native sheet host only. |

## Regression Coverage Assessment

The new regression test is useful but insufficient as a release gate. It proves the prop is threaded through the app code, but it did not assert gorhom's actual inline-sheet behavior. A follow-up regression should fail if `BaseBottomSheet` relies only on gorhom `bottomInset` for non-modal inline sheets; it should assert either an explicit parent/container bottom offset for `bottomSheetInset > 0` or a tested switch to a sheet mode where the inset truly changes layout.

Fail-on-revert proof was not attempted because live runtime evidence already refutes the current implementation.

## Required Rework

Do not rely on gorhom `bottomInset` alone for Mingla's inline `BaseBottomSheet`.

Recommended fix direction:

1. In `BaseBottomSheet`, when `bottomSheetInset > 0` and `wrapInRNModal === false`, apply the offset to the inline sheet container itself, for example by rendering the absolute-fill wrapper with a bottom style or by passing an explicitly reduced container height that gorhom uses for inline layout.
2. Keep the shared `ExpandedBusinessEventSheet` threading so both trip Reserve and event detail use the same solution.
3. Update the regression so it verifies inline/non-modal behavior, not just that `bottomInset` is forwarded.
4. Retest both screenshots on iPhone 17e or another non-Seth simulator before returning PASS.

## Final QA Outcome

FAIL.

One-line root cause: gorhom `bottomInset` is a no-op for this plain inline `BottomSheet` visible viewport, so the shared event/reserve sheet still extends underneath the absolute floating `GlassBottomNav`.
