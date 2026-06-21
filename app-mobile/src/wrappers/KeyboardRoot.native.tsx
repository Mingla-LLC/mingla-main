// ORCH-1171: KeyboardRoot — native variant. Wraps the app (or a per-Modal
// window) in KeyboardProvider so KeyboardToolbar + KeyboardAwareScrollView
// receive native keyboard frame events.

import React from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <KeyboardProvider>{children}</KeyboardProvider>;
