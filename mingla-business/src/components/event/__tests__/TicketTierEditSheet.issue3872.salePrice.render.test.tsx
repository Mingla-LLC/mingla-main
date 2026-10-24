import { describe, expect, test } from "@jest/globals";
const TestRenderer = require("react-test-renderer") as unknown;
import { canShowTicketTierDiscountControls } from "../../discounts/ticketTierDiscountContract";

describe("TicketTierEditSheet sale controls", () => {
  void TestRenderer;
  test("only enables server-backed controls for a persisted editable paid tier", () => {
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
