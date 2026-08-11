// #1841 [keyboard-guard-blind-spots]: useKeyboardHeight — native variant.
// Delegates to react-native-keyboard-controller, returning the keyboard's
// height in dp (0 while closed).
//
// WHY THIS EXISTS. orch-0892 pattern 1 forbids bespoke
// `Keyboard.addListener("keyboard(Will|Did)(Show|Hide)")` layout plumbing, and
// the gate's own fix message names the replacement: "use
// useReanimatedKeyboardAnimation or useKeyboardHandler from
// react-native-keyboard-controller for layout-affecting reads". A screen that
// lifts a sticky composer needs the keyboard's HEIGHT, which
// `useKeyboardIsVisible` (a boolean) cannot supply — so before #1841 the only
// way to get it was the forbidden listener. This wrapper closes that gap and
// mirrors useKeyboardIsVisible's indirection exactly.
//
// WHY `useGenericKeyboardHandler` AND NOT `useKeyboardHandler`. They are the
// same hook except that `useKeyboardHandler` also calls `useResizeMode()`,
// which sets Android's soft-input mode to SOFT_INPUT_ADJUST_RESIZE on mount and
// restores the default on unmount. Consumers of THIS hook compensate for the
// keyboard themselves using the height it returns; if the window also resized
// underneath them they would double-compensate. `useGenericKeyboardHandler` is
// the library's documented alternative "that doesn't set resize mode on mount",
// so mounting this hook changes no window behaviour — exactly like the raw
// listener it replaces.
//
// WHY `onStart` AND NOT `useKeyboardState`. `onStart` fires when the keyboard
// BEGINS moving, carrying the target height — the frame-timing equivalent of
// iOS's `keyboardWillShow`, which is what the replaced listeners used.
// `useKeyboardState` re-renders on `keyboardDidShow`/`keyboardDidHide` only, so
// a composer driven by it would lift a full animation late.
//
// Requires a <KeyboardProvider> above it in the same native window; the app
// mounts one at the root via src/wrappers/KeyboardRoot.native.tsx.
//
// Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

import { useCallback, useState } from "react";
import { useGenericKeyboardHandler } from "react-native-keyboard-controller";
import { runOnJS } from "react-native-reanimated";

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState<number>(0);

  // Stable JS-thread callback for the worklet to hop back through. Declared
  // separately (rather than passing setHeight to runOnJS directly) so the
  // worklet captures one identity for the life of the component.
  const applyHeight = useCallback((next: number): void => {
    setHeight(next);
  }, []);

  useGenericKeyboardHandler(
    {
      onStart: (e) => {
        "worklet";
        runOnJS(applyHeight)(e.height);
      },
    },
    [applyHeight],
  );

  return height;
}
