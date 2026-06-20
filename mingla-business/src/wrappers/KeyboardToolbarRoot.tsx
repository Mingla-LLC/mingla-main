// ORCH-1165: KeyboardToolbarRoot — web passthrough. Mirrors KeyboardRoot.tsx.
// The library react-native-keyboard-controller has NO web entry point in its
// package.json, and browsers have no on-screen keyboard accessory bar to host
// a Done button — so the toolbar renders nothing on web. Metro picks this file
// on web; native picks KeyboardToolbarRoot.native.tsx.
//
// Per SPEC_ORCH-1165 §4.1. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY — the
// library import stays out of the web bundle (same rationale as KeyboardRoot).

import React from "react";

export const KeyboardToolbarRoot: React.FC = () => null;
