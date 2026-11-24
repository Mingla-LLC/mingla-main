/**
 * issue #4522 (rework N2) — the overpayment lane's production wiring: the
 * refund Stripe client, the Paystack refund helper and the existing
 * instalment ops alert. A request path (a webhook, the cancel path) calls
 * returnOrderOverpaymentsBestEffort right after money was held; it never
 * throws, because the scheduled sweep retries anything left.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPaystackRefund, getPaystackRefund } from "../paystackRefunds.ts";
import { stripeTicketRefund } from "../stripe.ts";
import { installmentOpsAlert } from "./installmentOpsAlert.ts";
import {
  type OverpaymentRefundDeps,
  type OverpaymentStripe,
  returnDueOverpayments,
  stripeAccountForBrandFrom,
} from "./overpaymentRefunds.ts";

export function defaultOverpaymentDeps(supabase: SupabaseClient): OverpaymentRefundDeps {
  return {
    supabase,
    stripe: () => stripeTicketRefund() as unknown as OverpaymentStripe,
    stripeAccountForBrand: (brandId) => stripeAccountForBrandFrom(supabase, brandId),
    createPaystackRefund,
    getPaystackRefund,
    alertOps: installmentOpsAlert,
  };
}

/** Start returning an order's due overpayments now; the sweep retries the rest. */
export async function returnOrderOverpaymentsBestEffort(
  supabase: SupabaseClient,
  orderId: string,
  deps: OverpaymentRefundDeps = defaultOverpaymentDeps(supabase),
): Promise<void> {
  try {
    await returnDueOverpayments(deps, orderId, 20);
  } catch (error) {
    console.error(JSON.stringify({
      event: "overpayment_return_deferred",
      orderId,
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    }));
  }
}
