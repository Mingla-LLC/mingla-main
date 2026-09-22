// #3446 V2: is the soft keyboard up RIGHT NOW, answered synchronously at the
// instant a hardware back press reaches JS. Native variant (Metro resolves it
// on iOS and Android); the web and jest variant is imeUpTracker.ts.
//
// Why this exists, and why it is not a hook.
//
// The wizard back rule has to decide, inside a BackHandler callback, whether
// the IME is on screen. Every source the repo had was too late:
//
//   useKeyboardIsVisible() -> useKeyboardState().isVisible
//       React state set from a keyboardDidHide listener. Two serial lags: the
//       library emits keyboardDidHide from the IME inset animation's onEnd
//       (+522 ms measured on emulator-5564), and React still has to commit.
//       Measured 0.5-1.4 s behind the press that caused the hide.
//   KeyboardController.isVisible()
//       !isClosed, a module-scope boolean the library flips only on
//       keyboardDidHide / keyboardDidShow. No React commit, but still the
//       +522 ms didHide edge.
//
// keyboardWillShow / keyboardWillHide are emitted from KeyboardAnimationCallback
// .onStart — the FIRST native callback of the inset animation. Measured +124 ms
// after the back press on emulator-5564, against +522 ms for didHide. Nothing
// earlier is subscribable on this stack.
//
// Binding properties (SPEC #3446 V2 §4.2):
//   1. Module scope, not React state and not a ref. It must be readable from a
//      BackHandler callback with zero React involvement, and must not miss
//      events while the wizard is blurred.
//   2. Both will* and did*. will* buys the 124 ms; did* is the corroboration
//      and the recovery path if a will* is ever dropped.
//   3. isImeUp() must NEVER be called during render — only from a press
//      callback. It is a mutable module value and reading it in render tears.
//
// Invariant: I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK (docs/INVARIANT_REGISTRY.md)
// and I-PROPOSED-3446-B-IME-DECISIONS-READ-ONSET-NOT-COMMIT.

import { KeyboardController, KeyboardEvents } from "react-native-keyboard-controller";

// Seed from the library's own latch so a listener registered after the keyboard
// is already up still starts from the truth.
let imeUp = KeyboardController.isVisible();

KeyboardEvents.addListener("keyboardWillShow", () => {
  imeUp = true;
});
KeyboardEvents.addListener("keyboardDidShow", () => {
  imeUp = true;
});
KeyboardEvents.addListener("keyboardWillHide", () => {
  imeUp = false;
});
KeyboardEvents.addListener("keyboardDidHide", () => {
  imeUp = false;
});

/** The soft keyboard is up, or has not yet begun hiding, as of this instant. */
export const isImeUp = (): boolean => imeUp;

/**
 * We just asked the IME to hide; stop reporting it up from this instant.
 *
 * Optimistic on purpose. Called at the same instant as Keyboard.dismiss(), so
 * the very next press acts even 40 ms later rather than waiting on any event.
 *
 * The accepted cost, unchanged from the model this replaces: if the dismissal
 * does not take, the next press steps back with the keyboard still up. That is
 * ONE step, not a dead tap, and it self-heals — the step unmounts the focused
 * input, the IME hides, and the next keyboardWillHide corroborates the flag.
 */
export const noteImeDismissRequested = (): void => {
  imeUp = false;
};
