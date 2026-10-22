/**
 * ORCH-1006 [Universal all-in pricing engine] — client-side preview mirror.
 *
 * The buyer-total math has ONE server owner: `supabase/functions/_shared/
 * allInPricingEngine.ts`. This module is a deliberately-tiny PURE mirror of the
 * pre-tax portion of that engine, used ONLY to drive the authoring-time live
 * "Buyer pays" preview chip (Surface 1/2). It is NOT a source of truth — the
 * server recomputes the canonical `pricing_breakdown` at checkout, and the
 * receipt carries the real Stripe-computed VAT.
 *
 * Parity contract (keep in lockstep with the engine):
 *   - `feeFromBps` == engine `feeFromBps` (integer bps math, no float).
 *   - `previewBuyerPays` == engine `computeBuyerSubtotal().buyerSubtotalCents`.
 *   - GB is inclusive-VAT, so buyer_total == buyer_subtotal (VAT extracted
 *     INSIDE the total, never added on top) — the preview "Buyer pays" is exact
 *     for GB without any Stripe round-trip.
 *
 * The #3645 pricing preview is deliberately limited to the approved 4.5%:
 * 1.5% Mingla fee + 3% service fee. It never invents a payment-provider or
 * automatic-tax amount; those come from stored payout evidence and appear as
 * separate lines where applicable.
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
}

export interface PreviewResult {
  baseCents: number;
  miglaFeeCents: number;
  serviceFeeCents: number;
  /** What the buyer pays, all-in (exact for GB inclusive VAT). */
  buyerPaysCents: number;
  /** Host amount after the approved 4.5% fee components in this preview. */
  youKeepFloorCents: number;
  /** Per-component split, mirroring engine `passed`/`absorbed` (tax excluded). */
  passed: { miglaFeeCents: number; serviceFeeCents: number };
  absorbed: { miglaFeeCents: number; serviceFeeCents: number };
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
  const base = Number.isFinite(input.baseCents) ? Math.max(0, input.baseCents) : 0;
  const miglaFeeCents = feeFromBps(base, input.effectiveTakeRateBps);
  const serviceFeeCents = feeFromBps(base, serviceFeeBps);

  const passedMingla = input.switches.passMinglaFee ? miglaFeeCents : 0;
  const passedService = input.switches.passServiceFee ? serviceFeeCents : 0;

  const buyerPaysCents = base + passedMingla + passedService;
  // Flat 4.5% payout truth: both Mingla's 1.5% take and the disclosed 3%
  // service fee are retained from the sale. Passing a component increases the
  // buyer total by that same component; absorbing it lowers what the host gets.
  const youKeepFloorCents = buyerPaysCents - miglaFeeCents - serviceFeeCents;

  return {
    baseCents: base,
    miglaFeeCents,
    serviceFeeCents,
    buyerPaysCents,
    youKeepFloorCents,
    passed: { miglaFeeCents: passedMingla, serviceFeeCents: passedService },
    absorbed: {
      miglaFeeCents: input.switches.passMinglaFee ? 0 : miglaFeeCents,
      serviceFeeCents: input.switches.passServiceFee ? 0 : serviceFeeCents,
    },
  };
}
