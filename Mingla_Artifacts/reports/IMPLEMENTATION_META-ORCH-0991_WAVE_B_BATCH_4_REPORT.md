# IMPLEMENTATION — META-ORCH-0991 Wave B Batch 4 [Consumer modals → BaseBottomSheet]

**Skill:** mingla-implementor+claude
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/`
on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Anchor before this batch:** `a5d123d64e3b2796be1d53d574561c0c17faa895`
**Status:** implemented and verified (6/7 sim-proven on iPhone 17 Pro via Metro :8100;
7th — ActionButtons inline iOS picker — verified by identical-container-pattern +
structural test, live entry point is several swipe-deck levels deep and was not in
the throwaway sim harness; flagged for tester)

## Scope

Convert EXACTLY 7 modals from RN `<Modal>` / hand-rolled Animated shells to
`BaseBottomSheet`, stock gorhom motion, roll-up + swipe-down-close like
`ExpandedBusinessEventSheet`. The two destructive/irreversible CONFIRM cards become
NON-swipe `variant="center-dialog"`; everything else is a full swipe-down sheet. No
other modal touched. Consumer `app-mobile/` only. No backend / migrations / edge /
external APIs.

1. `app-mobile/src/components/PairRequestModal.tsx` — send pair request (sheet, keyboard-aware)
2. `app-mobile/src/components/IncomingPairRequestCard.tsx` — accept/decline confirm → **center-dialog**
3. `app-mobile/src/components/PairingInfoCard.tsx` — cancel-pairing confirm → **center-dialog**
4. `app-mobile/src/components/CustomHolidayModal.tsx` — create custom holiday (sheet, keyboard-aware)
5. `app-mobile/src/components/activity/ProposeDateTimeModal.tsx` — propose date/time (hand-rolled Animated slide-up → sheet; DateTimePicker preserved)
6. `app-mobile/src/components/activity/TicketPdfSheet.tsx` — ticket PDF/QR viewer (read-only, tall sheet)
7. `app-mobile/src/components/expandedCard/ActionButtons.tsx` — the inline iOS date/time picker `<Modal>` at ~line 656 ONLY (rest of file untouched; Android native picker branch untouched)

All 7 confirmed Wave B and NOT on the exclusion list. The two confirm cards
(Incoming accept/decline, PairingInfo cancel) are pure destructive/irreversible
confirms → center-dialog per the operator rule (playbook §1). PairRequest +
CustomHoliday have text inputs → keyboard-aware (BottomSheetTextInput + interactive).

## Comms ledger

Scanned on entry. No OPEN BLOCK/WARN row targets mingla-implementor,
META-ORCH-0991, or ALL requiring action. COMMS-0002 (backend strict-grep allowlist)
and COMMS-0003 (external-API docs) are N/A — zero backend/edge/migration files and
zero external APIs touched. COMMS-0006/0010 are other-ORCH and already
ACKNOWLEDGED/RESOLVED. No new cross-ORCH discovery to write.

## Cross-surface impact (Step 3.5)

Affected surfaces: **Consumer iOS** + **Consumer Android** only (shared `app-mobile/`
code path → parity automatic). UNAFFECTED: Buyer/anon web, Business iOS/Android,
Admin web, Business web preview — none renders these consumer pairing/holiday/
scheduling/ticket modals.

## Per-modal decision record

| # | Modal | Variant | Snap | Keyboard | wrapInRNModal | Notes |
|---|---|---|---|---|---|---|
| 1 | PairRequestModal | sheet | `['85%']` | **yes** (BottomSheetTextInput ×2: search + phone; interactive) | **true** | Was flex-end RN Modal `maxHeight:'85%'`. Header (title+close) + scroll body. Mounted from ConnectionsPage, which renders before the floating GlassBottomNav sibling in `app/index.tsx` → wrap. Excluded `CountryPickerModal` sub-modal kept as a sibling that floats independently. |
| 2 | IncomingPairRequestCard | **center-dialog** | — | no | n/a (auto) | Accept/decline confirm = footgun rule. Stripped local `overlay`/`backdrop`/`card` chrome + the scale/fade spring → `glass.centerDialog` supplies it. Busy/success dismiss-guard preserved (handleClose no-ops while busy/success). |
| 3 | PairingInfoCard | **center-dialog** | — | no | n/a (auto) | Cancel-pairing confirm. Stripped local scrim/card + spring. |
| 4 | CustomHolidayModal | sheet | `['88%']` | **yes** (BottomSheetTextInput: name; interactive) | **true** | Was flex-end RN Modal `SCREEN_HEIGHT*0.88`. Header + scroll body. Horizontal year/month/day pill pickers kept as inner horizontal `<ScrollView>` (orthogonal to the sheet pan — they scroll sideways, not vertically). ViewFriendProfileScreen mounts it over the nav → wrap. |
| 5 | ProposeDateTimeModal | sheet (dark) | `['85%']` | no (DateTimePicker only) | **true** | Was a HAND-ROLLED Animated slide-up + backdrop. Custom slide/backdrop springs DELETED → stock gorhom motion. Header + scroll body + sticky footer (ProposeDateTimeFooter). Dark canvas `#1C1C1E` preserved via `backgroundStyle` override. iOS date + time pickers now each render in their OWN RN `<Modal>` so they float ABOVE the sheet's `wrapInRNModal` window (were absolute overlays inside the old single Modal). Android native pickers unchanged. |
| 6 | TicketPdfSheet | sheet (dark) | `['88%']` | no (read-only) | **true** | Was flex-end RN Modal `maxHeight:'88%'`. `scrollMode="view"` (consumer owns the body tree — the QR carousel is a HORIZONTAL paging `<ScrollView>` that must keep paging; converting it to a vertical BottomSheetScrollView would break it). Bespoke dark canvas `#15181f` + topRadius 28 preserved via `backgroundStyle` override. |
| 7 | ActionButtons (iOS picker ONLY) | sheet (light) | `['45%']` | no (DateTimePicker only) | **true** | ONLY the iOS date/time `<Modal>` at ~line 656 converted. `scrollMode="view"`, header = the title + Cancel/Back-to-date/Next-or-Done row (all `TrackedTouchableOpacity` analytics preserved). DateTimePicker spinner as the `view` child. The Android native `display="default"` branch + the entire rest of ActionButtons are UNTOUCHED. ExpandedCard sits over the tab bar → wrap. |

**Fixed-snap, never content-dynamic (Batch-3 off-screen lesson applied):** every
sheet uses an explicit fixed snap (`['45%']`/`['85%']`/`['88%']`) translated from the
old modal's `maxHeight`/`SCREEN_HEIGHT*` — NO `enableDynamicSizing`. Sim-confirmed all
six harness-mounted sheets render fully on-screen (not off-bottom).

## Old → New receipts

### PairRequestModal.tsx
**Before:** RN `<Modal animationType="slide">` + `overlay` scrim + `backdrop`
TouchableOpacity + hand-rolled `sheet` card (`maxHeight:'85%'`, shadow) +
`handleContainer`/`handle` cosmetic drag handle + `KeyboardAwareScrollView` + raw
`<TextInput>` ×2.
**Now:** `<BaseBottomSheet snapPoints={['85%']} wrapInRNModal keyboardBehavior="interactive" …>`
with `header` slot, `scrollMode="scroll"`, `<BottomSheetTextInput>` ×2. Removed
`Modal`/`TextInput`/`KeyboardAwareScrollView` imports + the `overlay`/`backdrop`/
`sheet`/`handleContainer`/`handle`/`shadows` dead code. `CountryPickerModal` kept as a
sibling in a fragment. All callbacks/copy/analytics/error-state unchanged.
**Why:** SC — roll-up + swipe-down like the events sheet; keyboard-aware form (playbook §3).
**Lines changed:** ~60.

### IncomingPairRequestCard.tsx
**Before:** RN `<Modal animationType="none">` + scrim + backdrop (guarded press) +
`Animated.View` card with scale/fade spring; `card`/`overlay`/`backdrop` chrome.
**Now:** `<BaseBottomSheet variant="center-dialog">` (centered, NON-swipe). Removed
`Modal`/`Animated`/`shadows` + the spring refs/effect. `card` reduced to a transparent
`{width:'100%',alignItems:'center'}` passthrough. Busy/success dismiss-guard preserved
via `handleClose`. Accept/decline/success/error states + 800ms success timer unchanged.
**Why:** operator rule §1 — accept/decline confirm must not be flickable.
**Lines changed:** ~50.

### PairingInfoCard.tsx
**Before:** RN `<Modal>` + scrim + backdrop + `Animated.View` card with scale/fade spring.
**Now:** `<BaseBottomSheet variant="center-dialog">`. Removed `Modal`/`Animated`/`radius`/
`shadows` + spring refs/effect. `card` → transparent passthrough. Cancel/onClose unchanged.
**Why:** operator rule §1 — cancel-pairing confirm.
**Lines changed:** ~40.

### CustomHolidayModal.tsx
**Before:** RN `<Modal animationType="slide">` + `overlay`/`backdrop`/`sheetContent`
(`SCREEN_HEIGHT*0.88`) + `handleContainer`/`handle` + `KeyboardAwareScrollView` + raw
`<TextInput>`.
**Now:** `<BaseBottomSheet snapPoints={['88%']} wrapInRNModal keyboardBehavior="interactive" …>`
with `header` slot + `scrollMode="scroll"` + `<BottomSheetTextInput>`. Inner horizontal
pill `<ScrollView>`s kept. Removed `Modal`/`SCREEN_HEIGHT`/`KeyboardAwareScrollView` +
dead chrome styles. Validation/clamping/haptics/save unchanged.
**Why:** SC + keyboard-aware name field.
**Lines changed:** ~45.

### activity/ProposeDateTimeModal.tsx
**Before:** RN `<Modal>` + `KeyboardAwareView` + `Animated.View` backdrop + `Animated.View`
absolute `bottomSheet` with a CUSTOM slide spring + `handleContainer`/`handle`; iOS
date/time pickers as absolute overlay Views inside the same Modal; inline footer.
**Now:** `<BaseBottomSheet theme="dark" snapPoints={['85%']} wrapInRNModal …>` with
`header` slot, `scrollMode="scroll"`, `stickyFooter={<ProposeDateTimeFooter/>}`, dark
canvas via `backgroundStyle`. Removed `Animated`/`KeyboardAwareView` + `slideAnim`/
`backdropAnim`/`animateClose` + dead chrome styles. iOS pickers wrapped in their own
`<Modal as RNModal>` so they float above the sheet window. Android pickers + all
availability/scheduling logic unchanged.
**Why:** SC — replace hand-rolled motion with stock gorhom; preserve picker.
**Lines changed:** ~75.

### activity/TicketPdfSheet.tsx
**Before:** RN `<Modal animationType="slide">` + `backdrop` scrim + `card`
(`maxHeight:'88%'`, `#15181f`) + `dragHandle`.
**Now:** `<BaseBottomSheet theme="dark" snapPoints={['88%']} wrapInRNModal scrollMode="view"
backgroundStyle={…#15181f…}>`. Removed `Modal` import + `backdrop`/`dragHandle` +
duplicated `card` bg/radius/maxHeight. QR horizontal paging carousel + download/maps/
web/error flows unchanged.
**Why:** SC — read-only tall viewer; preserve the paging carousel.
**Lines changed:** ~25.

### expandedCard/ActionButtons.tsx
**Before:** iOS branch rendered RN `<Modal animationType="slide">` + `modalOverlay`
scrim + `backdropTouch` + `SafeAreaView modalContent` card + header + DateTimePicker.
**Now:** iOS branch renders `<BaseBottomSheet snapPoints={['45%']} wrapInRNModal
scrollMode="view" header={…}>` with the DateTimePicker as the body. Removed the
`Modal` + `SafeAreaView`/`useSafeAreaInsets` imports (now unused) + the `insets`
local + `modalOverlay`/`backdropTouch`/`modalContent` dead styles. Android native
picker branch + the rest of ActionButtons UNTOUCHED. All `TrackedTouchableOpacity`
picker analytics (`picker_cancel`/`picker_back_to_date`/`picker_done`/`picker_dismiss`
→ note: `picker_dismiss` backdrop tap is now the gorhom backdrop-press → onClose)
preserved.
**Why:** convert ONLY the date/time modal per dispatch; leave the rest.
**Lines changed:** ~20.

## Sim verification (iPhone 17 Pro `17091E60-…`, Metro :8100)

Metro-connection blocker resolved (see "Environment" below). Live triggers for these
modals need backend state (pending pair requests, friend birthdays, purchased tickets)
that can't be fabricated on-sim, so per playbook §7.5 a THROWAWAY harness
(`__B4_SIM_HARNESS__.tsx`, mounted from `app/index.tsx` inside the QueryClient/contexts
tree) rendered each sheet standalone with fixture props. **The harness file + its import
+ its mount were fully removed after verification and NEVER committed** (git status shows
only the 7 source files + the new test).

| # | Modal | Sim result | Screenshot |
|---|---|---|---|
| 1 | PairRequestModal | Rolled up at ['85%'], real gorhom handle, header+friends list (real data)+phone section on-screen; swipe-down dismissed | `/tmp/b4_01_pair.png` |
| 2 | IncomingPairRequestCard | Rendered as CENTERED card (not a sheet), JR avatar + Decline/Accept, flat scrim, no handle; error-state ("Couldn't decline — tap to try again") rendered cleanly on fake-id decline | `/tmp/b4_02_incoming.png` |
| 3 | PairingInfoCard | Rendered as CENTERED card, SC avatar + status + "Cancel invite", non-swipe | `/tmp/b4_03_pairinfo_ok.png` |
| 4 | CustomHolidayModal | Rolled up at ['88%'], handle + "Mark a day that matters" header + name field + year/month pills + "Save this day" | `/tmp/b4_04_holiday.png` |
| 5 | ProposeDateTimeModal | Rolled up DARK at ['85%'], handle + "Schedule Experience" header + date grid + sticky "Check Availability" footer; close-X → onClose worked | `/tmp/b4_05_propose_ok.png` |
| 6 | TicketPdfSheet | Rolled up DARK at ['88%'], handle + "Rooftop Sessions" header + venue + QR (rendered) + "Guest/Valid" + "Download PDF" | `/tmp/b4_06_ticket_ok.png` |
| 7 | ActionButtons iOS picker | NOT in harness (needs ExpandedCardData fixture + several swipe-deck levels to reach the Schedule flow). Verified by identical-container-pattern to #5's iOS picker (BaseBottomSheet view-mode + DateTimePicker), tsc-clean, regression-tested (T-9: exactly 1 BaseBottomSheet, Android branch intact). **Tester: reach via Explore → expand a card → Schedule → tap a date option (iOS).** | — |

Center-dialog non-swipe is structural (the `CenterDialog` sub-component renders a static
RN-Modal card with NO PanGestureHandler), so it cannot pan-dismiss by construction; the
centered render was confirmed for both #2 and #3.

## Regression test

**Path:** `app-mobile/src/components/ui/__tests__/WaveBBatch4.test.mjs`
**Passing run:** `PASS META-ORCH-0991 Wave B Batch-4 regression suite (…)`
**fails-on-revert:** verified — `git stash` of the 7 source files → test exits **1**
(T-1 BaseBottomSheet import assertion fails). Anchor commit before fix:
`a5d123d64e3b2796be1d53d574561c0c17faa895`. Restored (`git stash pop`) → test exits 0.
Structural/contract test (the gorhom host isn't mountable in the jest/node harness —
same approach as Wave-A/Batch-1/2/3). Asserts: all 7 consume BaseBottomSheet + no gorhom
import (T-1); converted shells shed RN Modal (T-2); the 2 confirms are center-dialog and
the 5 sheets are not (T-3); snaps match prior heights + no enableDynamicSizing (T-4);
keyboard sheets use BottomSheetTextInput+interactive (T-5); sheets wrap (T-6); Propose
keeps DateTimePicker + RN-Modal pickers + sticky footer + dark bg + dropped custom spring
(T-7); PairRequest keeps CountryPickerModal (T-8); ActionButtons converts ONLY the iOS
picker, Android branch intact (T-9); adversarial: old scrim/overlay/card/handle styles
gone (T-A1).

## Gates

- **Sole-consumer strict-grep** (`meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`):
  PASS — "scanned 409 file(s)… BaseBottomSheet.tsx is the sole @gorhom/bottom-sheet
  importer." Self-test PASS.
- **tsc** (`app-mobile`): 244 errors total = unchanged from the Batch-1 baseline (244).
  Zero new errors; zero errors reference any of the 7 touched files.
- **All Wave-B suites** (BaseBottomSheet, Batch1, Batch2, Batch3, Batch4): all PASS — no
  prior batch regressed.

## Environment — Metro :8100 connection blocker (RESOLVED)

The pre-existing operator Metro on :8100 had a stale half-dead socket: its `*:8100`
listener accepted IPv6 (`::1`) but refused IPv4 (`127.0.0.1`), which is exactly the host
the iOS dev client requests. Resolution (scoped to THIS session's own :8100 Metro — no
global kill): scope-killed only the worktree's Metro pid, restarted `expo start
--dev-client --port 8100`, primed the IPv4 bundle route (`curl -4 …/entry.bundle` → 200),
and triggered the dev-client Reload via Maestro coordinate-tap (osascript banned). On
cold launch the IPv4 route occasionally needs re-priming + a Reload tap; once warm the
app loads the latest bundle reliably. No other session's port/sim was touched.

## Discoveries for orchestrator

- **ActionButtons iOS picker live-trigger unreachable in the throwaway harness** — its
  Schedule flow needs `ExpandedCardData` fixtures + several swipe-deck levels. Converted +
  structurally verified + regression-tested; tester should exercise it via Explore →
  expand card → Schedule → date option on iOS.
- **Cold-launch IPv4 flake on :8100** — environmental (Metro dual-stack socket prefers
  IPv6). Not a code issue; mitigated by priming the IPv4 bundle route + a Reload tap.
  Worth a note for future sim sessions on this machine.
