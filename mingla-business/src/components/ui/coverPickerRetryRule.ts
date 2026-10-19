/**
 * coverPickerRetryRule — #3040 B-C6 [A-6] / design truth rule T5.
 *
 * "Try again" returned silently when the picked file was not retained in this
 * mount — always the case after the sheet was closed and reopened — so the
 * error card offered a button that did nothing. A retry-type action now ALWAYS
 * does something: it restarts with the retained file, or it opens the video
 * picker with the notice "Choose the video again to retry.", or (while another
 * cover operation is mid-flight) it says why it is waiting. PURE.
 */

export type RetryPlan =
  | { kind: "start_retained" }
  | { kind: "pick_again"; notice: string }
  | { kind: "busy"; notice: string };

export const RETRY_PICK_NOTICE = "Choose the video again to retry.";

export const retryVideoPlan = (input: { retainedFile: boolean; busy: boolean }): RetryPlan => {
  if (input.busy) {
    return { kind: "busy", notice: "Finishing the current cover upload — try again in a moment." };
  }
  return input.retainedFile ? { kind: "start_retained" } : { kind: "pick_again", notice: RETRY_PICK_NOTICE };
};
