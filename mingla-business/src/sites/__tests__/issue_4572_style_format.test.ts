/*
 * #4572 item 6 (D6, SC-6.6) — a gallery whose website plan ticks events and
 * "Creative & arts" is judged as an art venue for its style: it is never told
 * "Terra and Haven: too soft for a club night".
 *
 * FAILS-ON-REVERT (true line deletion): put `primaryFormat` back in
 * planFormatOf (styleLibrary.ts) or drop the `includes("art")` line in
 * styleFormat (packages/site-contracts/src/formats.ts) → SF-1 / SF-2 fail.
 */
import { styleFormat, skippedLine } from "../../../../packages/site-contracts/src/formats.ts";
import { planFormatOf, styleFitLabel } from "../styleLibrary";

describe("#4572 style format", () => {
  it("SF-1 a gallery plan {events, venue_creative_arts} is judged as art", () => {
    const plan = { offerings_selected: ["events", "venue_creative_arts"] };
    expect(styleFormat(plan)).toBe("art");
    expect(skippedLine(styleFormat(plan)!)).not.toContain("club night");
    expect(planFormatOf({ offeringsSelected: ["events", "venue_creative_arts"], story: null })).toBe("art");
  });

  it("SF-2 the gallery's look picker never warns Terra as 'avoid'", () => {
    const format = planFormatOf({ offeringsSelected: ["events", "venue_creative_arts"], story: null });
    expect(styleFitLabel(format, "terra")?.fit).not.toBe("avoid");
  });

  it("SF-3 an events-only plan is unchanged (still events, still the club-night line)", () => {
    expect(styleFormat({ offerings_selected: ["events"] })).toBe("events");
    expect(skippedLine("events")).toContain("club night");
  });

  it("SF-4 a venue main action keeps its own venue format", () => {
    expect(
      styleFormat({ offerings_selected: ["venue_food_drink", "venue_creative_arts"], main_action_page: "menu" }),
    ).toBe("restaurants");
    expect(styleFormat({ offerings_selected: [] })).toBeNull();
  });
});
