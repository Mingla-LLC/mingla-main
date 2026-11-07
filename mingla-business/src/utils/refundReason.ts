/**
 * #4271 — the refund reason box tells the host how much more to type.
 *
 * Shared by RefundSheet (online orders) and DoorRefundSheet (door sales). The
 * 10-character minimum and the server's own validation are unchanged; this only
 * decides what the helper line says and what tapping Send does while the reason
 * is too short (before, the button stayed disabled with no explanation).
 */

export const refundReasonHelperText = (
  trimmedLength: number,
  minLength: number,
): string => {
  if (trimmedLength <= 0) return `Add a reason (${minLength}+ characters)`;
  const missing = minLength - trimmedLength;
  if (missing <= 0) return "Looks good";
  return missing === 1
    ? "Add 1 more character"
    : `Add ${missing} more characters`;
};

export const refundReasonTooShortMessage = (minLength: number): string =>
  `Your reason needs at least ${minLength} characters.`;

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
