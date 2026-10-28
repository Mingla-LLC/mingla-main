// Issue #3645 — secure link to pay (or approve) one trip instalment. The first
// pay-link email is also the "before each payment" notice for pay-link rows.
// The URL carries a one-time token; it is never logged.
import { escapeEmailHtml, formatDueDate, formatInstallmentAmount, installmentEmailLayout } from "./formatDueDate.ts";

export interface InstallmentPayLinkEmailInput {
  purpose: "pay" | "approve";
  buyerName: string | null;
  tripTitle: string;
  brandName: string;
  amountCents: number;
  currency: string;
  dueAt: string;
  timezone: string | null;
  url: string;
}

export function renderInstallmentPayLinkEmail(input: InstallmentPayLinkEmailInput) {
  const amount = formatInstallmentAmount(input.amountCents, input.currency);
  const date = formatDueDate(input.dueAt, input.timezone);
  const name = input.buyerName?.trim() || "there";
  const approve = input.purpose === "approve";
  const subject = approve
    ? `Approve your ${amount} payment for ${input.tripTitle}`
    : `Your ${amount} payment for ${input.tripTitle} is due on ${date}`;
  const label = approve ? "Approve payment" : `Pay ${amount}`;
  const lead = approve
    ? `Your bank needs you to approve the <strong>${escapeEmailHtml(amount)}</strong> payment for <strong>${escapeEmailHtml(input.tripTitle)}</strong> with ${escapeEmailHtml(input.brandName)}.`
    : `Your <strong>${escapeEmailHtml(amount)}</strong> payment for <strong>${escapeEmailHtml(input.tripTitle)}</strong> with ${escapeEmailHtml(input.brandName)} is due on ${escapeEmailHtml(date)}. Pay securely with the button below, by card, bank or transfer.`;
  const html = installmentEmailLayout({
    heading: approve ? "Approve your payment" : "Your next payment",
    paragraphs: [
      `Hi ${escapeEmailHtml(name)},`,
      lead,
      approve
        ? "It only takes a moment. You won't be charged twice."
        : "If you pay by card, we'll charge the same card automatically for your next payments.",
    ],
    action: { url: input.url, label },
    footer: `This link is just for you. You received this because you booked ${escapeEmailHtml(input.tripTitle)} on Mingla.`,
  });
  const text = [
    approve ? "Approve your payment" : "Your next payment",
    "",
    `Hi ${name},`,
    "",
    approve
      ? `Your bank needs you to approve the ${amount} payment for ${input.tripTitle} with ${input.brandName}.`
      : `Your ${amount} payment for ${input.tripTitle} with ${input.brandName} is due on ${date}.`,
    `${label}: ${input.url}`,
  ].join("\n");
  return { subject, html, text };
}
