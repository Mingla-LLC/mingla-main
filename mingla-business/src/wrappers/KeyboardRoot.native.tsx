// ORCH-0892-A: KeyboardRoot — native variant. Wraps app in
// <KeyboardProvider> from react-native-keyboard-controller so every
// downstream <KeyboardAvoidingView> / <KeyboardAwareScrollView> /
// <KeyboardStickyView> primitive can subscribe to the native keyboard
// frame events at 60fps. Mirrors StripeProviderWrapper.native.tsx
// precedent. Metro picks this file on iOS + Android.
//
// Per SPEC_ORCH-0892-A §7.2. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

import React from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <KeyboardProvider>{children}</KeyboardProvider>;
