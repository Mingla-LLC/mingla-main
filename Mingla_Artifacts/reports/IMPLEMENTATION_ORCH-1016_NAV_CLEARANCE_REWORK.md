# Implementation Report: Nav Clearance Rework (ORCH-1016)

> Date: 2026-05-31
> Mode: Rework
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md`
> Design: `Mingla_Artifacts/specs/DESIGN_ORCH-1016_CONSUMER_DISCOVER_TRIPS_TAB.md`
> Status: implemented, partially verified

## 1. Layman Summary

Seth's plugged-in iPhone proved the remaining bug was not missing padding. The sheet was being measured against an ancestor taller than the physical phone window: on an iPhone with a `393 x 852` point display, the event sheet reported a `1057` point scroll viewport and the trip reserve sheet reported `1039`.

REWORK-10 bounds the inline `BaseBottomSheet` host to the real window height, while preserving the existing floating-nav inset and real trailing spacer. This should make gorhom compute a sane max scroll offset so the bottom tickets/page content can actually scroll clear of the floating nav instead of stopping early.

## 2. Request And Context

- **Request:** Fix trip/event bottom content still appearing under the floating nav or sticky Reserve bar during live testing.
- **Source:** Real-device tester handoff from 2026-05-31 plus Seth's live screenshots.
- **Affected surfaces:** Consumer native trip detail, trip Reserve shared event sheet, and consumer event detail sheet.
- **Related artifacts:** `QA_ORCH-1016_NAV_CLEARANCE_LIVE_MEASURE.md`, `QA_ORCH-1016_NAV_CLEARANCE_RETEST.md`.

## 3. Scope

- **In scope:** Correct gorhom's measured inline sheet viewport, keep real scroll clearance for tickets/pricing, preserve visible floating nav behavior.
- **Out of scope:** Web, business app, admin, DB, Supabase, checkout/payment logic, native rebuild/deploy.
- **Assumptions:** The bottom nav remains visible; the sheet should not be converted to a modal/portal surface.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `app-mobile/src/components/ui/BaseBottomSheet.tsx` | Shared sheet primitive | Non-wrapped sheet host relied on ancestor `absoluteFill`; real device proved that ancestor can be taller than the phone window. |
| `node_modules/@gorhom/bottom-sheet/src/components/bottomSheetHostingContainer/BottomSheetHostingContainer.tsx` | gorhom measurement behavior | `bottomInset` is applied as `bottom` on gorhom's hosting container, so the wrapper must add the inset back to keep measured height equal to the real window. |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Shared trip Reserve/event sheet host | Shared spacer already combines content clearance and nav overlay footprint. |
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | Main trip detail and Reserve mount | Main pricing rows keep scroll clearance above the sticky Reserve bar. |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Event detail mount | Event detail passes the same shared clearance inputs. |
| `app-mobile/src/hooks/useAppLayout.ts` | Nav footprint source | `getFloatingBottomNavSheetInset` accounts for capsule height and platform bottom offset. |

## 5. Blast Radius

- **Direct changes:** `BaseBottomSheet` and `orch_1016_nav_container_clearance` regression.
- **Existing in-branch changes preserved:** `ExpandedBusinessEventSheet`, `ConsumerTripDetailScreen`, `ExpandedCardModal`, and `useAppLayout` still carry the prior spacer/nav-clearance work.
- **Parity surfaces:** Consumer iOS and Android native sheets that use non-wrapped `BaseBottomSheet`. Buyer web, business native, admin web, and business web preview are not touched.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** None.
- **Deploy path:** Mobile JS/OTA-style code only; no DB or edge deploy.

## 6. Old To New Receipts

### `app-mobile/src/components/ui/BaseBottomSheet.tsx`

- **Before:** Non-wrapped sheets rendered inside `<View style={StyleSheet.absoluteFill}>`. On the real iPhone, that let Discover's taller ancestor become gorhom's measured container, producing impossible scroll viewport heights (`1057` / `1039` points on an `852` point screen).
- **After:** Non-wrapped visible sheets render inside `styles.inlineContainer` with `height: windowHeight + Math.max(0, bottomSheetInset)`.
- **Why:** gorhom's own `BottomSheetHostingContainer` applies `bottomInset` as `bottom`, so adding it back to the outer host produces an effective measured container equal to the real phone window while still preserving the nav-overlay inset contract.

### `app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx`

- **Before:** The regression guarded REWORK-9's full-wrapper and spacer behavior, but did not catch an oversized measured viewport.
- **After:** The regression now asserts `useWindowDimensions`, `inlineContainerHeight = windowHeight + Math.max(0, bottomSheetInset)`, the explicit inline host, and the absence of the old `StyleSheet.absoluteFill` wrapper.
- **Why:** It will fail if the real-device bug is reintroduced by letting gorhom measure against a taller ancestor again.

## 7. Implementation Details

- **Architecture decisions:** Keep `BaseBottomSheet` as the sole gorhom owner and avoid modal/portal conversion.
- **Data flow:** `bottomSheetInset` continues into gorhom as `bottomInset`; the outer inline host adds the same inset to its height so gorhom's measured container remains the physical window height.
- **State handling:** No state changes.
- **Error handling:** N/A.
- **Copy/accessibility:** No copy changed.
- **Analytics/notifications/realtime:** N/A.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Event/detail sheet does not stop scrolling early from an oversized viewport | Window-bounded inline host | `N2` source regression | Verified in source |
| Trip Reserve bottom clears floating nav | Existing shared spacer + corrected host measurement | `N4/N6` source regression plus required live smoke | Partially verified |
| Consumer event detail bottom clears floating nav | Existing shared spacer + corrected host measurement | `N5/N6` source regression plus required live smoke | Partially verified |
| Main trip detail Pricing/Tickets rows clear sticky Reserve bar + nav | Existing `scrollBottomClearance` preserved | `N7` source regression | Verified in source |
| Avoid REWORK-8 hard cutoff | Host is window-bounded, not bottom-shrunk above the nav | `N2` source regression | Verified in source |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| BaseBottomSheet remains sole gorhom owner | Yes | Yes | No new direct `@gorhom/bottom-sheet` import added. |
| Inline sheet invariant | Yes | Yes | Still uses inline `BottomSheet`; no modal provider/portal added. |
| No cross-session interference | Yes | Yes | Used the ORCH-1016 worktree and existing `8216` Metro context. |
| Regression test moves with behavior | Yes | Yes | Updated source regression encodes the physical-phone measurement contract. |
| UI design input | Yes | Yes | Design artifact already in report context; no new visual language introduced. |

## 10. Parity Check

- **Mobile:** Consumer iOS/Android shared native sheet behavior touched.
- **Business app:** Not touched.
- **Admin:** Not touched.
- **Public/web:** Not touched.
- **Solo/collab:** Trip Reserve and event detail share the same sheet host; no collab state changed.
- **Gaps:** Real-device visual PASS is still required after bundle reload.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No persisted behavior changed.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Nav-clearance source regression | `node app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx` | PASS | 7 checks; covers window-bounded inline host, shared spacer, trip detail scroll clearance. |
| Trip detail regression | `node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx` | PASS | 22 checks. |
| Sheet/keyboard/pills regression | `node app-mobile/src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx` | PASS | 16 checks. |
| Trip detail adversarial regression | `node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx` | PASS | 18 checks. |
| Whitespace | `git diff --check` | PASS | No whitespace errors. |
| Metro bundle compile | `curl -I -m 30 'http://172.20.9.90:8216/../../../mingla-main/app-mobile/node_modules/expo-router/entry.bundle?...'` | PASS | HTTP 200, `Content-Length: 28361025`, recent Metro log: `iOS Bundled 1198ms ... (1 module)`. |
| Real-device launch | `xcrun devicectl device process launch --device 41C4292C-1465-5C97-AE8E-FBCCADBD8530 --terminate-existing --activate com.mingla.app.v2` | PASS | App launched on Seth's plugged-in iPhone after the bundle compiled. |

Not rerun this pass:

- Full `npx tsc --noEmit` and broad lint were already known noisy in the current branch from prior reports.
- Final visual proof remains the real-device smoke test: Trip detail, Trip Reserve, and Event detail should all scroll their bottoms above the nav.

## 13. Regression Surface

1. Non-wrapped inline `BaseBottomSheet` container measurement.
2. Main trip detail sticky Reserve footer and scroll host.
3. Shared consumer event/trip Reserve event sheet.
4. TicketCartSheet sibling sheet, which keeps its own sticky CTA clearance.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Runtime proof pending | Source checks cannot prove final pixels clear the nav | Seth/tester confirms screenshots for main trip detail, trip Reserve, and event detail | QA handoff |
| Broad sheet primitive touched | Other non-wrapped sheets inherit the corrected window-bound host | Tester smoke should include at least one existing non-ORCH-1016 non-wrapped sheet if time permits | `BaseBottomSheet` |

## 15. Discoveries For Orchestrator

- None.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** JS-only React Native change; dev server currently expected at `http://172.20.9.90:8216`.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
ORCH-1016: bound inline sheet viewport to window

Resolves: ORCH-1016 nav-clearance rework
Evidence: focused source regressions pass
Deploy: mobile JS only; no DB or edge deploy
```

## Ready-To-Test Checklist

1. Fully reload the dev build from `http://172.20.9.90:8216`.
2. Discover -> Trips -> open `The Sone` -> scroll main trip detail to Pricing/Tickets. Expected: the rows can scroll fully above the sticky Reserve bar and bottom nav.
3. Tap Reserve -> scroll Tickets. Expected: ticket row/Buy CTA and page bottom sit fully above the floating bottom nav.
4. Discover -> Events -> open `Vibes and Stuff` or any published event -> scroll to Tickets/lower detail. Expected: bottom content clears the floating bottom nav with no hard cutoff exposing the feed underneath.
