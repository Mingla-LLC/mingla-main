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
//      EXCEPTION (#3446 rework): "the keyboard is up" means the keyboard owner
//      is still TELLING THE TRUTH. Once we have asked the keyboard to dismiss
//      and no hide has confirmed it yet, `visible` is a stale value we caused,
//      so it is not treated as authoritative (see
//      WIZARD_KEYBOARD_DISMISS_SETTLE_MS).
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

/**
 * #3446 rework — how long a dismissal WE asked for keeps `visible` from being
 * treated as authoritative.
 *
 * The window above assumes the keyboard owner's `visible` is true only while
 * the keyboard really is up. It is not, for the interval after we call
 * Keyboard.dismiss(). `useKeyboardIsVisible` reads
 * react-native-keyboard-controller, whose flag flips on the IME inset
 * animation's onEnd (KeyboardAnimationCallback.kt) — strictly later than the
 * framework's own WindowInsets flag. Device evidence on emulator-5564
 * (Android 15, gesture nav; /tmp/issue1780-retest-r4/CHECK3a-timing.txt): after
 * a back press dismissed the IME, the framework flag flipped at +82 ms, but a
 * second back press at 237, 311 and 340 ms was STILL read as "keyboard visible"
 * and swallowed by rule 0, while presses at 565, 570 and 622 ms stepped back.
 * So the library flag lags the real dismissal by somewhere in (340, 565] ms on
 * that device, and during that lag the host presses back and nothing happens.
 *
 * The cure is not a longer or shorter window on the hide stamp — there is no
 * hide stamp yet. It is to remember that WE asked for the dismissal, and treat
 * `visible` as stale until a hide confirms it. The hook clears the request on
 * the very next visibility change, in both directions: a hide means the request
 * was fulfilled, and a show means the keyboard is genuinely up again and
 * `visible` is authoritative once more. So in normal operation this constant is
 * never reached.
 *
 * It exists only for the case where the confirming hide never arrives (a missed
 * library event, a dismissal the IME ignores). Without a bound, one such miss
 * would leave `visible` permanently distrusted for the life of that focus, and
 * a genuinely-visible-keyboard press would step back instead of dismissing —
 * the very bug #3446 fixed, in the other direction. 1,000 ms is roughly 1.8x
 * the worst lag measured above and about 4x the Android IME hide animation
 * (~250 ms), so it cannot expire while a real dismissal is still in flight, and
 * a stuck request self-heals within one second. A stale request simply stops
 * suppressing `visible`; the next genuine dismissal stamps a fresh one.
 */
export const WIZARD_KEYBOARD_DISMISS_SETTLE_MS = 1_000;

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
 * True while a dismissal we asked for has neither been confirmed by a
 * visibility change nor aged past the settle bound. While this holds, the
 * keyboard owner's `visible` is a value we caused and have not seen updated, so
 * rule 0 must not read it.
 */
const hasOutstandingDismissRequest = (keyboard: WizardHardwareBackKeyboard): boolean => {
  const requestedAt = keyboard.dismissRequestedAt ?? null;
  return (
    requestedAt !== null && keyboard.now - requestedAt <= WIZARD_KEYBOARD_DISMISS_SETTLE_MS
  );
};

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
