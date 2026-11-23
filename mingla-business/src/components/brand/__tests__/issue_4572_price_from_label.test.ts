// issue #4572 item 7b — implementor regression.
//
// FAILS-ON-REVERT (true line deletion):
//   - delete `if (minorUnits <= 0) return "Free";` → "zero price is Free" fails
//     (it prints "From ₦0");
//   - delete `if (isFree === true) return "Free";` → "isFree wins" fails;
// The "one owner" source rule (I-4572-PRICE-FROM-ONE-OWNER) is held by the
// Deno suite packages/offering-rendering/__tests__/issue_4572_events_wiring.test.ts.

import {
  formatMoney,
  priceFromLabel,
} from "../../../../../packages/offering-rendering/priceFromLabel";

describe("#4572 7b priceFromLabel", () => {
  test("isFree wins over any price", () => {
    expect(priceFromLabel({ isFree: true, minorUnits: 500000, currency: "NGN" })).toBe("Free");
    expect(priceFromLabel({ isFree: true, minorUnits: null, currency: null })).toBe("Free");
  });

  test("zero price is Free even when isFree is false (never 'From NGN 0')", () => {
    expect(priceFromLabel({ isFree: false, minorUnits: 0, currency: "NGN" })).toBe("Free");
    expect(priceFromLabel({ minorUnits: 0, currency: "USD" })).toBe("Free");
  });

  test("paid NGN shows the naira glyph", () => {
    expect(priceFromLabel({ isFree: false, minorUnits: 2500000, currency: "NGN" })).toBe(
      "From ₦25,000",
    );
  });

  test("paid USD keeps cents only when they exist", () => {
    expect(priceFromLabel({ minorUnits: 1500, currency: "USD" })).toBe("From $15");
    expect(priceFromLabel({ minorUnits: 1550, currency: "USD" })).toBe("From $15.50");
  });

  test("unknown price and not free shows nothing", () => {
    expect(priceFromLabel({ isFree: false, minorUnits: null, currency: "NGN" })).toBeNull();
    expect(priceFromLabel({})).toBeNull();
    expect(priceFromLabel({ minorUnits: Number.NaN, currency: "NGN" })).toBeNull();
  });

  test("a missing currency never gains a symbol", () => {
    expect(priceFromLabel({ minorUnits: 1000, currency: null })).toBe("From 10.00");
    expect(formatMoney(10, null)).toBe("10.00");
  });
});
