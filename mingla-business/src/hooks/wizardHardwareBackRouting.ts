// #3446 — Android hardware back in the Business creation wizards: the pure
// routing decision. No react-native, expo-router or React import, so the
// decision table is testable on its own and shared by the native hook and by
// runtime wizard tests.
//
// Rules (first match wins):
//   0. The soft keyboard is up, or it hid moments ago and no back press has
//      claimed that hide yet -> the press only dismisses the keyboard. No owner
//      runs and the latch is left exactly as it was (a dismissal never arms or
//      releases it). Android can deliver the IME hide and hardwareBackPress for
//      one press in either order, hence the short window (see
//      WIZARD_KEYBOARD_BACK_WINDOW_MS).
//   1. A press is still in flight (latch not idle) -> do nothing.
//   2. The wizard is busy (publish / autosave / invite pre-check / discard)
//      -> do nothing.
//   3. First step -> run the wizard's own close/cancel owner, once, and latch
//      "exiting" so a second press cannot run the exit path twice.
//   4. Any later step -> run the wizard's own Back owner, once. If it returns a
//      promise (Trip saves before stepping back), latch "stepping" until it
//      settles so a second press cannot skip a step.
//
// Invariant: I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK (docs/INVARIANT_REGISTRY.md).

export interface WizardHardwareBackConfig {
  /** True only on the wizard's first step. */
  isFirstStep: boolean;
  /** Publish / autosave / invite pre-check / discard in flight. */
  busy: boolean;
  /** The exit path has surfaced UI (discard dialog or failure toast). */
  exitSurfaced: boolean;
  /** The wizard's EXISTING in-app Back owner. */
  onStepBack: () => void | Promise<void>;
  /** The wizard's EXISTING in-app close/cancel owner. */
  onExit: () => void;
}

export type WizardHardwareBackLatch = "idle" | "stepping" | "exiting";

/**
 * #3446 SC-7 — how long after the soft keyboard hid a back press still counts
 * as the press that hid it.
 *
 * With the keyboard up, one Android back press both hides the IME and reaches
 * JS as hardwareBackPress (runtime-proven on emulator-5564, Android 15, for
 * keyevent 4 and the edge-swipe gesture). The keyboard owner
 * (useKeyboardIsVisible -> react-native-keyboard-controller useKeyboardState)
 * flips only on keyboardDidHide, which the library emits from the IME inset
 * animation's onEnd (KeyboardAnimationCallback.kt), and the hook stamps the
 * hide when React commits that update.
 *
 * Order 1, press first: the press is dispatched when the IME STARTS hiding,
 * so it normally reaches JS before keyboardDidHide and sees the keyboard
 * visible. No window is involved.
 * Order 2, hide first: the platform delivered the press after the hide
 * animation ended. JS handles native events in emission order, so the press
 * lands right after the commit that flipped visibility; the stamp-to-press gap
 * is delivery plus JS scheduling (a frame or two and one wizard render), not
 * the interval between two human presses.
 *
 * 300 ms is Android's ViewConfiguration double-tap timeout, the platform's own
 * line between one gesture and two: comfortably above that scheduling gap and
 * below a deliberate second press. The window can only swallow a press that
 * follows a hide no back press claimed (Continue, tapping outside, the IME's
 * own hide key), and only one such press. A hide already claimed by a press
 * opens no window, so "back to hide the keyboard, back again to step" still
 * steps on the second press.
 */
export const WIZARD_KEYBOARD_BACK_WINDOW_MS = 300;

export interface WizardHardwareBackKeyboard {
  /** The keyboard owner reports the soft keyboard visible (last commit). */
  visible: boolean;
  /**
   * When the keyboard last hid (same clock as `now`), or null when it has not
   * hid since it was last shown or a back press already claimed that hide.
   */
  unclaimedHideAt: number | null;
  /** When this press arrived. */
  now: number;
}

export interface WizardHardwareBackDecision {
  action: "none" | "step_back" | "exit" | "dismiss_keyboard";
  nextLatch: WizardHardwareBackLatch;
  pending: Promise<void> | null;
}

const isThenable = (value: unknown): value is Promise<void> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

const isKeyboardBackPress = (keyboard: WizardHardwareBackKeyboard): boolean =>
  keyboard.visible ||
  (keyboard.unclaimedHideAt !== null &&
    keyboard.now - keyboard.unclaimedHideAt <= WIZARD_KEYBOARD_BACK_WINDOW_MS);

export function dispatchWizardHardwareBackPress(
  latch: WizardHardwareBackLatch,
  config: WizardHardwareBackConfig,
  keyboard?: WizardHardwareBackKeyboard,
): WizardHardwareBackDecision {
  if (keyboard !== undefined && isKeyboardBackPress(keyboard)) {
    return { action: "dismiss_keyboard", nextLatch: latch, pending: null };
  }
  if (latch !== "idle") {
    return { action: "none", nextLatch: latch, pending: null };
  }
  if (config.busy) {
    return { action: "none", nextLatch: "idle", pending: null };
  }
  if (config.isFirstStep) {
    config.onExit();
    return { action: "exit", nextLatch: "exiting", pending: null };
  }
  const result = config.onStepBack();
  if (isThenable(result)) {
    return { action: "step_back", nextLatch: "stepping", pending: result };
  }
  return { action: "step_back", nextLatch: "idle", pending: null };
}
