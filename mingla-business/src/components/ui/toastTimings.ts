// ORCH-0789: per-kind auto-dismiss schedule for the Toast primitive.
//
// Extracted to its own file so the I-PROPOSED-ERROR-TOAST-DISMISSIBLE
// invariant can be unit-tested without rendering the Toast component
// (which depends on the React Native runtime + react-native-reanimated).
//
// error: 12000 — bounded fallback so an iOS buyer who can't reach the
// close icon (e.g., phone locked, app backgrounded) still sees the toast
// disappear. Combined with the close-icon and tap-anywhere affordances
// in Toast.tsx, this guarantees no permanent error banner is possible.

export type ToastKind = "success" | "error" | "warn" | "info";

export const AUTO_DISMISS: Readonly<Record<ToastKind, number>> = {
  success: 2600,
  info: 2600,
  warn: 6000,
  error: 12000,
};
