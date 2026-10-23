import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscountCodeReason } from "@mingla/offering-rendering/discountQuote";
import { discountReasonCopy } from "@mingla/offering-rendering/discountReasonCopy";

const source = readFileSync(join(__dirname, "..", "DiscountCodeField.tsx"), "utf8");

const reasons: DiscountCodeReason[] = [
  "not_found",
  "paused",
  "not_started",
  "ended",
  "used_up",
  "buyer_limit",
  "queue",
  "not_applicable",
  "min_subtotal",
  "incompatible_better_automatic",
];

describe("#3872 discount-code field states", () => {
  test.each(reasons)("renders binding copy for %s", (reason) => {
    const copy = discountReasonCopy({
      reason,
      code: "SAVE10",
      date: "Friday",
      required: "$5.00",
      withName: "Member price",
    });
    expect(copy.length).toBeGreaterThan(8);
    expect(copy).not.toMatch(/undefined|null/);
  });

  test("keeps idle, applying, applied, rejected, rate-limit, retry, and sale-limit branches", () => {
    for (const needle of [
      "Enter code",
      "Applying {value}",
      'outcome?.status === "applied"',
      'outcome?.status === "rejected"',
      'quoteErrorCode === "rate_limited"',
      "Couldn&apos;t get your price. Try again.",
      "saleLimitedCopy(saleName, saleNotice.remaining)",
    ]) {
      expect(source).toContain(needle);
    }
    expect(source).not.toMatch(/amountMinor\s*[+\-*\/]/);
  });
});
