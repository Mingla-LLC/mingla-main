# IMPLEMENTATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — WAVE C PreferencesSheet body rebuild (fix gorhom scroll)

**Skill:** mingla-implementor (Claude, parity mirror)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`
**Anchor commit (pre-fix, for fails-on-revert):** `51d85bb705a2b3fbfab64f82de41c7b38170f983`
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4, Metro :8100 (shared LAN — not started/killed by this session). Consumer dev build `com.mingla.app.v2`.

## Layman summary

The Discover "Your Vibe" preferences sheet is now a real slide-down bottom sheet whose long body **scrolls all the way through all 5 sections** with the Apply button reachable at the end. A prior batch tried four ways and the body wouldn't scroll, so it was correctly left as the old pop-up. This time the exact cause was found on the simulator and the body was rebuilt so it scrolls top-to-bottom, the Apply button works (and the sheet closes on apply), and you can swipe it down to dismiss.

## Status

`implemented and verified` — PreferencesSheet `visible`-prop path is now a `BaseBottomSheet`; sim-proven all 5 sections render + scroll + Apply reachable + swipe-down close. tsc/gate/test green. Legacy inline full-screen path preserved unchanged.

---

## ROOT CAUSE (sim-proven, not inferred)

**gorhom's `BottomSheetScrollView` only scrolls when it is a DIRECT child of `<BottomSheet>`.** The shared `BaseBottomSheet` primitive's `header` and `stickyFooter` slots both wrap the scrollable inside an intermediate flexed `<BottomSheetView>` (BaseBottomSheet.tsx lines 362-368 stickyFooter path; 394-401 scroll+header path). That intermediate `BottomSheetView` makes the scrollview a **non-direct descendant** of `<BottomSheet>`, which breaks gorhom's content-pan→scroll gesture handoff: the sheet treats every vertical drag as a sheet-pan and never hands off to content scroll, so a body taller than the viewport simply will not move.

### How it was proven (controlled isolation on the iPhone 17 Pro sim)

1. Converted PreferencesSheet to `BaseBottomSheet` with `scrollMode="scroll"` + `header` slot + `stickyFooter` slot (the textbook approach). Sheet rolled up correctly, but **the body would not scroll** — Maestro `hierarchy` showed only sections 1–3 ("Your Vibe", curated, popular); "How are you rolling?", "How far?", and the Apply button were absent. Confirmed the content overflowed (the "Movies" chip measured at y=867 on an 874px screen) yet would not scroll.
2. Ruled out the prior-report hypotheses one by one with live edits + reloads:
   - **Animated.View sections** — forced all 5 `sectionAnims` to `1` and short-circuited the stagger effect → still no scroll. NOT the cause.
   - **wrapInRNModal / GestureHandlerRootView** — set `wrapInRNModal={false}` → still no scroll; and a trial `GestureHandlerRootView` wrap inside the RN modal did NOT fix it. NOT the cause. (Pan-down close worked the whole time, proving gesture-handler itself was wired.)
   - **The CustomPaywallScreen child** — moved it outside the sheet → no change.
3. **Decisive controlled experiment:** replaced the entire body with 40 dummy `<Text>` rows.
   - With `header` slot present → dummy stuck at row 12, would NOT scroll.
   - With `header` slot REMOVED (dummy as the bare direct child of `scrollMode="scroll"`) → **scrolled cleanly from row 12 to row 39.**
   - Re-adding ONLY `header={headerContent}` (nothing else) → broke scroll again.

   → The single differentiator is the `header` slot (and equivalently `stickyFooter`), because both wrap the `BottomSheetScrollView` in an intermediate `BottomSheetView`.

**Why the prior 4 attempts all failed:** attempts #2 (header + stickyFooter), #3 (header + inline footer) used the `header` slot — the exact break. Attempt #1 (`scrollMode="view"` + nested `BottomSheetScrollView`) and #4 (two-stop snap) didn't address the direct-child requirement either. **Why other Wave-B/C sheets weren't bitten:** EditInterestsSheet / CreateGroupChat / CityPicker pickers have content that FITS within their snap height, so they never actually needed to scroll — they used `header`/`stickyFooter` slots and looked fine. PreferencesSheet is the first converted sheet whose content genuinely overflows, so it's the first to expose the latent limitation.

### The fix

Render the title (`headerContent`), the 5 sections (`bodyContent`), AND the Apply/Reset row (`footerContent`) as **DIRECT children** of `scrollMode="scroll"` (the bare `BottomSheetScrollView`). Do NOT use the primitive's `header` / `stickyFooter` slots on this sheet. The title and Apply row therefore scroll WITH the content — acceptable, and consistent with the old RN-Modal sheet which also scrolled its title inside `KeyboardAwareScrollView`. **Zero changes to the shared `BaseBottomSheet` primitive** (the fix is entirely in the consumer; the primitive's slot behaviour is correct for sheets whose content fits).

Secondary fixes (in `PreferencesSheet/PreferencesSectionsAdvanced.tsx`): the two nested `<TextInput>` → `<BottomSheetTextInput>` (keyboard-aware inside the sheet) and the suggestions dropdown `<ScrollView>` → `<BottomSheetScrollView>` (so it doesn't fight the sheet pan), both imported from `BaseBottomSheet` per the sole-gorhom gate.

---

## Old → New receipts

### app-mobile/src/components/PreferencesSheet.tsx
**Before:** `visible`-prop path rendered an RN `<Modal animationType="slide" transparent>` with a hand-rolled `<Pressable>` backdrop + a fixed-height white card (`sheetContent`, height = `appLayout.screenHeight − insets.top − vs(20)`). Inside: `SafeAreaView(flex:1)` → white header → `View(flex:1)` → `KeyboardAwareScrollView` (a raw RN `<ScrollView>`) wrapping the 5 `Animated.View` sections → an **absolutely-positioned** footer with Apply/Reset.
**Now:** `visible`-prop path renders `<BaseBottomSheet snapPoints={['90%']} theme="light" scrollMode="scroll" wrapInRNModal keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" backgroundStyle={cream #fff9f5 + topRadius 28}>`. The body is split into `headerContent` (title block), `bodyContent` (the 5 `Animated.View` sections, unchanged), and `footerContent` (Apply + Reset) — all rendered as DIRECT children of the gorhom `BottomSheetScrollView` (no `header`/`stickyFooter` slots, no intermediate flex wrapper). Footer is the last scroll child (reachable). Paywall (its own RN Modal) renders as a sibling OUTSIDE the sheet. RN `<Modal>` + `<Pressable>` + `useAppLayout` + `vs` removed. The legacy inline full-screen path (`visible` undefined) re-wraps the SAME `headerContent`/`bodyContent`/`footerContent` in the original `SafeAreaView` + `KeyboardAwareScrollView` + absolute footer — byte-identical behaviour.
**Why:** META-ORCH-0991 conversion to the shared sheet primitive; the direct-child scroll structure is the root-cause fix above.
**Preserved:** every filter control + its state; `handleApplyPreferences` (incl. ORCH-0943 coord-resolve, ORCH-0904 solo GPS snapshot, ORCH-0446 solo/collab close behaviour), `handleReset`, `hasChanges`/`countChanges`/`isFormComplete`/`sectionWarnings`/`ctaHintText`, the staggered `sectionAnims`, `initialFocusSection` autoscroll (`scrollRef`), all analytics (`logAppsFlyerEvent`, `mixpanelService.*`), i18n keys, copy, and styling. Read-only (`!isEditable`) and collab modes preserved.
**Lines changed:** ~180 (shell split + import cleanup + style swap).

### app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx
**Before:** `TravelLimitSection` + `LocationInputSection` used raw RN `<TextInput>` for the two fields; the location suggestions dropdown was a raw RN `<ScrollView maxHeight:200 nestedScrollEnabled>`.
**Now:** both fields are `<BottomSheetTextInput>`; the suggestions dropdown is a `<BottomSheetScrollView>` — both imported from `../ui/BaseBottomSheet` (sole-gorhom gate). The unused RN `TextInput` + `ScrollView` imports removed.
**Why:** a raw RN `<TextInput>` inside a gorhom sheet gets covered by the keyboard and doesn't coordinate with the sheet position; a raw nested vertical `<ScrollView>` fights the sheet pan. The dispatch flagged these sub-component inputs as in-scope for a correct conversion.
**Preserved:** all preset pills, the custom-toggle Switch, the GPS Switch, the location chip, the locked/pro-feature hint, autocomplete behaviour, every style, the `memo` comparators.
**Lines changed:** ~21.

### app-mobile/src/components/ui/__tests__/WaveCBatch1.test.mjs
**Before:** T-8 asserted PreferencesSheet stays an RN `<Modal>` and does NOT import `BaseBottomSheet` (blocker guard).
**Now:** T-8 asserts the conversion + scroll contract: imports/renders `BaseBottomSheet`, no direct gorhom import, no raw `<Modal>`, `scrollMode="scroll"`, `['90%']` snap, `wrapInRNModal`, **NO `header={headerContent}` slot AND NO `stickyFooter` slot** (the root-cause guard), `headerContent`/`bodyContent`/`footerContent` rendered as direct scroll children, ≤1 `KeyboardAwareScrollView` (legacy path only), and the sub-component `BottomSheetTextInput`/`BottomSheetScrollView` migration. Suite header documents the root cause for reuse.
**Why:** the sheet is now converted; the test must guard the *correct* (direct-child) structure and fail on a revert to the broken `header`-slot shape.
**Lines changed:** ~106 (T-8 + header comment). Carries `[TEST-MOD-APPROVED META-ORCH-0991]` in the commit body (T-8 assertions inverted).

---

## Sim verification (iPhone 17 Pro, Metro :8100, Maestro)

Opened via Home/Explore → top-left sliders ("Preferences" / "Your Vibe"). Screenshots under `Mingla_Artifacts/reports/screenshots/wave_c_batch_2/`.

| Check | Result | Evidence |
|---|---|---|
| Rolls up like a sheet (gorhom handle, rounded top) | PASS | `FINAL_1_top.png` |
| All 5 sections render | PASS | hierarchy: sections 1–5 + Apply/Reset all present across scroll |
| Body scrolls top-to-bottom | PASS | before swipe → only "Your Vibe"/sections 1–3; after swipes → "How are you", "How far", "Lock", "Start Over" appear (`FINAL_1_top` → `FINAL_2_mid` → `FINAL_3_bottom`) |
| Apply button reachable | PASS | `FINAL_3_bottom.png` shows Apply + Start Over at the end |
| Apply works (change detection + apply + close) | PASS | tapped "45 min" → button flips "No changes to save" → "Lock It In (1)" (`PROOF_4_apply_enabled.png`); tapped it → sheet closed, prefs applied (`PROOF_5_after_apply.png`) |
| Swipe-down closes | PASS | re-opened, swiped down → back to deck |

Three required proofs: `PROOF_1_top.png` (top), `PROOF_2_mid.png` (scrolled middle — sections 3/4/5), `PROOF_3_bottom.png` (bottom, Apply visible). `FINAL_*` are the same flow on the final polished (cream-canvas) build.

---

## Gates

- **tsc:** `npx tsc --noEmit` from `app-mobile/` → **244 errors = baseline** (pre-existing; 0 new; 0 in the 2 touched source files).
- **Sole-gorhom gate:** `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` → OK (BaseBottomSheet sole importer across 409 files). BaseBottomSheet byte-identical to HEAD.
- **Regression suite:** `app-mobile/src/components/ui/__tests__/WaveCBatch1.test.mjs` → **PASS (T-1..T-8, T-A1)**.
  - **fails-on-revert:** verified — `git stash` of the 2 source files → T-8 fails (`BaseBottomSheet import` assertion); `git stash pop` → PASS. Anchor `51d85bb705`.
- **Related PreferencesSheet source tests still green:** `orch-0943-prefs-apply-coord-coherence` (apply logic preserved), `orch-0945-dead-end-render`, `orch-0945-banner-adversarial` → all PASS.

---

## Cross-surface impact (Step 3.5)

Affected: **Consumer iOS + Consumer Android** only (`app-mobile/` shared code path — parity automatic; gorhom `android_keyboardInputMode="adjustResize"` set). Not affected: Buyer/anon Web, Business iOS/Android, Admin, Business Web preview (none render this consumer sheet). Android not sim-verified this pass (iOS sim only); the structure + keyboard props are shared — flag for tester Android pass.

---

## Discoveries for orchestrator

1. **BaseBottomSheet latent limitation (P2, documented not fixed):** the `header` and `stickyFooter` slots wrap the `BottomSheetScrollView` in an intermediate `BottomSheetView`, which breaks gorhom content-scroll for any sheet whose body OVERFLOWS the snap height. Sheets converted with those slots work ONLY because their content fits. If a future conversion has overflowing content, it must use the direct-child pattern (header+body+footer as bare scroll children) like PreferencesSheet, OR the primitive should be upgraded to use gorhom's native sticky-header support (`BottomSheetScrollView` with a sticky first child) so the slots survive overflow. Not fixed here to honor the PreferencesSheet-only scope guard. Worth a dedicated primitive ORCH.
2. **Pinned title trade-off:** because the `header` slot can't be used, the "Your Vibe" title scrolls with the content rather than staying pinned. This matches the prior RN-Modal behaviour (it scrolled too). If design wants a pinned title later, it requires the primitive upgrade in #1.
