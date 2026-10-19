/** Append-only source contracts for #3720 H1-H9. */

// MINGLA-INVARIANT: I-3720-HOST-COMMUNITY-PROJECTION | issue #3720 | Host Community reads expose published content plus the caller's own review items, while staff-only notes and identity fields stay outside these projections.

import fs from "node:fs";
import path from "node:path";

import { truncateRoadmapBlurb } from "../../utils/roadmapBlurb";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("#3720 Host Help & Support rebuild", () => {
  test("H6 roadmap blurbs execute the bounded host-facing summary behavior", async () => {
    const result = await Promise.resolve(
      truncateRoadmapBlurb("Hosts can see an honest target without an overflowing internal planning note.", 34),
    );
    expect(result).toBe("Hosts can see an honest target…");
    expect(result.length).toBeLessThanOrEqual(35);
  });

  test("H1-H2 keep the desktop shell, constrained panes and four section navigation", () => {
    const route = read("mingla-business/app/account/support.tsx");
    const community = read("mingla-business/src/components/support/CommunityTabPanel.tsx");
    expect(route).toContain("DesktopCanvas");
    expect(route).toMatch(/Account\s+›\s+Help &amp; Support/);
    expect(route).toMatch(/width >= 1100/);
    expect(route).toMatch(/sectionRail[\s\S]+desktopFeed[\s\S]+sidePanel/);
    expect(route).toContain("maxWidth: 760");
    expect(route).toContain("hasCommunityTarget ? \"community\" : null");
    expect(route).toContain("target.kind === \"idea\" ? \"ideas\" : \"questions\"");
    for (const label of ["Announcements", "Roadmap", "Ideas", "Questions"]) {
      expect(community).toContain(`label: "${label}"`);
    }
    expect(route).toContain("key={communitySection}");
  });

  test("H3-H5 keep normal placeholders, list-first ideas and complete announcements", () => {
    const support = read("mingla-business/src/components/support/SupportTabPanel.tsx");
    const conversations = read("mingla-business/src/components/support/CommunityConversationsPanel.tsx");
    const community = read("mingla-business/src/components/support/CommunityTabPanel.tsx");
    expect(support).toMatch(/subjectInput:[\s\S]+letterSpacing: 0/);
    expect(conversations).toMatch(/input:[\s\S]+letterSpacing: 0/);
    expect(conversations).toContain("Suggest an idea");
    expect(conversations).toContain("Vote instead?");
    expect(conversations).toContain("setTimeout(() => setSettledTitle(title), 600)");
    expect(conversations).toContain("Community guidelines");
    expect(conversations).toMatch(/author_label} · {post.brand_label/);
    expect(community).toContain("unreadCard");
    expect(community).toContain("What you need to do");
    expect(community).toContain("On the roadmap");
  });

  test("H6-H9 keep honest roadmap rows, compact guides, sign-out confirmation and chat hint", () => {
    const community = read("mingla-business/src/components/support/CommunityTabPanel.tsx");
    const guides = read("mingla-business/src/components/support/GuidesTabPanel.tsx");
    const account = read("mingla-business/app/(tabs)/account.tsx");
    const support = read("mingla-business/src/components/support/SupportTabPanel.tsx");
    for (const label of ["Being delivered now", "Next", "Later", "Recently shipped"]) expect(community).toContain(label);
    expect(community).toContain("truncateRoadmapBlurb");
    expect(community).toContain("Aiming for");
    expect(community).toContain("Fed by");
    expect(guides).toContain("HELP_CHAPTERS.map");
    expect(guides).toContain("width: 88");
    expect(guides).toContain("height: 56");
    expect(account).toContain('icon="logout"');
    expect(account).toContain("Sign out of Mingla Host on this device?");
    expect(support).toContain("Add a subject to start");
    expect(read("mingla-business/src/utils/helpSupportLastTab.ts")).toMatch(/unreadCount > 0[\s\S]+return "community"/);
  });

  test("Host reads stay on bounded v2 projections and Admin authors the action fields", () => {
    const service = read("mingla-business/src/services/communityService.ts");
    const migration = read("supabase/migrations/20271108073720_issue_3720_host_help_support.sql");
    const admin = read("mingla-admin/src/components/community/AnnouncementsPanel.jsx");
    expect(service).toContain("issue_3720_community_feed_v2");
    expect(service).toContain("issue_3720_community_comments_v2");
    expect(service).toContain("action_line, roadmap_card_id");
    expect(migration).toContain("issue_3720_admin_upsert_announcement");
    expect(migration).toContain("Independent Host");
    expect(admin).toContain("What you need to do · optional");
    expect(admin).toContain("Linked roadmap card · optional");
  });
});
