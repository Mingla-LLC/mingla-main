import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MARKETING_TAB_ACTIONS } from "../marketingTabActions";

const source = (relative: string): string =>
  readFileSync(join(process.cwd(), relative), "utf8");

describe("#4168 Host wide-screen design contract", () => {
  it("gives every persistent Blast tab one canonical action", () => {
    expect(MARKETING_TAB_ACTIONS).toEqual({
      overview: expect.objectContaining({ label: "Send a campaign", href: "/(tabs)/marketing/campaigns/compose" }),
      campaigns: expect.objectContaining({ label: "New campaign", href: "/(tabs)/marketing/campaigns/compose" }),
      ads: expect.objectContaining({ label: "Create an ad", href: "/(tabs)/marketing/ads/create" }),
      creators: expect.objectContaining({ label: "Hire a creator" }),
      referrals: expect.objectContaining({ label: "Create offer" }),
      people: expect.objectContaining({ label: "Import people", href: "/(tabs)/people/import?returnTo=marketingPeople" }),
      templates: expect.objectContaining({ label: "New template", href: "/(tabs)/marketing/templates/new" }),
    });
  });

  it("feeds the compact and floating controls from the same action context", () => {
    const layout = source("app/(tabs)/marketing/_layout.tsx");
    const nav = source("src/components/marketing/MarketingSubNav.tsx");
    expect(layout).toContain("<MarketingActionProvider>");
    expect(layout).toContain("<MarketingActionSurfaces hidden={hideActions} />");
    expect(nav).toContain("const action = useMarketingAction()");
    expect(nav).toContain("<MarketingActionButton action={action}");
    expect(layout).not.toContain("UniversalCreatorSheet");
  });

  it("keeps Roadmap as stable Now, Next and Later lanes with hidden scrollbar chrome", () => {
    const panel = source("src/components/support/CommunityTabPanel.tsx");
    expect(panel).toContain('const LANE_ORDER = ["now", "next", "later"] as const');
    expect(panel).toContain('now: "Now"');
    expect(panel).toContain("showsHorizontalScrollIndicator={false}");
    expect(panel).toContain('testID="community-roadmap-board"');
    expect(panel).not.toMatch(/LANE_ORDER[^\n]*shipped/);
  });

  it("uses full-width responsive program columns and omits empty Results filters", () => {
    const kit = source("src/components/programs/ProgramKit.tsx");
    const results = source("src/components/creators/screens/CreatorResultsScreen.tsx");
    expect(kit).toContain("export function ProgramColumns");
    expect(kit).toContain('maxWidth: "100%"');
    const populated = results.indexOf("rows !== null && rows.length > 0");
    const segmented = results.indexOf("<Segmented", populated);
    const empty = results.indexOf("rows !== null && rows.length === 0");
    expect(populated).toBeGreaterThan(-1);
    expect(segmented).toBeGreaterThan(populated);
    expect(empty).toBeLessThan(segmented);
  });

  it("retains every Overview metric while removing duplicate route FABs", () => {
    const overview = source("app/(tabs)/marketing/index.tsx");
    for (const label of ["CAMPAIGNS SENT", "ACCEPTED", "DELIVERED", "OPENED", "CLICKED", "FAILED"]) {
      expect(overview).toContain(label);
    }
    for (const file of [
      "app/(tabs)/marketing/index.tsx",
      "app/(tabs)/marketing/campaigns/index.tsx",
      "app/(tabs)/marketing/templates/index.tsx",
      "src/components/people/PeoplePage.tsx",
    ]) {
      expect(source(file)).not.toContain("styles.fab");
    }
  });

  it("only applies desktop flex-basis sizing when columns are side by side", () => {
    for (const file of [
      "app/(tabs)/marketing/index.tsx",
      "app/(tabs)/marketing/ads/index.tsx",
      "src/components/support/CommunityTabPanel.tsx",
      "src/components/support/SupportTabPanel.tsx",
    ]) {
      const contents = source(file);
      expect(contents).toContain("isWideDesktop && styles.");
      expect(contents).toMatch(/Wide: \{ flexBasis: 0, flexGrow:/);
    }

    const ads = source("app/(tabs)/marketing/ads/index.tsx");
    expect(ads).toContain('flexDirection: "column-reverse"');
  });

  it("removes the narrow Community rail and visible desktop page heading", () => {
    const support = source("app/account/support.tsx");
    expect(support).not.toContain("sectionRail");
    expect(support).not.toContain("desktopConstrained");
    expect(support).not.toContain("desktopTitle");
    expect(support).toContain("community-floating-action");
  });
});
