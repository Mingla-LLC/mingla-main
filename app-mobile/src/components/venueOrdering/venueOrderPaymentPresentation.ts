// Issue #1793 rework — the tiny host-owned seam that makes a cancelled native
// sheet demonstrably resumable without moving provider code into shared UI.

type PaymentSheetError = {
  code?: string;
  message?: string;
  localizedMessage?: string;
};

export type VenueOrderPaymentPresentation = {
  orderId: string;
  paymentIntentId: string;
  status: "completed" | "cancelled" | "failed";
  error?: PaymentSheetError;
};

export async function presentVenueOrderPayment(input: {
  orderId: string;
  paymentIntentId: string;
  present: () => Promise<{ error?: PaymentSheetError }>;
}): Promise<VenueOrderPaymentPresentation> {
  const result = await input.present();
  return {
    orderId: input.orderId,
    paymentIntentId: input.paymentIntentId,
    status:
      result.error === undefined
        ? "completed"
        : result.error.code === "Canceled"
          ? "cancelled"
          : "failed",
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}
