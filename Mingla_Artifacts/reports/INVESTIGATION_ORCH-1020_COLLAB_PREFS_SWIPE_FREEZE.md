# INVESTIGATION ORCH-1020 — Collab Deck Preferences Swipe Freeze

**Date:** 2026-05-30  
**Mode:** INVESTIGATE  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1020-[collab-deck-prefs-swipe-freeze]`  
**Branch:** `ORCH-1020-collab-deck-prefs-swipe-freeze`  
**Verdict:** **Not reproducible on current iOS build. Source stack is unusual but the reported freeze is not confirmed.**

## Executive Summary

The original root-cause hypothesis was source-plausible: the collab deck is a full-screen React Native `Modal`, and its gear opens `PreferencesSheet`, whose visible path is a `BaseBottomSheet` wrapped in a second transparent React Native `Modal`. That creates a unique native-modal stack: `CollabDeckSheet fullScreen Modal -> BaseBottomSheet transparent Modal -> GestureHandlerRootView -> gorhom BottomSheet`.

Runtime evidence did **not** confirm the freeze on current iOS. On iPhone 17 Pro Max simulator (`2C3312D9-EE52-4EBD-9704-15811D49A2EC`, iOS 26.4), I opened the real `Fly Group` collaboration chat, opened the real `CollabDeckSheet`, opened the nested preferences sheet from the deck gear, performed multiple swipe-down variants, and verified the deck remained responsive by reopening the preferences sheet afterward. The solo preferences sheet also dismissed cleanly.

Android parity is **not runtime-confirmed** in this pass. The Android emulator loaded the bundle but stayed visually on the app bootstrap (`Welcome back`) before the Friends surface became reachable. I did not claim an Android pass.

## Scope

**Affected surfaces investigated**

- Consumer iOS
- Consumer Android

**Out of scope**

- buyer-web
- business iOS / Android / web-preview
- admin-web
- marketing web

## Historical Context

- ORCH-1020 was registered because the operator-reported symptom was: in a collaboration-session group-chat deck, opening preferences and swiping down freezes the app.
- META-ORCH-0991 Wave C (`ccf848aaa`) migrated `PreferencesSheet` visible mode to `BaseBottomSheet` with `wrapInRNModal`.
- Prior META-ORCH-0991 tests and comments document real React Native Modal / gorhom / gesture risks:
  - `BaseBottomSheetRework.test.mjs` guards `GestureHandlerRootView` inside wrapped modal windows.
  - `WaveCBatch2.test.mjs` documents that two `wrapInRNModal` sheets cannot safely co-present on iOS.
  - Several production call sites intentionally gate one modal/sheet while another is open.

## Source Trace

### 1. Collab deck owns the only full-screen RN Modal

`app-mobile/src/components/connections/CollabDeckSheet.tsx`

- Lines 50-58: local `showPrefsSheet` state opens preferences.
- Lines 61-65: deck close also forces `setShowPrefsSheet(false)`.
- Lines 72-78: deck renders `<Modal visible={visible} animationType="slide" presentationStyle="fullScreen">`.
- Lines 98-108: header gear calls `handleOpenPreferences`.
- Lines 143-149: mounts `<PreferencesSheet visible={showPrefsSheet} ... sessionId={sessionId} />` inside that full-screen modal.

This is the only `presentationStyle="fullScreen"` match in `app-mobile/src` / `app-mobile/app`.

### 2. Preferences visible path uses a wrapped gorhom sheet

`app-mobile/src/components/PreferencesSheet.tsx`

- Lines 1457-1477: visible-prop path documents the META-ORCH-0991 migration to shared `BaseBottomSheet`.
- Lines 1481-1498: renders `<BaseBottomSheet visible={!!visible} onClose={() => onClose?.()} snapPoints={['90%']} scrollMode="scroll" wrapInRNModal ...>`.
- Lines 1503-1508: header/body/footer are direct scroll children.

### 3. BaseBottomSheet wrap path creates the nested native window

`app-mobile/src/components/ui/BaseBottomSheet.tsx`

- Lines 314-320: visible changes call `snapToIndex` or `close()`.
- Lines 333-339: gorhom `onChange(-1)` calls `onClose()`.
- Lines 586-605: `BottomSheet` has `index={visible ? initialIndex : -1}` and `enablePanDownToClose`.
- Lines 608-635: `wrapInRNModal` returns `<RNModal transparent animationType="none" statusBarTranslucent>` wrapping `{sheet}` in a `GestureHandlerRootView`.

The control flow on pan-down is:

1. User drags gorhom sheet down.
2. gorhom emits `onChange(-1)`.
3. `BaseBottomSheet.handleSheetChange(-1)` calls `onClose`.
4. `PreferencesSheet.onClose` delegates to the parent.
5. `CollabDeckSheet` runs `setShowPrefsSheet(false)`.
6. `BaseBottomSheet` receives `visible=false`, calls `sheetRef.current?.close()`, and RNModal unmounts.

This is a plausible race surface, but not a proven current bug.

## Runtime Evidence

### iOS solo control

**Environment**

- Simulator: iPhone 17 Pro Max
- UDID: `2C3312D9-EE52-4EBD-9704-15811D49A2EC`
- Bundle loaded from ORCH-1020 worktree Metro.

**Steps**

1. Started from Home Explore.
2. Opened the solo preferences sheet using the top-left preferences control.
3. Swiped down from the sheet handle region.
4. Verified the app returned to Explore and remained renderable.

**Evidence**

- Open sheet screenshot: `/tmp/orch1020_forensics_ios_solo_open.png`
- After swipe screenshot: `/tmp/orch1020_forensics_ios_tap_probe_current.png`

**Result**

PASS / control: the solo preferences sheet did not freeze.

### iOS collab deck repro attempt

**Environment**

- Simulator: iPhone 17 Pro Max
- UDID: `2C3312D9-EE52-4EBD-9704-15811D49A2EC`
- Real collab state: `Fly Group`, 3 members, collab session.

**Steps**

1. Opened Friends.
2. Opened `Fly Group`.
3. Tapped the `Swipe` row to open the real `CollabDeckSheet`.
4. Confirmed deck header displayed `Fly Group` with the gear.
5. Tapped the gear to open collab preferences.
6. Confirmed preferences sheet displayed `Fly Group Vibes`.
7. Performed swipe-down variants:
   - handle-area swipe `50%,9% -> 50%,90%`, 400ms
   - handle/content swipe `50%,12% -> 50%,92%`, 700ms
   - content-area swipe `50%,28% -> 50%,92%`, 700ms
8. Verified the sheet dismissed and the deck remained responsive.
9. Reopened the preferences sheet from the gear after dismissal.

**Evidence**

- Friends list with collab chats: `/tmp/orch1020_forensics_ios_010_friends4.png`
- Real `Fly Group` chat: `/tmp/orch1020_forensics_ios_011_fly_chat.png`
- Collab deck open: `/tmp/orch1020_forensics_ios_013_fly_deck.png`
- Collab prefs open: `/tmp/orch1020_forensics_ios_014_fly_prefs_open.png`
- First swipe video: `/tmp/orch1020_forensics_ios_fly_swipe.mp4`
- After repeated swipe-down: `/tmp/orch1020_forensics_ios_016_fly_after_swipe2.png`
- Reopened prefs after dismissal: `/tmp/orch1020_forensics_ios_019_reopen_gear_probe.png`

**Result**

NOT REPRODUCED. The sheet dismissed and the app did not freeze. The deck remained interactive enough to reopen the preferences sheet.

### Android parity attempt

**Environment**

- Device: Android emulator `emulator-5554`
- App: `com.mingla.app.v2`
- Bundle: loaded from Metro serving app-mobile code whose relevant files are identical between ORCH-1020 worktree and anchor checkout:
  - `CollabDeckSheet.tsx`
  - `PreferencesSheet.tsx`
  - `BaseBottomSheet.tsx`
  - `MessageInterface.tsx`
  - `app/index.tsx`

**What happened**

1. The ORCH-1020 worktree Metro URL hit a dev-client resolver mismatch because the installed Android dev build requested anchor-root paths.
2. I switched Metro to the anchor checkout after confirming the relevant ORCH-1020 files are byte-identical.
3. Android bundled successfully.
4. The app stayed visually on `Welcome back` bootstrap and did not reach Friends before this report. Metro did log `HomePage: 1` and `sessionCount: 0`, so Android was past raw bundle load but not usable for the target collab-session journey.

**Evidence**

- Dev-client connection error: `/tmp/orch1020_forensics_android_003_8156_loaded.png`
- Android bundle in progress: `/tmp/orch1020_forensics_android_005_anchor_loaded.png`
- Android app bootstrap after bundle: `/tmp/orch1020_forensics_android_008_after_wait.png`
- Android app bootstrap after Metro logged `HomePage`: `/tmp/orch1020_forensics_android_009_after_log_home.png`

**Result**

NOT CONFIRMED. Android did not reach the target user journey in this pass.

## Findings

### F-1 — Reported iOS freeze is not reproducible on current build

**Classification:** not reproduced / likely already fixed or environment-specific  
**Severity if present:** S1-high, because an app freeze requires force-quit  
**Current confidence:** iOS current-build freeze is not confirmed

**Evidence**

- Real collab path reached: `Fly Group -> Swipe -> CollabDeckSheet -> gear -> Fly Group Vibes`.
- Multiple pan-down gestures dismissed the nested preferences sheet.
- The deck remained responsive after dismissal.
- Solo preferences also dismissed cleanly.

**Root-cause status**

The nested-modal hypothesis is source-plausible but runtime-refuted for this exact iOS simulator/current build combination. Do not send implementor to remove `wrapInRNModal` or rewrite `CollabDeckSheet` based on this investigation alone.

### F-2 — The nested-modal stack is real and unique enough to deserve a regression guard if the bug returns

**Classification:** production-hardening gap  
**Severity:** S2-medium

**Evidence**

- `CollabDeckSheet` is the only full-screen RN Modal in app-mobile.
- Its preferences gear mounts `PreferencesSheet` inside that Modal.
- `PreferencesSheet` visible path always passes `wrapInRNModal`.
- `BaseBottomSheet` implements `wrapInRNModal` using a second RN Modal.

**Impact**

Even though the freeze did not reproduce, this is still an unusual stack in the app. If future reports reproduce the freeze on a specific OS/device/build, the first fix direction should be a targeted collab-only ownership change, not a broad `BaseBottomSheet` rewrite.

### F-3 — Android parity remains open

**Classification:** open question  
**Severity:** S3-medium investigation gap

Android did not reach the Friends/collab deck journey in this pass. The app loaded the bundle but remained on bootstrap. The next Android check should use a known-good logged-in Android device/session or repair the emulator bootstrap state first.

## Blast Radius

**Confirmed unique full-screen parent**

- `app-mobile/src/components/connections/CollabDeckSheet.tsx:75`

**Other `wrapInRNModal` call sites**

Many sheets use `wrapInRNModal`, but grep found no other `presentationStyle="fullScreen"` RN Modal parent in `app-mobile/src` / `app-mobile/app`. The full-screen-parent nesting that motivated ORCH-1020 is therefore collab-deck-specific.

**Related but different risk**

The known META-ORCH-0991 two-`wrapInRNModal` co-presentation issue is not the same stack. That issue is RN Modal -> RN Modal for two wrapped sheets. ORCH-1020's suspected stack is full-screen RN Modal -> wrapped BaseBottomSheet RN Modal.

## Invariant Impact

No invariant violation is confirmed.

Preserve these existing constraints if ORCH-1020 later moves to SPEC:

- Do not introduce `BottomSheetModalProvider` / portal architecture without an explicit invariant review.
- Do not broadly remove `wrapInRNModal`; many sheets rely on it to z-stack over the custom tab/chat UI.
- Do not weaken the `GestureHandlerRootView` inside wrapped modal windows; it is guarding Android gesture registration.

## Recommended Next Phase

Do **not** dispatch implementation from this report.

Recommended routing:

1. Move ORCH-1020 to **WATCH / NOT REPRODUCED** unless Seth can still reproduce on a specific device/build.
2. If Seth can reproduce manually, capture:
   - platform and OS version,
   - exact chat/session,
   - whether the sheet is at scroll top,
   - whether the gesture begins on the handle or content,
   - whether a second sheet/paywall/picker is open,
   - screen recording.
3. Only then dispatch SPEC. The likely spec would be narrow: add a collab-only presentation escape hatch or gate the inner preferences sheet differently while preserving BaseBottomSheet invariants.

## Confidence

**High** for source topology and iOS not-reproduced on current simulator.  
**Medium** for “already fixed” because the original report may have depended on a different build/device/session state.  
**Low** for Android behavior because the journey was not reached.
