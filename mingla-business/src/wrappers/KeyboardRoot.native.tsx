// ORCH-0892-A: KeyboardRoot — native variant. Wraps app in
// <KeyboardProvider> from react-native-keyboard-controller so every
// downstream <KeyboardAvoidingView> / <KeyboardAwareScrollView> /
// <KeyboardStickyView> primitive can subscribe to the native keyboard
// frame events at 60fps. Mirrors StripeProviderWrapper.native.tsx
// precedent. Metro picks this file on iOS + Android.
//
// Per SPEC_ORCH-0892-A §7.2. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.
//
// #4420 / #4238 — ONE provider per app on Android. Sheet.tsx / Modal.tsx
// (ORCH-1170) mount a second KeyboardRoot inside their RN Modal window. On
// Android every mounted provider owns a native ModalAttachedWatcher, and each
// watcher answers a Modal's `topShow` by suspending ITS OWN main-window
// keyboard callback and then calling `dialog.setOnDismissListener(...)` to
// un-suspend it on close. A Dialog keeps only ONE dismiss listener, so the
// nested provider's watcher (which runs second) overwrites the root's: on
// close only the nested callback is resumed and the app-root callback stays
// suspended for the rest of the session. Every full-screen form then gets no
// keyboardWillShow / onMove events and the keyboard covers its fields
// (library 1.18.5 through 1.23.1, ModalAttachedWatcher.kt).
//
// The root provider's own watcher already forwards a Modal window's keyboard
// frames to the root context (it attaches a callback to the dialog's decor
// view), and React context flows through RN <Modal>, so on Android a nested
// KeyboardRoot is a passthrough and sheets read the root provider. iOS has no
// watcher and keeps the per-window provider ORCH-1170 shipped.

import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

const InsideKeyboardRoot = createContext(false);

/**
 * True when a nested KeyboardRoot must NOT mount a second native provider.
 * Exported for the regression test (#4420).
 */
export const skipsNestedProvider = (
  os: typeof Platform.OS,
  nested: boolean,
): boolean => nested && os === "android";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const nested = useContext(InsideKeyboardRoot);
  if (skipsNestedProvider(Platform.OS, nested)) return <>{children}</>;
  return (
    <InsideKeyboardRoot.Provider value>
      <KeyboardProvider>{children}</KeyboardProvider>
    </InsideKeyboardRoot.Provider>
  );
};
