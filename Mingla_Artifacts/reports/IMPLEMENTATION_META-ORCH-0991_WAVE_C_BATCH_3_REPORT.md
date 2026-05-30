# IMPLEMENTATION — META-ORCH-0991 Wave C BATCH 3 (FINAL in-scope batch): 4 consumer modals → BaseBottomSheet

**ORCH:** META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — Wave C, Batch 3 (final in-scope conversion batch).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`.
**Surfaces touched:** `CardDiscussionModal.tsx`, `FeedbackHistorySheet.tsx`, `MessageInterface.tsx` (event-audience picker ONLY), `ConnectionsPage.tsx` (friends modal ONLY), `connections/AddFriendView.tsx` (the friends-list tab's TextInput owner) + new regression test.
**Status:** implemented and verified — 3 of 4 sim-proven on iPhone 17 Pro via Metro :8100; CardDiscussionModal's live trigger is UNREACHABLE (dead host — see §7), verified structurally.
**Anchor commit (fails-on-revert proof):** `d3503c9a9b393af85082096d281d5360ad80c6c1`.

---

## 1. What changed in plain English

The last 4 in-scope modals now slide up + swipe-down-to-dismiss like the events sheet, on the shared `BaseBottomSheet`:
- The collab card-discussion chat (header + scrolling messages + a composer that stays above the keyboard).
- The beta-feedback history list (and its nested fullscreen screenshot viewer, gated so the two never crash on iOS).
- The event/trip broadcast "Attendees" roster picker in chat.
- The 4-tab Friends modal (with a keyboard-aware add-friend field and a child action-menu chain that never co-presents).

All behavior/copy/callbacks/analytics/styling preserved — only the container changed. After this batch, only the deferred PreferencesSheet body-rebuild remains.

## 2. Per-modal decisions

| Modal | Variant | Snap | Keyboard | Body mode | wrapInRNModal | Notes |
|---|---|---|---|---|---|---|
| **CardDiscussionModal** | sheet (light) | `['92%']` | **yes** (composer) | `view` (own `BottomSheetScrollView` thread) + **stickyFooter** composer | **true** | Was a `presentationStyle="pageSheet"` RN `<Modal>` + `KeyboardAwareView`. Header slot (title/subtitle/close); message thread → `BottomSheetScrollView` (raw RN `<ScrollView>` removed); composer `<TextInput>` → `<BottomSheetTextInput>` pinned via `stickyFooter` so the keyboard never covers it. `scrollViewRef.scrollToEnd` retained (BottomSheetScrollView exposes the same imperative API). Mounted inside `SessionViewModal`'s RN `<Modal>` over the deck — sibling of the already-`wrapInRNModal` `ExpandedCardModal` (Wave A) → `wrapInRNModal` (one RN-Modal parent + one wrapInRNModal gorhom child = the proven ORCH-0908 z-stack pattern; the two are mutually exclusive via separate `selectedCard*` flags so they never co-present each other). Light chat canvas + topRadius 20 via `backgroundStyle`. |
| **FeedbackHistorySheet** (root list) | sheet (light) | `['75%']` | no | `flatlist` (feedback `FlatList`; loading/error → `view`) | **true** | Was a `Pressable`-scrim flex-end RN `<Modal>` (maxHeight 75%). Header slot (title + close); feedback list rides the primitive `scrollMode="flatlist"` with `data/keyExtractor/renderItem/ListEmptyComponent` via `scrollProps`. Loading/error states swap to `scrollMode="view"` children. ProfilePage z-trap → `wrapInRNModal`. Dead `backdrop`/`sheet`/`handle` styles removed; `useSafeAreaInsets` + `FlatList` imports dropped. |
| **FeedbackHistorySheet** (nested fullscreen screenshot viewer) | RN `<Modal>` (kept) + **§13 gate** | — | no | — | — | The viewer stays its original fullscreen RN `<Modal>` (a horizontal/zoom image surface, not a sheet). **§13 one-sheet-at-a-time gate:** root `visible={visible && !screenshotOpen}` + wrapped `handleRootClose` so the two RN-Modal-backed surfaces never co-present on iOS (the playbook §13 crash class). On viewer dismiss the root re-presents. |
| **MessageInterface event-audience picker** (`~:2176`, ONLY this modal) | sheet (**dark**) | `['70%']` | no | `scroll` (`.map` roster) | **true** | Was a dark flex-end RN `<Modal>` (scrim `eventAudienceOverlay` + card `eventAudienceSheet` + hand-rolled `chatSheetHandle` + roster `.map` in a `<ScrollView>`). Bespoke dark canvas `#111418` + topRadius 26 + hairline preserved via `backgroundStyle` (`eventAudienceSheetBackground`). Header slot = icon shell + title + subtitle. Mounted in chat over the chat input → `wrapInRNModal`. The file's OTHER modals (image preview + file spinner — EXCLUDED) and the Batch-5 more-options sheet are UNTOUCHED → exactly **two** `<BaseBottomSheet>` in the file. Dead `eventAudienceOverlay`/`eventAudienceSheet`/`eventAudienceList`(maxHeight)/`chatSheetHandle` styles removed. |
| **ConnectionsPage friends modal** (`~:3556`, ONLY this modal) | sheet (light) | `['88%']` | **yes** (add-friend field) | `scroll` (4-tab bodies) | **true** | Was a 4-tab RN `<Modal>` with a hand-rolled `useKeyboard` sheet-height/`marginBottom` hack (`sheetHeight = screenHeight*0.88`). → light BaseBottomSheet, fixed `['88%']`, header slot = title row + 4-tab bar, body = the tab content via `scrollMode="scroll"`. gorhom owns keyboard (the add-friend field is now `BottomSheetTextInput`) so the `keyboardVisible`/`keyboardHeight`/`stableHeightRef`/`sheetHeight` math + `useWindowDimensions`/`Modal` imports were removed. Under the floating GlassBottomNav → `wrapInRNModal` (Batch-2 z-trap). Dead `sheetOverlay`/`backdropFill`/`sheetContainer`/`sheetHandle`/`sheetBody` styles removed. **§13 gate:** `visible={showFriendsModal && !anyFriendsChildOpen}` + wrapped `handleFriendsModalClose` — every child surface the modal can open (friend picker, action chooser, create-group, pair request, friend actions, report/block/add-to-board/paywall/incoming-pair/pending-collab) is RN-Modal-backed, so while one is open the friends sheet's window is dropped (the row handlers already `setShowFriendsModal(false)` first; the gate makes that structural). |
| **AddFriendView** (friends-list tab sub-component, used ONLY in the friends modal) | n/a | — | **yes** | — | — | Phone `<TextInput>` → `<BottomSheetTextInput>` (keyboard-aware inside the sheet — sim-confirmed the field + Invite button stay above the keyboard). Country picker stays `CountryPickerModal` (a fullScreen RN `<Modal>`) — the proven Batch-4 PairRequestModal precedent where a fullScreen RN `<Modal>` sub-picker, opened by a user tap, stacks above the wrapInRNModal sheet and virtualizes its country list in its OWN window. A first pass used `CountryPickerOverlay` (in-sheet, no RN Modal); the sim showed it nests its `FlatList` in the sheet's `BottomSheetScrollView` → a "VirtualizedLists should never be nested" warning. Reverted to `CountryPickerModal` (warning gone, sim-confirmed). |

## 3. The §13 nested-chain handling (the hard part)

Two §13 one-sheet-at-a-time gates were applied (the AccountSettings Batch-C-2 pattern):

1. **FeedbackHistorySheet root ↔ fullscreen screenshot viewer:** `screenshotOpen = !!fullScreenImageUrl`; root `visible={visible && !screenshotOpen}`; `handleRootClose` returns early while the viewer is open so the suppress-for-child close does not tear down the root. (Guards FH-5 + FH-A2.)
2. **ConnectionsPage friends modal ↔ its 11 RN-Modal-backed children:** `anyFriendsChildOpen` ORs every child flag; `visible={showFriendsModal && !anyFriendsChildOpen}`; `handleFriendsModalClose` early-returns while any child is open. **Sim-proven glitch-free:** opening a friend's ⋮ → FriendActionsSheet presented cleanly while the friends modal dropped its window (no `RCTFabricModalHostViewController already presenting` crash); swipe-closing the child returned to the chat list. (Guards CP-6 + CP-A1.)

CardDiscussionModal's `wrapInRNModal` inside `SessionViewModal`'s plain RN `<Modal>` is NOT a §13 risk: that is one RN-Modal parent + one wrapInRNModal gorhom child (the standard ORCH-0908 z-stack, identical to the already-shipped sibling `ExpandedCardModal`), not two co-present gorhom-sheet wraps.

## 4. Old → New Receipts

### app-mobile/src/components/board/CardDiscussionModal.tsx
**Before:** `presentationStyle="pageSheet"` RN `<Modal>` wrapping a `KeyboardAwareView` (full-screen `container`) → header View + a raw RN `<ScrollView ref>` message thread + an inline composer (`<TextInput>` + send). **Now:** `<BaseBottomSheet>` `['92%']` `wrapInRNModal`, `scrollMode="view"` with the thread on `BottomSheetScrollView`, header slot, `stickyFooter` composer with `<BottomSheetTextInput>` + `keyboardBehavior="interactive"`. `Modal`/`ScrollView`/`KeyboardAwareView`/`TextInput`(react-native) imports dropped; old `container` style → `sheetBackground` + `body`. **Why:** META-ORCH-0991 conversion; chat composer keyboard-aware + pinned, messages scroll. **~90 lines.**

### app-mobile/src/components/FeedbackHistorySheet.tsx
**Before:** root `Pressable`-scrim flex-end RN `<Modal>` (`maxHeight 75%`) + a hand-rolled `handle` + a `FlatList`; nested fullscreen screenshot-viewer RN `<Modal>`. **Now:** root `<BaseBottomSheet>` `['75%']` `wrapInRNModal`, `scrollMode` `flatlist`/`view`, header slot, §13-gated on `!screenshotOpen` + `handleRootClose`; the viewer stays an RN `<Modal>`. `FlatList`/`useSafeAreaInsets` imports dropped; `backdrop`/`sheet`/`handle` styles removed; `listContent`/`header` styles re-padded. **Why:** conversion + §13 nested-viewer gate. **~70 lines.**

### app-mobile/src/components/MessageInterface.tsx
**Before:** the event-audience picker was a dark flex-end RN `<Modal>` (`eventAudienceOverlay` scrim + `eventAudienceSheet` card + `chatSheetHandle` + `eventAudienceList` maxHeight ScrollView). **Now:** `<BaseBottomSheet>` dark `['70%']` `wrapInRNModal`, `scrollMode="scroll"`, header slot, bespoke dark canvas via `backgroundStyle`. Only this modal changed; image-preview + file-spinner RN `<Modal>`s and the Batch-5 more-options sheet untouched (exactly 2 `<BaseBottomSheet>` total). Dead `eventAudienceOverlay`/`eventAudienceSheet`/`eventAudienceList`/`chatSheetHandle` styles removed. **Why:** conversion of the named modal only. **~50 lines.**

### app-mobile/src/components/ConnectionsPage.tsx
**Before:** the 4-tab Friends modal was an RN `<Modal>` whose `sheetContainer` height was driven by a `useKeyboard` math block (`keyboardVisible`/`keyboardHeight`/`stableHeightRef`/`sheetHeight = screenHeight*0.88`) + `marginBottom`; header/tab-bar/body were hand-rolled with `sheetOverlay`/`backdropFill`/`sheetHandle`/`sheetBody`. **Now:** `<BaseBottomSheet>` light `['88%']` `wrapInRNModal`, keyboard-aware, header slot = title row + tab bar, body via `scrollMode="scroll"`; §13-gated on `!anyFriendsChildOpen` + `handleFriendsModalClose`. The keyboard math + `useWindowDimensions`/`Modal` imports + the dead sheet styles removed; `chatInsets` preserved (used elsewhere). **Why:** conversion + §13 child-chain gate; gorhom owns keyboard. **~120 lines.**

### app-mobile/src/components/connections/AddFriendView.tsx
**Before:** phone `<TextInput>` (raw RN) + `CountryPickerModal`. **Now:** `<BottomSheetTextInput>` (keyboard-aware) + `CountryPickerModal` retained (Batch-4 precedent; a CountryPickerOverlay-in-sheet trips the VirtualizedList-nesting warning). Unused `FlatList`/`KeyboardAwareScrollView` imports dropped. **Why:** the friends-list tab field must coordinate with the sheet keyboard; country picker must virtualize in its own window. **~15 lines.**

**Preserved verbatim (zero behavior change):** all message send/edit/delete/typing/realtime logic + mention parsing (CardDiscussion); the entire feedback delete pipeline + audio playback + screenshot thumbnails (FeedbackHistory); all participant rows + profile-open handlers + i18n (event-audience); all 4 tab bodies + AddFriendView/FriendsManagementList/RequestsView/BlockedUsersView + every child-sheet handler + analytics (friends modal); the full phone-lookup/invite/share pipeline + Mixpanel + i18n (AddFriendView).

## 5. Spec / requirement traceability

| Requirement | Status | Evidence |
|---|---|---|
| CardDiscussion → keyboard-aware composer, pinned, messages scroll | PASS (structural) | `stickyFooter` + `BottomSheetTextInput` + `interactive`; thread on `BottomSheetScrollView`. Live trigger unreachable (dead host §7); regression CD-5/CD-6 + structural identity to ExpandedCardModal. |
| FeedbackHistory list + nested viewer §13-gated, chain glitch-free | PASS | Sim `fh_05_history.png` (roll-up + empty-state flatlist), `fh_06_closed.png` (swipe-close). §13 gate FH-5 + adversarial FH-A2; no co-present path (root drops window while viewer open). |
| MessageInterface event-audience picker ONLY → dark sheet | PASS | Sim `mi_05_audience.png` (dark canvas roster roll-up), `mi_07_audience_closed2.png` (swipe-close). Exactly 2 `<BaseBottomSheet>` (MI-2); excluded modals intact (MI-5). |
| ConnectionsPage friends modal ONLY → keyboard sheet; child sheets no co-present crash | PASS | Sim: `cp_05` roll-up, `cp_10` country picker fullScreen (no warning), `cp_14` keyboard never covers field, `cp_21` FriendActionsSheet child presents glitch-free (§13), `cp_22` child swipe-close. CP-6 gate + CP-A1 adversarial. |
| Preserve behavior/copy/callbacks/analytics/styling | PASS | Only containers changed; §4 preserved-verbatim list. |
| Android hardware-back + backdrop-press close | PASS (mechanism) | All 4 sheets `wrapInRNModal` → RN `<Modal onRequestClose>` (back) + gorhom backdrop `pressBehavior="close"`. iOS backdrop/swipe verified; Android not driven this pass (iOS-equivalent mechanism, no Android-specific code). |
| Stock gorhom motion | PASS | Primitive passes no `animationConfigs`. |
| tsc clean | PASS | 244 = baseline, 0 new, 0 mentioning any touched file. |
| Sole-gorhom gate | PASS | Gate + self-test green; all gorhom containers imported from BaseBottomSheet. |
| Regression test (happy + fails-on-revert + adversarial) | PASS | `WaveCBatch3.test.mjs` green; fails-on-revert exit 1 @ `d3503c9a9`; adversarial CD-A1/FH-A1/FH-A2/MI-3/CP-A1/AF-2. |

## 6. Cross-surface impact (Step 3.5)

- **Consumer iOS** — AFFECTED. The 4 modal surfaces; 3 sim-verified, 1 structural (dead host).
- **Consumer Android** — AFFECTED (same shared files/code path; parity automatic). Back/backdrop wired via the primitive; not driven on emulator this pass (iOS-equivalent mechanism, no Android-specific code).
- **Buyer/anon web, Business iOS/Android, Admin web, Business web** — NOT affected. These are consumer `app-mobile/` chat/profile/friends surfaces with no analog on those surfaces.

## 7. Discoveries for Orchestrator

- **CardDiscussionModal's sole host `SessionViewModal` is a DEAD/legacy component.** `grep -rn "<SessionViewModal" app-mobile/src` returns ZERO mounts (only comment references in BoardSettingsDropdown/SwipeableSessionCards/collabSaveCard/useCollaborationCalendar). `CardDiscussionModal`'s ONLY caller is `SessionViewModal.tsx:842`. The live collab deck is `CollabDeckSheet` (post-META-ORCH-0929 redesign), which does NOT mount CardDiscussionModal. So **CardDiscussionModal cannot be reached through any live UI path** — its conversion is correct (tsc + regression + structural identity to the shipped `ExpandedCardModal`) but cannot be sim-driven. **Recommend the orchestrator register a follow-up: either re-wire CardDiscussionModal into CollabDeckSheet, or decommission SessionViewModal + CardDiscussionModal if the card-discussion feature is dead.** Flagging, not fixing (out of scope).
- **`AddFriendView` has pre-existing dead code** (`renderSentItem`/`sentItems`/`sentTabLoading`/`sentTabCount`) left over from the ORCH-0435 sent-tab move. Not touched (out of scope, tsc doesn't flag it). Cleanup candidate.
- **VirtualizedList-nesting in the friends sheet Requests/Blocked tabs:** `RequestsView` + `BlockedUsersView` use `<FlatList>` inside the friends sheet's `BottomSheetScrollView` body. This nesting PRE-EXISTED (the old RN-Modal sheet body was also a `<ScrollView>`), so it is not a regression, but it is a latent "VirtualizedLists nested in a ScrollView" warning on those two tabs. Not in this batch's scope; flag for a future cleanup (convert those tabs to the primitive's `scrollMode="flatlist"` per-tab, or `.map` them).

## 8. Regression Test

- **Path:** `app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs`
- **Passing run:** `PASS META-ORCH-0991 Wave C Batch-3 regression suite (CD, FH, MI, CP, AF — 4 modals + 1 sub-component)` (exit 0).
- **Fails-on-revert:** verified at `d3503c9a9b393af85082096d281d5360ad80c6c1` — `git stash` of the 5 product files → test exits 1 (`AssertionError: CD-1: must import BaseBottomSheet`); `git stash pop` → exits 0.
- **Adversarial:** CD-A1 (sheet canvas via backgroundStyle), FH-A1 (dead scrim/sheet/handle styles gone) + FH-A2 (root gate cannot regress to ungated `visible={visible}`), MI-3 (dead event-audience scrim/card/handle gone), CP-A1 (friends gate cannot regress to ungated `visible={showFriendsModal}`), AF-2 (CountryPickerOverlay-in-sheet rejected). Tester will layer a second adversarial test.
- Ships in the same commit as the fix.

## 9. Invariants

- `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER` — PRESERVED. `BottomSheetScrollView`/`BottomSheetTextInput` imported from `BaseBottomSheet`, never gorhom; gate + self-test green (409 files scanned).
- ORCH-0828 vanilla-inline-`<BottomSheet>` (no provider/portal) — PRESERVED; both nested chains solved via the §13 one-sheet-at-a-time gate, not `BottomSheetModal`.

## 10. Verification matrix (sim)

iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, Metro :8100, Maestro driver (no osascript):
1. **FeedbackHistory:** Profile → BETA TESTER → View History → sheet rolls up, empty-state flatlist (`fh_05`); swipe-down → Profile (`fh_06`).
2. **Event-audience:** Friends → broadcast chat "The random" → "View attendees" → dark sheet rolls up, roster (`mi_05`); swipe-down → chat (`mi_07`).
3. **Friends modal:** Friends → people icon → sheet rolls up, 4-tab + AddFriend + friend list (`cp_05`); country flag → fullScreen CountryPickerModal, NO VirtualizedList warning (`cp_10`); type phone → field + Invite stay above keyboard (`cp_14`); tab switch to Blocked → empty state (`cp_12`); friend ⋮ → FriendActionsSheet child presents glitch-free, no co-present crash (`cp_21`); child swipe-close → chat list (`cp_22`).
4. **CardDiscussion:** live trigger UNREACHABLE (dead host — §7). Verified by tsc + regression + structural identity to the shipped sibling ExpandedCardModal. Noted for tester.

No stuck/blank sheet, no co-present crash, no VirtualizedList warning at any verified step.
