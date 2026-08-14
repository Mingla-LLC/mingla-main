export type TicketStripeAttempt = {
  flow: "stripe_native" | "stripe_checkout" | "paystack_redirect";
  provider_object_id: string | null;
  provider_checkout_id: string | null;
  provider_idempotency_key: string;
};

export type TicketStripeNeutralizer = {
  expireCheckout(input: {
    checkoutSessionId: string;
    stripeAccountId: string;
    operationKey: string;
  }): Promise<void>;
  cancelPaymentIntent(input: {
    paymentIntentId: string;
    stripeAccountId: string;
    operationKey: string;
  }): Promise<void>;
};

export async function neutralizeTicketStripeAttempt(
  attempt: TicketStripeAttempt,
  stripeAccountId: string,
  neutralizer: TicketStripeNeutralizer,
): Promise<void> {
  if (attempt.flow === "stripe_checkout" && attempt.provider_checkout_id) {
    await neutralizer.expireCheckout({
      checkoutSessionId: attempt.provider_checkout_id,
      stripeAccountId,
      operationKey: `${attempt.provider_idempotency_key}:expire`,
    });
    return;
  }
  if (attempt.flow === "stripe_native" && attempt.provider_object_id) {
    await neutralizer.cancelPaymentIntent({
      paymentIntentId: attempt.provider_object_id,
      stripeAccountId,
      operationKey: `${attempt.provider_idempotency_key}:cancel`,
    });
    return;
  }
  throw new Error("provider_identity_missing");
}
