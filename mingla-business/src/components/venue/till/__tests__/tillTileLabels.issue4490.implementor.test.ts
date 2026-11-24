/**
 * #4490: a Till tile's screen-reader label says what the tile shows. A menu
 * tile with a "{n} left" stock pill includes it; a table tile that shows its
 * capacity (no minimum spend) includes the capacity.
 *
 * TillScreen builds both label parts with TILL_COPY.itemTileState and
 * TILL_COPY.tableTileDetail, so these cases execute the same code the tiles use.
 *
 * Fails on revert: drop the stock pill from itemTileState or the capacity
 * fallback from tableTileDetail and the matching case goes red.
 */
import { TILL_COPY } from "../tillCopy";

describe("Till tile accessibility labels (#4490)", () => {
  it("builds a label with the visible stock text", () => {
    expect(TILL_COPY.tileLabel(TILL_COPY.addItemLabel("Suya"), "N2,500", TILL_COPY.left(3))).toBe("Add Suya, N2,500, 3 left");
  });
  it("builds a table label with the shown capacity", () => {
    expect(TILL_COPY.tileLabel(TILL_COPY.seatTableLabel("T1"), TILL_COPY.seatsLabel(4), null)).toBe("Open table T1, 4 seats");
    expect(TILL_COPY.seatsLabel(1)).toBe("1 seat");
  });
  it("menu tile label state uses the stock pill label", () => {
    expect(TILL_COPY.itemTileState(true, TILL_COPY.left(3))).toBe("3 left");
    expect(TILL_COPY.itemTileState(true, null)).toBeNull();
    expect(TILL_COPY.itemTileState(false, TILL_COPY.left(3))).toBe(TILL_COPY.soldOut);
    expect(TILL_COPY.tileLabel(TILL_COPY.addItemLabel("Suya"), "N2,500", TILL_COPY.itemTileState(true, TILL_COPY.left(2)))).toBe("Add Suya, N2,500, 2 left");
  });
  it("table tile label falls back to the capacity when there is no minimum spend", () => {
    expect(TILL_COPY.tableTileDetail(null, 4)).toBe("4 seats");
    expect(TILL_COPY.tableTileDetail("N50,000", 4)).toBe("Minimum spend N50,000");
    expect(TILL_COPY.tileLabel(TILL_COPY.seatTableLabel("T1"), TILL_COPY.tableTileDetail(null, 1), null)).toBe("Open table T1, 1 seat");
  });
});
