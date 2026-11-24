/** Append-only source contracts for #3720 H1-H9. */

// MINGLA-INVARIANT: I-3720-HOST-COMMUNITY-PROJECTION | issue #3720 | Host Community reads expose published content plus the caller's own review items, while staff-only notes and identity fields stay outside these projections.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

// [TEST-MOD #4420] Help & Support became Announcements and Support. Roadmap,
// Ideas, Questions, Guides and the last-tab memory left the Host app, so
// their pins are gone; the surviving pins follow AnnouncementsPanel.
describe("#3720 Host Help & Support rebuild", () => {
  test("H1-H2 keep the desktop shell and wide panes", () => {
    const route = read("mingla-business/app/account/support.tsx");
    expect(route).toContain("DesktopCanvas");
    expect(route).not.toMatch(/Account\s+›\s+Help &amp; Support/);
    expect(route).not.toContain("sectionRail");
    expect(route).not.toContain("maxWidth: 760");
    expect(route).not.toContain("community-floating-action");
  });

  test("H3-H5 keep normal placeholders and complete announcements", () => {
    // #4382: the request inputs moved into the new-request form.
    const support = read("mingla-business/src/components/support/SupportNewRequestForm.tsx");
    const announcements = read("mingla-business/src/components/support/AnnouncementsPanel.tsx");
    expect(support).toMatch(/subjectInput:[\s\S]+letterSpacing: 0/);
    expect(announcements).toContain("unreadCard");
    expect(announcements).toContain('hubCopy("announcements.action_heading")');
  });

  test("H8-H9 keep sign-out confirmation and the new-request hint", () => {
    const account = read("mingla-business/app/(tabs)/account.tsx");
    const support = read("mingla-business/src/components/support/SupportTabPanel.tsx");
    expect(account).toContain('icon="logout"');
    expect(account).toContain("Sign out of Mingla Host on this device?");
    // #4382: the disabled Send explains what is missing, from the new-request form.
    const form = read("mingla-business/src/components/support/SupportNewRequestForm.tsx");
    expect(form).toContain('supportCopy("form.need_summary")');
    expect(support).toContain("SupportNewRequestForm");
  });

  test("Host reads stay on bounded v2 projections and Admin authors the action fields", () => {
    const service = read("mingla-business/src/services/communityService.ts");
    const migration = read("supabase/migrations/20271108073720_issue_3720_host_help_support.sql");
    const admin = read("mingla-admin/src/components/community/AnnouncementsPanel.jsx");
    expect(service).toContain("action_line, roadmap_card_id");
    expect(migration).toContain("issue_3720_admin_upsert_announcement");
    expect(migration).toContain("Independent Host");
    expect(admin).toContain("What you need to do · optional");
    expect(admin).toContain("Linked roadmap card · optional");
  });
});
