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

export type ScrollViewProps = KeyboardAwareScrollViewProps;

// ===========================================================================
// #1834 [keyboard-blocks-bank-field] — the clearance budget, DERIVED.
//
// ORCH-1165 shipped a flat `DEFAULT_BOTTOM_OFFSET = 54`, documented as
// "12 (clearance) + 42 (KEYBOARD_TOOLBAR_HEIGHT)". #1834 measured it on glass
// and both halves of that sum were wrong on a real device:
//
//   1. The Done bar does not occupy 42pt on modern iOS. The library floats it
//      clear of the keyboard's rounded corners — see
//      react-native-keyboard-controller/…/KeyboardToolbar/constants.js:
//        KEYBOARD_TOOLBAR_HEIGHT = 42
//        KEYBOARD_HAS_ROUNDED_CORNERS = ios && Platform.Version >= 26
//        OPENED_OFFSET = KEYBOARD_HAS_ROUNDED_CORNERS ? -11 : 0
//      and KeyboardToolbar mounts the bar in a KeyboardStickyView at
//      `offset.opened = opened + OPENED_OFFSET`. On iOS 26+ the bar therefore
//      OCCUPIES 53pt (42 tall, floated 11 above the keyboard), so 54 budgeted
//      1pt of visible clearance, not 12. Measured on an iPhone SE3 / iOS 26.5:
//      keyboard top 432, Done pill top 379 = keyboardTop - 53.
//
//   2. KeyboardAwareScrollView aligns the FOCUSED TEXT FRAME, not the `Input`
//      primitive's bordered box. `maybeScroll` targets `absoluteY + height`
//      from `useReanimatedFocusedInput`, which is the inner TextInput's frame;
//      the app's `Input` renders chrome below it. Measured delta between the
//      library's reference point and the visible bottom border:
//        iOS      13.5pt  (target landed 378, border box bottom 391.5)
//        Android   3.16dp (target landed 440.93, border box bottom 444.09)
//
//   Net on iOS 26+ under the old constant: 54 - 53 - 13.5 = -12.5pt, i.e. the
//   field a Nigerian business is typing into sat BEHIND the Done bar.
//
// The library does not re-export KEYBOARD_TOOLBAR_HEIGHT from its index, which
// is why a literal lived here. The answer is to compute from the SAME inputs
// the library uses, not to pin a second magic number that rots on the next OS
// bump. The three terms below are kept separate on purpose: a reader can see
// bar height + input chrome + visible clearance and check the arithmetic.
//
// Measurement space note (#1834 AMENDMENT 3): every figure above is SCREEN
// space. On Android `measureInWindow` is window-relative and the app window
// starts 30.58dp below the screen origin, so comparing it directly against
// `keyboardDidShow`'s `endCoordinates.screenY` overstates clearance by 30.58dp.
// ===========================================================================

/** The bar's own height. Mirrors the library's KEYBOARD_TOOLBAR_HEIGHT. */
export const KEYBOARD_TOOLBAR_HEIGHT = 42;

/** The library's own rule, evaluated on the same inputs it evaluates. */
const KEYBOARD_HAS_ROUNDED_CORNERS =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

/** The library's own OPENED_OFFSET: the bar floats this far above the keyboard. */
const OPENED_OFFSET = KEYBOARD_HAS_ROUNDED_CORNERS ? -11 : 0;

/**
 * What the Done bar actually COSTS above the keyboard's top edge: its height
 * plus however far it floats. 53 on iOS 26+, 42 everywhere else — derived, so
 * an OS bump or a library change to OPENED_OFFSET moves it automatically.
 */
export const DONE_BAR_OCCUPIED = KEYBOARD_TOOLBAR_HEIGHT - OPENED_OFFSET;

/**
 * Distance from the library's scroll target (the focused TextInput's text
 * frame bottom) down to the `Input` primitive's visible bottom border. Measured
 * on glass at #1834 TEST; never inferred. `default` is 0 because this module is
 * the `.native` variant — only iOS and Android ever load it — and fabricating
 * an unmeasured correction for a platform we have not measured would be
 * inventing data (Constitution rule 9).
 */
export const INPUT_CHROME_BELOW_TEXT_FRAME = Platform.select({
  ios: 13.5,
  android: 3.16,
  default: 0,
});

/** The visible gap the wrapper contract promises ABOVE the Done bar. */
export const MIN_VISIBLE_CLEARANCE = 0;

/**
 * bar height + input chrome + visible clearance.
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
 */
export const DEFAULT_BOTTOM_OFFSET =
  DONE_BAR_OCCUPIED + INPUT_CHROME_BELOW_TEXT_FRAME + MIN_VISIBLE_CLEARANCE;

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(
  function SmartScrollView({ bottomOffset = DEFAULT_BOTTOM_OFFSET, ...rest }, ref) {
    return (
      <KeyboardAwareScrollView ref={ref} bottomOffset={bottomOffset} {...rest} />
    );
  },
);
