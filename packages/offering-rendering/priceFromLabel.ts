// priceFromLabel — #4572 item 7b [one free-first "From" price label].
//
// I-4572-PRICE-FROM-ONE-OWNER: every "From <price>" / "Free" label on a brand
// page, its cards and the Host brand teaser comes from this module. The test
// packages/offering-rendering/__tests__/issue_4572_price_from_label.test.ts
// declares and enforces it.
//
// WHY: the brand page had its own `offeringPriceLabel`, which checked the
// price before the free flag, so a free event (price_from_cents = 0) read
// "From NGN 0". The Host teaser had a third copy that invented "Free" when the
// price was unknown. The event page already had the right rule
// (EventOfferingBody `formatTicketPrice`): free first, then the price.
//
// RULE:
//   isFree === true, or minorUnits <= 0  -> "Free"
//   minorUnits > 0                       -> "From <formatMoney>" (₦ glyph, #3341)
//   minorUnits null and not free         -> null (show nothing, Constitution 9)
// A mixed event (a free tier plus paid tiers) has price_from_cents = 0 (the
// server takes min() over every tier), so it reads "Free", the same as Sites.
//
// Pure module: no React, no RN, no app imports (I-MOR-0827-PACKAGE-ISOLATION).
// Import it by its deep specifier (`@mingla/offering-rendering/priceFromLabel`).

import { withCurrencyGlyph } from "./currencyGlyph";
import { priceDecimals } from "./priceDecimals";

// issue #1014 — currency may be null (published free-only event by a
// currency-less brand). Every render site branches to "Free" for 0-money
// BEFORE calling this; the null branch here is a defensive last resort that
// renders the bare amount WITHOUT fabricating a currency symbol.
export const formatMoney = (amount: number, currency: string | null): string => {
  if (currency === null) return amount.toFixed(2);
  try {
    // #3341 — en-US prints "NGN 25,000" for naira; show "₦25,000" like $/£/€.
    return withCurrencyGlyph(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        ...priceDecimals(amount),
      }).format(amount),
      currency,
    );
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export interface PriceFromInput {
  isFree?: boolean | null;
  /** Lowest price in minor units (cents, kobo). null when unknown. */
  minorUnits?: number | null;
  currency?: string | null;
}

export const priceFromLabel = ({
  isFree,
  minorUnits,
  currency,
}: PriceFromInput): string | null => {
  if (isFree === true) return "Free";
  if (minorUnits === null || minorUnits === undefined || !Number.isFinite(minorUnits)) {
    return null;
  }
  if (minorUnits <= 0) return "Free";
  const code =
    typeof currency === "string" && currency.trim().length > 0 ? currency.trim() : null;
  return `From ${formatMoney(minorUnits / 100, code)}`;
};
