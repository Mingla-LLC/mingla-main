/**
 * brandStripeDetachService — frontend wrapper for `brand-stripe-detach` edge fn.
 *
 * Per B2a Path C V3 SPEC §6 (detach flow) + DEC-121.
 *
 * Soft-deletes the brand's connected account locally and best-effort calls
 * `accounts.del` on Stripe. The edge fn always succeeds locally even if Stripe
 * rejects the delete (e.g., balance > 0); `stripeDeleteStatus` reflects the
 * Stripe-side outcome.
 *
 * Error contract per Const #3: throws on edge-fn error; never returns null.
 */

import { supabase } from "./supabase";

export type StripeDeleteStatus = "succeeded" | "rejected" | "skipped";

export interface BrandStripeDetachResult {
  /** Local soft-delete timestamp (ISO) */
  detachedAt: string;
  /** Stripe-side delete outcome */
  stripeDeleteStatus: StripeDeleteStatus;
  /** Stripe rejection reason if status === "rejected" (e.g., "balance_remaining") */
  rejectionReason: string | null;
}

interface RawDetachResponse {
  detached_at?: string;
  stripe_delete_status?: StripeDeleteStatus;
  rejection_reason?: string | null;
}

export async function detachBrandStripe(
  brandId: string,
): Promise<BrandStripeDetachResult> {
  const { data, error } = await supabase.functions.invoke<RawDetachResponse>(
    "brand-stripe-detach",
    { body: { brand_id: brandId } },
  );
  if (error) throw error;
  if (data === null) {
    throw new Error("detachBrandStripe: edge fn returned null");
  }
  if (typeof data.detached_at !== "string") {
    throw new Error("detachBrandStripe: missing detached_at in response");
  }
  return {
    detachedAt: data.detached_at,
    stripeDeleteStatus: data.stripe_delete_status ?? "skipped",
    rejectionReason: data.rejection_reason ?? null,
  };
}
