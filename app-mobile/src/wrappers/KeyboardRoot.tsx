// ORCH-1171: KeyboardRoot — web passthrough. react-native-keyboard-controller
// has no web entry point; browsers handle keyboard avoidance natively.

import React from "react";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
