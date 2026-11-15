/**
 * #4420 layout pass (builder C areas): the pure rules behind the re-laid
 * Promote, program and chat screens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MARKETING_SECTION_TITLES,
  MARKETING_SUB_NAV_TABS,
  isMarketingDetailRoute,
} from "../marketingSubNavTabs";

const source = (relative: string): string =>
  readFileSync(join(process.cwd(), relative), "utf8");

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

  it("keeps one action per section: the phone has no compact circle over the pills", () => {
    const nav = source("src/components/marketing/MarketingSubNav.tsx");
    expect(nav).not.toContain("compact={!isWideDesktop}");
    expect(nav).toContain('testID="marketing-desk-header"');
    const layout = source("app/(tabs)/marketing/_layout.tsx");
    expect(layout).toContain("isMarketingDetailRoute(pathname)");
    expect(layout).toContain("{hideActions ? null : <MarketingSubNav />}");
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

  it("caps every pinned chat screen clear of the privacy strip", () => {
    for (const file of [
      "app/messages/[conversationId].tsx",
      "src/components/messages/BrandEnquiryThreadScreen.tsx",
      "app/(tabs)/marketing/_layout.tsx",
    ]) {
      expect(source(file)).toContain("webPrivacyMaxHeight()");
    }
    const pin = source("src/components/messages/webViewportPin.ts");
    expect(pin).toContain("--mingla-privacy-inset");
  });

  it("lets a long program row value wrap instead of crushing the row title", () => {
    const kit = source("src/components/programs/ProgramKit.tsx");
    expect(kit).toMatch(/rowRight: \{[\s\S]*?flexShrink: 1,[\s\S]*?maxWidth: "58%"/);
  });
});
