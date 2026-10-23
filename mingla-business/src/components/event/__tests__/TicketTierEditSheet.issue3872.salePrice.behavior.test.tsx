import { describe, expect, test } from "@jest/globals";
import { canShowTicketTierDiscountControls } from "../../discounts/discountUiContract";

describe("TicketTierEditSheet sale-control decision", () => {
  test("only renders server-backed controls for a persisted editable paid tier", () => {
    const eligible = {
      hasPersistedTier: true,
      privateLinksEnabled: true,
      hasEventId: true,
      hasBrandId: true,
      canEditPrice: true,
      isFree: false,
    };
    expect(canShowTicketTierDiscountControls(eligible)).toBe(true);
    for (const key of [
      "hasPersistedTier",
      "privateLinksEnabled",
      "hasEventId",
      "hasBrandId",
      "canEditPrice",
    ] as const) {
      expect(
        canShowTicketTierDiscountControls({ ...eligible, [key]: false }),
      ).toBe(false);
    }
    expect(
      canShowTicketTierDiscountControls({ ...eligible, isFree: true }),
    ).toBe(false);
  });
});
