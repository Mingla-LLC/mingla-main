// MINGLA-INVARIANT: I-4572-PRICE-FROM-ONE-OWNER | issue #4572 | Every "From <price>" / "Free" label on the brand page (upcoming cards, next-up bar, experience, event and trip cards) and the Host brand teaser comes from packages/offering-rendering/priceFromLabel.ts: free first, then "From <formatMoney>" (₦ glyph), and nothing when the price is unknown. No other `From ${` template may appear in those files.
// issue #4572 item 7b — implementor regression.
//
// FAILS-ON-REVERT (true line deletion):
//   - delete `if (minorUnits <= 0) return "Free";` → "zero price is Free" fails
//     (it prints "From ₦0");
//   - delete `if (isFree === true) return "Free";` → "isFree wins" fails;
//   - restore the brand page's own `offeringPriceLabel` with a `From ${`
//     template → "no second owner" fails;
//   - restore NextEventTeaser's inline "Free"/`From ${` price → "no second
//     owner" fails.

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("#4572 7b no second owner (adversarial, comments ignored)", () => {
  const REPO = join(__dirname, "..", "..", "..", "..", "..");
  const code = (rel: string): string =>
    readFileSync(join(REPO, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  test.each([
    "packages/brand-rendering/PublicBrandPage.tsx",
    "mingla-business/src/components/brand/NextEventTeaser.tsx",
  ])("%s builds no 'From' label itself", (rel) => {
    const src = code(rel);
    expect(src).not.toContain("From ${");
    expect(src).not.toMatch(/\bofferingPriceLabel\b/);
    expect(src).toContain("priceFromLabel(");
  });

  test("NextEventTeaser never fabricates Free for an unknown price", () => {
    const src = code("mingla-business/src/components/brand/NextEventTeaser.tsx");
    expect(src).not.toMatch(/\?\s*"Free"/);
  });
});
