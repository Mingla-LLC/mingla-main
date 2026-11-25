/**
 * #4490 W2-N18 — the one money text for Purchases (list rows, ticket detail,
 * venue pass/plan detail). `formatPurchaseMoney` stays the number formatter;
 * this applies the app's known currency symbol where the engine printed the
 * ISO code (Hermes on iOS: "NGN 10,750.00" → "₦10,750.00"), the #4402 rule in
 * `programFormat`. Text that already carries a symbol is unchanged.
 */
import { withKnownCurrencySymbol } from "./programFormat";
import {
  formatPurchaseMoney,
  purchaseRefundLabel,
} from "./purchasePresentation";
import type { PurchaseTimelineItem } from "./purchaseTimeline";

/** Minor units in the currency's own exponent (2 for NGN, GBP, USD). */
export function purchaseMoneyText(
  amountMinor: number | null,
  currency: string | null,
  exponent = 2,
): string | null {
  if (amountMinor === null || currency === null) return null;
  const cents = exponent === 2 ? amountMinor : (amountMinor * 100) / 10 ** exponent;
  const text = formatPurchaseMoney(cents, currency);
  return text === null ? null : withKnownCurrencySymbol(text, currency);
}

export function purchaseRefundText(
  item: Pick<PurchaseTimelineItem, "refundedAmountCents" | "currency">,
): string | null {
  const text = purchaseRefundLabel(item);
  return text === null ? null : withKnownCurrencySymbol(text, item.currency);
}
