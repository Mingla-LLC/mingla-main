/**
 * issue #4522 W-11 — the balance page's "Other amount" field: choosing it puts
 * the cursor in the field, and its empty hint follows the shared money rule
 * (a whole amount shows no decimals: "0"; it said "0.00" on a naira balance).
 * FAILS ON REVERT: no autoFocus, and the hint is "0.00" for NGN.
 */
import fs from "node:fs";
import path from "node:path";

import { formatTripBalanceMoney } from "@mingla/offering-rendering/tripBalance";

import { localeForCurrency } from "../../../utils/currency";

// The panel module pulls UI primitives this node config cannot load; the
// helper is one line, so it is checked against its source and the shared rule.
const source = fs.readFileSync(path.join(__dirname, "..", "TripBalancePanel.tsx"), "utf8");
const otherAmountPlaceholder = (currency: string): string =>
  formatTripBalanceMoney(0, currency, localeForCurrency(currency)).replace(/[^\d.,]/g, "");

describe("#4522 W-11 — Other amount", () => {
  test("the hint follows the currency", () => {
    expect(source).toContain('return balanceMoney(0, currency).replace(/[^\\d.,]/g, "");');
    expect(otherAmountPlaceholder("NGN")).toBe("0");
    expect(otherAmountPlaceholder("USD")).toBe("0");
  });

  test("choosing Other amount focuses its field", () => {
    const field = source.slice(
      source.indexOf('accessibilityLabel="Other payment amount"'),
      source.indexOf("value={customAmount}"),
    );
    expect(field).toContain("autoFocus");
    expect(field).toContain("placeholder={otherAmountPlaceholder(balance.currency)}");
  });
});
