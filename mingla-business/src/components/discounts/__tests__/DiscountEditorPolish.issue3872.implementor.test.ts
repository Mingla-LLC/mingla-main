// MINGLA-INVARIANT: I-3872-HOST-EDITOR-USABLE | issue #3872 | The Host discount editor uses visible date/time pickers, clear choice cards, and a buyer-readable monetary preview rather than raw ISO or JSON fields.
// The approved test maintenance replaces source-text pinning with executable contracts.
import { describe, expect, test } from "@jest/globals";

import { isoFromLocalDateTime, localDateTimeValue } from "../discountDateTime";
import {
  DISCOUNT_KIND_DESCRIPTIONS,
  DISCOUNT_SCOPE_OPTIONS,
  formatDiscountPreviewMoney,
} from "../discountEditorContract";

describe("issue #3872 Host discount editor polish", () => {
  test("round-trips browser-local date-time values and supports an optional end", () => {
    const original = "2026-10-23T13:45:00.000Z";
    expect(isoFromLocalDateTime(localDateTimeValue(original))).toBe(original);
    expect(localDateTimeValue(null)).toBe("");
    expect(isoFromLocalDateTime("")).toBeNull();
    expect(isoFromLocalDateTime("not-a-date")).toBeNull();
  });

  test("provides descriptive choices for every discount kind and scope", () => {
    expect(DISCOUNT_KIND_DESCRIPTIONS).toEqual({
      code: "Buyers enter a code at checkout.",
      automatic: "The best eligible deal is applied automatically.",
      sale_price: "Show a lower price on selected items.",
    });
    expect(DISCOUNT_SCOPE_OPTIONS).toEqual([
      {
        value: "brand",
        label: "Entire brand",
        description: "All eligible paid items",
      },
      {
        value: "listing_kinds",
        label: "Offering types",
        description: "Events, trips, venues and more",
      },
      {
        value: "items",
        label: "Specific items",
        description: "Individual tickets, menu items or deposits",
      },
    ]);
  });

  test("formats buyer preview money from the brand currency without inventing one", () => {
    expect(formatDiscountPreviewMoney(850, "USD")).toBe("$8.50");
    expect(formatDiscountPreviewMoney(4800, "NGN")).toBe("₦48.00");
    expect(formatDiscountPreviewMoney(850, null)).toBe("—");
  });
});
