// ORCH-0892-B v2: useKeyboardIsVisible — native variant. Delegates to the
// library's useKeyboardState hook, returning the isVisible boolean.
//
// Mirrors the SmartScrollView wrapper indirection: consumers import from
// THIS wrapper, not the library directly, so Metro keeps the library out
// of the web bundle.
//
// Per SPEC_ORCH-0892-B_v2 §6.2. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

import { useKeyboardState } from "react-native-keyboard-controller";

export function useKeyboardIsVisible(): boolean {
  return useKeyboardState().isVisible;
}
