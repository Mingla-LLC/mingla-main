/**
 * #4490 spec 08 §13 (decided 22 Nov, O1-N6) — door sales of Entry work with or
 * without the Till, by the one switch that swaps the order pad for the Till.
 *
 * Truth table (flag = VENUE_TILL release, feature = the venue's Sell in
 * person, device = this build; every device on this build has the Till):
 *
 *   flag  feature  person may sell | order pad switch | door sells by
 *   off   off      yes / no        | pad              | gate sale sheet
 *   off   on       yes / no        | pad              | gate sale sheet
 *   on    off      yes / no        | pad              | gate sale sheet
 *   on    on       yes             | till             | Till (Entry tab)
 *   on    on       no              | none             | Till (it refuses without Sell)
 */
import { describe, expect, it } from "@jest/globals";

import { doorSaleEntry, guestListDoorSale } from "../features/checkin/doorSaleEntry";
import { venueOrderEntry } from "../venueModules";

describe("#4490 spec 08 §13 — the door follows the order pad's switch", () => {
  const cases: [boolean, boolean, "gate_sale" | "till"][] = [
    [false, false, "gate_sale"],
    [false, true, "gate_sale"],
    [true, false, "gate_sale"],
    [true, true, "till"],
  ];

  it.each(cases)("flag %s, feature %s → %s", (tillReleased, tillFeatureOn, expected) => {
    expect(doorSaleEntry({ tillReleased, tillFeatureOn })).toBe(expected);
  });

  it("agrees with venueOrderEntry for every input: the gate sale exactly when the pad is in use", () => {
    for (const tillReleased of [false, true]) {
      for (const tillFeatureOn of [false, true]) {
        for (const canSell of [false, true]) {
          const pad = venueOrderEntry({ tillReleased, tillFeatureOn, canSell }) === "pad";
          expect(doorSaleEntry({ tillReleased, tillFeatureOn }) === "gate_sale").toBe(pad);
        }
      }
    }
  });

  it("a guest-list arrival goes where the server says (it answers by the same switch)", () => {
    expect(guestListDoorSale("sell")).toBe("gate_sale");
    expect(guestListDoorSale("sell_in_till")).toBe("till");
    expect(guestListDoorSale("admitted")).toBeNull();
    expect(guestListDoorSale("list_closed_for_price")).toBeNull();
  });
});
