// ORCH-1171: Done-only keyboard accessory bar for every consumer TextInput.

import React from "react";
import {
  KeyboardToolbar,
  useKeyboardState,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";

import { colors } from "../constants/colors";

type KeyboardToolbarTheme = NonNullable<KeyboardToolbarProps["theme"]>;

export const MINGLA_KEYBOARD_TOOLBAR_THEME: KeyboardToolbarTheme = {
  light: {
    primary: colors.primary,
    disabled: "#B0BEC5",
    background: "#f3f3f4",
    ripple: "#bcbcbcbc",
  },
  dark: {
    primary: colors.primary,
    disabled: "#707070",
    background: "#2C2C2E",
    ripple: "#F8F8F888",
  },
};

// ORCH-1186 Fix 5 — gate on keyboard visibility (parity with the business app),
// for when the consumer native build ships. Without the keyboard up, the
// library's KeyboardToolbar rests at the TOP of the window → an off-white "Done"
// bar parked at the top of input-less sheets. Render nothing until a keyboard is
// visible; the Done bar still appears whenever a keyboard opens. useKeyboardState
// reads the nearest per-window KeyboardProvider.
// #4473 — a dark surface (e.g. a dark bottom sheet) asks for the dark bar
// whatever the system appearance, so a light pill never floats over it.
const MINGLA_KEYBOARD_TOOLBAR_DARK_THEME: KeyboardToolbarTheme = {
  light: MINGLA_KEYBOARD_TOOLBAR_THEME.dark,
  dark: MINGLA_KEYBOARD_TOOLBAR_THEME.dark,
};

export const KeyboardToolbarRoot: React.FC<{ tone?: "system" | "dark" }> = ({
  tone = "system",
}) => {
  const { isVisible } = useKeyboardState();
  if (!isVisible) return null;
  return (
    <KeyboardToolbar
      showArrows={false}
      theme={tone === "dark" ? MINGLA_KEYBOARD_TOOLBAR_DARK_THEME : MINGLA_KEYBOARD_TOOLBAR_THEME}
    />
  );
};
