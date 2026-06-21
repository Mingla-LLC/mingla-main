// ORCH-1171: shared keyboard-toolbar geometry for the consumer app.
// The Done-only accessory bar adds KEYBOARD_TOOLBAR_HEIGHT on top of the OS
// keyboard; scroll/composer clearance must account for it (mirror ORCH-1170).

/** Height of react-native-keyboard-controller's Done-only KeyboardToolbar. */
export const KEYBOARD_TOOLBAR_HEIGHT = 42;

/** Visible breathing room between a focused field and the toolbar top. */
export const KEYBOARD_CLEARANCE_ABOVE_TOOLBAR = 12;

/** Default bottomOffset for library KeyboardAwareScrollView wrappers. */
export const KEYBOARD_SCROLL_BOTTOM_OFFSET =
  KEYBOARD_CLEARANCE_ABOVE_TOOLBAR + KEYBOARD_TOOLBAR_HEIGHT;
