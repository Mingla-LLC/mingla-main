// #4430 item 6: SmartScrollView — web variant. react-native's ScrollView, so the
// web bundle loads no native keyboard library (mirrors the Host wrapper).
// #4508 R2: it takes (and ignores) the native variant's `bottomOffset`, so a
// screen can pass one prop set on every platform.
import React, { forwardRef } from 'react';
import { ScrollView as RNScrollView, type ScrollViewProps as RNScrollViewProps } from 'react-native';

export type ScrollViewProps = RNScrollViewProps & { bottomOffset?: number };

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(function ScrollView(
  { bottomOffset: _keyboardOnly, ...rest },
  ref,
) {
  return <RNScrollView ref={ref} {...rest} />;
});
