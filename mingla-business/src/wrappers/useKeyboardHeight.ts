// #1841 [keyboard-guard-blind-spots]: useKeyboardHeight — web variant.
// Returns 0 always.
//
// Sibling of useKeyboardIsVisible, and it exists for the same reason: a
// platform-agnostic screen must never `import "react-native-keyboard-controller"`
// directly, or the library leaks into the web bundle. Consumers import from
// THIS wrapper; Metro picks the .native.ts variant on iOS/Android and keeps the
// library out of web entirely.
//
// Web has no soft keyboard that overlaps content, so there is no height to
// report and every consumer's keyboard-open branch stays dormant — matching the
// behaviour of the bespoke Keyboard.addListener pattern this replaces, whose
// listeners never fired on web either.
//
// Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

export function useKeyboardHeight(): number {
  return 0;
}
