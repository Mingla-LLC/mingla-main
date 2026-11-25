/**
 * #4490 spec 08 O1 — Till display model: layout classes, basket rows from the
 * server check, the Send label, tip chips on food and drink, cash presets and
 * change, the draft, "--" until priced, and route prefill (spec 07 §11 B3).
 */

import {
  addToDraft,
  basketRows,
  cashPresets,
  changeDue,
  floorLayoutFor,
  foodAndDrinkMinor,
  itemNeedsChoices,
  itemSellable,
  sendLabel,
  setDraftQuantity,
  tillPrefillFrom,
  tipChoices,
  totalsReady,
} from "../tillModel";
import { tillErrorCopy } from "../tillCopy";
import { mapTillSale, type TillCatalog } from "../../../../services/venueTillService";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const sale = mapTillSale({
  id: "s1",
  venueId: "v1",
  state: "open",
  currency: "NGN",
  subtotalMinor: 900000,
  serviceChargeMinor: 90000,
  totalDueMinor: 990000,
  paidMinor: 0,
  remainingMinor: 990000,
  version: 4,
  lines: [
    {
      id: "l1",
      kind: "menu_round",
      state: "held",
      amountMinor: 550000,
      orderId: "o1",
      sent: false,
      fulfillmentStatus: "held",
      items: [
        { id: "i1", menuItemId: "chapman", name: "Chapman", quantity: 2, lineTotalMinor: 500000, modifiers: [], notes: "no ice" },
        { id: "i2", menuItemId: "suya", name: "Suya", quantity: 1, lineTotalMinor: 400000, voided: true, modifiers: [] },
      ],
    },
    { id: "l2", kind: "entry", state: "held", amountMinor: 537500, label: "Entry", groupId: "g1" },
  ],
});

const catalog = {
  menus: [{ id: "m", name: "Bar", items: [
    { id: "chapman", name: "Chapman", priceMinor: 250000, orderable: true, station: "bar", modifierGroups: [] },
    { id: "suya", name: "Suya", priceMinor: 400000, orderable: true, station: "kitchen", modifierGroups: [] },
  ] }],
} as unknown as TillCatalog;

describe("O1-M1 layout classes (spec 08 §2: phone < 600, tablet 600–1023, desk ≥ 1024)", () => {
  it.each([[390, "phone"], [599, "phone"], [600, "tablet"], [768, "tablet"], [1023, "tablet"], [1024, "desk"], [1440, "desk"]] as const)(
    "%i px is %s",
    (width, layout) => expect(floorLayoutFor(width)).toBe(layout),
  );
});

describe("O1-M2 basket rows come from the server check", () => {
  it("one row per item and per offer line; voided items stay visible and marked", () => {
    const rows = basketRows(sale);
    expect(rows.map((r) => [r.label, r.quantity, r.amountMinor, r.voided, r.sent])).toEqual([
      ["Chapman", 2, 500000, false, false],
      ["Suya", 1, 400000, true, false],
      ["Entry", 1, 537500, false, true],
    ]);
    expect(rows[0].orderItemId).toBe("i1");
    expect(rows[2].lineId).toBe("l2");
    expect(rows[0].detail).toBe("no ice");
  });
  it("no check, no rows", () => expect(basketRows(null)).toEqual([]));
});

describe("O1-M3 the Send button names the station of the unsent lines", () => {
  it("bar only → bar; a kitchen draft too → both; nothing unsent → null", () => {
    expect(sendLabel(sale, [], catalog)).toBe("bar");
    expect(sendLabel(sale, [{ key: "k", menuItemId: "suya", name: "Suya", quantity: 1, modifierIds: [], modifierNames: [], notes: null, station: "kitchen" }], catalog)).toBe("both");
    expect(sendLabel(null, [], catalog)).toBeNull();
  });
});

describe("O1-M4 tips are a share of food and drink before service charge (§12.2)", () => {
  it("voided items and offer lines are not food and drink", () => {
    expect(foodAndDrinkMinor(sale)).toBe(500000);
    expect(tipChoices(500000, [1000, 1250, 1500])).toEqual([
      { bps: 0, minor: 0 },
      { bps: 1000, minor: 50000 },
      { bps: 1250, minor: 62500 },
      { bps: 1500, minor: 75000 },
    ]);
  });
});

describe("O1-M5 cash: Exact first, then round notes; change never negative", () => {
  it("presets", () => {
    expect(cashPresets(587500)).toEqual([587500, 600000, 1000000]);
    expect(cashPresets(0)).toEqual([]);
  });
  it("change", () => {
    expect(changeDue(1500000, 587500, 0)).toBe(912500);
    expect(changeDue(500000, 587500, 0)).toBeNull();
    expect(changeDue(null, 1, 0)).toBeNull();
    expect(changeDue(600000, 587500, 12500)).toBe(0);
  });
});

describe("O1-M6 the draft and '--' until the server priced it (rule 9)", () => {
  it("merges identical choices and removes at zero", () => {
    let d = addToDraft([], { menuItemId: "chapman", name: "Chapman", quantity: 1, modifierIds: [], modifierNames: [], notes: null, station: "bar" });
    d = addToDraft(d, { menuItemId: "chapman", name: "Chapman", quantity: 1, modifierIds: [], modifierNames: [], notes: null, station: "bar" });
    expect(d).toHaveLength(1);
    expect(d[0].quantity).toBe(2);
    d = addToDraft(d, { menuItemId: "chapman", name: "Chapman", quantity: 1, modifierIds: [], modifierNames: [], notes: "no ice", station: "bar" });
    expect(d).toHaveLength(2);
    expect(setDraftQuantity(d, d[0].key, 0)).toHaveLength(1);
    expect(setDraftQuantity(d, d[0].key, 500)[0].quantity).toBe(99);
  });
  it("totals are ready only with a check and an empty draft", () => {
    expect(totalsReady(sale, [])).toBe(true);
    expect(totalsReady(null, [])).toBe(false);
    expect(totalsReady(sale, [{ key: "k", menuItemId: "x", name: "x", quantity: 1, modifierIds: [], modifierNames: [], notes: null, station: null }])).toBe(false);
  });
});

describe("O1-M7 tiles", () => {
  it("sold out or unpriced items cannot be added; items with choices open the sheet", () => {
    expect(itemSellable({ orderable: true, priceMinor: 100 } as never)).toBe(true);
    expect(itemSellable({ orderable: false, priceMinor: 100 } as never)).toBe(false);
    expect(itemSellable({ orderable: true, priceMinor: null } as never)).toBe(false);
    expect(itemNeedsChoices({ modifierGroups: [{ modifiers: [{ id: "m" }] }] } as never)).toBe(true);
    expect(itemNeedsChoices({ modifierGroups: [] } as never)).toBe(false);
  });
});

describe("O1-M8 route prefill (spec 07 §11 B3): opaque ids only", () => {
  it("guest-list reduced price opens Entry with option and count", () => {
    expect(tillPrefillFrom({ tab: "entry", offer: UUID_A, option: UUID_B, count: "2", entry: UUID_A })).toEqual({
      tab: "entry", offerId: UUID_A, priceOptionId: UUID_B, count: 2, guestListEntryId: UUID_A,
    });
  });
  it("junk is dropped", () => {
    expect(tillPrefillFrom({})).toBeNull();
    expect(tillPrefillFrom({ tab: "entry", offer: "nope", count: "999", entry: "x" })).toEqual({
      tab: "entry", offerId: null, priceOptionId: null, count: null, guestListEntryId: null,
    });
  });
});

describe("O1-M9 refusals read in words, never a code", () => {
  it.each([
    ["till_check_changed", "That check was changed on another device. We've refreshed it."],
    ["till_void_needs_money_rights", "Ask someone with money rights to void a sent item."],
    ["till_payment_too_large", "This payment is too large to take in one go. Ask for a smaller deposit, or record it as paid to the venue."],
    ["till_item_not_orderable", "This item sold out while you were adding it"],
  ])("%s", (code, copy) => expect(tillErrorCopy(code)).toBe(copy));
  it("an unknown code is still words", () => expect(tillErrorCopy("weird_code")).not.toMatch(/_/));
});
