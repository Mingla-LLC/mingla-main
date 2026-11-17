// ORCH-0789: per-kind auto-dismiss schedule for the Toast primitive.
//
// Extracted to its own file so the I-PROPOSED-ERROR-TOAST-DISMISSIBLE
// invariant can be unit-tested without rendering the Toast component.
//
// #4420 (spec §3.3, B4): toasts are NON-MODAL now (they render in ToastHost,
// never in a native <Modal>), so a toast no longer captures touches while it
// shows. The schedule follows the Graphite Glass kit:
//   success / info   4000
//   warn             6000
//   error            8000  (an error that carries an action, e.g. "Retry")
//   error, no action stays until dismissed: it cannot block anything any more
//                    (no Modal, no scrim), and it is always dismissible by the
//                    close icon, a tap on the card and a swipe up (ORCH-0789).
// `AUTO_DISMISS.error` stays a bounded positive number (the error-with-action
// timer); `resolveAutoDismissMs` is the one function that applies the
// no-action rule, the per-instance override, and nothing else.

export type ToastKind = "success" | "error" | "warn" | "info";

export const AUTO_DISMISS: Readonly<Record<ToastKind, number>> = {
  success: 4000,
  info: 4000,
  warn: 6000,
  error: 8000,
};

/**
 * The timer for one toast, in ms, or `null` for "stays until dismissed".
 * A per-instance `autoDismissMs` (number or null) always wins.
 */
export const resolveAutoDismissMs = (
  kind: ToastKind,
  hasAction: boolean,
  autoDismissMs?: number | null,
): number | null => {
  if (autoDismissMs !== undefined) return autoDismissMs;
  if (kind === "error" && !hasAction) return null;
  return AUTO_DISMISS[kind];
};
