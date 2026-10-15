export type TicketCheckoutConfirmationStatus = "paid" | "pending" | "failed";

export function classifyStripeCheckoutConfirmationStatus(
  paymentIntentStatus: string,
): TicketCheckoutConfirmationStatus {
  if (paymentIntentStatus === "succeeded") return "paid";
  if (
    paymentIntentStatus === "processing" ||
    paymentIntentStatus === "requires_action" ||
    paymentIntentStatus === "requires_capture"
  ) {
    return "pending";
  }
  return "failed";
}
