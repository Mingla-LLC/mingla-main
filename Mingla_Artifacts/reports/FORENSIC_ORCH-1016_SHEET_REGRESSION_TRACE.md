# FORENSIC_ORCH-1016_SHEET_REGRESSION_TRACE

## Verdict

The repeated fix attempts failed because the bug is not a padding bug. It is a sheet ownership bug introduced by the sheet-conversion architecture and then exposed hard by ORCH-1016 [Consumer Discover Trips tab].

Mingla currently has three independent things fighting over the same bottom of the screen:

1. the gorhom sheet viewport,
2. the sheet's internal scroll content and sticky footer,
3. the app-level floating `GlassBottomNav`, which is a later absolute sibling with higher z-order.

Recent reworks kept moving padding/spacers/insets between the first two, but the user-visible blocker is the third: the floating nav still sits on top of the sheet group. Until the full sheet group is presented above the nav, or the sheet group is measured/clipped against the actual nav top, the bottom of the page can still be hidden no matter how much content padding exists.

## User Outcome Step-Back

Seth's goal is not "add bottom padding" or "make the Buy row scroll a little more." The actual success condition is:

> On trip detail, trip Reserve, and consumer business-event detail, the bottommost meaningful content and any Reserve/Buy CTA must be fully visible and tappable above Mingla's floating bottom nav.

The current code does not guarantee that outcome because the sheet and nav are owned by different siblings in the render tree.

## Evidence Read

### Historical artifacts

- `Mingla_Artifacts/specs/SPEC_ORCH-0696_BOTTOM_SHEET_REDESIGN.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0828_BRUTAL_RETEST_REPORT.md`
- `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md`
- `Mingla_Artifacts/specs/SPEC_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md`
- `Mingla_Artifacts/specs/DESIGN_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0991_WAVE_A_EXPANDED_CARD_HEIGHT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0991_SHEET_FINISHING_PASS_REPORT.md`
- `Mingla_Artifacts/reports/QA_ORCH-1016_NAV_CLEARANCE_LIVE_MEASURE.md`
- `Mingla_Artifacts/reports/QA_ORCH-1016_NAV_CLEARANCE_RETEST.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1016_NAV_CLEARANCE_REWORK.md`

### Current source files

- `app-mobile/src/components/ui/BaseBottomSheet.tsx`
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
- `app-mobile/src/components/ExpandedCardModal.tsx`
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
- `app-mobile/src/hooks/useAppLayout.ts`
- `app-mobile/app/index.tsx`
- `app-mobile/src/components/GlassBottomNav.tsx`
- `packages/event-rendering/PublicEventPage.tsx`
- `app-mobile/node_modules/@gorhom/bottom-sheet/src/hooks/useAnimatedLayout.ts`
- `app-mobile/node_modules/@gorhom/bottom-sheet/src/hooks/useAnimatedDetents.ts`
- `app-mobile/node_modules/@gorhom/bottom-sheet/src/components/bottomSheetHostingContainer/BottomSheetHostingContainer.tsx`

### Runtime / screenshot evidence

- Seth's real-device screenshots:
  - `/Users/sethogieva/Downloads/IMG_0465.PNG`
  - `/Users/sethogieva/Downloads/IMG_0464.PNG`
- QA blocked screenshots:
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_live/trip_reserve_nav_blocked_iphone17e.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_live/event_detail_nav_blocked_iphone17e.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_retest/trip_reserve_scrolled_blocked_iphone17e.png`
  - `Mingla_Artifacts/reports/qa_evidence_orch1016/nav_clearance_retest/event_scrolled_blocked_iphone17e.png`
- Historical META-ORCH-0991 screenshots:
  - `Mingla_Artifacts/reports/screenshots/INVESTIGATE_META-ORCH-0991/11_event_after_scroll.png`
  - `Mingla_Artifacts/reports/screenshots/IMPLEMENT_META-ORCH-0991_REWORK/A06_android_ebes_scrolled.png`
  - `Mingla_Artifacts/reports/screenshots/IMPLEMENT_META-ORCH-0991_FINISHING/ios_B_business_card_tap_opens.png`

## Historical Timeline

### 2026-04-29 — ORCH-0696 changed ExpandedCardModal into a gorhom bottom sheet

ORCH-0696 converted the centered ExpandedCardModal into a gorhom `<BottomSheet>` with `['50%','90%']` snap points and `initialIndex=1`. It also introduced the dark sheet chrome/tokens. This established the visual sheet language, but not the later shared primitive.

Relevant source archaeology:

- Commit `fa28bcbc7` shows `ExpandedCardModal` directly rendering `<BottomSheet index={visible ? 1 : -1}>`.
- The event/place/Ticketmaster expanded-card path became a 90% bottom sheet, not a true full-screen route.

### 2026-05-14 — ORCH-0828 exposed the business-event sheet fragility

ORCH-0828 investigated a business event card that mounted but did not appear. The original `ExpandedBusinessEventSheet` path used gorhom modal/portal mechanics and was invisible on tap. The report identified the portal/modal path as fragile and recommended the inline `<BottomSheet>` pattern as the pragmatic recovery path.

That was a real bug fix for "sheet does not open," but it traded one failure class for another:

- Before: business event sheet could fail to appear.
- After: business event sheet appears inline in the app tree.
- New risk: inline sheets under the custom floating nav need explicit z-stack or measured nav clearance.

### ORCH-0908 — the known z-stack fix was RN Modal wrapping

META-ORCH-0991's own investigation names ORCH-0908 as the fix for sheets mounted deep in the deck tree:

> wrap the gorhom `<BottomSheet>` in an RN `<Modal transparent animationType="none" statusBarTranslucent>` so it lifts above the custom tab bar.

This is the "old behavior" Seth is remembering for the good sheets: the proven expanded-card path had a carrier above the in-tree tab bar.

### 2026-05-29/30 — META-ORCH-0991 centralized sheets but preserved a split contract

META-ORCH-0991 made `BaseBottomSheet` the single gorhom owner and locked the inline vanilla `<BottomSheet>` pattern. It kept `wrapInRNModal` as an opt-in escape hatch.

This was the critical architectural fork:

- Wrapped sheet: lives in an RN Modal window above the custom nav.
- Non-wrapped sheet: lives inline under the app root; if the nav is visible, it can overlay the sheet.

The implementation finishing pass then made a wrong assumption:

> `ExpandedBusinessEventSheet` and `TicketCartSheet` are non-wrapped but mount inside a wrapped parent, so the nav is hidden; not tab-bar candidates.

That assumption is false for the failing paths:

- `ExpandedCardModal` returns `ExpandedBusinessEventSheet` early for business events, before the wrapped card-detail sheet renders.
- ORCH-1016 renders `ExpandedBusinessEventSheet` directly as the trip Reserve sheet.
- ORCH-1016 renders `ConsumerTripDetailScreen` as a new inline `BaseBottomSheet` group below the same floating nav.

### 2026-05-30 — ORCH-1016 reused the fragile business-event sheet as a trip Reserve sheet

ORCH-1016 introduced the Trips tab and trip detail flow, then reused `ExpandedBusinessEventSheet` for Reserve/ticket checkout. That reuse is reasonable at the ticketing/data layer, but it inherited the sheet-presentation problem:

- The reserve/event sheet group is not wrapped as one overlay group above the nav.
- The main trip detail sheet has its own sticky Reserve footer.
- The nav remains a later absolute sibling with `zIndex:50`.

That is when the issue became impossible to miss: trips now stack main detail + reserve sheet + nav at the same bottom edge.

## Current Architecture Map

### Floating nav

`app-mobile/app/index.tsx` renders `GlassBottomNav` after the page content:

- `styles.bottomNavigation`: `position:'absolute'`, `bottom:0`, `left:0`, `right:0`, `zIndex:50`
- inline iOS nav bottom offset: `11`
- `GlassBottomNav` capsule height: `72`
- wrapper horizontal padding: `8`

So the visible nav footprint is not just `BOTTOM_NAV_CONTENT_HEIGHT = vs(56)`. It is a capsule with an absolute bottom offset, placed after the content tree.

### BaseBottomSheet

`BaseBottomSheet` has two different presentation modes:

- `wrapInRNModal=true`: the single sheet is wrapped in an RN Modal and lifted above app-root siblings.
- `wrapInRNModal=false`: the sheet is rendered inline in the current tree.

The failing surfaces are inline/non-wrapped at the group level.

Important current code:

- `BaseBottomSheet.tsx` accepts `bottomSheetInset`, forwards it to gorhom `bottomInset`, and in the latest uncommitted rework gives the inline wrapper `height = windowHeight + bottomSheetInset`.
- `ExpandedBusinessEventSheet.tsx` appends a real spacer after `PublicEventPage`.
- `ExpandedCardModal.tsx` passes nav clearance into `ExpandedBusinessEventSheet` for business events.
- `ConsumerTripDetailScreen.tsx` passes nav clearance into `ExpandedBusinessEventSheet` for trip Reserve.
- `ConsumerTripDetailScreen.tsx` does not pass `bottomSheetInset` to its own main trip-detail `BaseBottomSheet`; it manages only footer/scroll padding.

### Shared event page

`PublicEventPage` renders:

- `<ScrollComponent style={styles.scroll} contentContainerStyle={styles.scrollContent}>`
- tickets near the bottom under `styles.ticketsCol`
- `styles.scrollContent.paddingBottom = spacing.xl * 2`

`ExpandedBusinessEventSheet` injects gorhom's `BottomSheetScrollView` as `ScrollComponent` and appends a real spacer after children.

This is useful for scroll extent, but it does not move the sheet viewport above the nav.

## Proven Failed Fix Pattern

### Attempt family 1: content padding

Fixes added/changed `contentContainerStyle.paddingBottom`. This failed because gorhom scrollables do not reliably count container padding as scrollable child height for the terminal scroll extent. The last row can still stop behind the nav.

### Attempt family 2: real spacer child

REWORK-6 appended a real `<View height={bottomPad}/>` after the scroll children. This improved the correct layer for scroll extent, but only inside the scroll host. It did not change where the sheet group lives relative to `GlassBottomNav`.

### Attempt family 3: gorhom `bottomInset`

RETEST found `bottomSheetInset` reached `<BottomSheet bottomInset={...}>`, but the visible inline sheet still failed. Local gorhom source explains why relying on this is unsafe:

- `useAnimatedLayout.ts` subtracts `topInset + bottomInset` from container height only when `modal` is true.
- `useAnimatedDetents.ts` applies `bottomInset` to the closed detent only when `$modal || detached`.
- `BottomSheetHostingContainer.tsx` applies `bottom: bottomInset`, but this is an internal host style, not a complete guarantee that every sibling sheet group/scroll/footer will become visually and gesture-clear of an external app nav.

Even if the internal container shifts, it does not solve the larger ownership issue: the app-level nav is still a later sibling, not something the sheet group owns.

### Attempt family 4: window-bounded inline host

REWORK-10 bounded the inline host to `windowHeight + bottomSheetInset`. Seth's real-device screenshots after this still show the same outcome. That means the attempted host measurement correction did not restore the user-visible contract.

The likely reasons are:

- The main trip detail sheet never receives `bottomSheetInset`, only its reserve sheet does.
- The reserve/event sheet is a multi-root group (`ExpandedBusinessEventSheet` + `TicketCartSheet` sibling). Wrapping or shifting only one `BaseBottomSheet` root is not the same as presenting the whole group above the nav.
- The floating nav remains a later sibling with higher z-order.
- The regression tests check source wiring, not actual pixel/touch geometry.

## Root Cause Findings

### F1 — Confirmed Architecture Bug: the sheet group and bottom nav do not share one geometry owner

**File/line evidence**

- `app-mobile/app/index.tsx:2694-2703`: `bottomNavigation` is absolute and `zIndex:50`.
- `app-mobile/app/index.tsx:2508-2512`: nav renders after content.
- `app-mobile/src/components/ui/BaseBottomSheet.tsx:619-669`: `wrapInRNModal` wraps only one `BaseBottomSheet`; non-wrapped sheets render inline.
- `app-mobile/src/components/ExpandedCardModal.tsx:1711-1725`: business-event path returns `ExpandedBusinessEventSheet` directly.
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx:515-557`: trip detail and reserve sheet are sibling sheet roots in the same fragment.

**Current behavior**

The sheet group is inline under the screen tree while the nav renders later above it. Inner scroll spacers can change what is scrollable, but they cannot make the later nav stop overlaying the sheet.

**Expected behavior**

Either:

1. the full sheet group is presented above the nav in a single carrier, or
2. the visible nav remains on top but the full sheet group is measured/clipped against the nav top with a single runtime geometry contract.

**Causal chain**

ORCH-0828 switched business-event details to inline gorhom to make them visible -> META-ORCH-0991 standardized inline sheets and kept RN Modal wrapping as opt-in -> finishing pass assumed EBES was always inside a wrapped parent -> ORCH-1016 mounted EBES directly for trip Reserve and kept business-event early return direct -> nav overlays the bottom of trip/event sheets -> padding/spacer fixes cannot solve the sibling z-order/geometry conflict.

**Verification step**

Run a live geometry probe that measures `GlassBottomNav` top and the bottom of the last ticket CTA via `measureInWindow()` on both paths. PASS requires `lastCtaBottom <= navTop - 8` at max scroll, not just a source assertion.

### F2 — Confirmed Historical Miss: META-ORCH-0991 excluded EBES from tab-bar handling based on a false mount assumption

The finishing report explicitly says EBES/TicketCart are not tab-bar candidates because they mount inside a wrapped parent. That is false for the failing paths:

- business-event details return EBES directly from `ExpandedCardModal`;
- trip Reserve renders EBES directly from `ConsumerTripDetailScreen`;
- TicketCartSheet is a sibling root to EBES and needs the same group-level carrier when opened.

This explains why the regression persisted through multiple "local" fixes: the bug was classified as a content-padding gap when it was actually a presentation ownership gap.

### F3 — Confirmed Test Gap: the regression tests prove source wiring, not visible geometry

All recent focused tests passed while Seth and QA still saw the same blocked UI. The tests assert things like:

- `bottomSheetInset` prop exists and is threaded;
- spacer view exists;
- source imports the nav constants;
- old `absoluteFill` wrapper is gone.

They do not assert:

- actual nav top in pixels;
- actual last CTA bottom in pixels;
- scroll offset reaches a state where CTA clears;
- touch target is not under the nav.

The test suite created false confidence.

## Why It Feels Like "This Was Not Like This Before"

Seth's memory is consistent with the code history.

The sheets that felt right were the wrapped expanded-card path: the sheet rode above the custom nav because ORCH-0908 put it inside an RN Modal carrier. The business-event/trip paths now use inline sheet roots that do not inherit that carrier.

ORCH-1016 did not invent the underlying fragility, but it exposed it in a new high-frequency flow:

- trips added a main detail sheet;
- trips added a sticky Reserve footer;
- trips reused EBES for Reserve;
- the bottom nav remained visible and higher in z-order.

So the same architecture mistake became visible as "the bottom of the page never clears the menu."

## Recommended Fix Contract

### Recommendation A — robust, fastest path: present the affected sheet groups above the nav

Create a group-level overlay carrier, not just a per-sheet prop. The carrier should wrap the whole related sheet stack:

- consumer business-event detail: EBES + TicketCartSheet sibling;
- trip detail: main trip detail sheet + reserve EBES + any ticket cart sibling;
- any future nested ticket sheet opened from those.

Mechanism:

1. Add a `SheetOverlayCarrier` or equivalent RN Modal wrapper at the feature group boundary.
2. Put all sibling `BaseBottomSheet` roots for that flow inside the same carrier.
3. Inside the carrier, use normal inline `BaseBottomSheet` geometry and OS safe-area clearance only.
4. Do not rely on `GlassBottomNav` content padding for these modalized flows; the nav is behind the modal carrier.
5. Keep `BottomSheetScrollView` real spacer only where it is needed to allow final content breathing room above the sheet bottom/sticky footer.

Why this is recommended:

- It matches the proven ORCH-0908 solution.
- It fixes the whole group, including sibling sub-sheets.
- It stops fighting the app-level nav z-order.
- It is easier to verify visually.

Acceptance:

- At max scroll, `Tickets` and `Buy ticket`/`Reserve` CTA are visible and tappable without nav overlap.
- The floating nav is not visually overlaying the sheet content while the group is open.

### Recommendation B — if product requires the nav to remain visible

Build a measured top-level sheet host that explicitly owns the nav geometry:

1. Measure `GlassBottomNav` with `onLayout` + `measureInWindow()`.
2. Publish `navTop`, `navBottom`, `capsuleHeight`, and platform offsets through a layout context.
3. Host the sheet group in a top-level sibling below/above the nav with an explicit bottom boundary of `navTop - clearanceGap`.
4. Make the sheet background/body/footer end before that boundary.
5. Measure the final CTA and assert `ctaBottom <= navTop - 8`.

This is more work and more fragile than Recommendation A, but it preserves a visible nav.

### Do not continue with these approaches

- Do not add more fixed padding numbers.
- Do not add another spacer-only rework.
- Do not rely on gorhom `bottomInset` alone for inline visible-nav sheets.
- Do not wrap only one `BaseBottomSheet` root when the flow contains sibling sheet roots.
- Do not accept source-regex tests as the release gate.

## Required Regression Gate

Add a runtime geometry gate, not just source assertions.

Minimum acceptable test strategy:

1. Add temporary dev-only testIDs or probe refs for:
   - `GlassBottomNav` capsule,
   - trip main detail bottom CTA/footer,
   - trip reserve final ticket CTA,
   - event detail final ticket CTA.
2. In the app, log or expose `measureInWindow()` values after scroll settles.
3. The test must assert:
   - `lastTicketCtaBottom <= navTop - 8` when nav remains visible, or
   - nav is visually behind/hidden by the modal carrier when the sheet group is open.
4. Capture screenshots for both:
   - Discover -> Trips -> The Sone -> Reserve -> bottom,
   - Discover -> Events -> Vibes and Stuff -> bottom.

Source tests can remain, but they are not sufficient.

## Implementation Handoff Summary

The next implementor should stop editing padding and build a presentation fix. The work should decide one of two explicit product contracts:

1. **Recommended:** affected detail/reserve flows open in a group-level RN Modal carrier above the bottom nav, matching the proven wrapped expanded-card behavior.
2. **Alternative:** nav remains visible, but a top-level measured host owns the nav top and constrains the entire sheet group above it.

The implementation must cover both trip and event paths, and the verification must be screenshot/geometry based.

## Final Confidence

High confidence on the historical regression chain and why the last fixes failed. Medium confidence on the exact smallest code change because the current implementation has several uncommitted rework layers and Seth's latest proof is real-device visual, not a fresh instrumented measurement. The next step should be implementation from the group-level presentation contract above, followed by runtime geometry proof.

