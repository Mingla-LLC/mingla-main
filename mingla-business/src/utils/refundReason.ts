/**
 * #4271 — the refund reason box tells the host how much more to type.
 *
 * Shared by RefundSheet (online orders) and DoorRefundSheet (door sales). The
 * 10-character minimum and the server's own validation are unchanged; this only
 * decides what the helper line says and what tapping Send does while the reason
 * is too short (before, the button stayed disabled with no explanation).
 *
 * Door polish: ONE helper line instead of a helper, a "0 / 200" counter and a
 * separate red error. It counts down in grey, turns red (and is announced) after
 * a press while still short, goes quiet once the reason is long enough (the
 * line keeps its height so nothing jumps), and the "188 / 200" counter appears
 * only near the limit.
 */

/** The counter stays hidden until the reason is this long. */
export const REFUND_REASON_COUNTER_FROM = 180;

export interface RefundReasonHelperInput {
  /** Length after trimming: what the server validates. */
  trimmedLength: number;
  /** Raw length: what the box's maxLength stops. */
  length: number;
  minLength: number;
  maxLength: number;
  /** The host pressed Refund while the reason was still short. */
  pressedShort: boolean;
}

export interface RefundReasonHelper {
  /** Empty once the reason is long enough (the line keeps its height). */
  text: string;
  tone: "hint" | "error";
  /** "188 / 200" from REFUND_REASON_COUNTER_FROM, otherwise null. */
  counter: string | null;
}

const missingText = (missing: number): string =>
  missing === 1 ? "1 more character needed." : `${missing} more characters needed.`;

export const refundReasonHelper = (input: RefundReasonHelperInput): RefundReasonHelper => {
  const counter =
    input.length >= REFUND_REASON_COUNTER_FROM ? `${input.length} / ${input.maxLength}` : null;
  const missing = input.minLength - input.trimmedLength;
  if (missing <= 0) return { text: "", tone: "hint", counter };
  if (input.pressedShort) {
    return {
      text: `${missingText(missing)} Reasons need at least ${input.minLength}.`,
      tone: "error",
      counter,
    };
  }
  if (input.trimmedLength <= 0) {
    return { text: `At least ${input.minLength} characters.`, tone: "hint", counter };
  }
  return { text: missingText(missing), tone: "hint", counter };
};

export type RefundReasonPressAction = "submit" | "show_reason_error" | "none";

/**
 * Send stays tappable when everything but the reason is ready, so a short
 * reason gets an explanation instead of a silent dead button.
 */
export const refundReasonSendGate = (input: {
  trimmedLength: number;
  minLength: number;
  maxLength: number;
  /** Every other submit condition (selection, preview, role, not submitting). */
  otherwiseReady: boolean;
}): { enabled: boolean; onPress: RefundReasonPressAction } => {
  if (!input.otherwiseReady) return { enabled: false, onPress: "none" };
  if (input.trimmedLength < input.minLength) {
    return { enabled: true, onPress: "show_reason_error" };
  }
  if (input.trimmedLength > input.maxLength) {
    return { enabled: false, onPress: "none" };
  }
  return { enabled: true, onPress: "submit" };
};
