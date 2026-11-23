/**
 * #4572 item 16 — the Done bar is suppressed while Ari's composer is focused.
 *
 * Every other field in the app keeps the Done bar. Ari's composer sits flush
 * on the keyboard (no bar, no clearance), so it raises this flag on focus and
 * lowers it on blur or unmount. `KeyboardToolbarRoot.native` reads it and
 * renders nothing while it is set, and clears it when the keyboard hides so a
 * dismissal that never fires a blur (Android back) cannot strand the flag.
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
