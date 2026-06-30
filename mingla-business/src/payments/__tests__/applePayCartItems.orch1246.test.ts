// ORCH-1246 (Apple 4.9) — Apple Pay sheet must show the PRODUCT, not the company.
//
// buildApplePayCartItems produces the single Immediate line item PaymentSheet
// renders on the Apple Pay sheet. Without it, PaymentSheet defaults to the
// company (merchantDisplayName). These tests pin: label = product (not company),
// empty title → neutral fallback (never the company), and the cents→string
// amount format. Fails-on-revert if cartItems threading is removed.
import { describe, expect, test } from "@jest/globals";

import { buildApplePayCartItems } from "../applePayCartItems";

const COMPANY = "Mingla";

describe("buildApplePayCartItems (ORCH-1246 Apple 4.9)", () => {
  test("label is the PRODUCT title, never the company", () => {
    const [item] = buildApplePayCartItems("Sunset Rooftop Party", 4599, "Ticket");
    expect(item.label).toBe("Sunset Rooftop Party");
    expect(item.label).not.toBe(COMPANY);
    expect(item.paymentType).toBe("Immediate");
  });

  test("empty / whitespace / null / undefined title → fallback (never company)", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const [item] = buildApplePayCartItems(empty, 1000, "Reservation");
      expect(item.label).toBe("Reservation");
      expect(item.label).not.toBe(COMPANY);
    }
  });

  test("title is trimmed", () => {
    const [item] = buildApplePayCartItems("  Wine Tasting  ", 2500, "Experience");
    expect(item.label).toBe("Wine Tasting");
  });

  test("amount = (cents/100).toFixed(2) string", () => {
    expect(buildApplePayCartItems("X", 4599, "Ticket")[0].amount).toBe("45.99");
    expect(buildApplePayCartItems("X", 1000, "Ticket")[0].amount).toBe("10.00");
    expect(buildApplePayCartItems("X", 5, "Ticket")[0].amount).toBe("0.05");
    expect(buildApplePayCartItems("X", 0, "Ticket")[0].amount).toBe("0.00");
  });

  test("returns exactly one cart item", () => {
    expect(buildApplePayCartItems("Y", 100, "Ticket")).toHaveLength(1);
  });
});
