// #4430 item 6: SmartScrollView — native variant. The library's KeyboardAwareScrollView
// follows the focused field on the native side (no JS timers, no stale scroll offset),
// so program forms stop jumping while the person types. Re-exported as `ScrollView`
// so a screen uses one import name on every platform.
//
// bottomOffset keeps the focused field clear of the Done bar: the same
// clearance + toolbar height the rest of the app budgets (keyboardConstants.ts).
import React, { forwardRef } from 'react';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewProps } from 'react-native-keyboard-controller';
import type { ScrollView as RNScrollView } from 'react-native';
import { KEYBOARD_SCROLL_BOTTOM_OFFSET } from './keyboardConstants';

export type ScrollViewProps = KeyboardAwareScrollViewProps;

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(
  function SmartScrollView({ bottomOffset = KEYBOARD_SCROLL_BOTTOM_OFFSET, ...rest }, ref) {
    return <KeyboardAwareScrollView ref={ref} bottomOffset={bottomOffset} {...rest} />;
  },
);
