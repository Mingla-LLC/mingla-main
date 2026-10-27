/**
 * ORCH-1006 [Universal all-in pricing engine] — client-side preview mirror.
 *
 * The buyer-total math has ONE server owner: `supabase/functions/_shared/
 * allInPricingEngine.ts`. This module is a deliberately-tiny PURE mirror of the
 * pre-tax portion of that engine, used ONLY to drive the authoring-time live
 * "Buyer pays / You keep" preview (Surface 1/2). It is NOT a source of truth —
 * the server recomputes the canonical `pricing_breakdown` at checkout.
 *
 * Parity contract (keep in lockstep with the engine):
 *   - `feeFromBps` == engine `feeFromBps` (integer bps math, no float).
 *   - configured VAT == engine `computeConfigVat` (integer bps on subtotal).
 *   - GB is inclusive-VAT, so buyer_total == buyer_subtotal (VAT extracted
 *     INSIDE the total, never added on top) — the preview "Buyer pays" is exact
 *     for GB without any Stripe round-trip.
 *
 * Stripe-tax markets pass no rate here, preserving their inclusive/regional
 * behavior. Nigeria passes country_vat_config.NG's mirrored 750 bps rate.
 */

import { MINGLA_SERVICE_FEE_BPS } from "../constants/pricing";

export interface PreviewSwitches {
  /** NULL = inherit brand default; resolved to a concrete boolean before preview. */
  passTax: boolean;
  passMinglaFee: boolean;
  passServiceFee: boolean;
}

export interface PreviewInput {
  /** Sum of tier prices in CENTS (pre-tax, pre-fee). */
  baseCents: number;
  switches: PreviewSwitches;
  /** Mingla's take-rate in basis points (brand override or platform default). */
  effectiveTakeRateBps: number;
  /** Disclosed service fee in bps; defaults to the launch default. */
  serviceFeeBps?: number;
  /** Configured exclusive VAT in bps (Nigeria); absent for Stripe-tax markets. */
  vatRateBps?: number | null;
}

export interface PreviewResult {
  baseCents: number;
  miglaFeeCents: number;
  serviceFeeCents: number;
  /** What the buyer pays, all-in. */
  buyerPaysCents: number;
  /** Connected-account payout: buyer total minus Mingla's application fee. */
  youKeepCents: number;
  taxCents: number;
  /** Per-component split, mirroring engine `passed`/`absorbed`. */
  passed: { miglaFeeCents: number; serviceFeeCents: number; taxCents: number };
  absorbed: {
    miglaFeeCents: number;
    serviceFeeCents: number;
    taxCents: number;
  };
}

/** Integer basis-point money math — round(base × bps / 10000). Mirrors engine. */
export function feeFromBps(baseCents: number, bps: number): number {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0;
  return Math.round((baseCents * bps) / 10000);
}

/** The grossed-up buyer total BEFORE tax (= all-in for GB inclusive VAT). */
export function previewBuyerPays(input: PreviewInput): number {
  return computePreview(input).buyerPaysCents;
}

/** Full preview split for the "Buyer pays / You keep" chip. */
export function computePreview(input: PreviewInput): PreviewResult {
  const serviceFeeBps = input.serviceFeeBps ?? MINGLA_SERVICE_FEE_BPS;
  const vatRateBps = input.vatRateBps ?? 0;
  const base = Number.isFinite(input.baseCents)
    ? Math.max(0, input.baseCents)
    : 0;
  const miglaFeeCents = feeFromBps(base, input.effectiveTakeRateBps);
  const serviceFeeCents = feeFromBps(base, serviceFeeBps);

  const passedMingla = input.switches.passMinglaFee ? miglaFeeCents : 0;
  const passedService = input.switches.passServiceFee ? serviceFeeCents : 0;

  const buyerSubtotalCents = base + passedMingla + passedService;
  const taxCents = feeFromBps(buyerSubtotalCents, vatRateBps);
  const passedTaxCents = input.switches.passTax ? taxCents : 0;
  const buyerPaysCents = buyerSubtotalCents + passedTaxCents;
  // The connected account receives the provider charge minus Mingla's
  // application fee. VAT is not withheld or filed by Mingla.
  const youKeepCents = buyerPaysCents - miglaFeeCents - serviceFeeCents;

  return {
    baseCents: base,
    miglaFeeCents,
    serviceFeeCents,
    buyerPaysCents,
    youKeepCents,
    taxCents,
    passed: {
      miglaFeeCents: passedMingla,
      serviceFeeCents: passedService,
      taxCents: passedTaxCents,
    },
    absorbed: {
      miglaFeeCents: input.switches.passMinglaFee ? 0 : miglaFeeCents,
      serviceFeeCents: input.switches.passServiceFee ? 0 : serviceFeeCents,
      taxCents: input.switches.passTax ? 0 : taxCents,
    },
  };
}
