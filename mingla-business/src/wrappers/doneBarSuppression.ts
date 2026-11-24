/**
 * #4572 item 16 — the Done bar is suppressed while Ari's composer is focused.
 *
 * Every other field in the app keeps the Done bar. Ari's composer sits flush
 * on the keyboard (no bar, no clearance), so it raises this flag on focus and
 * lowers it on blur or unmount. `KeyboardToolbarRoot.native` reads it and
 * renders nothing while it is set.
 *
 * Only focus and blur move the flag. The keyboard hiding does NOT clear it:
 * Android's back button hides the keyboard but leaves the composer focused, and
 * the next tap reopens the keyboard with no new focus event. Clearing on hide
 * made the Done bar come back over the flush composer (#4572 P2-2). While the
 * keyboard is hidden the bar is not drawn anyway, so a raised flag is harmless
 * until the composer blurs (focusing any other field blurs it first).
 *
 * Platform-agnostic and library-free: web has no Done bar, so it is inert
 * there and costs the eager bundle a few bytes.
 */

let suppressed = false;
const listeners = new Set<() => void>();

export function setDoneBarSuppressed(next: boolean): void {
  if (suppressed === next) return;
  suppressed = next;
  listeners.forEach((listener) => listener());
}

export function subscribeDoneBarSuppressed(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function getDoneBarSuppressed(): boolean {
  return suppressed;
}

/** Whether the Done bar draws: the keyboard is up and Ari's composer is not focused. */
export function doneBarShown(keyboardVisible: boolean, suppressedNow: boolean): boolean {
  return keyboardVisible && !suppressedNow;
}
