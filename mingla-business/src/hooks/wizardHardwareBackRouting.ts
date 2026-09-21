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
//      EXCEPTION (#3446 rework, #3462 retest): "the keyboard is up" means the
//      keyboard owner is still TELLING THE TRUTH. Once we have asked the
//      keyboard to dismiss, `visible` is a value WE caused and have not seen
//      updated, so it is not read again until a REAL visibility change settles
//      that request -- a hide (the dismissal worked) or a show (the keyboard
//      genuinely came back). Nothing else ends the window: no clock, no press
//      count (see `hasOutstandingDismissRequest`).
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
  /**
   * When WE last asked the keyboard to dismiss, with no visibility change since
   * to confirm or contradict it; null when no such request is outstanding.
   *
   * The timestamp records WHEN, for ordering and for reading a trace; the rule
   * below deliberately never COMPARES it against `now`. Any comparison is a
   * deadline, and a deadline on this request is the #3462 dead tap (see
   * `hasOutstandingDismissRequest`).
   *
   * Optional: a caller that does not track its own dismissals (the decision
   * table, and any surface that never calls Keyboard.dismiss) behaves exactly
   * as before.
   */
  dismissRequestedAt?: number | null;
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

/**
 * True while a dismissal WE asked for has not yet been settled by a visibility
 * change. While this holds, the keyboard owner's `visible` is a value we caused
 * and have not seen updated, so rule 0 must not read it.
 *
 * There is NO time bound, and adding one back is the bug. #3446's first cut
 * bounded the request at 1,000 ms; the #3462 device round (emulator-5564,
 * Android 15, two wizards, seven reproductions) pressed back after a dismissal
 * and got NOTHING for roughly 1-3 seconds. The reason is structural, not a
 * matter of picking a bigger number:
 *
 *   - The owner is `useKeyboardIsVisible` -> `useKeyboardState().isVisible` ->
 *     `KeyboardController.isVisible()`, which is `!isClosed` where `isClosed`
 *     is flipped ONLY by the library's `keyboardDidHide` / `keyboardDidShow`
 *     listeners (react-native-keyboard-controller 1.18.5,
 *     lib/commonjs/module.js). On Android `keyboardDidHide` is emitted from the
 *     IME inset animation's onEnd, and React still has to commit the update.
 *   - So `visible` is a LATCH that stays `true` for the whole dismissal, and
 *     how long that takes is set by animation scheduling and main-thread load.
 *     It is not bounded by anything this module can know. The first cut assumed
 *     a 565 ms worst case from one unloaded measurement; the device round put
 *     it past 3 s.
 *   - Any deadline therefore has the same shape of failure: when it expires
 *     while the latch is still stale, rule 0 reads `visible` and swallows the
 *     press. A dead tap is Constitution rule 1, non-negotiable.
 *
 * So the request is authoritative until the truth arrives, and only the truth
 * ends it. The hook clears it on the next visibility change in either
 * direction: a hide is the confirmation we were waiting for, and a show means
 * the keyboard is genuinely up again and `visible` is authoritative once more.
 *
 * What this gives up, stated plainly: if the library were to drop the
 * confirming `keyboardDidHide` entirely AND the keyboard were still up, a press
 * would step back instead of dismissing. That costs one step, not a dead tap,
 * and it self-heals immediately -- stepping back unmounts the focused input, so
 * the IME hides and that hide is the visibility change that clears the request.
 * The bound it replaces bought nothing here: it could not observe the missing
 * event either, it only restored the swallow.
 */
const hasOutstandingDismissRequest = (keyboard: WizardHardwareBackKeyboard): boolean =>
  (keyboard.dismissRequestedAt ?? null) !== null;

const isKeyboardBackPress = (keyboard: WizardHardwareBackKeyboard): boolean =>
  // A visible keyboard only counts when nothing we did could be why it still
  // reads visible. The hide window is unaffected: an unclaimed hide is a real,
  // observed hide, and it still swallows exactly one press.
  (keyboard.visible && !hasOutstandingDismissRequest(keyboard)) ||
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
