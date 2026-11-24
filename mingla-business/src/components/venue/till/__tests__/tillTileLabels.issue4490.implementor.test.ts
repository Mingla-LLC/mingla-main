/**
 * #4490: a Till tile's screen-reader label says what the tile shows. A menu
 * tile with a "{n} left" stock pill includes it; a table tile that shows its
 * capacity (no minimum spend) includes the capacity.
 *
 * Fails on revert: without the stock pill in the label state or the capacity
 * in the table price slot, the source patterns below no longer match.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { TILL_COPY } from "../tillCopy";

const SRC = readFileSync(join(__dirname, "..", "TillScreen.tsx"), "utf8");

describe("Till tile accessibility labels (#4490)", () => {
  it("builds a label with the visible stock text", () => {
    expect(TILL_COPY.tileLabel(TILL_COPY.addItemLabel("Suya"), "N2,500", TILL_COPY.left(3))).toBe("Add Suya, N2,500, 3 left");
  });
  it("builds a table label with the shown capacity", () => {
    expect(TILL_COPY.tileLabel(TILL_COPY.seatTableLabel("T1"), TILL_COPY.seatsLabel(4), null)).toBe("Open table T1, 4 seats");
    expect(TILL_COPY.seatsLabel(1)).toBe("1 seat");
  });
  it("menu tile label state uses the stock pill label", () => {
    expect(SRC).toMatch(/sellable \? \(stock === null \? null : stock\.label\) : TILL_COPY\.soldOut/);
  });
  it("table tile label falls back to the capacity when there is no minimum spend", () => {
    expect(SRC).toMatch(/: TILL_COPY\.seatsLabel\(table\.capacity\),/);
  });
});
