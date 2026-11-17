/**
 * #4420 layout pass (builder C areas): the pure rules behind the re-laid
 * Promote, program and chat screens.
 *
 * [TEST-MOD-APPROVED #4420] — the source-text half moved to the I-4420-HOST-WIRING
 * strict-grep gate (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN); this file keeps the behaviour.
 */
import {
  MARKETING_SECTION_TITLES,
  MARKETING_SUB_NAV_TABS,
  isMarketingDetailRoute,
} from "../marketingSubNavTabs";

describe("#4420 Promote shell", () => {
  it("hides the section pills and action on a campaign or template detail, never on a section", () => {
    expect(isMarketingDetailRoute("/marketing/campaigns/b08973b6-642f")).toBe(true);
    expect(isMarketingDetailRoute("/marketing/templates/52a89447")).toBe(true);
    expect(isMarketingDetailRoute("/marketing/templates/new")).toBe(true);
    expect(isMarketingDetailRoute("/marketing/campaigns/compose")).toBe(false);
    expect(isMarketingDetailRoute("/marketing/campaigns")).toBe(false);
    expect(isMarketingDetailRoute("/marketing/templates")).toBe(false);
    expect(isMarketingDetailRoute("/marketing")).toBe(false);
    expect(isMarketingDetailRoute("/marketing/ads")).toBe(false);
  });

  it("gives every section a desktop page title", () => {
    for (const tab of MARKETING_SUB_NAV_TABS) {
      expect(MARKETING_SECTION_TITLES[tab.id]).toBeTruthy();
    }
    expect(MARKETING_SECTION_TITLES.overview).toBe("Promote");
  });
});

describe("#4420 no bleed-outs", () => {
  it("steps a long stat value down instead of ellipsizing it", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stripValueFontSize } = require("../../programs/StatStrip") as typeof import("../../programs/StatStrip");
    expect(stripValueFontSize("$0", false)).toBeUndefined();
    expect(stripValueFontSize("$1,966", false)).toBeUndefined();
    expect(stripValueFontSize("$1,966.5", false)).toBe(17);
    expect(stripValueFontSize("$12,966.50", false)).toBe(15);
    expect(stripValueFontSize("$12,966.50", true)).toBe(20);
  });
});
