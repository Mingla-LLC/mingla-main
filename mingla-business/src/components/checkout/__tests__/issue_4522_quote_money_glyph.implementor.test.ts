/**
 * issue #4522 G-10 — naira on one checkout screen read "NGN 1,200,000.00" on
 * one line (the quote summary) and "₦1,200,000.00" on the next (the payment
 * page's own copy of the formatter). One owner now: quoteMoney.ts, with the
 * shared glyph rule. A naira total in minor units is the real shape (kobo).
 *
 * FAILS ON REVERT: take withCurrencyGlyph out of quoteMoney.ts, or give the
 * payment page / discount field their own Intl formatter again.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

import { formatQuoteMoney } from "../quoteMoney";

describe("#4522 G-10 one checkout money formatter", () => {
  test("naira reads with the glyph, never the NGN code", () => {
    const text = formatQuoteMoney(120000000, "NGN");
    expect(text).toContain("₦");
    expect(text).not.toContain("NGN");
    expect(text).toContain("1,200,000.00");
  });

  test("dollars are unchanged", () => {
    expect(formatQuoteMoney(30000, "USD")).toContain("300.00");
  });

  test("the payment page and the discount field use that one owner", () => {
    const root = path.resolve(__dirname, "../../../..");
    for (const rel of [
      "app/checkout-trip/[tripEventId]/payment.tsx",
      "src/components/checkout/DiscountCodeField.tsx",
    ]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      expect(source).toContain("quoteMoney");
      expect(source).not.toMatch(/new Intl\.NumberFormat\(\s*undefined/);
    }
  });
});
