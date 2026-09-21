// #3446 — Android hardware back in the Business creation wizards: the pure
// routing decision. No react-native, expo-router or React import, so the
// decision table is testable on its own and shared by the native hook and by
// runtime wizard tests.
//
// Rules (first match wins):
//   0. The soft keyboard is up as of THIS press -> the press only dismisses the
//      keyboard. No owner runs and the latch is left exactly as it was (a
//      dismissal never arms or releases it).
//      "As of this press" is the whole point, and it is a synchronous read of
//      the IME's ONSET events, not of a React-committed value. See `imeUp`.
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

export interface WizardHardwareBackKeyboard {
  /**
   * The soft keyboard is up, or has not yet begun hiding, as of THIS press.
   *
   * Read synchronously at press time from a module-scope flag driven by the
   * keyboard's ONSET events — keyboardWillShow / keyboardWillHide, with
   * keyboardDidShow / keyboardDidHide as corroboration
   * (src/wrappers/imeUpTracker.native.ts). Never a React-committed value.
   *
   * This interface has one field on purpose. Every deadline placed on this path
   * has failed the same way — #3446's 1,000 ms dismissal bound (#3462: dead for
   * 1-3 s) and the 300 ms hide window (#3446 V2: 1500 ms -> 3/3 dead, because
   * the stamp came from a React commit 0.5-1.4 s after the press). The platform
   * does not tell JS why a keyboard hid, and the IME usually eats the
   * dismissing back press itself, so there is nothing to claim and nothing to
   * time. Do not add a timestamp here.
   */
  imeUp: boolean;
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

export function dispatchWizardHardwareBackPress(
  latch: WizardHardwareBackLatch,
  config: WizardHardwareBackConfig,
  keyboard?: WizardHardwareBackKeyboard,
): WizardHardwareBackDecision {
  if (keyboard !== undefined && keyboard.imeUp) {
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
