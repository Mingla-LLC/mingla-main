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
  status?: "detached" | "not_connected" | string;
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
  // ORCH-1140: a 200 with a recognized success status is SUCCESS even if a
  // field is missing (defense-in-depth against future response-shape drift —
  // the edge fn now always sends detached_at, but a missing field must never
  // again read a completed, destructive detach as a failure). A genuinely
  // malformed/failure body (no recognized success status) still throws;
  // non-2xx / null bodies still throw above.
  if (data.status !== "detached" && data.status !== "not_connected") {
    throw new Error("detachBrandStripe: unexpected response shape");
  }
  return {
    detachedAt:
      typeof data.detached_at === "string"
        ? data.detached_at
        : new Date().toISOString(),
    stripeDeleteStatus: data.stripe_delete_status ?? "skipped",
    rejectionReason: data.rejection_reason ?? null,
  };
}
