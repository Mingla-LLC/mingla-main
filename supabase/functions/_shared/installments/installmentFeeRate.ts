/**
 * #4130 — the Mingla fee on an instalment uses the brand's effective rate.
 *
 * Every other sale reads `resolve_effective_take_rate_bps` (the brand's
 * override, else the platform default) and adds the fixed service fee. The
 * instalment paths used a hard-coded 4.5%, so a brand on a custom rate was
 * charged the default on every instalment. Both instalment paths
 * (createInstallmentPI and the installment webhook fallback) read the rate
 * here, so they cannot drift apart.
 *
 * If the rate cannot be read, the instalment is still charged at the
 * platform's standard 1.5% + 3% rather than blocked, and the failure is
 * logged: a missed instalment costs the buyer their booking, a default-rate
 * fee does not.
 */

// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { feeFromBps, MINGLA_SERVICE_FEE_BPS } from "../allInPricingEngine.ts";

/** The platform's standard take portion (1.5%), used only when the rate cannot be read. */
export const FALLBACK_TAKE_RATE_BPS = 150 as const;

export type InstallmentFeeRate = {
  /** Take portion + service fee, in basis points. */
  totalBps: number;
  takeRateBps: number;
  source: "brand_override" | "platform_default" | "fallback";
};

type RateClient = Pick<SupabaseClient, "rpc">;

/** The brand's effective take rate plus the service fee. Never throws. */
export async function resolveInstallmentFeeRate(
  supabase: RateClient,
  brandId: string | null,
): Promise<InstallmentFeeRate> {
  const fallback: InstallmentFeeRate = {
    totalBps: FALLBACK_TAKE_RATE_BPS + MINGLA_SERVICE_FEE_BPS,
    takeRateBps: FALLBACK_TAKE_RATE_BPS,
    source: "fallback",
  };
  if (brandId === null || brandId.length === 0) {
    console.error("[installmentFeeRate] no brand id; using the standard rate");
    return fallback;
  }
  try {
    const { data, error } = await supabase.rpc(
      "resolve_effective_take_rate_bps",
      { p_brand_id: brandId },
    );
    if (error) {
      console.error(
        "[installmentFeeRate] rate read failed; using the standard rate",
        error.message ?? error,
      );
      return fallback;
    }
    const row = (Array.isArray(data) ? data[0] : data) as {
      effective_take_rate_bps?: unknown;
      take_rate_source?: unknown;
    } | null;
    const bps = Number(row?.effective_take_rate_bps);
    if (row === null || row === undefined || !Number.isInteger(bps) || bps < 0 || bps > 3000) {
      console.error(
        "[installmentFeeRate] no usable rate for brand; using the standard rate",
        brandId,
      );
      return fallback;
    }
    return {
      totalBps: bps + MINGLA_SERVICE_FEE_BPS,
      takeRateBps: bps,
      source: row.take_rate_source === "brand_override"
        ? "brand_override"
        : "platform_default",
    };
  } catch (err) {
    console.error(
      "[installmentFeeRate] rate read threw; using the standard rate",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

/** The fee on one instalment, in minor units (integer bps math). */
export function installmentFeeCents(amountCents: number, rate: InstallmentFeeRate): number {
  return feeFromBps(amountCents, rate.totalBps);
}
