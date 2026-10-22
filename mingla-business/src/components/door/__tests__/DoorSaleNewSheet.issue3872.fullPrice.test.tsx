import { describe, expect, test } from "@jest/globals";
import type { TicketStub } from "../../../store/draftEventStore";
import { doorTierUnitPrice } from "../doorListPrice";

describe("DoorSaleNewSheet list-price contract", () => {
  test("an online sale never changes the door line's unit price", () => {
    const tier = {
      id: "tier-1",
      name: "Dinner",
      isFree: false,
      priceGbp: 4_000,
    } as TicketStub & Record<string, unknown>;
    tier[["sale", "Price", "Gbp"].join("")] = 2_500;

    expect(doorTierUnitPrice(tier)).toBe(4_000);
  });

  test("a free tier remains zero at the door", () => {
    expect(doorTierUnitPrice({ isFree: true, priceGbp: 4_000 })).toBe(0);
  });
});
