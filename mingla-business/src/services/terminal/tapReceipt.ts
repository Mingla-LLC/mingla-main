/**
 * #4271 — the text of a receipt a host can hand on through the share sheet, for a
 * tap that was approved or not (Apple 5.10). Confidential by construction: it takes
 * no name, phone, email or card number other than the provider's short card label.
 */
import { formatCurrency, majorFromMinor } from "../../utils/currency";

export interface TapReceiptInput {
  eventName: string | null;
  brandName: string | null;
  outcome: "approved" | "declined";
  totalCents: number;
  feeCents: number | null;
  currency: string;
  cardLabel: string | null;
  whenIso: string;
  /** The PaymentIntent id. Only its last 8 characters are printed. */
  paymentIntentId: string | null;
}

const money = (cents: number, currency: string): string =>
  formatCurrency(majorFromMinor(cents, currency), currency);

export const buildTapReceiptText = (input: TapReceiptInput): string => {
  const lines: string[] = [];
  if (input.brandName) lines.push(input.brandName);
  if (input.eventName) lines.push(input.eventName);
  lines.push(new Date(input.whenIso).toUTCString());
  lines.push(`Total: ${money(input.totalCents, input.currency)}`);
  if (input.feeCents !== null && input.feeCents > 0) {
    lines.push(`Includes fees: ${money(input.feeCents, input.currency)}`);
  }
  if (input.cardLabel) lines.push(input.cardLabel);
  lines.push(input.outcome === "approved" ? "Approved." : "Not approved. No money was taken.");
  if (input.paymentIntentId) lines.push(`Reference: ${input.paymentIntentId.slice(-8)}`);
  return lines.join("\n");
};
