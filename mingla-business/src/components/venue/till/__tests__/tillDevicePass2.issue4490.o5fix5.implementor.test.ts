/**
 * #4490 spec 08 O5 fix 5 — the pure rules behind the re-check fixes at
 * c79a8ad436 (the rendered proof is tillDevicePass2.issue4490.o5fix5.render).
 *
 * FAILS-ON-REVERT: tillHeaderStacked false on a phone -> F1; saleTakesItems
 * true on a paid check -> F4; splitMinglaMark gone -> F5; checkTitle back to
 * "New check" / "Team member" -> F7; teamListState without its loading branch
 * -> F9; swapPickable or parseOrderSoldOut without canSwapEven -> F11.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

import { floorLayoutFor, saleTakesItems, tillHeaderStacked } from "../tillModel";
import { splitMinglaMark } from "../pinModel";
import { checkRef, checkTitle } from "../checkLabel";
import { teamListState } from "../../../team/teamRowModel";
import { swapChoice, swapPickable } from "../../stock/stockModel";
import { parseOrderSoldOut } from "../../../../services/venueStockService";
import type { TillSale } from "../../../../services/venueTillService";

const sale = (state: TillSale["state"]): TillSale => ({ state } as unknown as TillSale);

describe("#4490 08-O5 fix 5", () => {
  test("F1 the Till header stacks on every phone width (320-430), not on a tablet or desk", () => {
    for (const w of [320, 375, 390, 430]) expect(tillHeaderStacked(floorLayoutFor(w))).toBe(true);
    for (const w of [768, 1024, 1440]) expect(tillHeaderStacked(floorLayoutFor(w))).toBe(false);
  });

  test("F4 a paid, voided or refunded check takes no more items; an open (or paying) check and no check do", () => {
    expect(saleTakesItems(null)).toBe(true);
    expect(saleTakesItems(sale("open"))).toBe(true);
    expect(saleTakesItems(sale("paying"))).toBe(true);
    for (const s of ["paid", "voided", "refunded", "partially_refunded"] as const) expect(saleTakesItems(sale(s))).toBe(false);
  });

  test("F5 the Mingla mark is split off a Mingla admin's name only", () => {
    expect(splitMinglaMark({ name: "Ada Okafor from Mingla", isMinglaTeam: true })).toEqual({ name: "Ada Okafor", mark: "from Mingla" });
    expect(splitMinglaMark({ name: "Mingla Team", isMinglaTeam: true })).toEqual({ name: "Mingla Team", mark: null });
    expect(splitMinglaMark({ name: "Tolu from Mingla", isMinglaTeam: false })).toEqual({ name: "Tolu from Mingla", mark: null });
    expect(splitMinglaMark({ name: "Kemi" })).toEqual({ name: "Kemi", mark: null });
  });

  test("F7 one name per check: its name, else its table, else Check #<ref> (never New check or Team member)", () => {
    const id = "9f3a1111-1111-4111-8111-111111111111";
    expect(checkRef(id)).toBe("9F3A");
    expect(checkTitle({ id, label: null, spotLabel: null })).toBe("Check #9F3A");
    expect(checkTitle({ id, label: "  ", spotLabel: "Table 4" })).toBe("Table 4");
    expect(checkTitle({ id, label: "Ade's party", spotLabel: "Table 4" })).toBe("Ade's party");
    expect(checkTitle({ id: "", label: null })).toBe("Check");
  });

  test("F9 the Team page shows loading (not 'working solo') until its people arrive", () => {
    expect(teamListState({ loading: true, pendingCount: 0, acceptedCount: 0 })).toBe("loading");
    expect(teamListState({ loading: false, pendingCount: 0, acceptedCount: 1 })).toBe("empty");
    expect(teamListState({ loading: false, pendingCount: 1, acceptedCount: 1 })).toBe("list");
    expect(teamListState({ loading: false, pendingCount: 0, acceptedCount: 2 })).toBe("list");
  });

  test("F11 a cheaper swap follows the refund rule; a same-price swap the kitchen or seller rule (canSwapEven)", () => {
    const line = { quantity: 1, lineTotalMinor: 500000, station: "kitchen" };
    const cheaper = swapChoice(line, { priceMinor: 100000, station: "kitchen" });
    const same = swapChoice(line, { priceMinor: 500000, station: "kitchen" });
    // A finance manager: may refund, does not sell or run the kitchen.
    expect(swapPickable(cheaper, true, false)).toBe(true);
    expect(swapPickable(same, true, false)).toBe(false);
    // A seller: no refund rights.
    expect(swapPickable(cheaper, false, true)).toBe(false);
    expect(swapPickable(same, false, true)).toBe(true);
    const fm = parseOrderSoldOut({ orderId: "o", currency: "NGN", canRefund: true, canSwap: true, canSwapEven: false, lines: [], swapOptions: [] });
    expect([fm.canSwap, fm.canSwapEven]).toEqual([true, false]);
    const older = parseOrderSoldOut({ orderId: "o", currency: "NGN", canRefund: false, canSwap: true, lines: [], swapOptions: [] });
    expect(older.canSwapEven).toBe(true);
  });
});
