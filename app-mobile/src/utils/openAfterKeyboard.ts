// Issue #4114 QA (P3): with the phone keyboard up, the first tap on the Add a
// friend country button only dismissed the keyboard. Opening the picker drops
// the sheet's RN <Modal> window while iOS is still animating the keyboard away,
// and iOS refuses to present the picker's window in that moment. So: when the
// keyboard is up, dismiss it first and open on keyboardDidHide (with a timeout
// fallback); when it is down, open at once. One tap, always.

export interface KeyboardLike {
  isVisible(): boolean;
  dismiss(): void;
  addListener(event: "keyboardDidHide", listener: () => void): { remove(): void };
}

export const OPEN_AFTER_KEYBOARD_FALLBACK_MS = 400;

export function openAfterKeyboardHides(
  keyboard: KeyboardLike,
  open: () => void,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): void {
  if (!keyboard.isVisible()) {
    open();
    return;
  }
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    subscription.remove();
    open();
  };
  const subscription = keyboard.addListener("keyboardDidHide", fire);
  keyboard.dismiss();
  schedule(fire, OPEN_AFTER_KEYBOARD_FALLBACK_MS);
}
