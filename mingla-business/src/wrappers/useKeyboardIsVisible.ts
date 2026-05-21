// ORCH-0892-B v2: useKeyboardIsVisible — web variant. Returns false always.
//
// Web has no soft keyboard show/hide event that requires UI to translate
// or hide. Hardware keyboards on web are always present; dock-hide UX
// on Cycle 3 wizard root pattern was iOS/Android-only. Returning a
// constant false here keeps the bundle small (zero library imports)
// and matches pre-ORCH-0892 web behavior (no dock-hide on web).
//
// Per SPEC_ORCH-0892-B_v2 §6.1. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

export function useKeyboardIsVisible(): boolean {
  return false;
}
