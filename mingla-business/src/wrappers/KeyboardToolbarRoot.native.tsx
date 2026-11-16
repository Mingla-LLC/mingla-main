// ORCH-1165: KeyboardToolbarRoot — native variant. Renders the
// react-native-keyboard-controller <KeyboardToolbar> as a Done-only
// (no Prev/Next chevrons) accessory bar pinned to the top edge of the
// on-screen keyboard for EVERY focused TextInput in the business app.
// The library's <KeyboardStickyView> (internal to KeyboardToolbar)
// translates the bar off-screen when no field is focused, so this mounts
// once and is inert until a field gains focus. Metro picks this file on
// iOS + Android; web picks KeyboardToolbarRoot.tsx (a null passthrough).
//
// `showArrows={false}` → Done-only (Seth-locked, no Prev/Next).
// Done text color = brand accent.warm (#eb7825) via the theme below.
//
// Per SPEC_ORCH-1165 §4.1. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY
// (every keyboard piece flows through react-native-keyboard-controller —
// no bespoke Keyboard.addListener for layout). This native file is added
// to the orch-0892 strict-grep SAFELIST.

import React, { useCallback, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import {
  KeyboardToolbar,
  useReanimatedKeyboardAnimation,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { color } from "../constants/designSystem";
import { HapticFeedback } from "../utils/hapticFeedback";
import { KEYBOARD_TOOLBAR_HEIGHT, OPENED_OFFSET } from "./keyboardClearance.native";
import { useKeyboardIsVisible } from "./useKeyboardIsVisible";

// The library does not re-export its KeyboardToolbarTheme type from the
// package index — derive it from the public prop so we stay on the exported
// surface and the override is type-checked against the real shape.
type KeyboardToolbarTheme = NonNullable<KeyboardToolbarProps["theme"]>;

// Start from the library's default theme shape and override only `primary`
// (the Done button text color) to the Mingla brand orange. Background kept
// at the library's dark elevated-surface (#2C2C2E) to match the dark app.
// Both light + dark blocks are supplied because the library reads
// useKeyboardState().appearance; the business app is dark, but providing
// both guards against an appearance flip.
export const MINGLA_KEYBOARD_TOOLBAR_THEME: KeyboardToolbarTheme = {
  light: {
    primary: color.accent, // AA on the light toolbar background
    disabled: color.keyboardToolbar.lightDisabled,
    background: color.keyboardToolbar.lightBackground,
    ripple: color.keyboardToolbar.lightRipple,
  },
  dark: {
    primary: color.accent, // #eb7825 — Done text, brand action color
    disabled: color.keyboardToolbar.darkDisabled,
    background: color.keyboardToolbar.darkBackground,
    ripple: color.keyboardToolbar.darkRipple,
  },
};

export interface AvailabilityNumericToolbarState {
  previousDisabled: boolean;
  nextDisabled: boolean;
  focusPrevious: () => void;
  focusNext: () => void;
}

let availabilityState: AvailabilityNumericToolbarState | null = null;
const availabilityListeners = new Set<() => void>();

export function setAvailabilityNumericToolbarState(
  next: AvailabilityNumericToolbarState | null,
): void {
  availabilityState = next;
  availabilityListeners.forEach((listener) => listener());
}

function subscribeAvailabilityToolbar(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return (): void => {
    availabilityListeners.delete(listener);
  };
}

function getAvailabilityToolbarSnapshot(): AvailabilityNumericToolbarState | null {
  return availabilityState;
}

type ToolbarButtonProps = React.ComponentProps<
  NonNullable<KeyboardToolbarProps["button"]>
>;

const AvailabilityToolbarButton = ({
  accessibilityHint,
  accessibilityLabel,
  children,
  disabled,
  onPress,
  style,
  testID,
}: ToolbarButtonProps): React.ReactElement => {
  const scoped = getAvailabilityToolbarSnapshot();
  const scopedDisabled =
    accessibilityLabel === "Previous"
      ? scoped?.previousDisabled
      : accessibilityLabel === "Next"
        ? scoped?.nextDisabled
        : undefined;
  const effectiveDisabled = scopedDisabled ?? disabled ?? false;
  const exactHint =
    accessibilityLabel === "Previous"
      ? "Moves to the previous availability field"
      : accessibilityLabel === "Next"
        ? "Moves to the next availability field"
        : "Closes the keyboard without saving";

  return (
    <Pressable
      accessibilityHint={exactHint ?? accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: effectiveDisabled }}
      android_ripple={
        Platform.OS === "android"
          ? { color: color.keyboardToolbar.darkRipple, radius: 22 }
          : undefined
      }
      disabled={effectiveDisabled}
      hitSlop={{ top: 1, bottom: 1, left: 1, right: 1 }}
      onPress={(event) => {
        HapticFeedback.buttonPress();
        onPress(event);
      }}
      style={[
        styles.toolbarButton,
        style,
        effectiveDisabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <View pointerEvents="none">{children}</View>
    </Pressable>
  );
};

// ORCH-1186 Fix 5 — gate on keyboard visibility. The library's KeyboardToolbar
// rests at the TOP of the window when no keyboard is up (KeyboardStickyView
// translates it from offset 0), so on input-less sheets/modals it showed an
// off-white bar with an orange "Done" parked at the sheet top. Render NOTHING
// until a keyboard is actually visible; the Done bar still appears whenever a
// keyboard opens (only the resting-at-top artifact is removed). useKeyboard
// IsVisible reads the nearest per-window KeyboardProvider (KeyboardRoot), so
// this resolves correctly inside each Sheet/Modal's own provider window.
//
// #4420 (device round 2) — the bar never showed inside a Sheet/Modal window.
// The library's own KeyboardStickyView follows the provider's RN-Animated
// keyboard height (a native-driver Animated.event); inside a RN <Modal> window
// that value never moves, so the bar stayed at offset 0: the window bottom,
// behind the keyboard (iOS), or partly under it (Android). The Reanimated
// keyboard values of the SAME per-window provider do move there (the sheet's
// useKeyboardHeight reads them), so the bar now rides those: the library bar
// renders with its own sticky translate switched off (`enabled={false}`, with
// the closed offset cancelled), inside a bottom-anchored Animated.View that
// translates by the Reanimated keyboard height plus the library's
// OPENED_OFFSET. One path for every window (root, sheet, dialog).
const DONE_BAR_REST_OFFSET = { closed: -KEYBOARD_TOOLBAR_HEIGHT, opened: 0 };

const DoneBarDock: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { height } = useReanimatedKeyboardAnimation();
  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: height.value + OPENED_OFFSET }],
  }));
  return (
    <Animated.View pointerEvents="box-none" style={[styles.dock, dockStyle]}>
      {children}
    </Animated.View>
  );
};

export const KeyboardToolbarRoot: React.FC = () => {
  const visible = useKeyboardIsVisible();
  const scoped = useSyncExternalStore(
    subscribeAvailabilityToolbar,
    getAvailabilityToolbarSnapshot,
    getAvailabilityToolbarSnapshot,
  );
  const handlePrevious = useCallback<
    NonNullable<KeyboardToolbarProps["onPrevCallback"]>
  >((event) => {
    const current = getAvailabilityToolbarSnapshot();
    if (current === null || current.previousDisabled) return;
    event.preventDefault();
    current.focusPrevious();
  }, []);
  const handleNext = useCallback<
    NonNullable<KeyboardToolbarProps["onNextCallback"]>
  >((event) => {
    const current = getAvailabilityToolbarSnapshot();
    if (current === null || current.nextDisabled) return;
    event.preventDefault();
    current.focusNext();
  }, []);
  if (!visible) return null;
  if (scoped !== null) {
    return (
      <DoneBarDock>
        <KeyboardToolbar
          button={AvailabilityToolbarButton}
          enabled={false}
          offset={DONE_BAR_REST_OFFSET}
          onNextCallback={handleNext}
          onPrevCallback={handlePrevious}
          showArrows={true}
          theme={MINGLA_KEYBOARD_TOOLBAR_THEME}
        />
      </DoneBarDock>
    );
  }
  return (
    <DoneBarDock>
      <KeyboardToolbar
        enabled={false}
        offset={DONE_BAR_REST_OFFSET}
        showArrows={false}
        theme={MINGLA_KEYBOARD_TOOLBAR_THEME}
      />
    </DoneBarDock>
  );
};

const styles = StyleSheet.create({
  // Anchored to the window bottom; the library bar inside is `position:
  // absolute, bottom: 0`, so the dock's translate alone places it.
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  toolbarButton: {
    minWidth: 44,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.55,
  },
});
