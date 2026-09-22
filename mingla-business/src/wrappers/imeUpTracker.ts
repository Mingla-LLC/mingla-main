// #3446 V2: isImeUp — web variant. The soft keyboard is never up on web.
//
// Web has no soft keyboard the way iOS and Android do, and no hardware back
// button, so the wizard back rule that reads this never runs there
// (useWizardHardwareBack.ts is a no-op). Returning a constant false keeps the
// decision total without a platform branch at the call site.
//
// This variant imports NOTHING — no react-native, no react, and above all not
// react-native-keyboard-controller. The web-leak ratchet in
// wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx holds
// KNOWN_WEB_LEAKS at [], so any platform-agnostic file importing the library
// fails it. That is also why the listeners live in the .native.ts sibling.
//
// This is likewise the variant jest's default node/ts-jest config resolves
// (moduleFileExtensions has no "native.ts"), so suites that mount a wizard need
// no keyboard-library mock.
//
// Per SPEC #3446 V2 §4.2.

/** Web has no soft keyboard onset to observe. */
export const isImeUp = (): boolean => false;

/** Nothing to dismiss, nothing to record. */
export const noteImeDismissRequested = (): void => {};
