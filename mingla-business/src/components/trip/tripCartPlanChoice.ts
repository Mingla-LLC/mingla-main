/**
 * tripCartPlanChoice — ORCH-1180 [trip-cart-installment-aware].
 *
 * Two tiny pure helpers that carry the buyer's per-package "pay over time" choice
 * from the public trip page §10 box all the way into the cart-level
 * CartContext.paymentPlanChoice the whole checkout reads. Before this, the
 * per-package choice (selectedLine.paymentPlanChoice) was dropped twice — the
 * public page reserved with `undefined` and the checkout cart seed parsed only
 * {ticketTypeId, quantity} — so the cart never learned the buyer wanted a plan and
 * charged the full price with no deposit/schedule.
 *
 * Both helpers COLLAPSE per-line choices into the single session-wide cart choice
 * (mirrors the consumer ConsumerTripDetailScreen): if ANY selected/seeded line pays
 * over time, the whole cart leads with the deposit; otherwise "full" (NEVER "auto",
 * so no installment rows are minted when no package is on a plan — the pay-in-full
 * opt-out, i-proposed-pay-in-full-opt-out-no-installment-rows). No money is computed
 * here — the cart's existing projectInstallmentSchedule branch owns deposit/schedule.
 */

import type { TripPaymentPlanChoice } from "@mingla/offering-rendering";

/**
 * Minimal line shape both the reserve collapse + the seed resolve read. Only
 * `paymentPlanChoice` is consulted; the real selected/seeded lines carry more
 * fields, which is why the helpers take a structural-supertype generic below.
 */
export interface TripCartLineChoice {
  paymentPlanChoice?: TripPaymentPlanChoice;
}

/**
 * FIX A — collapse the per-package plan choice of the selected lines into the
 * cart-level choice for the public-page Reserve. Any line on a plan → the whole
 * cart goes "installments"; else "full". Generic over the line shape so the real
 * selected/seeded lines (with ticketTypeId/quantity) pass without widening.
 */
export const collapseTripPlanChoice = (
  lines: ReadonlyArray<TripCartLineChoice>,
): TripPaymentPlanChoice =>
  lines.some((l) => l.paymentPlanChoice === "installments")
    ? "installments"
    : "full";

/** A seeded checkout line parsed from the `lines` route param JSON. */
export interface SeededTripLine {
  ticketTypeId: string;
  quantity: number;
  paymentPlanChoice?: TripPaymentPlanChoice;
}

/**
 * FIX B — parse the checkout `lines` route param into seeded cart lines, reading
 * each row's OPTIONAL paymentPlanChoice ("full" | "installments"). Malformed input
 * → []. Unknown/absent choice → the line is a plain full-price line (no choice).
 * This is the AUTHORITATIVE pay-over-time source: a stale scalar `plan` param can
 * disagree, but the lines JSON is what the §10 box actually selected.
 */
export const parseSeededTripLines = (
  raw: string | undefined,
): SeededTripLine[] => {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((row) => {
    if (
      row !== null &&
      typeof row === "object" &&
      typeof (row as { ticketTypeId?: unknown }).ticketTypeId === "string" &&
      typeof (row as { quantity?: unknown }).quantity === "number" &&
      (row as { quantity: number }).quantity > 0
    ) {
      const rawChoice = (row as { paymentPlanChoice?: unknown })
        .paymentPlanChoice;
      const choice: TripPaymentPlanChoice | undefined =
        rawChoice === "installments"
          ? "installments"
          : rawChoice === "full"
            ? "full"
            : undefined;
      return [
        {
          ticketTypeId: (row as { ticketTypeId: string }).ticketTypeId,
          quantity: Math.floor((row as { quantity: number }).quantity),
          ...(choice !== undefined ? { paymentPlanChoice: choice } : {}),
        },
      ];
    }
    return [];
  });
};

/**
 * FIX B — given the seeded lines parsed above and the inbound scalar `plan` param,
 * resolve the cart-level choice the seed effect should set. The lines JSON wins: if
 * any seeded line is "installments" the cart leads with the deposit, overriding a
 * possibly-stale scalar param; otherwise honor the scalar param (default "full").
 */
export const resolveSeededCartPlanChoice = (
  seededLines: ReadonlyArray<TripCartLineChoice>,
  scalarPlanParam: TripPaymentPlanChoice,
): TripPaymentPlanChoice =>
  seededLines.some((l) => l.paymentPlanChoice === "installments")
    ? "installments"
    : scalarPlanParam;
