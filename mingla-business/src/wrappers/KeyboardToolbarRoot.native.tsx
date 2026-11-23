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

import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import {
  FocusedInputEvents,
  KeyboardController,
  useReanimatedKeyboardAnimation,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { ChevronDown, ChevronUp } from "lucide-react-native";

import { color, materials, space, type } from "../constants/designSystem";
import { HapticFeedback } from "../utils/hapticFeedback";
import { DONE_BAR_OCCUPIED } from "./keyboardClearance.native";
import {
  getDoneBarSuppressed,
  setDoneBarSuppressed,
  subscribeDoneBarSuppressed,
} from "./doneBarSuppression";
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
  // #4420 (device round 2): the host app is dark in both keyboard
  // appearances, so both blocks are the Graphite bar: the sheet's solid
  // material with the orange Done. (The light block used to paint a pale
  // floating pill over a dark sheet.)
  light: {
    primary: color.accent,
    disabled: color.keyboardToolbar.darkDisabled,
    background: materials.sheet.solidFill as KeyboardToolbarTheme["light"]["background"],
    ripple: color.keyboardToolbar.darkRipple,
  },
  dark: {
    primary: color.accent, // #eb7825 — Done text, brand action color
    disabled: color.keyboardToolbar.darkDisabled,
    background: materials.sheet.solidFill as KeyboardToolbarTheme["dark"]["background"],
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

// ORCH-1186 Fix 5 — gate on keyboard visibility: render NOTHING until a
// keyboard is actually visible. useKeyboardIsVisible reads the nearest
// per-window KeyboardProvider (KeyboardRoot), so this resolves correctly inside
// each Sheet/Modal's own provider window.
//
// #4420 (device round 2) — the bar is the app's own Graphite bar, driven only
// by library APIs (I-PROPOSED-KEYBOARD-LIBRARY-ONLY):
//   - Position: the library's KeyboardStickyView follows the provider's
//     RN-Animated keyboard height, which never moves inside a RN <Modal>
//     window, so inside every Sheet the bar sat behind the keyboard (iOS) or
//     partly under it (Android). The same provider's Reanimated height DOES
//     move there, so the bar rides useReanimatedKeyboardAnimation, anchored at
//     the window bottom: one path for every window (root, sheet, dialog).
//   - Shape: flush on the keyboard top, full width, DONE_BAR_OCCUPIED tall, so
//     every clearance budget built from DONE_BAR_OCCUPIED stays exact. The
//     library bar floated as a pale rounded pill 11pt above the iOS 26
//     keyboard, which read as foreign on the dark sheets.
//   - Actions: Done = KeyboardController.dismiss(); Previous / Next (only for
//     the registered availability group) = KeyboardController.setFocusTo,
//     unless the scoped callbacks take the event.
const DoneBarDock: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { height } = useReanimatedKeyboardAnimation();
  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: height.value }],
  }));
  return (
    <Animated.View pointerEvents="box-none" style={[styles.dock, dockStyle]}>
      {children}
    </Animated.View>
  );
};

interface DoneBarProps {
  showArrows: boolean;
  button?: React.ComponentType<ToolbarButtonProps>;
  onPrevCallback?: KeyboardToolbarProps["onPrevCallback"];
  onNextCallback?: KeyboardToolbarProps["onNextCallback"];
  theme: KeyboardToolbarTheme;
}

const DefaultBarButton = AvailabilityToolbarButton;

const DoneBar: React.FC<DoneBarProps> = ({
  showArrows,
  button,
  onPrevCallback,
  onNextCallback,
  theme,
}) => {
  const [inputs, setInputs] = useState({ current: 0, count: 0 });
  useEffect(() => {
    const subscription = FocusedInputEvents?.addListener("focusDidSet", (e) => {
      setInputs(e);
    });
    return () => subscription?.remove();
  }, []);
  const Button = button ?? DefaultBarButton;
  const prevDisabled = inputs.current === 0;
  const nextDisabled = inputs.current === inputs.count - 1;
  const onPrev = (event: GestureResponderEvent): void => {
    onPrevCallback?.(event);
    if (!event.isDefaultPrevented()) void KeyboardController.setFocusTo("prev");
  };
  const onNext = (event: GestureResponderEvent): void => {
    onNextCallback?.(event);
    if (!event.isDefaultPrevented()) void KeyboardController.setFocusTo("next");
  };
  const onDone = (): void => {
    void KeyboardController.dismiss();
  };
  const palette = theme.dark;
  return (
    <View style={[styles.bar, { backgroundColor: palette.background }]} testID="keyboard.toolbar">
      {showArrows ? (
        <View style={styles.arrows}>
          <Button accessibilityHint="Moves focus to the previous field" accessibilityLabel="Previous" disabled={prevDisabled} onPress={onPrev} theme={theme} testID="keyboard.toolbar.previous">
            <ChevronUp size={22} strokeWidth={2.25} color={prevDisabled ? palette.disabled : color.text1} />
          </Button>
          <Button accessibilityHint="Moves focus to the next field" accessibilityLabel="Next" disabled={nextDisabled} onPress={onNext} theme={theme} testID="keyboard.toolbar.next">
            <ChevronDown size={22} strokeWidth={2.25} color={nextDisabled ? palette.disabled : color.text1} />
          </Button>
        </View>
      ) : null}
      <View style={styles.flex} />
      <Button accessibilityHint="Closes the keyboard" accessibilityLabel="Done" onPress={onDone} theme={theme} testID="keyboard.toolbar.done" style={styles.doneButton}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.doneText, { color: palette.primary }]}>
          Done
        </Text>
      </Button>
    </View>
  );
};

export const KeyboardToolbarRoot: React.FC = () => {
  const visible = useKeyboardIsVisible();
  // #4572 — Ari's composer sits flush on the keyboard with no Done bar.
  const suppressed = useSyncExternalStore(
    subscribeDoneBarSuppressed,
    getDoneBarSuppressed,
    getDoneBarSuppressed,
  );
  useEffect(() => {
    // A dismissal that never blurs the field must not strand the flag.
    if (!visible) setDoneBarSuppressed(false);
  }, [visible]);
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
  if (!visible || suppressed) return null;
  if (scoped !== null) {
    return (
      <DoneBarDock>
        <DoneBar
          button={AvailabilityToolbarButton}
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
      <DoneBar showArrows={false} theme={MINGLA_KEYBOARD_TOOLBAR_THEME} />
    </DoneBarDock>
  );
};

const styles = StyleSheet.create({
  // Anchored to the window bottom; the dock's translate alone places the bar
  // flush on the keyboard top.
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  bar: {
    height: DONE_BAR_OCCUPIED,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  arrows: { flexDirection: "row" },
  flex: { flex: 1 },
  doneButton: { paddingHorizontal: space[3] },
  doneText: { ...type.btn },
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
