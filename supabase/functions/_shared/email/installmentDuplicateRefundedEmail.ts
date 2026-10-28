// Issue #3645 — a second payment for an instalment that was already paid (or
// is no longer due) is refunded automatically; this tells the buyer.
import { escapeEmailHtml, formatInstallmentAmount, installmentEmailLayout } from "./formatDueDate.ts";

export interface InstallmentDuplicateRefundedInput {
  buyerName: string | null;
  tripTitle: string;
  amountCents: number;
  currency: string;
}

export function renderInstallmentDuplicateRefundedEmail(input: InstallmentDuplicateRefundedInput) {
  const amount = formatInstallmentAmount(input.amountCents, input.currency);
  const name = input.buyerName?.trim() || "there";
  const subject = `We refunded a duplicate ${amount} payment for ${input.tripTitle}`;
  const html = installmentEmailLayout({
    heading: "We refunded a duplicate payment",
    paragraphs: [
      `Hi ${escapeEmailHtml(name)},`,
      `We received an extra <strong>${escapeEmailHtml(amount)}</strong> payment for <strong>${escapeEmailHtml(input.tripTitle)}</strong> and refunded it in full. It can take up to 10 working days to reach you.`,
      "Your booking is not affected.",
    ],
    footer: `You received this because you booked ${escapeEmailHtml(input.tripTitle)} on Mingla.`,
  });
  const text = [
    "We refunded a duplicate payment",
    "",
    `Hi ${name},`,
    "",
    `We received an extra ${amount} payment for ${input.tripTitle} and refunded it in full. It can take up to 10 working days to reach you.`,
    "Your booking is not affected.",
  ].join("\n");
  return { subject, html, text };
}
