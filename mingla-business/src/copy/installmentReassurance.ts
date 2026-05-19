/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — single source of truth
 * for the buyer-facing installment-plan reassurance copy. Used by
 * `<InstallmentScheduleDisplay variant="buyer" />` on every plan-active
 * trip buyer touchpoint (canonical wiring list lives in the component
 * header per ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer +
 * Planner Surfaces]).
 *
 * Locked at SPEC time (SPEC_ORCH-0873 §3.5.3; ORCH-0882 added
 * `isProjection` clarifier per SC-9 / Constitution #9 — projected
 * pre-purchase dates must be honestly labeled). Future copy iteration →
 * new ORCH (not silent inline edits across consumers).
 */
export function installmentReassuranceText(input: {
  /** Formatted deposit, e.g. "$275.00". */
  depositFormatted: string;
  /** Formatted sum of all installments after the deposit, e.g. "$825.00". */
  remainingFormatted: string;
  /**
   * ORCH-0882 — when true, the dates above were projected from
   * `new Date()` because the buyer hasn't booked yet. We append a
   * one-sentence clarifier so the buyer understands the dates will
   * lock at booking time.
   */
  isProjection?: boolean;
}): string {
  const base =
    `You're paying ${input.depositFormatted} today. ` +
    `The remaining ${input.remainingFormatted} will charge automatically ` +
    `on the dates above. We'll email you before each charge.`;
  if (input.isProjection === true) {
    return base + " Dates assume you book today; they lock when you pay.";
  }
  return base;
}
