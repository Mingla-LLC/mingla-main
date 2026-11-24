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

/**
 * The offset the composer's KeyboardAvoidingView needs: its parent's window Y.
 *
 * Android (#4572 retest, API 34 emulator, edge-to-edge): React Native's
 * `measureInWindow` subtracts the window's visible display frame top (the
 * status bar), while the library compares the frame with a keyboard top that
 * is measured from the top of the screen. The composer therefore ended exactly
 * one status bar (63px = 24dp) under the keyboard. On Android the status-bar
 * height is added back; iOS and web are unchanged.
 */
export function composerKeyboardOffsetFor(
  parentWindowY: number,
  platform: string = "ios",
  androidStatusBarHeight: number | null | undefined = 0,
): number {
  if (!Number.isFinite(parentWindowY)) return 0;
  const statusBar =
    platform === "android" &&
    typeof androidStatusBarHeight === "number" &&
    Number.isFinite(androidStatusBarHeight) &&
    androidStatusBarHeight > 0
      ? androidStatusBarHeight
      : 0;
  return Math.max(0, Math.round(parentWindowY + statusBar));
}

export interface ComposerKeyboardGeometry {
  /** The composer host (`styles.kav`) top as `measureInWindow` reports it. */
  parentWindowY: number;
  /**
   * Where `measureInWindow`'s 0 sits on screen: 0 on iOS; the status bar on
   * Android, whose measureInWindow subtracts the visible frame's top.
   */
  measureOriginOnScreen?: number;
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
  const viewBottomOnScreen = (g.measureOriginOnScreen ?? 0) + g.parentWindowY + g.frameY + g.frameHeight;
  const composerBottomOnScreen = viewBottomOnScreen - libraryPaddingFor(g);
  const keyboardTopOnScreen = g.screenHeight - g.keyboardHeight;
  return keyboardTopOnScreen - composerBottomOnScreen;
}
