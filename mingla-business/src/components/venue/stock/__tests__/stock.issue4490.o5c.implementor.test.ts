/**
 * #4490 spec 08 O5 part C — stock display state, the Till's sold-out words,
 * the swap rule the staff screen shows, and the guest's sold-out lines.
 */
import {
  stockDraftChanged,
  stockDraftFrom,
  stockPill,
  stockSaveInput,
  swapChoice,
  tillSoldOutSentence,
} from "../stockModel";
import { STOCK_COPY, stockErrorCopy } from "../stockCopy";
import { guestSoldOutOf, parseGuestSoldOut } from "../guestSoldOut";
import { parseOrderSoldOut } from "../../../../services/venueStockService";

describe("stock pills (spec 08 §2: Sold out, {n} left, warning at Warn me at)", () => {
  it("shows nothing for an item that is not counted", () => {
    expect(stockPill(null, null)).toBeNull();
    expect(stockPill(undefined, 3)).toBeNull();
  });
  it("Sold out at 0, the count above it, warning tone at or below the level", () => {
    expect(stockPill(0, 5)).toEqual({ label: "Sold out", tone: "err" });
    expect(stockPill(3, 5)).toEqual({ label: "3 left", tone: "warn" });
    expect(stockPill(5, 5)).toEqual({ label: "5 left", tone: "warn" });
    expect(stockPill(24, 5)).toEqual({ label: "24 left", tone: "neutral" });
    expect(stockPill(24, null)).toEqual({ label: "24 left", tone: "neutral" });
  });
});

describe("the item's Stock section draft", () => {
  it("starts from the count, or off when untracked", () => {
    expect(stockDraftFrom(null, null)).toEqual({ tracked: false, count: 0, warnAt: 0 });
    expect(stockDraftFrom(3, 1)).toEqual({ tracked: true, count: 3, warnAt: 1 });
  });
  it("saves null to stop tracking; a warning level of 0 means none", () => {
    expect(stockSaveInput({ tracked: false, count: 9, warnAt: 2 })).toEqual({ count: null, warnAt: null });
    expect(stockSaveInput({ tracked: true, count: 15, warnAt: 0 })).toEqual({ count: 15, warnAt: null });
    expect(stockSaveInput({ tracked: true, count: 15, warnAt: 5 })).toEqual({ count: 15, warnAt: 5 });
  });
  it("knows when there is something to save", () => {
    expect(stockDraftChanged({ tracked: false, count: 0, warnAt: 0 }, null, null)).toBe(false);
    expect(stockDraftChanged({ tracked: true, count: 0, warnAt: 0 }, null, null)).toBe(true);
    expect(stockDraftChanged({ tracked: true, count: 3, warnAt: 1 }, 3, 1)).toBe(false);
    expect(stockDraftChanged({ tracked: true, count: 15, warnAt: 1 }, 3, 1)).toBe(true);
    expect(stockDraftChanged({ tracked: false, count: 3, warnAt: 1 }, 3, 1)).toBe(true);
  });
});

describe("swap rule (T16: same station, same price or less)", () => {
  const line = { quantity: 1, lineTotalMinor: 550000, station: "kitchen" };
  it("cheaper says what goes back; same price; dearer and other station cannot be picked", () => {
    expect(swapChoice(line, { priceMinor: 350000, station: "kitchen" })).toEqual({ kind: "cheaper", backMinor: 200000 });
    expect(swapChoice(line, { priceMinor: 550000, station: "kitchen" })).toEqual({ kind: "same" });
    expect(swapChoice(line, { priceMinor: 1850000, station: "kitchen" })).toEqual({ kind: "dearer" });
    expect(swapChoice(line, { priceMinor: 300000, station: "bar" })).toEqual({ kind: "other_station" });
  });
  it("compares the whole line for a quantity above 1", () => {
    expect(swapChoice({ quantity: 2, lineTotalMinor: 1000000, station: "kitchen" }, { priceMinor: 500000, station: "kitchen" }))
      .toEqual({ kind: "same" });
    expect(swapChoice({ quantity: 2, lineTotalMinor: 1000000, station: "kitchen" }, { priceMinor: 500001, station: "kitchen" }))
      .toEqual({ kind: "dearer" });
  });
});

describe("the Till's sold-out words (spec copy)", () => {
  it("before paying names the item", () => {
    expect(tillSoldOutSentence("pay", "Jollof", 0)).toBe("Jollof sold out. Take it off before paying.");
  });
  it("on send: too many asks to change the quantity; none left names the item", () => {
    expect(tillSoldOutSentence("send", "Asun", 2)).toBe("Only 2 left. Change the quantity.");
    expect(tillSoldOutSentence("send", "Jollof", 0)).toBe("Jollof sold out. Take it off before sending.");
    expect(tillSoldOutSentence("send", null, null)).toBe("An item sold out. Take it off before sending.");
  });
  it("every refusal has plain words; an unknown code never shows raw", () => {
    expect(stockErrorCopy("sold_out_refund_once")).toMatch(/already had one sold-out refund/);
    expect(stockErrorCopy("weird_code")).toBe("That didn't save. Try again.");
    expect(STOCK_COPY.boardRow(3, 1)).toBe("3 left · on 1 open ticket");
    expect(STOCK_COPY.boardRow(null, 2)).toBe("Not counted · on 2 open tickets");
  });
});

describe("the staff and guest reads", () => {
  it("parses the staff sold-out view with the server's refund preview", () => {
    const v = parseOrderSoldOut({
      orderId: "o1", currency: "NGN", canRefund: true, canSwap: true, refundUsed: false,
      lines: [{ orderItemId: "l1", menuItemId: "m1", name: "Soup", quantity: 1, lineTotalMinor: 550000,
        refundPreviewMinor: 605000, station: "kitchen", resolution: null }],
      swapOptions: [{ menuItemId: "m2", name: "Asun", priceMinor: 400000, station: "kitchen" }],
    });
    expect(v.lines[0].refundPreviewMinor).toBe(605000);
    expect(v.lines[0].resolution).toBeNull();
    expect(v.swapOptions[0].station).toBe("kitchen");
  });
  it("reads the guest's sold-out lines and ignores anything malformed", () => {
    const lines = parseGuestSoldOut([
      { itemName: "Soup", quantity: 1, resolution: "swap", swappedToName: "Asun", refundedMinor: 165000 },
      { itemName: 3 },
      null,
    ]);
    expect(lines).toEqual([{ itemName: "Soup", quantity: 1, resolution: "swap", swappedToName: "Asun", refundedMinor: 165000 }]);
    expect(guestSoldOutOf({ soldOut: lines })).toHaveLength(1);
    expect(guestSoldOutOf(null)).toEqual([]);
    expect(guestSoldOutOf({})).toEqual([]);
  });
});
