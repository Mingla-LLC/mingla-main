import {
  assert,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

// MINGLA-INVARIANT: I-3720-ADMIN-COMMUNITY-CONSOLE | issue #3720 | The Admin console retains the approved grouped navigation, human-action queues, audited Community workflows, safe email audience, responsive support list, and evidence-packet review.
Deno.test("#3720 Admin Community and Support rebuild stays complete", async () => {
  const [page, navigation, tabs, ideas, questions, moderation, announcements, roadmap, support, email, composer, team, guide, groups, inbox, service] = await Promise.all([
    read("pages/CommunitySupportPage.jsx"),
    read("components/community/CommunitySupportNavigation.jsx"),
    // #4130 Wave 6: Overview was retired; the two pages' tabs live here.
    read("lib/supportCommunityTabs.js"),
    read("components/community/IdeasPanel.jsx"),
    read("components/community/QuestionsPanel.jsx"),
    read("components/community/ModerationPanel.jsx"),
    read("components/community/AnnouncementsPanel.jsx"),
    read("components/community/RoadmapPanel.jsx"),
    read("pages/SupportDeskPage.jsx"),
    read("pages/EmailPage.jsx"),
    // #4226: the audience presets moved from the composer into lib/emailAudience.js.
    Promise.all([read("components/email/EmailComposer.jsx"), read("lib/emailAudience.js")]).then((parts) => parts.join("\n")),
    read("components/community/TeamRolesPanel.jsx"),
    read("components/community/FeatureGuidePanel.jsx"),
    read("components/community/BrandGroupsPanel.jsx"),
    read("components/community/ProductInboxPanel.jsx"),
    read("services/communityService.js"),
  ]);

  // #4130 Wave 6: the grouped navigation became two pages, Support and
  // Community, each with one flat row of tabs (a select on a phone).
  for (const tab of ["Inbox", "Email", "People and roles", "Announcements", "Roadmap", "Ideas from hosts", "Questions", "Moderation", "Reported enquiries", "Brand groups", "Feature guide", "Product inbox"]) assert(tabs.includes(`label: "${tab}"`), tab);
  assertMatch(navigation, /md:hidden/);
  assertMatch(page, /Available for support/);
  assertMatch(page, /Conversations with hosts and explorers, oldest waiting first[.]/);
  assertMatch(page, /What we tell hosts, what we've shipped, and what they ask for[.]/);
  assertNotMatch(page, /CutoverPanel|activeTab === "availability"|OverviewPanel/);
  assertMatch(ideas, /not_now/);
  assertMatch(ideas, /Response from Mingla/);
  assertMatch(ideas, /Merge into this idea/);
  assertMatch(ideas, /Promote to roadmap/);
  assertMatch(questions, /Mingla team badge/);
  assertMatch(questions, /"pin"|"unpin"/);
  for (const label of ["Reports", "First posts", "Appeals", "Hidden", "Paused hosts", "Audit log", "7 days", "30 days", "Permanent"]) assert(moderation.includes(label), label);
  assertMatch(moderation, /Reason shown to the Host/);
  assertMatch(announcements, /Sent and scheduled/);
  assertMatch(announcements, /Retry failed/);
  assertMatch(roadmap, /Recently shipped/);
  assertMatch(roadmap, /draggable/);
  assertMatch(roadmap, /line-clamp-2/);
  assertMatch(support, /Requester[\s\S]+Subject[\s\S]+Status[\s\S]+Idle[\s\S]+Next update/);
  assertMatch(support, /lg:hidden/);
  assertMatch(email, /History[\s\S]+Send[\s\S]+Templates[\s\S]+Unsubscribes/);
  assertMatch(composer, /userType: "host"/);
  assertMatch(composer, /Explorer users/);
  assertMatch(composer, /Insert ▾/);
  // [TEST-MOD-APPROVED #3988] One "Community & Support" role column replaces the two role columns.
  assertMatch(team, /Community &amp; Support[\s\S]+Available[\s\S]+Last active/);
  assertNotMatch(team, />\{row[.]user_id\}</);
  assertMatch(guide, /Apply evidence packet/);
  assertMatch(guide, /pinned Mingla GitHub URL/);
  assertMatch(guide, /before[\s\S]+after/);
  assertMatch(groups, /Search Brand groups/);
  assertMatch(groups, /count === 1 [^\n]+teammate/);
  assertMatch(inbox, /Open the Mingla Avengers board/);

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

