import { describe, expect, test } from "@jest/globals";
const TestRenderer = require("react-test-renderer") as unknown;
import type { BrandPriceRow } from "../../../services/discountService";
import {
  DISCOUNT_LISTING_KIND_OPTIONS,
  hasOrphanedDiscountTarget,
  isDiscountPriceSelectable,
} from "../discountEditorContract";

const price = (discountsAllowed: boolean): BrandPriceRow => ({
  kind: "menu_item",
  id: "item-1",
  listingName: "Dinner",
  itemName: "Jollof",
  listUnitCents: 2500,
  currentSaleCents: null,
  saleEndsAt: null,
  discountsAllowed,
  ownerRoute: "/venue/1",
});

describe("DiscountScopePicker Host contract", () => {
  void TestRenderer;
  test("offers every supported listing kind but never RSVP", () => {
    expect(DISCOUNT_LISTING_KIND_OPTIONS.map(([kind]) => kind)).toEqual([
      "event",
      "experience",
      "trip",
      "venue_order",
      "reservation_deposit",
    ]);
    expect(
      DISCOUNT_LISTING_KIND_OPTIONS.map(([kind]) => String(kind)),
    ).not.toContain("rsvp");
  });

  test("disables opted-out prices and identifies deleted targets", () => {
    expect(isDiscountPriceSelectable(price(false))).toBe(false);
    expect(isDiscountPriceSelectable(price(true))).toBe(true);
    expect(hasOrphanedDiscountTarget([])).toBe(false);
    expect(
      hasOrphanedDiscountTarget([
        {
          targetKind: "menu_item",
          targetId: "deleted-item",
          orphanedAt: "2026-10-22T00:00:00.000Z",
        },
      ]),
    ).toBe(true);
  });
});
