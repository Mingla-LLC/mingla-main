/**
 * #4572 retest P1-1 — where the Ari composer ends when the keyboard is up.
 *
 * The keyboard-controller `KeyboardAvoidingView` (1.18.x) pads itself by
 *   max(frame.y + frame.height - (screenHeight - keyboardHeight - keyboardVerticalOffset), 0)
 * where `frame` is its own onLayout frame: RELATIVE TO ITS PARENT, not the
 * screen. The Ari composer's view sits inside `styles.kav`, below the status
 * bar and the Ari top bar, so with no offset the padding came up short by
 * exactly that parent's window Y and the composer ended under the keyboard.
 *
 * The parent's measured window Y is therefore the view's offset. These are
 * pure functions so the geometry can be proved without a device.
 */

/** The offset the composer's KeyboardAvoidingView needs: its parent's window Y. */
export function composerKeyboardOffsetFor(parentWindowY: number): number {
  if (!Number.isFinite(parentWindowY)) return 0;
  return Math.max(0, Math.round(parentWindowY));
}

export interface ComposerKeyboardGeometry {
  /** The composer host (`styles.kav`) top, in screen points. */
  parentWindowY: number;
  /** The KeyboardAvoidingView's frame, relative to that host (keyboard closed). */
  frameY: number;
  frameHeight: number;
  /** The composer pill column's height inside the view (keyboard closed). */
  composerHeight: number;
  screenHeight: number;
  keyboardHeight: number;
  keyboardVerticalOffset: number;
}

/** The library's padding for the view, on the library's own formula. */
export function libraryPaddingFor(g: ComposerKeyboardGeometry): number {
  const keyboardY = g.screenHeight - g.keyboardHeight - g.keyboardVerticalOffset;
  return Math.max(g.frameY + g.frameHeight - keyboardY, 0);
}

/**
 * Gap between the composer's bottom edge and the keyboard's top edge, in
 * points: 0 is flush, negative means the composer is under the keyboard.
 * The content above the view shrinks (it is a flex: 1 scroll area) and the
 * resting spacer below it is fixed, so the view's bottom stays put and the
 * padding grows upward from it.
 */
export function composerGapAboveKeyboard(g: ComposerKeyboardGeometry): number {
  const viewBottomOnScreen = g.parentWindowY + g.frameY + g.frameHeight;
  const composerBottomOnScreen = viewBottomOnScreen - libraryPaddingFor(g);
  const keyboardTopOnScreen = g.screenHeight - g.keyboardHeight;
  return keyboardTopOnScreen - composerBottomOnScreen;
}
