# INVESTIGATION — ORCH-0892-B v2 [Global focused-input shifter — feasibility + architecture]

**Author:** Claude `mingla-forensics` (INVESTIGATE mode, re-investigation after operator rejected v1 per-screen approach).
**Date:** 2026-05-20.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Triggered by:** Operator rejection of `SPEC_ORCH-0892-B_KEYBOARD_AVOIDANCE_SWEEP.md` v1 with quote: "this will not work. It is unreliable and there are so many places you are missing out. The best way to fix this is that if a screen is scrolled to the end, and the input field (Total height encompassing top to bottom) fully or partially bleeds into the height of the keyboard. It should shift up such that the field is above the keyboard."

---

## §1 What the operator actually wants — restated precisely

ONE app-wide mechanism that, when ANY TextInput is focused AND the keyboard is showing, ensures the field's bottom edge sits just above the keyboard's top edge. Chrome (TopBar, BottomNav/dock, status bar area) stays put — only "screen content" shifts. For Sheets: expand the sheet's height + shift the content within so the focused field clears the keyboard.

Key requirements derived from the quote:
1. **Universal coverage.** "So many places you are missing out" — no per-screen wraps, no judgment calls about which screen to migrate. The mechanism must apply automatically to every TextInput anywhere in the app, including future screens.
2. **Just enough shift.** "Total height encompassing top to bottom… fully or partially bleeds into the height of the keyboard. It should shift up such that the field is above the keyboard." Compute overlap precisely; translate by exactly that overlap, no more.
3. **Chrome stays.** "Just the entire screen without touching the top bar, footer, etc." Only the content area shifts.
4. **Sheets: expand + shift content within.** Don't translate the whole sheet panel (current pattern); instead expand the body and scroll within.

---

## §2 Library capability inventory (`react-native-keyboard-controller@1.18.5`)

Inspected `node_modules/react-native-keyboard-controller/lib/typescript/` exhaustively. The library v1.18.5 (pinned to Expo SDK 54) exposes:

### Hooks (callable from any React component)
- `useResizeMode()` — Android-only; sets `windowSoftInputMode=adjustResize` on mount, restores on unmount. Globally enables system-driven content-push on Android.
- `useKeyboardAnimation()` / `useReanimatedKeyboardAnimation()` — returns `{ height, progress }` as Animated/Reanimated shared values. Worklet-readable. Frame-perfect.
- `useKeyboardHandler({ onStart, onMove, onEnd, onInteractive })` — worklet handlers for keyboard frame events.
- `useGenericKeyboardHandler(...)` — same as `useKeyboardHandler` but doesn't touch Android resize mode.
- `useKeyboardController()` — `{ setEnabled, enabled }` toggle.
- **`useReanimatedFocusedInput()` — KEY: returns `{ input: SharedValue<FocusedInputLayoutChangedEvent | null> }`.** Worklet-readable focused input state including `layout.absoluteX`, `layout.absoluteY`, `layout.width`, `layout.height` (screen-absolute), and `parentScrollViewTarget` (native tag of the focused input's parent ScrollView).
- `useFocusedInputHandler({ onChangeText, onSelectionChange })` — worklet handlers for input events.
- `useKeyboardState()` — JS-side `{ isVisible, height, ... }` snapshot.

### Components
- `<KeyboardProvider>` — root-level. Must wrap the app for any of the above hooks to receive events. (Already mounted in `app/_layout.tsx` per ORCH-0892-A.)
- `<KeyboardAvoidingView>` — drop-in for RN's KAV with native frame-perfect animation. Per-screen wrap.
- `<KeyboardAwareScrollView>` — drop-in for RN's ScrollView. Per-ScrollView wrap. **Internally uses `useReanimatedFocusedInput` + `useReanimatedKeyboardAnimation` + worklet `scrollTo` to auto-scroll the focused input into the visible area above the keyboard.** Production-tested. See `node_modules/react-native-keyboard-controller/src/components/KeyboardAwareScrollView/index.tsx:101-300`.
- `<KeyboardStickyView>` — pins a view above the keyboard.
- `<KeyboardToolbar>` — iOS-style accessory bar.
- `<OverKeyboardView>` / `<KeyboardExtender>` — overlay content above the keyboard.

### Imperative module (`KeyboardController`)
- `setDefaultMode()`, `setInputMode()` (Android `windowSoftInputMode` control)
- `preload()` (iOS — pre-warm keyboard)
- `dismiss({ keepFocus })`
- `setFocusTo("next" | "prev" | "current")`
- `isVisible()`, `state()`

### **Critical absence**
The library does NOT expose `KeyboardController.scrollFocusedInputToVisibleArea()` or `scrollViewByTag(tag, y, animated)`. There is NO imperative "scroll an arbitrary UIScrollView by native tag" API. All scroll-to-focused behavior is bundled inside `<KeyboardAwareScrollView>`, which scrolls only its own ScrollView via `useAnimatedRef` + Reanimated `scrollTo(animatedRef, x, y)`.

**Consequence:** A truly zero-touch global shifter that scrolls the focused input's parent ScrollView from a root-mounted worklet is NOT buildable on top of v1.18.5 without writing a custom native module to bridge "scroll by tag." That's substantial extra work (Objective-C/Swift + Kotlin/Java + Codegen specs + parity with the library's keyboard event subscription).

---

## §3 What "global" actually means under the library's architecture

Three platform realities constrain the design:

### §3.A Android — already global via system
`windowSoftInputMode=adjustResize` (Expo default) causes the Android system to RESIZE the window when the keyboard appears — content above the keyboard is pushed up by the system. ScrollViews automatically reflow. This is GENUINELY global, zero per-screen code. The library's `useResizeMode` ensures this mode is set even if a screen overrode it.

### §3.B iOS — NO system-wide content shift mechanism exists
iOS has `automaticallyAdjustKeyboardInsets` on UIScrollView (iOS 14+) which is per-ScrollView and unreliable in nested layouts (this is the original bug class). iOS has NO window-level "resize on keyboard show" equivalent to Android's `adjustResize`. The OS-level keyboard event lets each view decide how to react.

→ On iOS, "global shifter" inherently requires SOME per-view integration. Either: (a) every ScrollView is replaced with KAS (per-view wrap), (b) a custom native module bridges `scrollView.scrollRectToVisible:` calls from JS by tag, or (c) the whole app root translates (chrome moves too).

### §3.C Web — no soft keyboard
Web users have hardware keyboards that don't overlap content. Wrappers on web should be no-op passthroughs (already established by ORCH-0892-A pattern).

### §3.D Architectural conclusion
"Global" achievable WITHOUT custom native module: replace every form-screen's `ScrollView` with the library's `KeyboardAwareScrollView` via a single wrapper. Mechanical, app-wide, one rule. NOT zero-touch, but ONE-touch-per-screen with no per-screen judgment. The library handles all keyboard math; the wrapper is a re-export.

"Global" achievable WITH custom native module work: bridge `scroll-by-native-tag` from a root worklet. ~1-2 weeks of native work; substantial risk. Recommended only if Option 1 proves insufficient.

---

## §4 Screen anatomy audit — chrome vs content

Read 4 representative screens. Common pattern:

```
<ScreenRoot>
  <ChromeRow>               ← top chrome (close icon + stepper + counter)
  <SubtitleRow>             ← top chrome continued
  <ScrollView>              ← SCROLLABLE CONTENT (the part that should shift)
    ... TextInputs ...
  </ScrollView>
  {!keyboardVisible && <Dock> /* bottom chrome — hidden on keyboard up */}
</ScreenRoot>
```

Evidence:
- `mingla-business/src/components/event/EventCreatorWizard.tsx:820-905` — exact pattern (chrome / subtitle / ScrollView / dock).
- `mingla-business/src/components/trip/TripCreatorWizard.tsx:1070-1188` — wraps body in KAV from RN today; otherwise same shape.
- `mingla-business/src/components/brand/BrandEditView.tsx` — pilot from ORCH-0892-A; wraps in library KAV.
- `mingla-business/app/account/edit-profile.tsx` — similar shape; uses Keyboard.addListener for dock-hide.

**Key insight:** The ScrollView IS the natural chrome/content boundary in this codebase. Chrome elements (TopAppBar, IconChrome rows, dock GlassCards) live OUTSIDE the ScrollView. If we make the ScrollView keyboard-aware (via KAS), the library scrolls within the ScrollView — chrome stays put automatically because chrome is rendered as a sibling, not a child, of the ScrollView.

**This matches the operator's vision** ("imaginary scroll that doesn't exist… without touching the top bar, footer") — KAS literally does this by adjusting the ScrollView's contentOffset, leaving the parent View's chrome siblings unchanged.

---

## §5 Sheet primitive — current pattern vs proposed rework

### §5.A Current pattern (read from `mingla-business/src/components/ui/Sheet.tsx:160-265`)
- Listens to `Keyboard.addListener` for show/hide.
- Sets `keyboardHeight` state.
- Clamps `sheetHeight = min(requestedSheetHeight, screenHeight - keyboardHeight - 40)` — shrinks the panel if keyboard would push it below.
- Sets `openY = -keyboardHeight` — translates the WHOLE PANEL up by keyboardHeight when keyboard is visible.
- Result: panel slides up as a unit; entire sheet (header + body + footer) moves above keyboard.

### §5.B Problem with current pattern
- Translating the entire panel up moves the sheet's HEADER and HANDLE BAR too — they end up higher than designed.
- The panel must be CLAMPED in height to fit, which can crop the body content.
- If multiple inputs in the sheet body have different Y positions, the panel-translate is uniform — some inputs over-shift, some still get hidden behind the keyboard.

### §5.C Proposed rework (matches operator's "expand height + shift content" vision)
- DELETE the `Keyboard.addListener` + `keyboardHeight` state + `openY = -keyboardHeight` translate.
- DELETE the height clamp.
- WRAP the Sheet's body content in `<KeyboardAwareScrollView>` from the library (with `bottomOffset={12}` for clearance).
- Result: sheet panel stays at its designed snap point; the BODY (a KAS) scrolls internally so the focused input clears the keyboard. Header + handle bar stay put. Only the body content shifts within the panel.

### §5.D Sheet rework cost
- ~50 lines of keyboard plumbing DELETED from Sheet.tsx.
- ~10 lines of KAS wrap ADDED.
- Net: simpler Sheet primitive.
- All sheet consumers (11 sheet files in §7.D of the v1 SPEC) continue to work without modification — they pass children to Sheet, Sheet wraps them in KAS automatically.

---

## §6 Architectural recommendation

### Approach — "SmartScrollView" wrapper, applied via single-rule app-wide migration

**One new wrapper:** `mingla-business/src/wrappers/SmartScrollView.{tsx,native.tsx}`.
- `.native.tsx` re-exports `KeyboardAwareScrollView` from `react-native-keyboard-controller`.
- `.tsx` (web) re-exports `ScrollView` from `react-native` (passthrough — no soft keyboard on web).

**One Sheet rewrite:** Sheet.tsx body uses `<KeyboardAwareScrollView>` internally; delete the panel-translate keyboard plumbing.

**One rule:** every screen-level `ScrollView` that contains (or might contain in the future) a TextInput is imported from `@/wrappers/SmartScrollView` instead of from `react-native`. Mechanical find-replace.

**Teardown of ORCH-0892-A wrappers:**
- DELETE `mingla-business/src/wrappers/KeyboardAvoidingView.{tsx,native.tsx}` (obsolete — KAS replaces it).
- KEEP `mingla-business/src/wrappers/KeyboardRoot.{tsx,native.tsx}` (still needed — KeyboardProvider mount is required for KAS to receive keyboard events).
- ORCH-0892-A pilots (BrandEditView, TripBrandWizard, CoverPicker) get their KAV wraps REMOVED and their ScrollView swapped to SmartScrollView.

**Teardown of 11 v1 SPEC migration targets:**
- All Template B Cycle-3 listeners (Keyboard.addListener + paddingBottom math + automaticallyAdjustKeyboardInsets) DELETED.
- Template A KAV swaps REVERSED (the library KAV is no longer used — KAS replaces it).
- Every screen's main ScrollView swapped to SmartScrollView.

### Why this satisfies the operator's vision

1. **Universal coverage.** Every form-screen uses the wrapper. New screens that import from the wrapper inherit the behavior automatically. The strict-grep gate (already shipped in ORCH-0892-A) flips to forbid bare `ScrollView` imports in form-containing screens.
2. **Just enough shift.** KAS computes overlap exactly (lines 170-194 of the library source): `visibleRect - point <= bottomOffset` triggers a `scrollTo(targetY)` that places the field exactly at `keyboardTop - bottomOffset`. No more, no less.
3. **Chrome stays.** KAS scrolls WITHIN the ScrollView; chrome rendered as siblings outside the ScrollView is unaffected. Status bar, top app bar, bottom dock — all unchanged.
4. **Sheets: expand + shift content.** Sheet rewrite uses KAS inside; sheet outer chrome (handle + header) stays; body content scrolls.

### File touch estimate

| Action | File count |
|--------|-----------|
| New wrapper `SmartScrollView.{tsx,native.tsx}` | 2 |
| Sheet.tsx rewrite | 1 |
| ORCH-0892-A wrapper teardown (`KeyboardAvoidingView.{tsx,native.tsx}` delete) | -2 |
| ORCH-0892-A pilot cleanup (BrandEditView, TripBrandWizard, CoverPicker) | 3 |
| ORCH-0892-A `_layout.tsx` — no change (KeyboardRoot stays) | 0 |
| Template A migrations (compose, templates/[id], venue/create, VenueCreatorWizard) | 4 |
| Template B migrations (7 files: TripCreatorWizard, EventCreatorWizard, EditPublishedScreen, EditPublishedTripScreen, account/delete, account/edit-profile, BusinessWelcomeScreen) | 7 |
| Sheet-embedded files (11 from v1 SPEC §7.D) — likely STAY AS-IS (Sheet rewrite handles them) | 0 |
| Strict-grep gate update (SAFELIST + new pattern banning bare `ScrollView` from RN in form files) | 1 |
| Wrapper test file extension | 1 |
| **Total file touches** | **~19** |

Compared to v1 SPEC's 11 + 1 wrapper + 1 hook pair + 1 gate = 14 files, the v2 approach is comparable in touch count but FUNDAMENTALLY SIMPLER: one rule (use SmartScrollView), no per-screen template logic, no per-screen judgment about A vs B vs C, no sheet-adjacency carve-out (Sheet primitive owns sheet behavior).

### What v2 explicitly does NOT do (vs v1)

- Does NOT use library's `KeyboardAvoidingView` (KAS replaces it).
- Does NOT introduce per-screen template logic.
- Does NOT introduce a `useKeyboardIsVisible` hook (the 6 screens that need dock-hide get it for free from `useKeyboardState().isVisible` from the library — one hook used directly without our own wrapper, since web variant returns `false` is trivial and can be a one-line inline conditional in the screens that need it. OR build the wrapper hook anyway for cleanliness).
- Does NOT touch the sheet-embedded files individually (the Sheet primitive rewrite handles them).

---

## §7 Honest tradeoffs of the recommended approach

### §7.A "Not truly zero-touch" — operator's "missing places" concern

The recommended approach IS one-touch-per-form-screen (find-replace ScrollView import). It's NOT a single-file global shifter. Reasons:

- Library v1.18.5 has no `KeyboardController.scrollViewByTag(tag, y)` imperative API. Confirmed by exhaustive read of `lib/typescript/types/module.d.ts`.
- Building a custom native module to expose `scroll-by-tag` is ~1-2 weeks of additional native work (Obj-C + Swift + Kotlin + JSI codegen) with parity-with-library risk.
- The "global" win comes from the strict-grep gate: it WILL fail CI if any new screen imports bare `ScrollView` from `react-native` in a form file (codified rule, not per-screen judgment). Future screens cannot "miss" this.

### §7.B Web bundle

The wrapper pair pattern from ORCH-0892-A v2 is reused exactly. `.tsx` (web) re-exports `ScrollView from "react-native"` — zero library import on web — preserves the TA-1 anchor (zero `react-native-keyboard-controller` strings in web bundle).

### §7.C Sheet rework risk

Sheet primitive rewrite is a high-leverage change (every sheet consumer in the app depends on it). Risks:
- Visual regression: sheet outer panel no longer slides up, only content within scrolls. This MATCHES operator's preference but is a visual delta from current behavior.
- Sheet body must be a single KAS — if a sheet consumer renders its OWN ScrollView inside (rare), they'd nest a ScrollView inside a KAS → known footgun. Mitigation: Sheet primitive provides the KAS; consumers render bare Views inside.
- Mitigated by tester smoke on every sheet consumer (11 files) at acceptance.

### §7.D Screens that don't have a ScrollView

A handful of screens fit entirely in one viewport without scrolling. They'd not benefit from KAS (KAS is a ScrollView). Mitigation: such screens with a TextInput at the bottom can either (a) wrap in KAS anyway (KAS scrolls if needed, no-ops if content fits), or (b) wrap in library's `KeyboardAvoidingView` (still allowed by I-PROPOSED-KEYBOARD-LIBRARY-ONLY allowlist via the wrapper if we keep the KAV wrapper pair). Sampling 4 representative form screens confirmed all use a ScrollView — no immediate need for a non-scroll fallback.

### §7.E Performance

KAS is worklet-driven (Reanimated 4). 60fps native animation. Same performance characteristics as ORCH-0892-A pilots already shipped and accepted. No regression.

### §7.F Migration effort vs operator's "I want this done" goal

The recommended approach is a single CODEMOD-style pass over the codebase. Total time estimate: 4-6 hours of mechanical edits + Sheet rewrite + test extension + strict-grep gate update. Plus ~2 hours of operator-driven sim smoke on the 11 migrated screens + Sheet consumers.

---

## §8 Open question for operator before SPEC write

The library imposes a real constraint: no zero-touch global shifter is possible at v1.18.5 without custom native module work. The recommended approach is "ONE-touch-per-form-screen via SmartScrollView wrapper + Sheet primitive rewrite." This satisfies the operator's vision functionally (universal, just-enough-shift, chrome-stays, sheet expand+shift) but is not literally a single root-level component.

**Three options the operator can choose from:**

- **Option V2-A (recommended) — SmartScrollView wrapper + Sheet rewrite.** ~19 file touches, one rule, library does the work. Builds on ORCH-0892-A foundations; reuses the v2 wrapper indirection pattern. EAS-OTA eligible. Estimated 1-2 days end-to-end.
- **Option V2-B — Custom native module for `KeyboardController.scrollFocusedInputBy(overlap)`.** Build a true root-mounted global shifter on top of a new native API. ~1-2 weeks of native dev work. Higher risk; needs to track library version updates. Not EAS-OTA — requires production build.
- **Option V2-C — Just translate the entire app root.** Wrap RootLayout in `<Reanimated.View>` that translates by overlap. Chrome moves too (operator explicitly rejected, but listing for completeness).

---

## §9 Confidence

**High** for §2-§5 (library capability, screen anatomy, Sheet pattern — all from direct source reads at the library version pinned in `package.json`).
**Medium** for §6 file touch estimate (depends on whether any non-form ScrollViews need conversion — unlikely but possible).
**High** for §7.A (the absence of `scrollViewByTag` API in v1.18.5 module exports is verified by reading every export in `lib/typescript/types/module.d.ts`).

---

## §10 Recommendation

Pause SPEC writing. Confirm Option V2-A with operator. Then write `SPEC_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md` superseding the v1 SPEC.
