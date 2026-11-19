/**
 * #4453 — a notification row's body opens it: the first tap shows the full
 * text, the next tap on the open row goes where "Open" goes.
 */
import { nextRowTap } from "../rowTap";

describe("a tap on a notification row", () => {
  it("first shows the full text", () => {
    expect(nextRowTap(false, true)).toBe("expand");
    expect(nextRowTap(false, false)).toBe("expand");
  });
  it("then follows the notification's link", () => {
    expect(nextRowTap(true, true)).toBe("open");
  });
  it("folds a row that has nowhere to go", () => {
    expect(nextRowTap(true, false)).toBe("collapse");
  });
});
