/** Provider-neutral buyer copy for a trip payment plan. */
export function installmentReassuranceText(input: {
  depositFormatted: string;
  remainingFormatted: string;
  isProjection?: boolean;
  collection?: "auto_card" | "auto_card_or_pay_link";
}): string {
  const base = input.collection === "auto_card_or_pay_link"
    ? `You're paying ${input.depositFormatted} today. The remaining ${input.remainingFormatted} is due on the dates above. If you pay today by card, we'll charge the same card automatically on each date; otherwise we'll email you a secure link to pay. Your bank may ask you to approve a payment. We'll email you before each payment.`
    : `You're paying ${input.depositFormatted} today. The remaining ${input.remainingFormatted} will charge automatically on the dates above. We'll email you before each charge.`;
  return input.isProjection === true
    ? base + " Dates assume you book today; they lock when you pay."
    : base;
}
