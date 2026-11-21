// Issue #4130 (Wave 6) — the Community & Support console is two pages,
// Support and Community.
//
//   W6-1  every old console address (each tab, no tab, retired tabs) lands on
//         the right page and tab, keeping its other query values
//   W6-2  Support and Community are real pages; #/email still opens Email
//   W6-3  access: every tab keeps its area, so each role sees exactly the
//         tabs it saw before the split, nobody more (Overview retired)
//   W6-4  Reported enquiries sits next to Moderation on Community, gated to
//         the Community area, and keeps its capability-contract row
//   W6-5  the inbox counts come from the inbox's own rows (staff-created
//         threads included), so a count always matches the list
//   W6-6  failed announcement pushes are found and retried through the
//         existing retry path, Admin-only
//   W6-7  Roadmap links (Work cards) open Community, old links still count
//
// [TEST-MOD #4420] Community and the Roadmap screen are retired: their tabs
// redirect (Support, Work tickets, the Feature guide screen, Announcements),
// Reported enquiries arrive in the Support inbox, and Work cards no longer link
// to a Roadmap screen. issue4420_admin_redirects.implementor.test.js pins the
// full table; this suite keeps pinning what Support still holds.
//
// #4383: Email, Blog, Links page, Announcements and Roadmap left these two
// pages for their own Communications screens; this suite now pins what the
// two pages still hold, and issue_4383_communications.implementor.test.js
// pins the screens, the redirects and the persona access table.
//
// Run: node --test src/__tests__/issue_4130_wave6_support_community.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AREA,
  BLOG_AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
  canOpenPage,
} from "../lib/access.js";
import { isRetiredPageId, redirectHash } from "../lib/adminRoutes.js";
import {
  SUPPORT_PAGE_TABS,
  consoleRedirectHash,
  pageTabFromHash,
  pageTabHash,
} from "../lib/supportCommunityTabs.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { conversationRow, needsReplyCount, splitInbox } from "../lib/supportInboxModel.js";
import { announcementsWithFailedPushes, pushDelivery } from "../lib/announcementDelivery.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const ids = (tabs) => tabs.map((tab) => tab.id);

// The console's tabs before the split (#3720 / #3988 / #4111), and the page
// each now lives on. Overview and Availability were not content tabs any more
// (Overview retired here; Availability is the Support header switch).
// #4383: email, blog, announcements and roadmap are Communications screens
// now (a tab of none), and Community opens on Ideas.
// [TEST-MOD #4420] each old tab -> its full new address (with x=1 carried);
// retired tabs drop values their new page does not read.
const OLD_TAB_HOME = {
  support: "#/support?x=1",
  email: "#/email?x=1",
  blog: "#/blog?x=1",
  team: "#/support?tab=team&x=1",
  announcements: "#/announcements?x=1",
  roadmap: "#/announcements",
  ideas: "#/support",
  questions: "#/support",
  moderation: "#/support",
  "enquiry-reports": "#/support?filter=reported&x=1",
  "brand-groups": "#/brand-groups?x=1", // #4452 §7.2: its own screen
  "feature-guide": "#/feature-guide?x=1",
  product: "#/work-board?type=tickets",
};

describe("W6-1 old console addresses", () => {
  it("every old tab lands on its page and tab, keeping the rest of the address", () => {
    for (const [tab, expected] of Object.entries(OLD_TAB_HOME)) {
      assert.equal(redirectHash(`#/community-support?tab=${tab}&x=1`), expected, tab);
      assert.equal(consoleRedirectHash(`#/community-support?x=1&tab=${tab}`), expected, `${tab} (order)`);
    }
  });

  it("no tab, a retired tab or an unknown one opens Support's inbox", () => {
    for (const hash of ["#/community-support", "#/community-support?tab=overview", "#/community-support?tab=availability", "#/community-support?tab=cutover", "#/community-support?tab=__proto__"]) {
      assert.equal(redirectHash(hash), "#/support", hash);
    }
  });

  it("links already sent by email alerts and Work cards still open the right place", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    assert.equal(redirectHash(`#/community-support?tab=support&ticket=${id}`), `#/support?ticket=${id}`);
    assert.equal(redirectHash(`#/community-support?tab=support&thread=${id}`), `#/support?thread=${id}`);
    // [TEST-MOD #4420] the Product board and Roadmap screen are retired.
    assert.equal(redirectHash(`#/community-support?tab=product&signal=${id}`), "#/work-board?type=tickets");
    assert.equal(redirectHash(`#/community-support?tab=roadmap&card=${id}`), "#/announcements");
    assert.equal(redirectHash("#/community-support?tab=team"), "#/support?tab=team");
  });
});

describe("W6-2 Support is a real page; Community is retired (#4420)", () => {
  it("Support is not a redirect; community-support and (#4420) community are", () => {
    assert.equal(isRetiredPageId("support"), false);
    assert.equal(isRetiredPageId("community"), true);
    assert.equal(redirectHash("#/support?tab=team"), null);
    assert.equal(redirectHash("#/community?tab=ideas"), "#/support");
    assert.equal(isRetiredPageId("community-support"), true);
    assert.equal(redirectHash("#/email"), null);
  });

  it("App maps Support from its own file and no longer maps the console or Community", () => {
    const app = read("App.jsx");
    assert.match(app, /\n\s+support: SupportPage,/);
    assert.equal(/"community-support":|\bcommunity: CommunityPage/.test(app), false);
    assert.match(app, /import \{ SupportPage \} from "\.\/pages\/SupportPage";/);
    assert.match(read("pages/SupportPage.jsx"), /export function SupportPage\(\) \{/);
  });

  it("each page reads and writes its own tab; the default tab has a bare address", () => {
    // #4383 (D1): Support keeps the inbox and People and roles.
    assert.deepEqual(ids(SUPPORT_PAGE_TABS), ["support", "team"]);
    assert.equal(pageTabFromHash("#/support", "support"), "support");
    assert.equal(pageTabFromHash("#/support?tab=team", "support"), "team");
    assert.equal(pageTabFromHash("#/support?tab=roadmap", "support"), "support");
    assert.equal(pageTabFromHash("#/community", "community"), null); // [TEST-MOD #4420] no Community tabs
    assert.equal(pageTabHash("support", "support"), "#/support");
    assert.equal(pageTabHash("support", "roadmap"), "#/support");
  });
});

describe("W6-3 access is unchanged", () => {
  const person = (areas, role = "growth") => ({ email: "t@example.test", role, status: "active", areas });
  // #4255: every active teammate also holds email_drafts and blog (the server
  // sends both), so the Email and Blog tabs open on Support for everyone, and
  // Support opens for a teammate with no Support or Community role.
  const TEAM = [AREA.EMAIL_DRAFTS, BLOG_AREA];
  const PEOPLE = {
    admin: person([AREA.ADMIN_CONSOLE], "admin"),
    supportTeammate: person([AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA, ...TEAM]),
    supportOnly: person([COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, ...TEAM]),
    communityOnly: person([COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA, ...TEAM]),
    salesOnly: person([AREA.ROLE_HOME, AREA.CRM, ...TEAM]),
  };
  // What each person saw in the console before the split, content tabs only,
  // plus (#4255) Email and Blog for every teammate.
  // [TEST-MOD #4420] what each person sees now: Community's retired tabs are
  // gone (ideas, questions, moderation, product; roadmap), Reported enquiries
  // arrive in the Support inbox, and the Feature guide is its own screen with
  // the access its tab had. Every surviving tab or screen is unchanged per person.
  const NOW = {
    admin: ["announcements", "blog", "brand-groups", "email", "feature-guide", "links", "support", "team"],
    supportTeammate: ["blog", "brand-groups", "email", "feature-guide", "links", "support"],
    supportOnly: ["blog", "brand-groups", "email", "feature-guide", "links", "support"],
    communityOnly: ["blog", "email"],
    salesOnly: ["blog", "email"],
  };

  it("each person sees exactly the surviving tabs and screens they saw before", () => {
    // #4383: a moved tab is now its own screen, opened by canOpenPage.
    assert.equal(/\n\s+community: /.test(read("App.jsx")), false, "Community is retired: no route");
    const SCREENS = ["email", "blog", "links", "announcements", "brand-groups", "feature-guide"]; // #4452: + Brand groups; #4420: + Feature guide
    for (const [who, access] of Object.entries(PEOPLE)) {
      const support = ids(communitySupportTabsForAccess(access, SUPPORT_PAGE_TABS));
      const opensSupport = canOpenPage(access, "support");
      assert.equal(opensSupport, canOpenPage(access, "community-support"), `${who}: Support carries the console's access exactly (#4383)`);
      const screens = SCREENS.filter((id) => canOpenPage(access, id));
      assert.deepEqual([...(opensSupport ? support : []), ...screens].sort(), NOW[who], who);
    }
  });

  it("Admin-only tabs stay Admin-only; Email and Blog are every teammate's", () => {
    for (const tab of ["team", "announcements"]) { // [TEST-MOD #4420] roadmap and product rows retired
      assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT[tab].area, AREA.ADMIN_CONSOLE, tab);
    }
    assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT.email.area, AREA.EMAIL_DRAFTS);
    assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT.blog.area, BLOG_AREA);
    const page = read("pages/SupportPage.jsx"); // [TEST-MOD #4420] the Support page's own file
    assert.match(page, /communitySupportTabsForAccess\(access, pageTabs\)/);
    assert.match(page, /activeTab === "team" && capabilities\.isAdmin && <TeamRolesPanel/);
    assert.equal(page.includes("ProductInboxPanel"), false); // [TEST-MOD #4420] the Product board is retired
    // #4383: the moved panels are no longer drawn here.
    for (const gone of ["<EmailPage", "<BlogPanel", "<LinksPagePanel", "<AnnouncementsPanel", "<RoadmapPanel", "<FailedPushBanner"]) {
      assert.equal(page.includes(gone), false, gone);
    }
  });

  it("every Support tab has its contract row, and Support holds all the tab rows", () => {
    assert.deepEqual(
      ids(SUPPORT_PAGE_TABS).sort(),
      Object.keys(COMMUNITY_SUPPORT_TAB_CONTRACT).filter((id) => ["support", "community"].includes(COMMUNITY_SUPPORT_TAB_CONTRACT[id].page)).sort(),
    );
    assert.equal(Object.hasOwn(COMMUNITY_SUPPORT_TAB_CONTRACT, "overview"), false);
  });
});

// [TEST-MOD #4420] the Reported enquiries tab retired with Community; the
// reports arrive in the Support inbox (Reported label), through the same RPCs,
// which the support row of the contract now names.
describe("W6-4 Reported enquiries", () => {
  it("arrive in the Support inbox through the same three RPCs", () => {
    assert.equal(Object.hasOwn(COMMUNITY_SUPPORT_TAB_CONTRACT, "enquiry-reports"), false);
    for (const rpc of ["admin_enquiry_block_everywhere", "admin_enquiry_dismiss_report", "admin_list_reported_enquiries"]) {
      assert.ok(COMMUNITY_SUPPORT_TAB_CONTRACT.support.rpcs.includes(rpc), rpc);
    }
    assert.equal(redirectHash("#/community?tab=enquiry-reports"), "#/support?filter=reported");
  });
});

// [TEST-MOD #4420] the eight views and their rail were retired by the chat inbox
// (Open / Resolved, labels, search). The rule this suite pins is unchanged: the
// numbers shown (Open, Resolved, the page's Inbox badge) are the number of rows
// the list holds, worked out from the same rows.
describe("W6-5 the inbox counts match the inbox", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const ctx = { nowMs: now, me: "s1" };
  const tickets = [
    { id: "i1", origin: "staff", visibility: "internal", status: "open", assigned_staff_id: "s1", last_sender_kind: "staff", last_message_at: "2026-10-26T11:20:00Z", next_update_at: "2026-10-26T18:00:00Z" },
    { id: "t1", origin: "customer", visibility: "person", status: "open", assigned_staff_id: null, last_sender_kind: "customer", last_message_at: "2026-10-25T09:00:00Z", next_update_at: "2026-10-26T10:00:00Z" },
    { id: "t2", origin: "customer", visibility: "brand", status: "pending", assigned_staff_id: "s1", last_sender_kind: "staff", last_message_at: "2026-10-26T08:00:00Z", next_update_at: null },
    { id: "t3", origin: "customer", visibility: "person", status: "resolved", assigned_staff_id: null, last_message_at: "2026-10-24T08:00:00Z" },
    { id: "t4", origin: "customer", visibility: "person", status: "closed", assigned_staff_id: "s1", last_message_at: "2026-10-26T09:00:00Z" },
    { id: "t5", origin: "customer", visibility: "person", status: "new", assigned_staff_id: null, last_sender_kind: null, first_response_at: null, last_message_at: "2026-10-26T10:00:00Z" },
  ];
  const rows = tickets.map(conversationRow);

  it("Open and Resolved hold every row once, and the badge is the Needs reply count", () => {
    const { open, resolved } = splitInbox(rows, ctx);
    assert.equal(open.length + resolved.length, rows.length);
    assert.deepEqual(open.map((r) => r.id), ["t5", "t1", "i1", "t2"]);
    assert.deepEqual(resolved.map((r) => r.id), ["t4", "t3"]);
    assert.equal(needsReplyCount(rows), 2);
  });

  it("the desk shows those counts and hands them to the page's Inbox badge", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /const inbox = useMemo\(\(\) => splitInbox\(allRows,/);
    assert.match(desk, /needsReplyCount\(allRows\)/);
    assert.match(desk, /onCounts\?\.\(\{ open: badge, needs: badge \}\)/);
    assert.match(read("pages/SupportPage.jsx"), /onCounts=\{onInboxCounts\}/);
    assert.equal(/support: Number\(data\.unanswered_tickets/.test(read("pages/SupportPage.jsx")), false);
  });
});

describe("W6-6 failed announcement pushes", () => {
  const delivery = (campaign, channels) => ({ campaign_id: campaign, channels });
  const rows = [
    { id: "a2", title: "Payouts", published_at: "2026-10-18T10:00:00Z", delivery: delivery("c2", { push_accepted: 13, push_failed: 23, push_retrying: 0 }) },
    { id: "a1", title: "Older", published_at: "2026-10-01T10:00:00Z", delivery: delivery("c1", { push_accepted: 5, push_failed: 2 }) },
    { id: "a3", title: "Healthy", published_at: "2026-10-20T10:00:00Z", delivery: delivery("c3", { push_accepted: 30, push_failed: 0 }) },
    { id: "a4", title: "Draft", published_at: null, delivery: null },
  ];

  it("lists announcements with failed pushes, newest first, with what was tried", () => {
    const failed = announcementsWithFailedPushes(rows);
    assert.deepEqual(failed.map((row) => [row.id, row.failed, row.tried, row.campaignId]), [["a2", 23, 36, "c2"], ["a1", 2, 7, "c1"]]);
    assert.deepEqual(announcementsWithFailedPushes(null), []);
    assert.equal(pushDelivery({ delivery: delivery("c", { push_failed: "x" }) }).failed, 0);
    assert.deepEqual(announcementsWithFailedPushes([{ id: "n", delivery: { channels: { push_failed: 3 } } }]), [], "no campaign, nothing to retry");
  });

  it("the Announcements screen (Admins only) shows the banner, and Retry reuses the Announcements path", () => {
    // #4383: the banner moved with the announcements to their own screen.
    const page = read("pages/communications/AnnouncementsPage.jsx");
    assert.match(page, /<FailedPushBanner \/>/);
    const banner = read("components/community/FailedPushBanner.jsx");
    assert.match(banner, /retryAnnouncementDelivery\(confirming\.campaignId\)/);
    assert.match(banner, /<LoadError/);
    assert.match(banner, /<Modal open=\{Boolean\(confirming\)\}/);
    assert.equal(/\.rpc\(|invokeWithRefresh|functions\.invoke/.test(banner), false, "no new sender");
    const announcements = read("components/community/AnnouncementsPanel.jsx");
    assert.match(announcements, /<th className="p-3">Push failed<\/th>/);
    assert.match(announcements, /Retry failed/);
  });
});

// [TEST-MOD #4420] the Roadmap screen is retired: Work cards no longer link to
// it (the wording is approved on the card), and old Roadmap links open
// Announcements; the Write an announcement link stays.
describe("W6-7 Roadmap links", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  it("old Roadmap, Community and console links open Announcements; Work cards keep the announcement link", () => {
    for (const hash of [`#/roadmap?card=${id}`, `#/community?tab=roadmap&card=${id}`, `#/community-support?tab=roadmap&card=${id}`]) {
      assert.equal(redirectHash(hash), "#/announcements", hash);
    }
    assert.equal(read("lib/opsModel.js").includes("roadmapDraftHref"), false);
    assert.equal(read("components/ops/WordingQueue.jsx").includes('href="#/announcements"'), true);
  });
});
