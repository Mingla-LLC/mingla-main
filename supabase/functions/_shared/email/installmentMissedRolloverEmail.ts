// issue #4522 (D-7, spec §5.4 item 9) — a payment that missed every automatic
// retry on a v2 plan was moved onto the later payments: the booking is NOT at
// risk. This replaces the "your booking is at risk" dunning for that row, once.
// Same layout as the pre-charge notice; the amounts are read from the rows at
// send time (the missed row, and the next open payment it now joins).
import { escapeEmailHtml, formatDueDate, formatInstallmentAmount, installmentEmailLayout } from "./formatDueDate.ts";
import { balanceLinkText } from "./installmentReminderEmail.ts";

export interface InstallmentMissedRolloverInput {
  buyerName: string | null;
  tripTitle: string;
  brandName: string;
  ordinal: number;
  /** The missed payment's amount. */
  amountCents: number;
  currency: string;
  /** The next open payment after the move, when there is one. */
  nextPayment: { amountCents: number; dueAt: string } | null;
  timezone: string | null;
  /** "Pay toward your balance" for a flexible v2 plan; absent → none. */
  balanceUrl?: string | null;
}

export function renderInstallmentMissedRolloverEmail(input: InstallmentMissedRolloverInput) {
  const amount = formatInstallmentAmount(input.amountCents, input.currency);
  const name = input.buyerName?.trim() || "there";
  const next = input.nextPayment === null ? null : {
    amount: formatInstallmentAmount(input.nextPayment.amountCents, input.currency),
    date: formatDueDate(input.nextPayment.dueAt, input.timezone),
  };
  const subject = `Payment ${input.ordinal} for ${input.tripTitle} moved to your later payments`;
  const moved =
    `We couldn't collect ${amount} for payment ${input.ordinal} of ${input.tripTitle}, so we've added it to your remaining payments. Your booking with ${input.brandName} is still confirmed.`;
  const nextLine = next === null ? null : `Your next payment is ${next.amount}, due on ${next.date}.`;
  const hasBalanceLink = typeof input.balanceUrl === "string" && input.balanceUrl.startsWith("https://");
  const html = installmentEmailLayout({
    heading: "Missed payment moved to later payments",
    paragraphs: [
      `Hi ${escapeEmailHtml(name)},`,
      `We couldn't collect <strong>${escapeEmailHtml(amount)}</strong> for payment ${input.ordinal} of <strong>${escapeEmailHtml(input.tripTitle)}</strong>, so we've added it to your remaining payments. Your booking with ${escapeEmailHtml(input.brandName)} is still confirmed.`,
      ...(nextLine === null ? [] : [escapeEmailHtml(nextLine)]),
      "Please make sure your card is ready for your next payment.",
      ...(hasBalanceLink
        ? [`<a href="${escapeEmailHtml(String(input.balanceUrl))}">Pay toward your balance</a>. Your later payments shrink to match.`]
        : []),
    ],
    footer: `You received this because you booked ${escapeEmailHtml(input.tripTitle)} on Mingla.`,
  });
  const text = [
    "Missed payment moved to later payments",
    "",
    `Hi ${name},`,
    "",
    moved,
    ...(nextLine === null ? [] : [nextLine]),
    "Please make sure your card is ready for your next payment.",
    ...balanceLinkText(input.balanceUrl),
  ].join("\n");
  return { subject, html, text };
}
