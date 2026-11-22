/**
 * #4490 Explorer W4 — the native venue checkout's server calls (spec 06 W4).
 *
 * The same `venue-offers` and `venue-membership-pay-link` actions buyer web
 * uses (`mingla-business/src/services/venueOfferGuestService.ts`,
 * `venueMembershipGuestService.ts`), on the signed-in owner path: every call
 * carries the user's session (the Supabase client adds it), never a booking or
 * member token, and the token a `hold` or `membership_join` answer carries is
 * dropped here, never kept (rule 3). `pay` always sends `channel: "app"`, which
 * changes only the server's own return address (`/paid/visit/<id>`).
 *
 * Nothing here computes a price: every amount is read from the server's
 * answer. Failures throw `VenuePurchaseError` with the server's code; the sheet
 * turns codes into words (`venueCheckoutNoticeFor`), never a raw code.
 */
import { invokeVenueFunction, VENUE_READ_TIMEOUT_MS, VenuePurchaseError } from "./venuePurchaseService";

/** A write may take longer than a read; the app's fetch wrapper caps every call at 20 s. */
export const VENUE_WRITE_TIMEOUT_MS = 20_000;
/** One `confirm_return` round (the polls run their own clock around it). */
export const VENUE_CONFIRM_TIMEOUT_MS = 8_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;

// ─── the payment session `pay` returns ─────────────────────────────────

export type VenuePaymentSession =
  | { readonly provider: "paystack"; readonly authorizationUrl: string }
  | {
      readonly provider: "stripe";
      readonly clientSecret: string;
      readonly publishableKey: string;
      readonly stripeAccountId: string;
      readonly amountMinor: number | null;
      readonly currencyCode: string | null;
    };

/**
 * The provider session from a `pay` answer (`createStayPaymentSession`):
 * Paystack → an https payment page; Stripe → a PaymentSheet session. Anything
 * else is no session. The return address the answer also carries is the
 * server's and is never read here.
 */
export function parseVenuePaymentSession(raw: unknown): VenuePaymentSession | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "requires_redirect" && raw.provider === "paystack") {
    const url = raw.authorizationUrl;
    return typeof url === "string" && /^https:\/\/\S+$/.test(url) ? { provider: "paystack", authorizationUrl: url } : null;
  }
  if (raw.kind === "requires_payment" && raw.provider === "stripe") {
    const { clientSecret, publishableKey, stripeAccountId } = raw;
    if (typeof clientSecret !== "string" || clientSecret.length === 0) return null;
    if (typeof publishableKey !== "string" || publishableKey.length === 0) return null;
    if (typeof stripeAccountId !== "string" || stripeAccountId.length === 0) return null;
    return {
      provider: "stripe",
      clientSecret,
      publishableKey,
      stripeAccountId,
      amountMinor: num(raw.amountMinor),
      currencyCode: typeof raw.currencyCode === "string" ? raw.currencyCode : null,
    };
  }
  return null;
}

export type VenueConfirmAnswer = "confirmed" | "pending" | "failed" | "not_paid" | "nothing_to_confirm";

function confirmAnswer(value: unknown): VenueConfirmAnswer {
  return value === "confirmed" || value === "pending" || value === "failed" || value === "not_paid"
    ? value
    : "nothing_to_confirm";
}

/** Drop any token field before an answer leaves this module (rule 3). */
function withoutTokens(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const { bookingToken: _b, memberToken: _m, token: _t, ...rest } = raw;
  return rest;
}

// ─── venue-offers ─────────────────────────────────────────────────────────

export const venueOfferCheckoutService = {
  /** One live offer's public detail (no identity needed). */
  async offer(input: { brandSlug: string; venueSlug: string; offeringId: string }): Promise<unknown> {
    return invokeVenueFunction("venue-offers", { action: "offer", ...input }, { timeoutMs: VENUE_READ_TIMEOUT_MS });
  },

  async availability(input: {
    offeringId: string;
    from: string;
    to: string;
    priceOptionId?: string | null;
    guests?: number | null;
  }): Promise<unknown> {
    return invokeVenueFunction(
      "venue-offers",
      {
        action: "availability",
        offeringId: input.offeringId,
        from: input.from,
        to: input.to,
        ...(input.priceOptionId ? { priceOptionId: input.priceOptionId } : {}),
        ...(typeof input.guests === "number" ? { guests: input.guests } : {}),
      },
      { timeoutMs: VENUE_READ_TIMEOUT_MS },
    );
  },

  async hireOptions(input: { offeringId: string; windowId: string; guests: number | null }): Promise<unknown> {
    return invokeVenueFunction(
      "venue-offers",
      {
        action: "hire_options",
        offeringId: input.offeringId,
        windowId: input.windowId,
        ...(input.guests !== null ? { guests: input.guests } : {}),
      },
      { timeoutMs: VENUE_READ_TIMEOUT_MS },
    );
  },

  async hourDay(input: { offeringId: string; date: string; guests: number | null }): Promise<unknown> {
    return invokeVenueFunction(
      "venue-offers",
      {
        action: "hour_day",
        offeringId: input.offeringId,
        date: input.date,
        ...(input.guests !== null ? { guests: input.guests } : {}),
      },
      { timeoutMs: VENUE_READ_TIMEOUT_MS },
    );
  },

  /** The server's price for the choice (`issue_4490_quote_offer`). The body is the choice only: no amount. */
  async quote(input: { body: Record<string, unknown>; cartKey: string; idempotencyKey: string }): Promise<unknown> {
    const { action: _a, totalMinor: _t, amountMinor: _m, ...choice } = input.body;
    return invokeVenueFunction(
      "venue-offers",
      { ...choice, action: "quote", cartKey: input.cartKey, idempotencyKey: input.idempotencyKey },
      { timeoutMs: VENUE_READ_TIMEOUT_MS },
    );
  },

  /** Hold the places (a replay with the same key returns the first booking). */
  async hold(input: {
    quoteId: string;
    guest: { name: string; email: string; phone?: string; phoneCountryIso?: string };
    cartKey: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    return withoutTokens(
      await invokeVenueFunction(
        "venue-offers",
        {
          action: "hold",
          quoteId: input.quoteId,
          guest: input.guest,
          cartKey: input.cartKey,
          idempotencyKey: input.idempotencyKey,
        },
        { timeoutMs: VENUE_WRITE_TIMEOUT_MS },
      ),
    );
  },

  /** The payment session for the booking; `channel: "app"` changes only the return address. */
  async pay(input: {
    groupId: string;
    expectedVersion: number;
    idempotencyKey: string;
    payMode: "deposit" | "full" | null;
  }): Promise<VenuePaymentSession> {
    if (!UUID.test(input.groupId)) throw new VenuePurchaseError("invalid_request");
    const raw = await invokeVenueFunction(
      "venue-offers",
      {
        action: "pay",
        groupId: input.groupId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        ...(input.payMode !== null ? { payMode: input.payMode } : {}),
        channel: "app",
      },
      { timeoutMs: VENUE_WRITE_TIMEOUT_MS },
    );
    const session = parseVenuePaymentSession(raw);
    if (session === null) throw new VenuePurchaseError("offer_payment_unavailable");
    return session;
  },

  async confirmReturn(groupId: string): Promise<{ outcome: VenueConfirmAnswer; booking: unknown }> {
    const raw = await invokeVenueFunction(
      "venue-offers",
      { action: "confirm_return", groupId },
      { timeoutMs: VENUE_CONFIRM_TIMEOUT_MS },
    );
    return {
      outcome: confirmAnswer(isObject(raw) ? raw.outcome : null),
      booking: isObject(raw) ? withoutTokens(raw.booking ?? null) : null,
    };
  },

  async get(groupId: string): Promise<unknown> {
    return withoutTokens(
      await invokeVenueFunction("venue-offers", { action: "get", groupId }, { timeoutMs: VENUE_READ_TIMEOUT_MS }),
    );
  },

  // ─── plans ──────────────────────────────────────────────────────────────

  async membershipJoin(input: {
    planId: string;
    member: { name: string; email: string; phone?: string };
    startOn: string | null;
    cartKey: string;
    idempotencyKey: string;
  }): Promise<{ subscriptionId: string; status: string | null; raw: unknown }> {
    const raw = withoutTokens(
      await invokeVenueFunction(
        "venue-offers",
        {
          action: "membership_join",
          planId: input.planId,
          member: input.member,
          ...(input.startOn !== null ? { startOn: input.startOn } : {}),
          cartKey: input.cartKey,
          idempotencyKey: input.idempotencyKey,
        },
        { timeoutMs: VENUE_WRITE_TIMEOUT_MS },
      ),
    );
    const subscriptionId = isObject(raw) && typeof raw.subscriptionId === "string" ? raw.subscriptionId : null;
    if (subscriptionId === null || !UUID.test(subscriptionId)) throw new VenuePurchaseError("membership_request_failed");
    return { subscriptionId, status: isObject(raw) && typeof raw.status === "string" ? raw.status : null, raw };
  },

  /** The plan's first payment (`venue-membership-pay-link` pay, the web join flow's call) with `channel: "app"`. */
  async memberPay(input: { subscriptionId: string; idempotencyKey: string }): Promise<VenuePaymentSession> {
    const raw = await invokeVenueFunction(
      "venue-membership-pay-link",
      { action: "pay", subscriptionId: input.subscriptionId, idempotencyKey: input.idempotencyKey, channel: "app" },
      { timeoutMs: VENUE_WRITE_TIMEOUT_MS },
    );
    const session = parseVenuePaymentSession(raw);
    if (session === null) throw new VenuePurchaseError("membership_payment_unavailable");
    return session;
  },

  async memberConfirm(subscriptionId: string): Promise<{ outcome: VenueConfirmAnswer; member: unknown }> {
    const raw = await invokeVenueFunction(
      "venue-membership-pay-link",
      { action: "confirm_return", subscriptionId },
      { timeoutMs: VENUE_CONFIRM_TIMEOUT_MS },
    );
    return {
      outcome: confirmAnswer(isObject(raw) ? raw.outcome : null),
      member: isObject(raw) ? withoutTokens(raw.member ?? null) : null,
    };
  },

  async membershipGet(subscriptionId: string): Promise<unknown> {
    return withoutTokens(
      await invokeVenueFunction(
        "venue-offers",
        { action: "membership_get", subscriptionId },
        { timeoutMs: VENUE_READ_TIMEOUT_MS },
      ),
    );
  },
};

export type VenueOfferCheckoutService = typeof venueOfferCheckoutService;
