// #4490 spec 08 O2 — pricing a Till card payment (tap or scan) and its pay code.
//
// The carrier venue order is priced with the shared venue-order engine
// (computeVenueOrderMoney): fee on the lines and service charge, never on the
// tip, switches and take rate from resolve_brand_pricing_inputs, application
// fee = Mingla fee + platform service fee (#3645). The amount and the service
// charge share come from the database (issue_4490_till_card_prepare); nothing
// here is read from the client except the tip.

import {
  MINGLA_SERVICE_FEE_BPS,
  type PricingRegion,
  type PricingSwitches,
  taxBehaviorForRegion,
} from "./allInPricingEngine.ts";
import { computeVenueOrderMoney } from "./venueOrderPricing.ts";
import { resolveProviderRouting } from "./paymentProvider.ts";
import { readBrandPayoutHoldStamp } from "./payoutHoldStamp.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const STRIPE_REGIONS = ["GB", "US", "EU", "CH"] as const;
export const TILL_MAX_MINOR = 2147483647;

/** Same alphabet and length as door codes (no 0/O, 1/I/L). */
export const TILL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TILL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function generateTillCode(
  randomBytes: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 256 - (256 % TILL_CODE_ALPHABET.length);
  let out = "";
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= limit) continue; // no modulo bias
      out += TILL_CODE_ALPHABET[b % TILL_CODE_ALPHABET.length];
      if (out.length === 8) break;
    }
  }
  return out;
}

export function makeTillPayUrl(origin: string, code: string): string {
  if (!TILL_CODE_RE.test(code)) throw new Error("till_code_invalid");
  return `${origin.replace(/\/+$/, "")}/pay/till/${code}`;
}

export type TillCarrierPricing =
  | {
    ok: true;
    provider: "stripe" | "paystack";
    stripeAccountId: string | null;
    paystackSubaccount: string | null;
    isCutover: boolean;
    /** The p_money object issue_4490_till_card_start checks and writes. */
    money: Record<string, unknown>;
    totalCents: number;
    applicationFeeCents: number;
  }
  | { ok: false; code: string };

/**
 * Prices the carrier for one Till card payment. Refusals are Till codes:
 * till_card_not_ready (provider account not ready), till_card_tax_at_checkout
 * (tax added at checkout cannot be shown on a card reader or scan page),
 * brand_setup_incomplete (NG brand with no VAT country), till_payment_too_large.
 */
export async function priceTillCarrier(
  client: Client,
  input: {
    brandId: string;
    venueId: string;
    currency: string;
    amountMinor: number;
    serviceChargeMinor: number;
    tipMinor: number;
  },
): Promise<TillCarrierPricing> {
  const { data: rows, error } = await client.rpc(
    "resolve_brand_pricing_inputs",
    {
      p_brand_id: input.brandId,
      p_venue_id: input.venueId,
    },
  );
  if (error || !Array.isArray(rows) || rows.length === 0) {
    return { ok: false, code: "till_card_not_ready" };
  }
  const pricing = rows[0] as Record<string, unknown>;
  const routing = resolveProviderRouting({
    payment_provider: pricing.payment_provider as string | null,
    payment_country: pricing.payment_country as string | null,
    pricing_currency: pricing.pricing_currency as string | null,
  });
  const currency = String(pricing.pricing_currency ?? "").trim().toUpperCase();
  if (currency.length !== 3 || currency !== input.currency.toUpperCase()) {
    return { ok: false, code: "till_card_not_ready" };
  }
  const rawRegion = String(pricing.pricing_region ?? "").trim().toUpperCase();
  const region: PricingRegion = routing.provider === "paystack"
    ? "NG"
    : (STRIPE_REGIONS as readonly string[]).includes(rawRegion)
    ? rawRegion as PricingRegion
    : "GB";
  const switches: PricingSwitches = {
    pass_tax: pricing.pass_tax === true,
    pass_mingla_fee: pricing.pass_mingla_fee === true,
    pass_service_fee: pricing.pass_service_fee === true,
  };
  // The door rule (doorPayServer.ts): tax added on top at checkout is refused.
  if (
    routing.provider === "stripe" && switches.pass_tax &&
    taxBehaviorForRegion(region) === "exclusive"
  ) {
    return { ok: false, code: "till_card_tax_at_checkout" };
  }
  // #4389: an NG brand with no VAT country cannot price a card payment.
  if (routing.provider === "paystack" && pricing.vat_rate_bps === null) {
    return { ok: false, code: "brand_setup_incomplete" };
  }
  const stamp = await readBrandPayoutHoldStamp(
    client,
    input.brandId,
    "venue-till",
  );
  if (!stamp.ok) return { ok: false, code: "till_card_not_ready" };
  const stripeAccountId = typeof pricing.stripe_account_id === "string"
    ? pricing.stripe_account_id
    : null;
  const paystackSubaccount =
    typeof pricing.paystack_subaccount_code === "string"
      ? pricing.paystack_subaccount_code
      : null;
  if (routing.provider === "paystack") {
    if (!stamp.isCutover && !paystackSubaccount) {
      return { ok: false, code: "till_card_not_ready" };
    }
  } else if (!stripeAccountId || pricing.stripe_charges_enabled !== true) {
    return { ok: false, code: "till_card_not_ready" };
  }
  const effectiveTakeRateBps = Number(pricing.effective_take_rate_bps ?? 0);
  const money = computeVenueOrderMoney({
    subtotalCents: input.amountMinor - input.serviceChargeMinor,
    serviceChargeBps: 0,
    serviceChargeCentsOverride: input.serviceChargeMinor,
    tipBps: null,
    tipFlatCents: input.tipMinor > 0 ? input.tipMinor : null,
    switches,
    region,
    currency,
    effectiveTakeRateBps,
    takeRateSource:
      (pricing.take_rate_source as "brand_override" | "platform_default") ??
        "platform_default",
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    vatRateBps: pricing.vat_rate_bps === null
      ? 0
      : Number(pricing.vat_rate_bps),
  });
  if (money.totalCents <= 0) return { ok: false, code: "till_nothing_to_pay" };
  if (money.totalCents > TILL_MAX_MINOR) {
    return { ok: false, code: "till_payment_too_large" };
  }
  return {
    ok: true,
    provider: routing.provider,
    stripeAccountId: routing.provider === "stripe" ? stripeAccountId : null,
    paystackSubaccount,
    isCutover: stamp.isCutover,
    totalCents: money.totalCents,
    applicationFeeCents: money.minglaFeeCents + money.platformServiceFeeCents,
    money: {
      provider: routing.provider,
      stripeAccountId: routing.provider === "stripe" ? stripeAccountId : null,
      currency,
      subtotalCents: money.subtotalCents,
      serviceChargeCents: money.serviceChargeCents,
      tipCents: money.tipCents,
      effectiveTakeRateBps,
      serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
      minglaFeeCents: money.minglaFeeCents,
      platformServiceFeeCents: money.platformServiceFeeCents,
      passMinglaFee: switches.pass_mingla_fee,
      passServiceFee: switches.pass_service_fee,
      passTax: switches.pass_tax,
      buyerSubtotalCents: money.buyerSubtotalCents,
      taxAmountCents: money.taxAmountCents,
      totalCents: money.totalCents,
      pricingBreakdown: money.pricingBreakdown,
    },
  };
}

/** Paystack's verified `channel`, in the Till's words (NULL when unknown). */
export function tillChannelFromPaystack(channel: unknown): string | null {
  return typeof channel === "string" &&
      ["card", "bank_transfer", "ussd", "bank"].includes(channel)
    ? channel
    : null;
}
