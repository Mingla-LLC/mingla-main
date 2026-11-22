import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

describe("#4173 Guides, Community and Brand-group polish", () => {
  // [TEST-MOD #4420] Guides, the in-app player and Community's section tabs
  // left the Host app; the Help Centre hand-off moved to the Support column.
  it("hands the growing catalogue to the Help Centre", () => {
    const column = read("mingla-business/src/components/support/SupportColumn.tsx");
    expect(column).toContain("openHelpCentre(HELP_CENTRE_URL)");
    expect(column).not.toContain("Linking.openURL");
    expect(read("mingla-business/src/components/support/helpCentreLauncher.native.ts")).toContain("WebBrowser.openBrowserAsync");
    // [TEST-MOD #4420] rework 3 (G7): web opens a new tab and never replaces the
    // app (openExternal's popup-blocked fallback navigated the app tab away).
    const web = read("mingla-business/src/components/support/helpCentreLauncher.web.ts");
    expect(web).toContain('w.open(url, "_blank")');
    expect(web).not.toContain("location.assign");
    expect(web).not.toContain("noopener,");
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
