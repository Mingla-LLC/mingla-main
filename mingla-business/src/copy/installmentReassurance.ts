/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — single source of truth
 * for the buyer-facing installment-plan reassurance copy. Used by
 * <InstallmentScheduleDisplay variant="buyer" /> on all 3 buyer-anon-web
 * checkout routes (`/checkout/[eventId]/{index,buyer,payment}.tsx`).
 *
 * Locked at SPEC time (SPEC_ORCH-0873 §3.5.3). Future copy iteration → new
 * ORCH (not silent inline edits across 3 files).
 */
export function installmentReassuranceText(input: {
  /** Formatted deposit, e.g. "$275.00". */
  depositFormatted: string;
  /** Formatted sum of all installments after the deposit, e.g. "$825.00". */
  remainingFormatted: string;
}): string {
  return (
    `You're paying ${input.depositFormatted} today. ` +
    `The remaining ${input.remainingFormatted} will charge automatically ` +
    `on the dates above. We'll email you before each charge.`
  );
}
