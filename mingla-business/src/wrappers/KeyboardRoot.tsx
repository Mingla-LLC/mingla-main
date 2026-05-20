// ORCH-0892-A: KeyboardRoot — web passthrough. Mirrors the
// StripeProviderWrapper.tsx precedent at src/payments/. The library
// react-native-keyboard-controller has NO web entry point in its
// package.json — mounting the native provider on web would at minimum
// log "module not found" under Metro and at worst throw on native
// module resolution. Metro picks this file on web; native picks
// KeyboardRoot.native.tsx. Browsers handle keyboard avoidance via
// viewport behavior — no library needed.
//
// Per SPEC_ORCH-0892-A §7.1. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY
// (DRAFT — flips ACTIVE on ORCH-0892-C close).

import React from "react";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
