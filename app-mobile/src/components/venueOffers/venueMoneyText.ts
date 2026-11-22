/**
 * #4490 Explorer W3 — the venue money text on Explorer surfaces (deck chips,
 * the card sheet's Ways to come, the venue page panes).
 *
 * The shared venue formatter (`formatVenueMoney`, "₦4,000" for whole amounts)
 * plus the app's known-symbol rule: Hermes prints the ISO code for some
 * currencies ("NGN 4,000"), and Seth decided Naira always reads ₦ (spec 06
 * §14). One rule, the same one the Purchases list uses (W2-N18).
 */
import { formatVenueMoney } from "@mingla/brand-rendering/venueFeaturePage";

import { withKnownCurrencySymbol } from "../../utils/programFormat";

export function venueMoneyText(minor: number, currencyCode: string, exponent: number): string {
  return withKnownCurrencySymbol(formatVenueMoney(minor, currencyCode, exponent), currencyCode);
}
