// ORCH-0892-B v2: SmartScrollView — native variant. Re-exports the library's
// KeyboardAwareScrollView as 'ScrollView' so consumers can use a single
// import name across platforms. The library implementation tracks the
// focused TextInput via useReanimatedFocusedInput and worklet-scrolls this
// ScrollView so the focused field sits exactly bottomOffset (DEFAULT_BOTTOM_OFFSET
// below; consumers may override) above the keyboard. Chrome rendered as
// siblings of this ScrollView is unaffected (KAS only scrolls its own
// children).
//
// Per SPEC_ORCH-0892-B_v2 §7.A + library source
// node_modules/react-native-keyboard-controller/src/components/KeyboardAwareScrollView/index.tsx:101-300.
// Invariants: I-PROPOSED-KEYBOARD-LIBRARY-ONLY + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY.

import React, { forwardRef } from "react";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import { Platform } from "react-native";
import type { ScrollView as RNScrollView } from "react-native";

// #1890 [keyboard-clearance-overshoot] — the Done-bar terms moved to the shared
// occluder budget so all FOUR keyboard-compensating mechanisms read one source
// instead of four. The derivation is unchanged, so DEFAULT_BOTTOM_OFFSET below
// is byte-identical on every branch. Imported by EXPLICIT `.native` path: this
// module is itself native-only, and the default jest config resolves no
// platform extensions, so a bare "./keyboardClearance" would silently load the
// WEB variant (DONE_BAR_OCCUPIED = 0) inside #1834's suites.
import {
  DONE_BAR_OCCUPIED,
  MIN_VISIBLE_CLEARANCE,
} from "./keyboardClearance.native";

// Re-exported so this module's public surface is unchanged. #1834's two suites
// read these names off THIS module and must keep passing untouched.
export {
  KEYBOARD_TOOLBAR_HEIGHT,
  KEYBOARD_HAS_ROUNDED_CORNERS,
  OPENED_OFFSET,
  DONE_BAR_OCCUPIED,
  MIN_VISIBLE_CLEARANCE,
  DONE_BAR_PRESENT_IN_RAW_MODAL,
} from "./keyboardClearance.native";

export type ScrollViewProps = KeyboardAwareScrollViewProps;

// ===========================================================================
// #1834 [keyboard-blocks-bank-field] — the clearance budget, DERIVED.
//
// ORCH-1165 shipped a flat `DEFAULT_BOTTOM_OFFSET = 54`, documented as
// "12 (clearance) + 42 (KEYBOARD_TOOLBAR_HEIGHT)". #1834 measured it on glass
// and both halves of that sum were wrong on a real device:
//
//   1. The Done bar does not occupy 42pt on modern iOS — it occupies 53, and
//      that term now lives in `keyboardClearance.native.ts` with the library
//      rule it is derived from. Measured on an iPhone SE3 / iOS 26.5:
//      keyboard top 432, Done pill top 379 = keyboardTop - 53.
//
//   2. KeyboardAwareScrollView aligns the CARET LINE, not the input frame and
//      not the `Input` primitive's bordered box — see the CARET_LINE_TO_FIELD_BOTTOM
//      block below, which #1890 corrected.
//
//   Net on iOS 26+ under the old constant: 54 - 53 - 13.5 = -12.5pt, i.e. the
//   field a Nigerian business is typing into sat BEHIND the Done bar.
//
// The three terms are kept separate on purpose: a reader can see bar height +
// caret residual + visible clearance and check the arithmetic.
// ===========================================================================

/**
 * Distance from the library's scroll target down to the field's visible bottom
 * border.
 *
 * #1890 CORRECTION — this constant was named `INPUT_CHROME_BELOW_TEXT_FRAME`
 * and documented as "the `Input` primitive's chrome below its text frame".
 * That explanation was wrong, and wrong in a way that would misdirect the next
 * edit: it implies the term is a property of the `Input` COMPONENT, which
 * invites making it conditional on which primitive rendered — the wrong
 * conditional. The library does not target the input's frame at all.
 *
 * From the library's own source, `KeyboardAwareScrollView/index.tsx`:
 *
 *   // updateLayoutFromSelection
 *   height: clamp(customHeight, 0, input.value.layout.height)
 *   //   where customHeight = lastSelection.value?.selection.end.y
 *
 *   // maybeScroll
 *   const point = absoluteY + inputHeight;   // <- the CARET LINE's bottom
 *   if (visibleRect - point <= bottomOffset) { ... }
 *
 * It aligns the bottom of the CARET's line box — its own prop doc says "the
 * distance between the keyboard and the caret". So the real term is:
 *
 *   residual = fieldHeight - caretLineBottomWithinField
 *
 * which produces 13.5 for the app's `Input` BY CONSTRUCTION, not by luck:
 * `Input` is `height: 48` with `alignItems: "center"` (Input.tsx:406,750) and a
 * body line box of ~21pt, so the caret line ends at (48 + 21) / 2 = 34.5 and
 * the residual is 48 - 34.5 = 13.5.
 *
 * Because it is a function of FIELD HEIGHT and LINE METRICS rather than of the
 * component, its error on other field shapes is small and predominantly an
 * UNDERSHOOT — the opposite direction from #1890's reported overshoot. Measured
 * at #1890 INVESTIGATE on `BrandEditView`'s multiline TextArea (deliberately not
 * the `Input` primitive): true residual 14.0 against the 13.5 applied, i.e.
 * 0.5pt of undershoot, on a field this constant was never tuned for.
 *
 * Making it DYNAMIC is available and deliberately rejected:
 * `useReanimatedFocusedInput()` + `useFocusedInputHandler({onSelectionChange})`
 * are public, so the wrapper COULD compute the residual live — but
 * `bottomOffset` feeds `useEffect(() => runOnUI(maybeScroll)(...), [bottomOffset])`,
 * so the field would re-scroll on every caret move between lines. Trading a
 * measured <=0.5pt error for visible jitter on every multiline field is a bad
 * trade.
 *
 * `default` is 0 because this module is the `.native` variant — only iOS and
 * Android ever load it — and fabricating an unmeasured correction for a
 * platform we have not measured would be inventing data (Constitution rule 9).
 *
 * VALUES UNCHANGED by #1890: 13.5 / 3.16 / 0, exactly as #1834 measured them.
 */
export const CARET_LINE_TO_FIELD_BOTTOM = Platform.select({
  ios: 13.5,
  android: 3.16,
  default: 0,
});

/**
 * @deprecated #1890 renamed this to `CARET_LINE_TO_FIELD_BOTTOM` — the library
 * aligns the caret line, not the input's text frame. Kept as an alias (same
 * value, never a second number) because #1834's two suites and ORCH-1165's
 * clearance test import this name, and both are append-only.
 */
export const INPUT_CHROME_BELOW_TEXT_FRAME = CARET_LINE_TO_FIELD_BOTTOM;

/**
 * bar height + caret residual + visible clearance.
 *
 *   iOS 26+   53   + 13.5 + 12 = 78.5
 *   iOS < 26  42   + 13.5 + 12 = 67.5
 *   Android   42   + 3.16 + 12 = 57.16
 *
 * Consumers may still override per-instance, but no call site in
 * `mingla-business` does — the budget is one app-wide fact with one owner.
 * I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE requires this to stay >= 42; every
 * branch above clears that by construction, since DONE_BAR_OCCUPIED alone is
 * already >= 42.
 *
 * #1890 did NOT change any of these three numbers. SmartScrollView measured
 * 11.5pt against its 12pt contract on an iPhone SE3 — on contract, and not the
 * mechanism that was overshooting.
 */
export const DEFAULT_BOTTOM_OFFSET =
  DONE_BAR_OCCUPIED + CARET_LINE_TO_FIELD_BOTTOM + MIN_VISIBLE_CLEARANCE;

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(
  function SmartScrollView({ bottomOffset = DEFAULT_BOTTOM_OFFSET, ...rest }, ref) {
    return (
      <KeyboardAwareScrollView ref={ref} bottomOffset={bottomOffset} {...rest} />
    );
  },
);
