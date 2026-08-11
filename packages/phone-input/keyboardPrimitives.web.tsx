/**
 * keyboardPrimitives — WEB build. Library-free stand-ins for the two
 * `react-native-keyboard-controller` primitives `CountryPickerModal` mounts.
 *
 * Per #1627 [keyboard-guard-vacuity].
 *
 * WHY THESE ARE INERT AND NOT MISSING. Both primitives exist to react to a
 * NATIVE soft keyboard: `KeyboardProvider` wires the native keyboard-frame
 * event stream into React, and `KeyboardToolbar` renders the Done/Prev/Next bar
 * that sits attached ON TOP OF that keyboard. A browser has neither. The
 * library's web build is already a no-op at runtime — it just costs 60,418 B
 * raw / 9,966 B brotli in `__common` to be one. These stand-ins do the same
 * nothing for free.
 *
 * The behavioural contract is not invented here: it is the shape the repo's own
 * Playwright suites already run the web bundle against —
 * `mingla-business/playwright/orch1207/keyboard-controller-stub.cjs`:
 *     KeyboardProvider: ({children}) => children ?? null,
 *     KeyboardToolbar: () => null,
 * with ONE deliberate deviation, documented on `KeyboardProvider` below.
 *
 * Invariant: I-PROPOSED-1627-NO-NATIVE-KEYBOARD-LIBRARY-IN-THE-WEB-GRAPH.
 */

import { type ReactNode, type ReactElement } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";

const styles = StyleSheet.create({
  // ===========================================================================
  // DO NOT simplify this component to `<>{children}</>`. A future reader WILL
  // want to — it looks like a pointless wrapper. It is not.
  //
  // The library's real KeyboardProvider renders
  //   <KeyboardControllerViewAnimated ... style={styles.container}>{children}</>
  // where `container: { flex: 1 }`
  // (react-native-keyboard-controller/src/animated.tsx:41-44 and 241-249).
  //
  // At CountryPickerModal.tsx:308 this element is the ONLY thing between a
  // `presentationStyle="fullScreen"` <Modal> and <SafeAreaProvider>. Drop the
  // flex container and the full-screen picker has nothing stretching it to the
  // modal's height — it collapses to content height. That is how a pure bundle
  // fix becomes a visual regression on the buyer checkout path.
  //
  // The Playwright stub cited above CAN get away with a bare passthrough: it
  // replaces the module inside an already-laid-out page for assertion purposes.
  // This file replaces it in the shipped bundle, so it must reproduce the
  // layout contribution, not just the API surface.
  // ===========================================================================
  container: { flex: 1 },
});

/**
 * The library's `KeyboardToolbarProps`, re-declared STRUCTURALLY rather than
 * imported.
 *
 * `import type { KeyboardToolbarProps } from "react-native-keyboard-controller"`
 * is erased by the compiler and would cost no bytes — but it re-introduces the
 * package specifier into a web-resolved source file, which is exactly what the
 * #1627 source ratchet (T1) forbids, and correctly: a type import is one
 * character away from a value import, and the ratchet must not have to judge
 * which it is looking at.
 *
 * Only the members `CountryPickerModal` actually passes are modelled. The
 * NATIVE variant re-exports the library's full type, and that is the variant
 * TypeScript resolves for `./keyboardPrimitives` at call sites, so consumers
 * still type-check against the real thing.
 */
type KeyboardToolbarThemeColors = {
  primary: ColorValue;
  disabled: ColorValue;
  background: string;
  ripple: ColorValue;
};

export type KeyboardToolbarProps = {
  showArrows?: boolean;
  theme?: {
    light: KeyboardToolbarThemeColors;
    dark: KeyboardToolbarThemeColors;
  };
};

export function KeyboardProvider({
  children,
}: {
  children?: ReactNode;
}): ReactElement {
  return <View style={styles.container}>{children}</View>;
}

/**
 * Renders nothing. `KeyboardToolbar` is a bar attached to the top edge of a
 * soft keyboard; on web no such keyboard ever appears, so there is no edge to
 * attach to and nothing for its Done button to dismiss. Returning `null` is the
 * honest web behaviour, not a stub-shaped hole.
 *
 * Props are accepted and ignored so the call site stays platform-agnostic — the
 * `<KeyboardToolbar showArrows={false} theme={…}>` element at
 * CountryPickerModal.tsx:319 is unchanged on every platform (#1627 SC-3).
 */
export function KeyboardToolbar(_props: KeyboardToolbarProps): null {
  return null;
}
