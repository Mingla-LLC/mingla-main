# IMPLEMENTATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — WAVE C, BATCH 1 (search / keyboard sheets)

**Skill:** mingla-implementor (Claude, parity mirror)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Anchor commit (pre-fix, for fails-on-revert):** `3927bc788423ccdb91abed2d307a2456b65e971b`
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4, Metro :8100 (shared LAN — not started/killed by this session)

## Layman summary

Three of the four dispatched search/keyboard sheets are converted to the shared slide-down bottom-sheet (`BaseBottomSheet`) — they now roll up, swipe down to close, and keep their search field + results above the keyboard:
- **Create group chat** (name + friends), **New-message friend picker** (search list), **Discover city picker** (city search).

The fourth, the **Discover preferences sheet ("Your Vibe")**, could NOT be safely converted: its long body refused to scroll inside the gorhom sheet across four different attempts, leaving the "How far?" section and the Apply button unreachable. Rather than ship a broken core sheet, it was left as-is (its current RN Modal) and the blocker is documented for a dedicated follow-up. A test guard prevents anyone flipping it silently.

## Status

`implemented and verified` — 3 of 4 converted + sim-proven. 4th (`PreferencesSheet`) **NOT converted — hard gorhom-scroll blocker, evidence below.**

---

## Scope confirmation

All 4 dispatched targets are Wave C, none excluded (INVESTIGATION §1: CreateGroupChatSheet #30, FriendPickerSheet #31, CityPickerSheet #34, PreferencesSheet #6 — all "GOOD — Wave C"). Operator rule §1 applied: all 4 are non-destructive → swipe-down sheets, never center-dialog.

---

## Old → New receipts

### CreateGroupChatSheet.tsx (`app-mobile/src/components/connections/`)
**Before:** RN `<Modal animationType="slide" transparent>` with a hand-rolled `<Pressable>` backdrop + absolute flex-end card (`maxHeight: '85%'`) + cosmetic drag handle. Name + search were raw `<TextInput>`. Submit button was pinned below the inner `<ScrollView>`.
**Now:** `<BaseBottomSheet snapPoints={['90%']} theme="light" scrollMode="scroll" wrapInRNModal keyboardBehavior="interactive">` — `header` slot = title + close X (+ error line); the name + search fields are `<BottomSheetTextInput>`; the friend rows (`.map`) ride the `BottomSheetScrollView` body; the Create button is the `stickyFooter` (safe-area bottom padding preserved). The `accessibilityViewIsModal` focus-trap the old Modal gave is restored by `wrapInRNModal`.
**Why:** SPEC/playbook — single shared sheet primitive, swipe-down + keyboard-aware, z-stack over the floating GlassBottomNav.
**Preserved:** `availableFriends.length > 3` search-field gate, `getFriendId`/`getFriendName`/`getInitials`, haptics (`HapticFeedback.light/medium`), `toggleFriend` set logic, `canSubmit` (name + ≥1 selected + !creating), `handleSubmit` (onSubmit→onCreated→delayed onClose), `onClose` reset effect, i18n keys, all styling.
**Lines changed:** ~120 (shell + import + footer + style consolidation).

### FriendPickerSheet.tsx (`app-mobile/src/components/connections/`)
**Before:** RN `<Modal>` + `<TouchableOpacity>` backdrop + absolute card (`height: '88%'`) + cosmetic `handleBar`. Results were a raw RN `<FlatList>`. Keyboard was handled by the hand-rolled `useKeyboard` hook + a `ListFooterComponent` spacer hack.
**Now:** `<BaseBottomSheet snapPoints={['88%']} theme="light" scrollMode="flatlist" wrapInRNModal keyboardBehavior="interactive">` — the friend results route through the primitive's `BottomSheetFlatList` (data/keyExtractor/renderItem via `scrollProps`); the search header (title + close + `<BottomSheetTextInput>`) is the implicit `ListHeaderComponent`; the loading / no-friends / no-results states are the `ListEmptyComponent`. The `useKeyboard` hook + spacer hack are DELETED (gorhom owns keyboard + the list).
**Why:** long vertical list → must use the gorhom-aware flatlist mode (playbook §5), not a raw RN FlatList that fights the pan.
**Preserved:** `getInitials`/`getFriendDisplayName`, `searchQuery` `useMemo` filter (name + username), `handleSelectFriend` (loading-id guard + finally-clear), `handleClose` (reset + onClose), `renderFriendRow` (avatar/name/per-row spinner), all empty-state copy + styling.
**Lines changed:** ~70.

### CityPickerSheet.tsx (`app-mobile/src/components/discover/`)
**Before:** RN `<Modal>` + a hand-rolled `KeyboardAvoidingView` (`behavior="padding"` on iOS) lifting an 80px dismiss strip + a `flex:1` dark sheet. Search was a raw `<TextInput autoFocus>`; results were a raw `<ScrollView>`.
**Now:** `<BaseBottomSheet snapPoints={['90%']} theme="dark" scrollMode="scroll" wrapInRNModal keyboardBehavior="interactive" backgroundStyle={{rgba(20,22,26,0.98), topRadius 24}}>` — `header` slot = title + close + current-city hint + `<BottomSheetTextInput autoFocus>`; the status rows + `.map` results ride the `BottomSheetScrollView`. The `KeyboardAvoidingView` + `Platform` import are DELETED (gorhom owns keyboard).
**Why:** the hand-rolled KAV is exactly what gorhom replaces; bespoke dark chrome retained via `backgroundStyle`. Discover mounts sheets before the floating GlassBottomNav (same z-trap as the Batch-5 Night Out filter on this screen) → wrap.
**Preserved:** 250ms autocomplete debounce, `parseStateCountry` + US-state/country maps, ORCH-0824 first-segment city-name parse, `handlePick` (persist `discover_city_*` + success haptic + onCityPicked + onClose), all 4 status-row failure modes + copy, `autoFocus`/`autoCorrect=false`/`autoCapitalize="words"`, the discover_city_*-only write guard.
**Lines changed:** ~60.

### PreferencesSheet.tsx — **NOT CONVERTED (reverted to original)**
See the Blocker section. File is byte-identical to HEAD (`git diff HEAD` = 0 lines).

---

## Per-modal sim verification (iPhone 17 Pro, Metro :8100, Maestro)

| Sheet | Roll-up | Swipe-close | Keyboard NOT covering field/results | Live search filter | Selection | Screenshot |
|---|---|---|---|---|---|---|
| CreateGroupChatSheet | ✅ | ✅ | ✅ (name field + Create footer stay above keyboard) | n/a (≤3 friends → search hidden, correct) | ✅ (Ava → checkbox + Create enables) | `creategroupchat_open/keyboard/selected.png` |
| FriendPickerSheet | ✅ (orphaned entry — temp `useState(true)`, reverted) | ✅ | ✅ (search + results above keyboard) | ✅ ("Ava" → 1 result) | tap-to-select wired (onSelectFriend) | `friendpicker_open/keyboard_filter.png` |
| CityPickerSheet | ✅ | ✅ | ✅ (search + 5 results above keyboard) | ✅ ("Brooklyn" → 5 Google-Places results) | pick wired (handlePick) | `citypicker_open/keyboard_filter.png` |

All screenshots under `Mingla_Artifacts/reports/screenshots/wave_c_batch_1/`.

**Orphaned entry point note (FriendPickerSheet):** `setFriendPickerVisible(true)` is never called anywhere in `ConnectionsPage.tsx` — the sheet has no live trigger. Per playbook §7.5, verified by temporarily seeding `useState(true)`, screenshotting, then `git checkout --` (the flip was NEVER committed; ConnectionsPage is byte-identical to HEAD). Flag for orchestrator: FriendPickerSheet may be dead code — worth confirming whether a "new message" entry point was removed.

---

## BLOCKER — PreferencesSheet body cannot scroll inside a gorhom sheet

**Symptom (sim-proven):** opened as a `BaseBottomSheet`, only ~3 of the 5 sections render; gorhom reports the scroll as "1 page"; the body will not scroll to the "How are you rolling?" / "How far?" sections or the **Apply** button. The user cannot complete or apply preferences → broken core flow. Screenshot: `prefs_blocker_no_scroll.png`. (It DOES roll up + swipe-close correctly — `prefs_as_sheet_before_revert.png` — only the body scroll is broken.)

**Four documented patterns attempted, all failed to scroll:**
1. `scrollMode="view"` + a `BottomSheetScrollView` nested under the consumer's `SafeAreaView`/flex Views — no scroll.
2. `scrollMode="scroll"` + the primitive's `header` + `stickyFooter` slots — body clipped off-screen, sections 4–5 + footer never render.
3. `scrollMode="scroll"` + footer inline as last scroll element — same "1 page", sections 4–5 absent.
4. Two-stop `['50%','90%']` snap + `initialIndex={1}` (events-sheet config) — same.

**Root cause:** PreferencesSheet's body is a `KeyboardAwareScrollView` (a raw RN `<ScrollView>`) wrapping 5 `Animated.View` sections + an absolute footer, inside a `SafeAreaView`, with a sibling `CustomPaywallScreen` Modal, behind a dual render mode. A raw RN `<ScrollView>` nested in a gorhom `<BottomSheet>` defeats gorhom's content-size measurement + pan→scroll handoff (the exact thing playbook §5 forbids), and wrapping `BottomSheetScrollView` under intermediate flex Views clips the tall body.

**Decision:** do NOT ship a broken sheet (dispatch HARD GUARD). PreferencesSheet stays its original RN `<Modal>` (works today). A real conversion requires rebuilding the body to render sections as DIRECT children of the primitive's `BottomSheetScrollView` (no `KeyboardAwareScrollView`/SafeAreaView/absolute-footer/flex wrappers) AND migrating the two nested inputs (`LocationInputSection` + `TravelLimitSection`, in out-of-scope `PreferencesSheet/*` sub-components) to `BottomSheetTextInput`. That is a standalone refactor of a core consumer surface → its own ORCH / dedicated Wave-C sub-task with the sub-component edits in scope.

**Guard:** regression test T-8 asserts PreferencesSheet still uses an RN `<Modal>` and does NOT import `BaseBottomSheet` — so a future change cannot silently ship the broken conversion without re-proving body scroll on a sim.

---

## Gates

- **tsc:** `npx tsc --noEmit` from `app-mobile/` → **244 errors = baseline** (pre-existing; 0 new). Zero errors in the 3 touched files.
- **Sole-gorhom gate:** `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` → OK (BaseBottomSheet sole importer across 409 files); `--self-test` → all 8 pass.
- **Regression test:** `app-mobile/src/components/ui/__tests__/WaveCBatch1.test.mjs` → **PASS (T-1..T-8, T-A1)**.
  - happy-path: T-1..T-7 assert the 3 sheets consume BaseBottomSheet, no raw Modal/gorhom import, no center-dialog, correct fixed snaps, BottomSheetTextInput + keyboardBehavior interactive, wrapInRNModal, FriendPicker flatlist mode.
  - blocker guard: T-8 asserts PreferencesSheet still uses RN `<Modal>` + does NOT import BaseBottomSheet.
  - adversarial T-A1: old scrim/overlay/sheet-card/handle styles + the KeyboardAvoidingView + useKeyboard hack are GONE.
  - **fails-on-revert:** verified — `git stash` of the 3 source files → test exits non-zero (T-1 fails); `git stash pop` → PASS. Anchor `3927bc788`.

---

## Cross-surface impact (Step 3.5)

Affected: **Consumer iOS + Consumer Android** only (`app-mobile/` shared code path — parity automatic; gorhom `android_keyboardInputMode="adjustResize"` set on all 3). Not affected: Buyer/anon Web, Business iOS/Android, Admin, Business Web preview (none render these consumer sheets). Android not sim-verified this pass (iOS sim only); the keyboard prop + back-handler are wired identically via the shared primitive — flag for tester Android pass.

---

## Discoveries for orchestrator

1. **PreferencesSheet conversion blocker (P1 for Wave C):** needs its own ORCH / sub-task — body-tree rebuild + sub-component `BottomSheetTextInput` migration. Detail above + playbook §12 HARD LESSON.
2. **FriendPickerSheet may be dead code:** `setFriendPickerVisible(true)` is never called in `ConnectionsPage.tsx`. The conversion is correct + sim-proven (via temp flip), but the "New message" entry point appears unreachable. Worth confirming whether a trigger was removed or should be re-added.
3. **Shared test-helper fragility (fixed in-batch):** the `code()` comment-stripper in the Wave-suite tests breaks on a literal `/*` appearing inside a `//` line comment (a comment reading `PreferencesSheet/*` opened a phantom block comment and swallowed 13KB). Avoid `/*` substrings in code comments; the Batch-C-1 prefs comment was reworded.

## Wave C remaining (per dispatch)

AccountSettings nested-picker chain (+ delete-confirm), CardDiscussionModal composer, FeedbackHistorySheet nested, MessageInterface event-audience, ConnectionsPage friends modal — **plus the PreferencesSheet body-rebuild sub-task surfaced here.**
