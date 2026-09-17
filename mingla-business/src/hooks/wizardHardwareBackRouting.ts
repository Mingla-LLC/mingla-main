// #3446 — Android hardware back in the Business creation wizards: the pure
// routing decision. No react-native, expo-router or React import, so the
// decision table is testable on its own and shared by the native hook and by
// runtime wizard tests.
//
// Rules (first match wins):
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

export interface WizardHardwareBackDecision {
  action: "none" | "step_back" | "exit";
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
): WizardHardwareBackDecision {
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
