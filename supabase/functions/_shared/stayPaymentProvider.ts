import { paystackInitializeTransaction } from "./paystack.ts";
import { stripeTicketCheckout } from "./stripe.ts";
import { resolvePublishableKey } from "./stripeMode.ts";
import { getPaymentMethodTypes } from "./stripePaymentMethods.ts";

export type PreparedStayPayment = {
  attemptId: string;
  groupId: string;
  provider: "stripe" | "paystack";
  connectedAccountRef: string | null;
  amountMinor: string;
  currencyCode: string;
  applicationFeeMinor: string;
  buyerEmail: string | null;
  state: string;
};

export type StayPaymentSession =
  | {
    kind: "requires_payment";
    provider: "stripe";
    attemptId: string;
    providerPaymentRef: string;
    clientSecret: string;
    publishableKey: string;
    stripeAccountId: string;
    amountMinor: string;
    currencyCode: string;
  }
  | {
    kind: "requires_redirect";
    provider: "paystack";
    attemptId: string;
    providerPaymentRef: string;
    authorizationUrl: string;
    amountMinor: string;
    currencyCode: string;
  };

export type StayPaymentProviderDependencies = {
  createStripe?: typeof stripeTicketCheckout;
  initializePaystack?: typeof paystackInitializeTransaction;
  publishableKey?: typeof resolvePublishableKey;
};

function positiveSafeInteger(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("stay_invalid_provider_amount");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error("stay_invalid_provider_amount");
  }
  return parsed;
}

function nonnegativeSafeInteger(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("stay_invalid_provider_amount");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error("stay_invalid_provider_amount");
  }
  return parsed;
}

export async function createStayPaymentSession(
  prepared: PreparedStayPayment,
  idempotencyKey: string,
  dependencies: StayPaymentProviderDependencies = {},
): Promise<StayPaymentSession> {
  const amount = positiveSafeInteger(prepared.amountMinor);
  const applicationFee = nonnegativeSafeInteger(
    prepared.applicationFeeMinor,
  );
  const currency = prepared.currencyCode.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency) || prepared.state !== "created") {
    throw new Error("stay_invalid_provider_preparation");
  }

  if (prepared.provider === "stripe") {
    if (!prepared.connectedAccountRef?.startsWith("acct_")) {
      throw new Error("stay_stripe_account_required");
    }
    const stripe = (dependencies.createStripe ?? stripeTicketCheckout)();
    const body: Record<string, unknown> = {
      amount,
      currency,
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_purpose: "stay_reservation",
        stay_group_id: prepared.groupId,
        stay_payment_attempt_id: prepared.attemptId,
      },
    };
    if (applicationFee > 0) {
      body.application_fee_amount = applicationFee;
    }
    // @ts-ignore Stripe's Deno SDK namespace is runtime-provided.
    const intent = await stripe.paymentIntents.create(body, {
      stripeAccount: prepared.connectedAccountRef,
      idempotencyKey: `stay:${prepared.attemptId}:${idempotencyKey}`,
    });
    const clientSecret = String(intent.client_secret ?? "");
    if (!intent.id || !clientSecret) {
      throw new Error("stay_stripe_response_incomplete");
    }
    return {
      kind: "requires_payment",
      provider: "stripe",
      attemptId: prepared.attemptId,
      providerPaymentRef: String(intent.id),
      clientSecret,
      publishableKey: (dependencies.publishableKey ?? resolvePublishableKey)(),
      stripeAccountId: prepared.connectedAccountRef,
      amountMinor: prepared.amountMinor,
      currencyCode: prepared.currencyCode,
    };
  }

  if (
    prepared.currencyCode.toUpperCase() !== "NGN" ||
    !prepared.buyerEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prepared.buyerEmail)
  ) {
    throw new Error("stay_paystack_checkout_invalid");
  }
  const result = await (
    dependencies.initializePaystack ?? paystackInitializeTransaction
  )({
    email: prepared.buyerEmail,
    amountSubunits: amount,
    currency: "NGN",
    reference: `mingla_stay_${prepared.attemptId.replaceAll("-", "")}`,
    metadata: {
      mingla_purpose: "stay_reservation",
      stay_group_id: prepared.groupId,
      stay_payment_attempt_id: prepared.attemptId,
    },
    // The brand is payout-hold cut over before preparation. No subaccount or
    // transaction_charge fields: funds settle to Mingla for shared release.
  });
  return {
    kind: "requires_redirect",
    provider: "paystack",
    attemptId: prepared.attemptId,
    providerPaymentRef: result.reference,
    authorizationUrl: result.authorization_url,
    amountMinor: prepared.amountMinor,
    currencyCode: prepared.currencyCode,
  };
}
