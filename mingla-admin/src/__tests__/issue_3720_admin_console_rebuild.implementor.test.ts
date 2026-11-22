import {
  assert,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

// MINGLA-INVARIANT: I-3720-ADMIN-COMMUNITY-CONSOLE | issue #3720 | The Admin console retains the approved grouped navigation, human-action queues, audited Community workflows, safe email audience, responsive support list, and evidence-packet review.
// [TEST-MOD #4420] Community (Ideas, Questions, Moderation, Product board) and
// the Roadmap screen are retired, and their panels deleted; this keeps
// pinning every surviving screen of the rebuild: Support, Announcements,
// Email, People and roles, the Feature guide and Brand groups.
Deno.test("#3720 Admin Community and Support rebuild stays complete", async () => {
  const [page, tabs, announcements, support, email, composer, team, guide, groups, service] = await Promise.all([
    read("pages/SupportPage.jsx"),
    read("lib/supportCommunityTabs.js"),
    read("components/community/AnnouncementsPanel.jsx"),
    read("pages/SupportDeskPage.jsx"),
    read("pages/EmailPage.jsx"),
    Promise.all([read("components/email/EmailComposer.jsx"), read("lib/emailAudience.js")]).then((parts) => parts.join("\n")),
    read("components/community/TeamRolesPanel.jsx"),
    read("components/community/FeatureGuidePanel.jsx"),
    Promise.all([read("components/community/BrandGroupsPanel.jsx"), read("components/community/BrandGroupList.jsx"), read("lib/brandGroupInbox.js")]).then((parts) => parts.join("\n")),
    read("services/communityService.js"),
  ]);

  for (const tab of ["Inbox", "People and roles"]) assert(tabs.includes(`label: "${tab}"`), tab);
  for (const gone of ["Ideas from hosts", "Moderation", "Product board", "Brand groups"]) assert(!tabs.includes(`label: "${gone}"`), gone);
  assert(tabs.includes('"brand-groups": "brand-groups"'), "the old Brand groups tab lands on its own screen");
  assertMatch(page, /Available for support/);
  assertMatch(page, /Conversations with hosts and explorers. The ones that need a reply come first[.]/);
  assertNotMatch(page, /CutoverPanel|activeTab === "availability"|OverviewPanel/);
  assertMatch(announcements, /Sent and scheduled/);
  assertMatch(announcements, /Retry failed/);
  assertMatch(support, /<InboxList/);
  assertMatch(support, /<TicketPanel/);
  assertMatch(support, /hidden lg:block/);
  assertMatch(email, /emailViewsFor\(access\)/);
  assertMatch(composer, /userType: "host"/);
  assertMatch(composer, /Explorer users/);
  assertMatch(composer, /Insert ▾/);
  assertMatch(team, /Community &amp; Support[\s\S]+Available[\s\S]+Last active/);
  assertNotMatch(team, />\{row[.]user_id\}</);
  assertMatch(guide, /Apply evidence packet/);
  assertMatch(guide, /pinned Mingla GitHub URL/);
  assertMatch(guide, /before[\s\S]+after/);
  assertMatch(groups, /Search brand groups/);
  assertMatch(groups, /n === 1 \? "teammate" : "teammates"/);

  // The server's Community RPCs stay reachable from the service (Host apps on
  // current builds still use the data).
  for (const rpc of [
    "issue_3720_admin_list_posts", "issue_3720_admin_update_idea",
    "issue_3720_admin_question_action", "issue_3720_admin_moderation_workspace",
    "issue_3720_admin_moderate", "issue_3720_admin_announcement_deliveries",
    "issue_3720_admin_retry_announcement", "issue_3720_admin_team_roster",
    "issue_3720_admin_overview",
  ]) assert(service.includes(rpc), rpc);
});

Deno.test("#3720 console migration keeps audited staff writes and posting-pause read access", async () => {
  const sql = await Deno.readTextFile(new URL("../../../supabase/migrations/20271108063720_issue_3720_community_console_rebuild.sql", import.meta.url));
  assertMatch(sql, /community_posting_pauses/);
  assertMatch(sql, /community_audit_log/);
  assertMatch(sql, /p_action LIKE 'pause_%'/);
  assertMatch(sql, /host_visible_reason_required/);
  assertMatch(sql, /community_post_votes/);
  assertMatch(sql, /business[.]community[.]staff_answer/);
  assertMatch(sql, /lane IN \('now','next','later','shipped'\)/);
  assertNotMatch(sql, /CREATE OR REPLACE FUNCTION public[.]find_capabilities/);
});

