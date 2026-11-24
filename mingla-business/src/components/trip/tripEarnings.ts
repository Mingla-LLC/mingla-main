/**
 * #4522 — the numbers behind the builder's "What you earn" card. Every figure is
 * `pricingPreview.ts` (`computePreview`), never a second copy of the fee rules.
 *
 * Imported only by `TripEarningsCardBody`, which loads in the same chunk as the
 * "Who covers costs" section (`pricing/WhoCoversCostsChunk`), the other user of
 * the fee preview. Imported from the wizard's chunk it would be hoisted into
 * `__common` (the boot payload; ORCH-1083).
 */

import { computePreview, type PreviewSwitches } from "../../utils/pricingPreview";

export interface EarningsInput {
  /** Package price in minor units (cents/kobo). */
  priceMinor: number;
  /** null = the brand's rate could not be read: no fee rows are invented. */
  takeRateBps: number | null;
  serviceFeeBps?: number;
  switches: PreviewSwitches;
  vatRateBps?: number | null;
}

export interface EarningsRows {
  priceMinor: number;
  /** The Mingla fee (take rate + service fee) the host pays out of the price. */
  feeMinor: number;
  /** The part of the fee added to the buyer's price instead. */
  feePassedMinor: number;
  vatMinor: number | null;
  receiveMinor: number;
}

/** null when the rate is unknown ("We'll show your earnings once your payout settings load."). */
export function computeEarningsRows(input: EarningsInput): EarningsRows | null {
  if (input.takeRateBps === null) return null;
  const r = computePreview({
    baseCents: input.priceMinor,
    switches: input.switches,
    effectiveTakeRateBps: input.takeRateBps,
    serviceFeeBps: input.serviceFeeBps,
    vatRateBps: input.vatRateBps,
  });
  const hasVat = input.vatRateBps !== null && input.vatRateBps !== undefined && input.vatRateBps > 0;
  return {
    priceMinor: r.baseCents,
    feeMinor: r.absorbed.miglaFeeCents + r.absorbed.serviceFeeCents,
    feePassedMinor: r.passed.miglaFeeCents + r.passed.serviceFeeCents,
    vatMinor: hasVat ? r.taxCents : null,
    receiveMinor: r.youKeepCents,
  };
}

/**
 * "At {spots} travelers": what the host receives if every spot on every priced
 * package sells, each package at its own price. Packages with no spots set are
 * left out (never assumed).
 */
export function earningsAtFullCapacity(
  packages: ReadonlyArray<{ priceMinor: number; spots: number | null }>,
  base: Omit<EarningsInput, "priceMinor">,
): { spots: number; receiveMinor: number } | null {
  let spots = 0;
  let receive = 0;
  for (const p of packages) {
    if (p.spots === null || p.spots <= 0 || p.priceMinor <= 0) continue;
    const rows = computeEarningsRows({ ...base, priceMinor: p.priceMinor });
    if (rows === null) return null;
    spots += p.spots;
    receive += rows.receiveMinor * p.spots;
  }
  return spots > 0 ? { spots, receiveMinor: receive } : null;
}
