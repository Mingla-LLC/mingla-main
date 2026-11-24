// issue #4572 item 7b — tester adversarial (different angle from the
// implementor's table of examples): properties that must hold for EVERY input,
// including the malformed values a stale row or a bad import can carry.
//
//   P-1 never a zero, NaN or Infinity amount after "From" ("From ₦0",
//       "From NGN 0", "From $NaN"), for any number the feed can hold;
//   P-2 free-first: isFree === true is "Free" whatever the price says;
//   P-3 an unknown price that is not free shows nothing (null), never a
//       fabricated "Free" (Constitution 9) — including NaN / ±Infinity;
//   P-4 the naira glyph regardless of the code's case or padding (brands
//       store `pricing_currency` lower case: "ngn");
//   P-5 a whole amount shows no decimals and a fractional one shows the
//       currency's own (never "₦25,000.5"); a sub-unit price is still a price.
//
// FAILS-ON-REVERT: delete `if (minorUnits <= 0) return "Free";` (P-1),
// `if (isFree === true) return "Free";` (P-2) or the Number.isFinite guard
// (P-3: NaN would print "From ₦NaN").

import { priceFromLabel } from "../../../../../packages/offering-rendering/priceFromLabel";

// Zero-decimal currencies (JPY) are left out: Mingla stores cents for every currency it sells in.
const CURRENCIES = ["NGN", "ngn", " NGN ", "USD", "GBP", "EUR", "KES", "ZAR", "GHS", null, "", "  "];
const AMOUNTS = [0, -0, 1, 99, 100, 150, 2_500_000, 2_500_050, 1_515_772_50, Number.MAX_SAFE_INTEGER, -1, -500];

describe("#4572 7b priceFromLabel — tester properties", () => {
  test("P-1 never prints a zero, NaN or Infinity amount", () => {
    for (const currency of CURRENCIES) {
      for (const minorUnits of AMOUNTS) {
        const label = priceFromLabel({ isFree: false, minorUnits, currency });
        if (label === null || label === "Free") continue;
        expect(label).toMatch(/^From /);
        expect(label).not.toMatch(/NaN|Infinity|undefined|null/);
        // the amount part must not be all zeros ("From ₦0", "From $0.00")
        expect(label.replace(/^From /, "").replace(/[^0-9]/g, "")).not.toMatch(/^0*$/);
      }
    }
  });

  test("P-2 isFree wins over every price and currency", () => {
    for (const currency of CURRENCIES) {
      for (const minorUnits of [...AMOUNTS, null, undefined, Number.NaN]) {
        expect(priceFromLabel({ isFree: true, minorUnits, currency })).toBe("Free");
      }
    }
  });

  test("P-3 an unknown, non-free price shows nothing", () => {
    for (const isFree of [false, null, undefined]) {
      for (const minorUnits of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(priceFromLabel({ isFree, minorUnits, currency: "NGN" })).toBeNull();
      }
    }
  });

  test("P-4 the naira glyph for any case or padding of the code", () => {
    for (const currency of ["NGN", "ngn", "Ngn", " NGN", "NGN "]) {
      const label = priceFromLabel({ minorUnits: 2_500_000, currency });
      expect(label).toBe("From ₦25,000");
      expect(label).not.toMatch(/NGN/i);
    }
  });

  test("P-5 whole amounts drop decimals; fractional ones keep the currency's own", () => {
    expect(priceFromLabel({ minorUnits: 2_500_000, currency: "USD" })).toBe("From $25,000");
    expect(priceFromLabel({ minorUnits: 2_500_050, currency: "NGN" })).toBe("From ₦25,000.50");
    expect(priceFromLabel({ minorUnits: 1, currency: "USD" })).toBe("From $0.01");
  });
});
