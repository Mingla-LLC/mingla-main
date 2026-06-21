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

import React from "react";
import {
  KeyboardToolbar,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";

import { accent } from "../constants/designSystem";
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
    primary: accent.warm, // #eb7825 — Done text, brand action color
    disabled: "#B0BEC5",
    background: "#f3f3f4",
    ripple: "#bcbcbcbc",
  },
  dark: {
    primary: accent.warm, // #eb7825 — Done text, brand action color
    disabled: "#707070",
    background: "#2C2C2E",
    ripple: "#F8F8F888",
  },
};

// ORCH-1186 Fix 5 — gate on keyboard visibility. The library's KeyboardToolbar
// rests at the TOP of the window when no keyboard is up (KeyboardStickyView
// translates it from offset 0), so on input-less sheets/modals it showed an
// off-white bar with an orange "Done" parked at the sheet top. Render NOTHING
// until a keyboard is actually visible; the Done bar still appears whenever a
// keyboard opens (only the resting-at-top artifact is removed). useKeyboard
// IsVisible reads the nearest per-window KeyboardProvider (KeyboardRoot), so
// this resolves correctly inside each Sheet/Modal's own provider window.
export const KeyboardToolbarRoot: React.FC = () => {
  const visible = useKeyboardIsVisible();
  if (!visible) return null;
  return (
    <KeyboardToolbar showArrows={false} theme={MINGLA_KEYBOARD_TOOLBAR_THEME} />
  );
};
