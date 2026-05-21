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

// 12pt clearance keeps the field comfortably above the keyboard without
// scrolling further than necessary. Consumers may override per-instance.
const DEFAULT_BOTTOM_OFFSET = 12;

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(
  function SmartScrollView({ bottomOffset = DEFAULT_BOTTOM_OFFSET, ...rest }, ref) {
    return (
      <KeyboardAwareScrollView ref={ref} bottomOffset={bottomOffset} {...rest} />
    );
  },
);
