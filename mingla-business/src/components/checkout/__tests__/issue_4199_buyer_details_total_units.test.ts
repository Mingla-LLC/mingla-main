import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatCurrency } from "../../../utils/currency";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const read = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const buyerPages = [
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
] as const;

describe("#4199 buyer-details totals keep major-unit cart values", () => {
  test("documents the live NGN regression at the formatter boundary", () => {
    expect(formatCurrency(100, "NGN")).toBe("₦100.00");
    expect(formatCurrency(100, "NGN", true)).toBe("₦1.00");
  });

  test.each(buyerPages)(
    "%s formats both all-in totals as major units",
    (relativePath) => {
      const source = read(relativePath);
      const majorUnitCalls = source.match(
        /formatCurrency\(totals\.allInTotal,\s*totals\.currency\)/g,
      );

      expect(majorUnitCalls).toHaveLength(2);
      expect(source).not.toMatch(
        /formatCurrency\(totals\.allInTotal,\s*totals\.currency,\s*true\)/,
      );
    },
  );
});
