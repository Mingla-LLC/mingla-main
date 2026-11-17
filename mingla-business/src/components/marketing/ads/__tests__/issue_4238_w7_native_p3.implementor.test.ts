/**
 * #4238 W7: native verdict P3-1, P3-3, P3-4 and P4-3, behaviour of the
 * helpers (the screen wiring is pinned in the #4238 plain-language
 * strict-grep gate, section 8):
 *   P3-1 the 1280 ads table never scrolls sideways (list rows below its width);
 *   P3-4 the budget marks stack when their labels would touch on the real
 *        track width;
 *   P4-3 a notification's spoken time never reads "now ago".
 * P3-3 (two-line Home tile names) is layout only: gate section 8.
 */
import {
  HOST_AD_TABLE_MIN_WIDTH,
  hostAdListUsesTable,
} from "../hostAdListLayout";
import { hostAdMarksCollide } from "../hostAdBuilderRules";
import { formatRelativeSpoken } from "../../../notifications/formatRelativeSpoken";

describe("#4238 W7 P3-1 ads table width", () => {
  it("needs every column's floor plus gaps and padding", () => {
    expect(HOST_AD_TABLE_MIN_WIDTH).toBe(220 + 120 + 2 * 112 + 64 + 64 + 40);
  });
  it("the 576 px main column at 1280 gets list rows, a wide one the table", () => {
    expect(hostAdListUsesTable(true, 576)).toBe(false);
    expect(hostAdListUsesTable(true, HOST_AD_TABLE_MIN_WIDTH)).toBe(true);
    expect(hostAdListUsesTable(true, 0)).toBe(true);
    expect(hostAdListUsesTable(false, 1400)).toBe(false);
  });
});

describe("#4238 W7 P3-4 budget marks", () => {
  it("stacks marks whose labels would touch on a phone track", () => {
    // 30% apart on a 330 pt phone track = 99 pt < a 120 pt label.
    expect(hostAdMarksCollide(20, 50, 330)).toBe(true);
    // The same 30% on a 900 px desktop track is 270 px: side by side.
    expect(hostAdMarksCollide(20, 50, 900)).toBe(false);
    // Before layout the 22% rule holds.
    expect(hostAdMarksCollide(20, 50, 0)).toBe(false);
    expect(hostAdMarksCollide(20, 30, 0)).toBe(true);
  });
});

describe("#4238 W7 P4-3 spoken notification time", () => {
  const NOW = Date.parse("2026-11-16T12:00:00Z");
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();
  it.each([
    [10_000, "just now"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [3 * 3_600_000, "3 hours ago"],
    [24 * 3_600_000, "1 day ago"],
  ])("%p ms reads %p", (ms, words) => {
    expect(formatRelativeSpoken(ago(ms), NOW)).toBe(words);
  });
  it("an older one is a date, never '<date> ago'", () => {
    const spoken = formatRelativeSpoken(ago(20 * 24 * 3_600_000), NOW);
    expect(spoken.startsWith("on ")).toBe(true);
    expect(spoken).not.toMatch(/ago$/);
    expect(formatRelativeSpoken("not a date", NOW)).toBe("");
  });
});
