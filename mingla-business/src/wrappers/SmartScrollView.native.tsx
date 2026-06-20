// ORCH-0892-B v2: SmartScrollView — native variant. Re-exports the library's
// KeyboardAwareScrollView as 'ScrollView' so consumers can use a single
// import name across platforms. The library implementation tracks the
// focused TextInput via useReanimatedFocusedInput and worklet-scrolls this
// ScrollView so the focused field sits exactly bottomOffset (12pt default
// here; consumers may override) above the keyboard. Chrome rendered as
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
import type { ScrollView as RNScrollView } from "react-native";

export type ScrollViewProps = KeyboardAwareScrollViewProps;

// ORCH-1165: 54 = 12 (clearance) + 42 (KEYBOARD_TOOLBAR_HEIGHT). The app-wide
// Done bar adds 42pt of height on top of the keyboard, so the auto-scroll must
// land the focused field 42pt higher to keep 12pt of visible clearance ABOVE
// the toolbar — otherwise the bar occludes the field (the exact regression Seth
// flagged). The library does not publicly export KEYBOARD_TOOLBAR_HEIGHT from
// its index, so the literal is used. Consumers may still override per-instance.
// Exported for the §9 fails-on-revert clearance test
// (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE: MUST stay >= 42).
export const DEFAULT_BOTTOM_OFFSET = 54; // was 12

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(
  function SmartScrollView({ bottomOffset = DEFAULT_BOTTOM_OFFSET, ...rest }, ref) {
    return (
      <KeyboardAwareScrollView ref={ref} bottomOffset={bottomOffset} {...rest} />
    );
  },
);
