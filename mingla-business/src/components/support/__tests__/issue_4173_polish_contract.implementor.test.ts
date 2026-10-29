import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

describe("#4173 Guides, Community and Brand-group polish", () => {
  it("keeps exactly five foundations visible and hands the growing catalogue to the Help Centre", () => {
    const guides = read("mingla-business/src/components/support/GuidesTabPanel.tsx");
    const route = read("mingla-business/app/account/support.tsx");
    expect(guides).toContain("FEATURED_GUIDE_SLUGS");
    expect(guides).toContain("START_GUIDE");
    expect(guides).toContain("ESSENTIAL_GUIDES");
    expect(guides).toContain("View more videos");
    expect(guides).toContain("openHelpCentre(HELP_CENTRE_URL)");
    expect(guides).not.toContain("showAll");
    expect(guides).not.toContain("Linking.openURL");
    expect(guides).toContain('grid: { flex: 1, minHeight: 0');
    expect(guides).toContain('mobileCell: { width: "48%", height: "48%"');
    expect(guides).toContain('desktopCell: { flex: 1, height: "100%"');
    expect(route).toContain('scrollEnabled={tab !== "guides"}');
    expect(read("mingla-business/src/components/support/helpCentreLauncher.native.ts")).toContain("WebBrowser.openBrowserAsync");
    expect(read("mingla-business/src/components/support/helpCentreLauncher.web.ts")).toContain("openExternal(url)");
    expect(read("mingla-business/src/components/support/helpCentreLauncher.web.ts")).not.toContain("window.open");
  });

  it("never calls pause during guide teardown after Expo may release the player", () => {
    const player = read("mingla-business/src/components/support/GuidePlayerModal.tsx");
    expect(player).not.toContain("player.pause()");
    expect(player).toContain("timeSubscription.remove()");
    expect(player).toContain("endSubscription.remove()");
  });

  it("reveals selected Community tabs and keeps two compact mobile roadmap lanes visible", () => {
    const community = read("mingla-business/src/components/support/CommunityTabPanel.tsx");
    expect(community).toContain("selectedCommunityTabOffset");
    expect(community).toContain("revealActiveSection");
    expect(community).toContain("minHeight: 44");
    expect(community).toContain("(width - 48 - spacing.sm) / 2");
  });

  it("keeps roster email out of the collapsed header and inside authorized details", () => {
    const thread = read("mingla-business/app/messages/[conversationId].tsx");
    const people = read("mingla-business/src/components/messages/BrandGroupPeoplePanel.tsx");
    const migration = read("supabase/migrations/20280207004173_issue_4173_brand_group_roster.sql");
    expect(thread).toContain("tap to see people");
    expect(thread).toContain("BrandGroupPeopleSheet");
    expect(thread).toContain("BrandGroupPeoplePanel");
    expect(thread).not.toContain("member.email}");
    expect(people).toContain("member.email");
    expect(people).toContain('role === "brand_owner"');
    expect(migration).toContain("issue_3720_brand_group_can_access");
    expect(migration).toContain("WHEN 'brand_owner' THEN 0");
    expect(migration).toContain("member.accepted_at IS NOT NULL");
    expect(migration).toContain("member.removed_at IS NULL");
    expect(migration).toContain("REVOKE ALL");
  });
});
