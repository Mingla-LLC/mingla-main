// Issue #3872 PR 1 (money truth) — the explicit order totals every ticket path
// writes from the SAME pricing breakdown whose total is sent to the provider.
//
// Invariant I-3872-PROVIDER-AMOUNT-EQUALS-BUYER-TOTAL (declared in
// _shared/__tests__/issue_3872_money_truth_totals.implementor.test.ts): on
// every ticket path (hosted Stripe, native Stripe, Paystack, free, installment
// deposit) the amount sent to the payment provider and the stored
// buyer_total_cents come from the same variable; finalize copies the session's
// totals and pricing_breakdown to the order.
//
// Column meanings (ticket_checkout_sessions and orders, added by
// 20271107003872_issue_3872_money_truth.sql):
//   list_subtotal_cents  sum of the ticket lines at list price
//   discount_cents       discounts applied (0 until discounts ship)
//   net_subtotal_cents   what the tickets cost after discounts, before fees
//   buyer_fees_cents     Mingla and service fees passed to the buyer
//   tax_cents            tax ADDED on top for the buyer (exclusive regimes);
//                        inclusive VAT sits inside the prices and is reported in
//                        pricing_breakdown.components.tax_cents
//   buyer_total_cents    what the provider charged
//                        = net_subtotal_cents + buyer_fees_cents + tax_cents
//   pricing_source       computed_at_checkout | provider_reconciled |
//                        legacy_reconstructed
//
// orders.total_cents keeps its old, path-dependent meaning (ticket base on
// Stripe, the all-in total on Paystack). New code must not read it for money.

import type {
  ComputeAllInInput,
  PricingBreakdown,
  PricingRegion,
} from "./allInPricingEngine.ts";
import { buildPricingBreakdown } from "./allInPricingEngine.ts";

export type PricingSource =
  | "computed_at_checkout"
  | "provider_reconciled"
  | "legacy_reconstructed";

export interface ExplicitOrderTotals {
  list_subtotal_cents: number;
  discount_cents: number;
  net_subtotal_cents: number;
  buyer_fees_cents: number;
  tax_cents: number;
  buyer_total_cents: number;
  pricing_source: PricingSource;
}

export interface MoneyTruthDiscount {
  id: string;
  kind: string;
  name: string;
  code: string | null;
  amountCents: number;
}

export type PricingBreakdownWithDiscounts = PricingBreakdown & {
  list_subtotal_cents: number;
  discount_cents: number;
  discounts: Array<{
    id: string;
    kind: string;
    name: string;
    code: string | null;
    amount_cents: number;
  }>;
};

function assertWholeNonNegative(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`order_money_truth_invalid_${name}:${value}`);
  }
}

/**
 * Derive the explicit totals from the breakdown whose buyer_total_cents is the
 * provider amount. Throws when the breakdown cannot satisfy the identity, so a
 * caller can never persist totals that disagree with the charge.
 */
export function explicitTotalsFromBreakdown(
  breakdown: PricingBreakdown,
  pricingSource: PricingSource = "computed_at_checkout",
  listSubtotalCents?: number,
): ExplicitOrderTotals {
  const net = breakdown.base_cents;
  const list = listSubtotalCents ?? net;
  const discount = list - net;
  const fees = breakdown.buyer_subtotal_cents - breakdown.base_cents;
  const tax = breakdown.buyer_total_cents - breakdown.buyer_subtotal_cents;
  assertWholeNonNegative("discount", discount);
  assertWholeNonNegative("net_subtotal", net);
  assertWholeNonNegative("buyer_fees", fees);
  assertWholeNonNegative("tax", tax);
  assertWholeNonNegative("buyer_total", breakdown.buyer_total_cents);
  return {
    list_subtotal_cents: list,
    discount_cents: discount,
    net_subtotal_cents: net,
    buyer_fees_cents: fees,
    tax_cents: tax,
    buyer_total_cents: breakdown.buyer_total_cents,
    pricing_source: pricingSource,
  };
}

/** The session row patch: the explicit totals plus the breakdown itself. */
export function sessionMoneyTruthPatch(
  breakdown: PricingBreakdown,
  pricingSource: PricingSource = "computed_at_checkout",
  listSubtotalCents?: number,
): ExplicitOrderTotals & { pricing_breakdown: PricingBreakdown } {
  return {
    ...explicitTotalsFromBreakdown(breakdown, pricingSource, listSubtotalCents),
    pricing_breakdown: breakdown,
  };
}

/** Add the immutable list/discount snapshot to the provider money breakdown. */
export function withDiscounts(
  breakdown: PricingBreakdown,
  input: {
    listSubtotalCents: number;
    discounts: readonly MoneyTruthDiscount[];
  },
): PricingBreakdownWithDiscounts {
  const discount = input.listSubtotalCents - breakdown.base_cents;
  assertWholeNonNegative("discount", discount);
  return {
    ...breakdown,
    list_subtotal_cents: input.listSubtotalCents,
    discount_cents: discount,
    discounts: input.discounts.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      code: entry.code,
      amount_cents: entry.amountCents,
    })),
  };
}

/**
 * The breakdown for a hosted Stripe Checkout Session at create time. The line
 * item is the fee-grossed pre-tax subtotal; Stripe's automatic tax may add tax
 * on top, which is reconciled from the paid Checkout Session's amount_total by
 * issue_3872_record_ticket_provider_total.
 */
export function hostedCheckoutBreakdown(
  input: ComputeAllInInput,
  lineItemAmountCents: number,
): PricingBreakdown {
  return buildPricingBreakdown({
    input,
    amountTotalCents: lineItemAmountCents,
    taxCents: 0,
    taxBasis: "provider_hosted_checkout",
    stripeTaxCalculationId: null,
  });
}

/**
 * The breakdown for a free (zero-total) checkout. Every amount is zero; the
 * region and switches record the event's configuration when it was readable.
 */
export function freeCheckoutBreakdown(args: {
  region: PricingRegion;
  currency: string;
  switches: ComputeAllInInput["switches"];
  effectiveTakeRateBps: number;
  takeRateSource: ComputeAllInInput["takeRateSource"];
}): PricingBreakdown {
  return buildPricingBreakdown({
    input: {
      baseCents: 0,
      switches: args.switches,
      region: args.region,
      currency: args.currency,
      effectiveTakeRateBps: args.effectiveTakeRateBps,
      takeRateSource: args.takeRateSource,
    },
    amountTotalCents: 0,
    taxCents: 0,
    taxBasis: "unresolved_flat_absorb",
    stripeTaxCalculationId: null,
  });
}

// deno-lint-ignore no-explicit-any
type MinimalSupabase = {
  from: (table: string) => any;
  rpc: (...args: any[]) => any;
};

/**
 * Persist the explicit totals and breakdown on an unfinalized ticket session.
 * Non-fatal by design: the provider call is already bound to the same
 * breakdown, and payment reconciliation (issue_3872_record_ticket_provider_total)
 * or the operator backfill fills any gap. Returns whether the write landed.
 */
export async function persistTicketSessionMoneyTruth(
  supabase: MinimalSupabase,
  checkoutSessionId: string,
  breakdown: PricingBreakdown,
  pricingSource: PricingSource = "computed_at_checkout",
  listSubtotalCents?: number,
): Promise<boolean> {
  try {
    const patch = sessionMoneyTruthPatch(
      breakdown,
      pricingSource,
      listSubtotalCents,
    );
    const { error } = await supabase
      .from("ticket_checkout_sessions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", checkoutSessionId)
      .is("order_id", null);
    if (error) {
      console.error("[order-money-truth] session totals write failed", {
        checkoutSessionId,
        message: String((error as { message?: unknown }).message ?? error),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[order-money-truth] session totals invalid", {
      checkoutSessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Record what the provider actually charged for a ticket session (and its
 * order, when finalize already ran). Non-fatal: a failure is logged and the
 * sale continues; the operator backfill reconciles any session left behind.
 */
export async function recordTicketProviderTotal(
  supabase: MinimalSupabase,
  args: {
    checkoutSessionId: string;
    provider: "stripe" | "paystack";
    providerTotalCents: number | null;
    providerTaxCents?: number | null;
  },
): Promise<Record<string, unknown> | null> {
  if (
    args.providerTotalCents === null ||
    !Number.isInteger(args.providerTotalCents) ||
    args.providerTotalCents < 0
  ) {
    return null;
  }
  try {
    const { data, error } = await supabase.rpc(
      "issue_3872_record_ticket_provider_total",
      {
        p_checkout_session_id: args.checkoutSessionId,
        p_provider: args.provider,
        p_provider_total_cents: args.providerTotalCents,
        p_provider_tax_cents: args.providerTaxCents ?? null,
      },
    );
    if (error) {
      console.error("[order-money-truth] provider total record failed", {
        checkoutSessionId: args.checkoutSessionId,
        message: String((error as { message?: unknown }).message ?? error),
      });
      return null;
    }
    const result = (data ?? null) as Record<string, unknown> | null;
    if (result && result.outcome === "mismatch") {
      console.error(
        "[order-money-truth] provider total disagrees with checkout",
        {
          checkoutSessionId: args.checkoutSessionId,
          result,
        },
      );
    }
    return result;
  } catch (err) {
    console.error("[order-money-truth] provider total record threw", {
      checkoutSessionId: args.checkoutSessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
