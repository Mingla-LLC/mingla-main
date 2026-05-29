# IMPLEMENTATION — META-ORCH-0991 Wave B Batch 5 [Consumer modals → BaseBottomSheet]

**Skill:** mingla-implementor+claude
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/`
on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Anchor before this batch:** `707e0ec817f65cb92b8387fe22619c24e0deab56`
**Status:** implemented and verified (5/7 sim-proven on iPhone 17 Pro via Metro :8100;
LockedCard summary center-dialog verified by construction + Batch-4 precedent;
DiscoverScreen filter + MessageInterface 1:1 more-options converted + structurally
tested + tsc-clean, live triggers flagged for tester)

## Scope

Convert EXACTLY 7 modals from RN `<Modal>` (and one hand-rolled Animated context
menu) to `BaseBottomSheet`, stock gorhom motion, roll-up + swipe-down-close like
`ExpandedBusinessEventSheet`. ONE is an irreversible commit confirm → NON-swipe
`variant="center-dialog"`; everything else is a full swipe-down sheet. Three live
inside large screen files — ONLY the named modal in each is converted. Consumer
`app-mobile/` only. No backend / migrations / edge / external APIs.

1. `app-mobile/src/components/DismissedCardsSheet.tsx` — left-swiped cards list (sheet)
2. `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` — schedule a locked card; only the summary-step `<Modal>` (center-dialog)
3. `app-mobile/src/components/chat/MessageContextMenu.tsx` — long-press message actions → compact anchored action-menu sheet
4. `app-mobile/src/components/board/BoardSettingsDropdown.tsx` — board settings menu (rename input → keyboard-aware)
5. `app-mobile/src/components/DiscoverScreen.tsx` — ONLY the filter `<Modal>` (~line 1815)
6. `app-mobile/src/components/MessageInterface.tsx` — ONLY the 1:1 more-options `<Modal>` (~line 2336)
7. `app-mobile/src/components/PersonHolidayView.tsx` — ONLY the saves-list `<Modal>` (~line 1053)

Supporting (mechanical, in scope): `app-mobile/src/components/ui/BaseBottomSheet.tsx`
gains a one-line `BottomSheetFlatList` re-export (playbook §0 — consumers may not import
gorhom directly); `app-mobile/src/components/PairedSavesListScreen.tsx` gains an opt-in
`inBottomSheet` prop so its vertical 2-col grid uses `BottomSheetFlatList` when rendered
inside #7's sheet (a raw RN `<FlatList>` would fight the sheet pan). The visits-list
consumer of `PairedSavesListScreen` is unchanged (`inBottomSheet` defaults false).

All 7 confirmed Wave B and NOT on the exclusion list. The 3 big-screen files keep all
their EXCLUDED modals untouched (DiscoverScreen had exactly one modal; MessageInterface
keeps image-preview + file-spinner + the Wave-C event-audience modal; PersonHolidayView
keeps the visits-list pageSheet modal).

## Comms ledger

Scanned on entry. No OPEN BLOCK/WARN row targets mingla-implementor, META-ORCH-0991, or
ALL requiring action for this UI-only conversion. COMMS-0002 (backend strict-grep
allowlist) and COMMS-0003 (external-API docs) are N/A — zero backend/edge/migration files
and zero external APIs touched. COMMS-0006/0008/0009/0010 are other-ORCH and already
ACKNOWLEDGED/RESOLVED. No new cross-ORCH discovery to write.

## Cross-surface impact (Step 3.5)

Affected surfaces: **Consumer iOS** + **Consumer Android** only (shared `app-mobile/`
code path → parity automatic). UNAFFECTED: Buyer/anon web, Business iOS/Android, Admin web,
Business web preview — none renders these consumer deck/chat/board/holiday surfaces.

## Per-modal decision record

| # | Modal | Variant | Snap | Keyboard | wrapInRNModal | Notes |
|---|---|---|---|---|---|---|
| 1 | DismissedCardsSheet | sheet (light) | `['80%']` | no | **true** | Was RN Modal `maxHeight: screenHeight*0.8`. Header (count + close X) + scroll list body. Mounted from SwipeableCards/AppHandlers over the deck tab bar → wrap. |
| 2 | LockedCardSchedulingSheet (summary step) | **center-dialog** | — | no | n/a (auto) | The `step==="pick"` branch already delegates to the Batch-4 ProposeDateTimeModal (untouched). The `step==="summary"` `<Modal>` was a centered confirm card ("once you confirm … a new round of swiping starts") → irreversible commit confirm → center-dialog (non-swipe). Stripped local `overlay`/`sheet` chrome → transparent `dialogBody` passthrough; glass.centerDialog supplies scrim/card. `resetAndClose` wired to `onClose` (backdrop/back close = the old Cancel). |
| 3 | MessageContextMenu | sheet (light), **compact** | `['28%']` | no | **true** | "Context-menu feel" per dispatch: a SHORT bottom action sheet, not a tall pan-down sheet. Emoji reaction row + small action-icon row preserved. Dropped the hand-rolled Animated scale/fade spring + the `position`-anchored absolute placement → stock gorhom roll-up. `position` prop retained on the interface for caller compatibility (BoardDiscussionTab + MessageInterface pass it) but no longer drives placement (`void position`). Open haptic preserved. Mounted in chat over the input → wrap. |
| 4 | BoardSettingsDropdown | sheet (light) | `['80%']` | **yes** (rename input) | **true** | Was RN Modal `maxHeight:"80%"`. Header slot (editable name `BottomSheetTextInput` + pencil + orange underline + mute bell) + scroll body (invite section + members) + sticky footer (Leave/Delete, was already outside the ScrollView). `TextInput`→`BottomSheetTextInput`; ref widened to `React.ElementRef<typeof BottomSheetTextInput>`. Mounted in chat (MessageInterface group-chat header) over the input → wrap. |
| 5 | DiscoverScreen filter (line 1815 ONLY) | sheet (dark) | `['85%']` | no | **true** | Was RN Modal flex-end card `maxHeight:"85%"`, dark `rgba(22,24,28,1)` canvas + topRadius 24. Bespoke dark canvas/radius preserved via `backgroundStyle`. Header (title + close X) + scroll body (date/category/genre sections) + sticky footer (Reset/Apply). DiscoverScreen is a tab screen; GlassBottomNav is a later sibling → unwrapped would render under the nav → wrap. The single filter Modal was the only `<Modal>` in the file (now 0 raw modals). |
| 6 | MessageInterface 1:1 more-options (line 2336 ONLY) | sheet (light) | `['45%']` | no | **true** | Was RN Modal flex-end card. Action-menu list (View Profile / Add to Session / Share Saved Card / Remove / Block / Report). Header (contact name) + view-mode action items. Destructive items route to their OWN downstream confirms, so the menu itself is a non-destructive picker → sheet. Mounted in chat over the input → wrap. The file's OTHER modals (image preview line 1791, file-processing spinner line 1734, event-audience line 2171 = Wave C) are UNTOUCHED; the event-audience modal's `chatSheetHandle` style was retained for it. |
| 7 | PersonHolidayView saves-list (line 1053 ONLY) | sheet (light) | `['90%']` | no | **true** | Was a full-screen `presentationStyle="pageSheet"` RN Modal wrapping `PairedSavesListScreen`. `scrollMode="view"` (the screen owns its body tree). Its 2-col vertical grid now renders via `BottomSheetFlatList` (the new `inBottomSheet` opt-in) so it scrolls inside the sheet instead of fighting the pan. Mounted from ViewFriendProfileScreen over the floating tab bar → wrap. The visits-list pageSheet Modal (line 1085) is UNTOUCHED per dispatch. |

**Fixed-snap, never content-dynamic (Batch-3 off-screen lesson):** every sheet uses an
explicit fixed snap translated from the old modal's `maxHeight`/`SCREEN_HEIGHT*` — NO
`enableDynamicSizing`.

## Old → New receipts

### components/ui/BaseBottomSheet.tsx
**Before:** re-exported `BottomSheetTextInput` (Batch 1) + `BottomSheetScrollView` (Batch 3).
**Now:** also re-exports `BottomSheetFlatList` so #7's `PairedSavesListScreen` can use a
gorhom-aware vertical list without importing gorhom (sole-consumer gate).
**Why:** vertical FlatList inside a sheet must coordinate with the pan gesture.
**Lines changed:** ~7.

### components/DismissedCardsSheet.tsx
**Before:** RN `<Modal animationType="slide">` + `overlay` + `backdrop` TouchableOpacity +
`sheet` card (`maxHeight: screenHeight*0.8`) + `handleBar` + raw `<ScrollView>`.
**Now:** `<BaseBottomSheet snapPoints={['80%']} wrapInRNModal scrollProps={{style:list…}}
header={…}>` with the card list as scroll-body children. Removed `Modal`/`ScrollView`/
`Dimensions` imports + `screenHeight` + the `overlay`/`backdrop`/`sheet`/`handleBar` dead
styles. All copy (i18n), save/cardPress callbacks, the ORCH-0902 "Also passed by your
group" section, empty state, badges unchanged.
**Why:** SC — roll-up + swipe-down list like the events sheet.
**Lines changed:** ~45.

### components/session/LockedCardSchedulingSheet.tsx
**Before:** summary step rendered RN `<Modal animationType="fade">` + `overlay`
(`justifyContent:center`) + `sheet` card. (Pick step delegates to ProposeDateTimeModal.)
**Now:** `<BaseBottomSheet variant="center-dialog" onClose={resetAndClose}>` with a
transparent `dialogBody` passthrough. Removed `Modal` import + `overlay`/`sheet` styles.
The whole confirm body (title/subtitle/3 summary rows/Confirm/Pick-different-time/Cancel),
the atomic lock+schedule RPC, push notify, cache invalidations, haptics, and the
busy/disable guards are unchanged.
**Why:** operator rule §1 — an irreversible commit confirm must not be flickable.
**Lines changed:** ~25.

### components/chat/MessageContextMenu.tsx
**Before:** RN `<Modal animationType="none">` + `backdrop` TouchableOpacity +
`Animated.View` menu with scale/fade spring, absolute `top: clampedTop` placement keyed
on `position`, `menuHeight`/`showAbove`/`clampedTop` math.
**Now:** `<BaseBottomSheet snapPoints={['28%']} wrapInRNModal scrollMode="view">` with the
emoji row + action-icon row in a padded `menu` container. Removed `Modal`/`Animated`/
`Dimensions` imports + `useRef`, the spring `useEffect`/`dismiss`, the placement math, the
`backdrop` style + the absolute/shadow on `menu`. Open haptic + all reaction/reply/copy/
edit/delete callbacks unchanged. `position` retained on props (`void position`).
**Why:** dispatch — anchored compact action-menu feel, stock gorhom motion.
**Lines changed:** ~50.

### components/board/BoardSettingsDropdown.tsx
**Before:** `<>{visible && <Modal animationType="slide">}` + `sheetOverlay` + `sheetBackdrop`
Pressable + `sheetContainer` (`maxHeight:"80%"`) + `sheetHandleRow`/`sheetHandle` + raw
`<ScrollView>` body + a manually-placed footer View; raw `<TextInput ref={nameInputRef}>`.
**Now:** `<BaseBottomSheet snapPoints={['80%']} wrapInRNModal keyboardBehavior="interactive"
header={name+bell} scrollProps={…} stickyFooter={Leave/Delete}>`. `TextInput`→
`BottomSheetTextInput`; ref type widened. Removed `Modal`/`ScrollView`/`Pressable`/
`TextInput` imports + the `sheetOverlay`/`sheetBackdrop`/`sheetContainer`/`sheetHandleRow`/
`sheetHandle` dead styles. All invite/lookup/mute/member-management/admin/revoke logic,
copy, haptics, Alerts unchanged.
**Why:** SC + keyboard-aware rename field.
**Lines changed:** ~60.

### components/DiscoverScreen.tsx
**Before:** the filter RN `<Modal animationType="slide">` + `filterModalOverlay` +
`backdropTouch` + `filterModalContent` (dark `rgba(22,24,28,1)`, radius 24, `maxHeight:"85%"`)
+ header + raw `<ScrollView>` + footer.
**Now:** `<BaseBottomSheet snapPoints={['85%']} wrapInRNModal theme="dark"
backgroundStyle={{dark canvas + radius 24}} header={…} scrollProps={…}
stickyFooter={Reset/Apply}>`. Removed `Modal` from the RN import + the
`filterModalOverlay`/`backdropTouch`/`filterModalContent` dead styles. All filter
sections, options, selection logic, reset/apply handlers, copy unchanged. ONLY this modal
touched; the rest of DiscoverScreen untouched.
**Why:** SC — roll-up dark filter sheet.
**Lines changed:** ~55.

### components/MessageInterface.tsx
**Before:** the 1:1 more-options RN `<Modal animationType="slide">` (line 2336) +
`chatSheetOverlay` TouchableOpacity + `chatSheetContainer` card + `chatSheetHandle` + title
+ action items.
**Now:** `<BaseBottomSheet snapPoints={['45%']} wrapInRNModal scrollMode="view"
header={name}>` with the action items in a `chatSheetBody`. Added `BaseBottomSheet` import +
`CHAT_MORE_OPTIONS_SNAP` const. Removed the `chatSheetOverlay`/`chatSheetContainer` dead
styles; **retained** `chatSheetHandle` (still used by the untouched event-audience modal at
~line 2188). The RN `Modal` import stays (3 excluded modals still use it). All
view-profile/add-to-session/share/remove/block/report handlers + copy unchanged. The
image-preview, file-spinner, and event-audience modals are UNTOUCHED.
**Why:** convert ONLY the named modal per dispatch.
**Lines changed:** ~30.

### components/PersonHolidayView.tsx
**Before:** saves-list RN `<Modal animationType="slide" presentationStyle="pageSheet">`
(line 1053) wrapping `PairedSavesListScreen`.
**Now:** `<BaseBottomSheet snapPoints={['90%']} wrapInRNModal scrollMode="view">` wrapping
`PairedSavesListScreen` with `inBottomSheet`. Added `BaseBottomSheet` import +
`SAVES_LIST_SNAP`. The RN `Modal` import stays (visits-list pageSheet at line 1085 is
untouched). All saves mapping, card-press navigation (the 300ms dismiss-then-open dance),
loading state unchanged.
**Why:** convert ONLY the saves-list modal per dispatch.
**Lines changed:** ~20.

### components/PairedSavesListScreen.tsx
**Before:** rendered its 2-col grid with a raw RN `<FlatList>`; `useState` imported unused.
**Now:** opt-in `inBottomSheet?: boolean` prop picks `BottomSheetFlatList` (sheet) vs raw
`FlatList` (default, full-screen/pageSheet consumers). Imported `BottomSheetFlatList` from
BaseBottomSheet; dropped the already-unused `useState`. No other consumer changes (default
keeps the raw list).
**Why:** vertical list inside #7's sheet must coordinate with the pan gesture.
**Lines changed:** ~10.

## Sim verification (iPhone 17 Pro `17091E60-…`, Metro :8100)

Cold-launch hit the documented IPv4/IPv6 dual-stack flake (dev client requested
`127.0.0.1:8100` against an IPv6-only listener → "Could not connect" red screen). Resolved
by priming the IPv4 entry.bundle route (`curl -4 … → 200`) and tapping Reload via Maestro
(osascript banned), scoped to :8100 only — no other session's port/sim touched.

Live triggers for these modals need deep app state (a collab session with dismissed cards,
a picked locked-card date, a long-pressed chat message, a real group session, a friend's
holiday saves) that can't be fabricated on-sim, so per playbook §7.5 a THROWAWAY harness
(`__B5_SIM_HARNESS__.tsx`, mounted as a sibling of `<AppContent/>` inside the
QueryClient/gesture-root tree) rendered each mountable sheet standalone with fixture props.
**The harness file + its import + its mount were fully removed after verification and NEVER
committed** (git status shows only the 9 source files + the new test; `git checkout --` on
`app/index.tsx`).

| # | Modal | Sim result | Screenshot |
|---|---|---|---|
| 1 | DismissedCardsSheet | Rolled up at ['80%'], real gorhom handle, "1 Card Viewed" header + close X + card row (title/category/rating/Passed/Save). Swipe-down → dismissed to deck. | `/tmp/b5_01b_dismissed.png`, `/tmp/b5_01c_after_swipe.png` |
| 2 | LockedCardSchedulingSheet summary (center-dialog) | The pick step (delegated ProposeDateTimeModal) rendered; the summary center-dialog is gated behind ProposeDateTimeModal's full date+time+availability flow (more than the harness drives). Center-dialog is NON-swipe by construction (static RN-Modal card, no PanGestureHandler) and was sim-proven for the two Batch-4 center-dialogs. **Tester: reach via a real collab session → Lock it in → pick a date → Check Availability → the summary "Lock in this plan?" card appears centered, non-swipe.** | `/tmp/b5_02_locksummary.png` |
| 3 | MessageContextMenu | Rolled up as a COMPACT bottom action sheet (context-menu feel, short height — NOT a tall sheet), gorhom handle + emoji reaction row (❤️😂👍😮😢🔥) + action-icon row (reply/copy/edit/delete-red). Swipe-down dismissed. | `/tmp/b5_03d_ctxmenu.png` |
| 4 | BoardSettingsDropdown | Rolled up at ['80%'], handle + editable "Weekend Crew" name (orange underline + pencil) + mute bell + invite-by-phone + friends accordion + MEMBERS(2) + sticky Leave/Delete footer. (Harness "Failed to load pending invites" toast is fixture noise — fake non-uuid session id; error surfaced cleanly, no silent failure.) Name field is `BottomSheetTextInput` + interactive keyboard (same proven primitive as Batch-1/2 keyboard sheets). | `/tmp/b5_04_board.png` |
| 5 | DiscoverScreen filter | NOT in harness (deeply embedded in the Discover tab). Converted + structurally tested (T-8: the single filter Modal is the only one → 0 raw `<Modal>` left) + tsc-clean. Mechanically identical roll-up sheet to #1/#4. **Tester: Discover tab → "More" filter chip → dark filter sheet rolls up; swipe-down closes; Reset/Apply pinned.** | — |
| 6 | MessageInterface 1:1 more-options | NOT in harness (1:1 chat). Converted + structurally tested (T-8: 3 excluded modals remain; chatSheetHandle retained) + tsc-clean. **Tester: open a 1:1 chat → header more-options (•••) → light action menu rolls up; swipe-down closes; View Profile / Add to Session / Share / Remove / Block / Report.** | — |
| 7 | PersonHolidayView saves-list | Rolled up at ['90%'], handle + "Alex's saves" header (back arrow) + 2-col grid (BottomSheetFlatList) of save cards. Swipe-down dismissed. | `/tmp/b5_05_saves.png`, `/tmp/b5_05b_after.png` |

## Regression test

**Path:** `app-mobile/src/components/ui/__tests__/WaveBBatch5.test.mjs`
**Passing run:** `PASS META-ORCH-0991 Wave B Batch-5 regression suite (T-1..T-9, T-A1)`
**fails-on-revert:** verified — `git stash` of the 9 source files (test kept) → test exits
**1** (T-1 BaseBottomSheet-import assertion fails on the reverted DismissedCardsSheet).
Anchor commit before fix: `707e0ec817f65cb92b8387fe22619c24e0deab56`. Restored
(`git stash pop`) → test exits 0.

Structural/contract test (the gorhom host isn't mountable in the node harness — same
approach as Wave-A/Batch-1/2/3/4). Asserts: all 7 host files consume BaseBottomSheet + the
4 standalone files import no gorhom (T-1); the 4 standalone files shed RN Modal (T-2);
LockedCard summary is center-dialog + the 6 sheets are not (T-3); snaps match prior heights
+ no enableDynamicSizing (T-4); BoardSettings is keyboard-aware via BottomSheetTextInput +
interactive (T-5); sheets wrap (T-6); MessageContextMenu is compact ['28%'] + the
Animated.spring/Animated-import are gone (T-7); the 3 big-screen files convert ONLY the
named modal — DiscoverScreen has 0 raw modals, MessageInterface keeps ≥3, PersonHolidayView
keeps the visits-list (T-8); BaseBottomSheet re-exports BottomSheetFlatList +
PairedSavesListScreen/PersonHolidayView wire inBottomSheet (T-9); adversarial: every old
scrim/overlay/card/handle style key is gone from the converted surfaces (T-A1).

## Gates

- **Sole-consumer strict-grep** (`meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`):
  PASS — "scanned 409 file(s)… BaseBottomSheet.tsx is the sole @gorhom/bottom-sheet
  importer." Self-test PASS.
- **tsc** (`app-mobile`): 244 errors total = unchanged from the Batch-1 baseline (244).
  Zero new errors. The only touched-file diagnostic is the PRE-EXISTING
  `LockedCardSchedulingSheet.tsx(76): Cannot find namespace 'JSX'` on the unchanged
  function signature (confirmed present at HEAD `707e0ec81` before this batch).
- **All Wave-B suites** (BaseBottomSheet, Batch1, Batch2, Batch3, Batch4, Batch5): all PASS
  — no prior batch regressed.

## Spec traceability (playbook)

- §0 sole-consumer gate: green; needed `BottomSheetFlatList` → added as a one-line re-export
  on the primitive (not imported in any consumer).
- §1 variant rule: LockedCard summary = the only center-dialog (irreversible commit confirm);
  the other 6 are full swipe-down sheets.
- §2 snap heights: all translated from the old `maxHeight`/`SCREEN_HEIGHT*`; all FIXED
  (§2 off-screen lesson).
- §3 keyboard: BoardSettings rename input → `BottomSheetTextInput` + interactive +
  adjustResize.
- §4 wrapInRNModal: all 6 sheets wrap (deck/chat/tab-bar mounts); center-dialog is
  RN-Modal-backed automatically.
- §5 body composition: header / scroll-or-view body / stickyFooter slots used; no raw RN
  list inside a sheet (BottomSheetFlatList for #7's grid).
- §6 preserve-behavior: all copy/callbacks/analytics/error-state/styling preserved; dead
  scrim/overlay/card/handle styles removed; Android back + backdrop close via the primitive.

## Discoveries for orchestrator

- **LockedCard summary center-dialog + DiscoverScreen filter + MessageInterface 1:1
  more-options** — three live triggers not reachable in the throwaway harness (need a real
  collab session date-pick flow / Discover "More" chip / a 1:1 chat header menu). All
  converted, structurally regression-tested, and tsc-clean; flagged above for the tester to
  exercise in real UI. Same posture as Batch-4's ActionButtons-picker.
- **Cold-launch IPv4 flake on :8100** — re-confirmed (Metro dual-stack socket prefers IPv6).
  Environmental, not a code issue; mitigated by priming the IPv4 bundle route + a Reload tap.
- **After this batch only Wave C remains** (complex: PreferencesSheet, AccountSettings
  nested chain, CreateGroupChat/FriendPicker/CityPicker search sheets, CardDiscussion
  composer, FeedbackHistory nested, MessageInterface event-audience, ConnectionsPage friends
  modal).
