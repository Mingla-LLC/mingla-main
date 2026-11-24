/**
 * #4490 spec 08 O5 fix 1 (O5-T4): the void sheet asks "Put it back in stock"
 * for a sent item the venue counts; the switch starts on and its value is what
 * the Till sends (the server decides what comes back).
 */
import { voidAsksRestock, type BasketRow } from "../tillModel";
import { TILL_COPY } from "../tillCopy";
import type { TillCatalog } from "../../../../services/venueTillService";

const item = (over: Partial<BasketRow>): BasketRow => ({
  key: "item:1", kind: "item", label: "Zobo", detail: null, quantity: 1, amountMinor: 200000, sent: true, voided: false,
  orderItemId: "oi1", lineId: null, lineState: "held", kitchen: null, menuItemId: "m-zobo", ...over,
});
const catalog = (stockLeft: number | null): TillCatalog => ({
  venueId: "v", brandId: "b", venueName: "V", currency: "NGN", serviceChargeBps: 0, canManageMoney: true, tipsEnabled: false,
  tipBpsOptions: [], tapAvailable: false, spots: [], tableReservationsOn: false, tables: [], hourOffers: [],
  menus: [{ id: "menu", name: "Bar", items: [{ id: "m-zobo", name: "Zobo", description: null, priceMinor: 200000, orderable: true,
    allowsNotes: false, station: "bar", modifierGroups: [], stockLeft, stockWarnAt: null }] }],
});

describe("O5-T4 the void asks to put a counted, sent item back in stock", () => {
  test("a sent item the venue counts: the switch shows", () => {
    expect(voidAsksRestock(item({}), catalog(4))).toBe(true);
    expect(voidAsksRestock(item({}), catalog(0))).toBe(true);
  });
  test("not counted, not sent, not an item, or nothing picked: no switch", () => {
    expect(voidAsksRestock(item({}), catalog(null))).toBe(false);
    expect(voidAsksRestock(item({ sent: false }), catalog(4))).toBe(false);
    expect(voidAsksRestock(item({ kind: "offer", menuItemId: null }), catalog(4))).toBe(false);
    expect(voidAsksRestock(null, catalog(4))).toBe(false);
    expect(voidAsksRestock(item({}), null)).toBe(false);
  });
  test("the words", () => {
    expect(TILL_COPY.putBackInStock).toBe("Put it back in stock");
    expect(TILL_COPY.putBackInStockHint).toBe("Turn this off if it was made, dropped or can't be sold again.");
  });
});
