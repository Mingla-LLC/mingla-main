// ORCH-1171: Done-only keyboard accessory bar for every consumer TextInput.

import React from "react";
import {
  KeyboardToolbar,
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

export const KeyboardToolbarRoot: React.FC = () => (
  <KeyboardToolbar showArrows={false} theme={MINGLA_KEYBOARD_TOOLBAR_THEME} />
);
