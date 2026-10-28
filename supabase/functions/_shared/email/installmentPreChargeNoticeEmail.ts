// Issue #3645 (D-1, both rails) — "before each payment" notice for an
// instalment charged automatically to the saved card. Keeps the promise the
// buyer terms already make: "We'll email you before each charge."
import { escapeEmailHtml, formatDueDate, formatInstallmentAmount, installmentEmailLayout } from "./formatDueDate.ts";

export interface InstallmentPreChargeNoticeInput {
  buyerName: string | null;
  tripTitle: string;
  brandName: string;
  amountCents: number;
  currency: string;
  dueAt: string;
  timezone: string | null;
  /** Card ending shown when known; otherwise "your saved card". */
  cardLast4: string | null;
}

export function renderInstallmentPreChargeNoticeEmail(input: InstallmentPreChargeNoticeInput) {
  const amount = formatInstallmentAmount(input.amountCents, input.currency);
  const date = formatDueDate(input.dueAt, input.timezone);
  const card = input.cardLast4 && /^[0-9]{4}$/.test(input.cardLast4)
    ? `your card ending ${input.cardLast4}`
    : "your saved card";
  const subject = `Your ${amount} payment for ${input.tripTitle} is due on ${date}`;
  const name = input.buyerName?.trim() || "there";
  const html = installmentEmailLayout({
    heading: "Your next payment is coming up",
    paragraphs: [
      `Hi ${escapeEmailHtml(name)},`,
      `Your <strong>${escapeEmailHtml(amount)}</strong> payment for <strong>${escapeEmailHtml(input.tripTitle)}</strong> with ${escapeEmailHtml(input.brandName)} is due on ${escapeEmailHtml(date)}. We'll charge ${escapeEmailHtml(card)} automatically.`,
      "Nothing to do if your card is ready. Your bank may ask you to approve the payment.",
    ],
    footer: `You received this because you booked ${escapeEmailHtml(input.tripTitle)} on Mingla.`,
  });
  const text = [
    "Your next payment is coming up",
    "",
    `Hi ${name},`,
    "",
    `Your ${amount} payment for ${input.tripTitle} with ${input.brandName} is due on ${date}. We'll charge ${card} automatically.`,
    "Nothing to do if your card is ready. Your bank may ask you to approve the payment.",
  ].join("\n");
  return { subject, html, text };
}
