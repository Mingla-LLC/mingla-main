// Issue #1793 rework — resume the provider object already bound to an unpaid
// venue order. This is the only continuation owner used by create replays and
// the possession-token status endpoint. It never creates an order, PaymentIntent,
// Checkout Session, Paystack transaction, or charge.

export type VenueOrderContinuationRow = {
  id: string;
  brand_id: string;
  provider: string | null;
  payment_status: string;
  total_cents: number;
  currency: string;
  expires_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_account_id: string | null;
  paystack_reference: string | null;
  metadata: Record<string, unknown> | null;
};

export type VenueOrderPaymentContinuation =
  | {
    kind: "requires_payment";
    paymentIntentId: string;
    clientSecret: string;
    publishableKey: string;
    stripeAccountId: string;
    totalCents: number;
    currency: string;
  }
  | {
    kind: "requires_web_redirect";
    url: string;
  }
  | {
    kind: "requires_paystack_redirect";
    authorizationUrl: string;
  };

export type VenueOrderContinuationDependencies = {
  now?: () => number;
  publishableKey: () => string;
  retrievePaymentIntent: (
    paymentIntentId: string,
    stripeAccountId: string,
  ) => Promise<Record<string, unknown>>;
  retrieveCheckoutSession: (
    checkoutSessionId: string,
    stripeAccountId: string,
  ) => Promise<Record<string, unknown>>;
};

/** Stripe SDK adapter kept outside the pure resolver for deterministic tests. */
export function stripeVenueOrderContinuationDependencies(
  createStripe: () => {
    paymentIntents: { retrieve: (...args: unknown[]) => Promise<unknown> };
    checkout: {
      sessions: { retrieve: (...args: unknown[]) => Promise<unknown> };
    };
  },
  publishableKey: () => string,
): VenueOrderContinuationDependencies {
  return {
    publishableKey,
    retrievePaymentIntent: async (id, account) =>
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
      await createStripe().paymentIntents.retrieve(id, {}, {
        stripeAccount: account,
      }) as Record<string, unknown>,
    retrieveCheckoutSession: async (id, account) =>
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
      await createStripe().checkout.sessions.retrieve(id, {}, {
        stripeAccount: account,
      }) as Record<string, unknown>,
  };
}

function unexpired(row: VenueOrderContinuationRow, now: number): boolean {
  if (row.payment_status !== "pending") return false;
  if (row.expires_at === null) return true;
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function paystackUrl(row: VenueOrderContinuationRow): string | null {
  const continuation = row.metadata?.payment_continuation;
  if (continuation === null || typeof continuation !== "object") return null;
  const url = (continuation as Record<string, unknown>).authorization_url;
  const reference = (continuation as Record<string, unknown>).reference;
  if (typeof url !== "string" || reference !== row.paystack_reference) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
        parsed.hostname === "checkout.paystack.com"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Return the SAME live payment continuation, or null when the provider object
 * is no longer safely reusable. Provider metadata is checked against the row,
 * so a mismatched object can never be handed to this order.
 */
export async function resolveVenueOrderPaymentContinuation(
  row: VenueOrderContinuationRow,
  surface: "native" | "web",
  dependencies: VenueOrderContinuationDependencies,
): Promise<VenueOrderPaymentContinuation | null> {
  if (!unexpired(row, (dependencies.now ?? Date.now)())) return null;

  if (row.provider === "paystack") {
    if (!row.paystack_reference) return null;
    const authorizationUrl = paystackUrl(row);
    return authorizationUrl === null
      ? null
      : { kind: "requires_paystack_redirect", authorizationUrl };
  }

  if (row.provider !== "stripe" || !row.stripe_account_id) return null;

  if (surface === "native") {
    if (!row.stripe_payment_intent_id) return null;
    let intent: Record<string, unknown>;
    try {
      intent = await dependencies.retrievePaymentIntent(
        row.stripe_payment_intent_id,
        row.stripe_account_id,
      );
    } catch {
      return null;
    }
    const metadata = intent.metadata as Record<string, unknown> | undefined;
    const status = String(intent.status ?? "");
    const clientSecret = String(intent.client_secret ?? "");
    if (
      String(intent.id ?? "") !== row.stripe_payment_intent_id ||
      Number(intent.amount) !== row.total_cents ||
      String(intent.currency ?? "").toUpperCase() !==
        row.currency.toUpperCase() ||
      metadata?.mingla_venue_order_id !== row.id ||
      metadata?.mingla_brand_id !== row.brand_id ||
      !["requires_payment_method", "requires_confirmation", "requires_action"]
        .includes(status) ||
      clientSecret === ""
    ) {
      return null;
    }
    return {
      kind: "requires_payment",
      paymentIntentId: row.stripe_payment_intent_id,
      clientSecret,
      publishableKey: dependencies.publishableKey(),
      stripeAccountId: row.stripe_account_id,
      totalCents: row.total_cents,
      currency: row.currency,
    };
  }

  if (!row.stripe_checkout_session_id) return null;
  let session: Record<string, unknown>;
  try {
    session = await dependencies.retrieveCheckoutSession(
      row.stripe_checkout_session_id,
      row.stripe_account_id,
    );
  } catch {
    return null;
  }
  const metadata = session.metadata as Record<string, unknown> | undefined;
  const url = String(session.url ?? "");
  if (
    String(session.id ?? "") !== row.stripe_checkout_session_id ||
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    Number(session.amount_total) !== row.total_cents ||
    String(session.currency ?? "").toUpperCase() !==
      row.currency.toUpperCase() ||
    metadata?.mingla_venue_order_id !== row.id ||
    metadata?.mingla_brand_id !== row.brand_id ||
    !url.startsWith("https://checkout.stripe.com/")
  ) {
    return null;
  }
  return { kind: "requires_web_redirect", url };
}
