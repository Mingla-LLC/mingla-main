// issue #4522 G-10 — the ONE money line for a checkout quote. Naira reads
// "₦1,200,000.00" everywhere (the shared glyph rule, #3341), never "NGN 1,200,000.00"
// on one line and "₦" on the next.
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

export const formatQuoteMoney = (minor: number, currency: string): string => {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(minor / 100),
      currency,
    );
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`.trim();
  }
};
