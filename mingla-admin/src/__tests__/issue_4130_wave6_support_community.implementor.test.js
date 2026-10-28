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
// Run: node --test src/__tests__/issue_4130_wave6_support_community.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
  canOpenPage,
} from "../lib/access.js";
import { isRetiredPageId, redirectHash } from "../lib/adminRoutes.js";
import {
  COMMUNITY_PAGE_TABS,
  SUPPORT_PAGE_TABS,
  consoleRedirectHash,
  pageTabFromHash,
  pageTabHash,
} from "../lib/supportCommunityTabs.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import {
  SUPPORT_INBOX_FILTERS,
  supportInboxCounts,
  supportInboxRows,
} from "../lib/supportTicketMetrics.js";
import { announcementsWithFailedPushes, pushDelivery } from "../lib/announcementDelivery.js";
import { isRoadmapHash, roadmapCardFromHash, roadmapDraftHref } from "../lib/opsModel.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const ids = (tabs) => tabs.map((tab) => tab.id);

// The console's tabs before the split (#3720 / #3988 / #4111), and the page
// each now lives on. Overview and Availability were not content tabs any more
// (Overview retired here; Availability is the Support header switch).
const OLD_TAB_HOME = {
  support: ["support", null],
  email: ["support", "email"],
  blog: ["support", "blog"],
  team: ["support", "team"],
  announcements: ["community", null],
  roadmap: ["community", "roadmap"],
  ideas: ["community", "ideas"],
  questions: ["community", "questions"],
  moderation: ["community", "moderation"],
  "enquiry-reports": ["community", "enquiry-reports"],
  "brand-groups": ["community", "brand-groups"],
  "feature-guide": ["community", "feature-guide"],
  product: ["community", "product"],
};

describe("W6-1 old console addresses", () => {
  it("every old tab lands on its page and tab, keeping the rest of the address", () => {
    for (const [tab, [page, newTab]] of Object.entries(OLD_TAB_HOME)) {
      const expected = `#/${page}?${newTab ? `tab=${newTab}&` : ""}x=1`;
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
    assert.equal(redirectHash(`#/community-support?tab=product&signal=${id}`), `#/community?tab=product&signal=${id}`);
    assert.equal(redirectHash(`#/community-support?tab=roadmap&card=${id}`), `#/community?tab=roadmap&card=${id}`);
    assert.equal(redirectHash("#/community-support?tab=team"), "#/support?tab=team");
  });
});

describe("W6-2 Support and Community are real pages", () => {
  it("they are no longer redirects; community-support and email are", () => {
    assert.equal(isRetiredPageId("support"), false);
    assert.equal(isRetiredPageId("community"), false);
    assert.equal(redirectHash("#/support?tab=email"), null);
    assert.equal(redirectHash("#/community?tab=roadmap"), null);
    assert.equal(isRetiredPageId("community-support"), true);
    assert.equal(redirectHash("#/email"), "#/support?tab=email");
  });

  it("App maps both pages and no longer maps the console", () => {
    const app = read("App.jsx");
    assert.match(app, /\n\s+support: SupportPage,\n\s+community: CommunityPage,/);
    assert.equal(/"community-support":/.test(app), false);
    assert.match(app, /import \{ CommunityPage, SupportPage \} from "\.\/pages\/CommunitySupportPage";/);
    const page = read("pages/CommunitySupportPage.jsx");
    assert.match(page, /export function SupportPage\(\) \{\n  return <SupportCommunityConsole pageId="support" \/>;/);
    assert.match(page, /export function CommunityPage\(\) \{\n  return <SupportCommunityConsole pageId="community" \/>;/);
  });

  it("each page reads and writes its own tab; the default tab has a bare address", () => {
    assert.deepEqual(ids(SUPPORT_PAGE_TABS), ["support", "email", "blog", "team"]);
    assert.equal(pageTabFromHash("#/support", "support"), "support");
    assert.equal(pageTabFromHash("#/support?tab=email", "support"), "email");
    assert.equal(pageTabFromHash("#/support?tab=roadmap", "support"), "support");
    assert.equal(pageTabFromHash("#/community", "community"), "announcements");
    assert.equal(pageTabHash("support", "support"), "#/support");
    assert.equal(pageTabHash("community", "enquiry-reports"), "#/community?tab=enquiry-reports");
    assert.equal(pageTabHash("support", "roadmap"), "#/support");
  });
});

describe("W6-3 access is unchanged", () => {
  const person = (areas, role = "growth") => ({ email: "t@example.test", role, status: "active", areas });
  const PEOPLE = {
    admin: person([AREA.ADMIN_CONSOLE], "admin"),
    supportTeammate: person([AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA]),
    supportOnly: person([COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA]),
    communityOnly: person([COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA]),
    salesOnly: person([AREA.ROLE_HOME, AREA.CRM]),
  };
  // What each person saw in the console before the split, content tabs only.
  const BEFORE = {
    admin: Object.keys(OLD_TAB_HOME).sort(),
    supportTeammate: ["blog", "brand-groups", "enquiry-reports", "feature-guide", "ideas", "moderation", "questions", "support"],
    supportOnly: ["blog", "brand-groups", "feature-guide", "support"],
    communityOnly: ["enquiry-reports", "ideas", "moderation", "questions"],
    salesOnly: [],
  };

  it("each person sees exactly the tabs they saw before, split over the two pages", () => {
    for (const [who, access] of Object.entries(PEOPLE)) {
      const support = ids(communitySupportTabsForAccess(access, SUPPORT_PAGE_TABS));
      const community = ids(communitySupportTabsForAccess(access, COMMUNITY_PAGE_TABS));
      const opens = canOpenPage(access, "support");
      assert.equal(canOpenPage(access, "community"), opens, who);
      assert.equal(opens, canOpenPage(access, "community-support"), `${who}: page access is the old console's`);
      assert.deepEqual(opens ? [...support, ...community].sort() : [], BEFORE[who], who);
    }
  });

  it("Admin-only tabs stay Admin-only", () => {
    for (const tab of ["email", "team", "announcements", "roadmap", "product"]) {
      assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT[tab].area, AREA.ADMIN_CONSOLE, tab);
    }
    const page = read("pages/CommunitySupportPage.jsx");
    assert.match(page, /communitySupportTabsForAccess\(access, pageTabs\)/);
    assert.match(page, /activeTab === "team" && capabilities\.isAdmin && <TeamRolesPanel/);
    assert.match(page, /activeTab === "product" && capabilities\.isAdmin && <ProductInboxPanel \/>/);
  });

  it("every tab on either page has its contract row, and the two pages hold them all", () => {
    assert.deepEqual(
      [...ids(SUPPORT_PAGE_TABS), ...ids(COMMUNITY_PAGE_TABS)].sort(),
      Object.keys(COMMUNITY_SUPPORT_TAB_CONTRACT).sort(),
    );
    assert.equal(Object.hasOwn(COMMUNITY_SUPPORT_TAB_CONTRACT, "overview"), false);
  });
});

describe("W6-4 Reported enquiries", () => {
  it("sits right after Moderation on Community and keeps its gate and contract row", () => {
    const tabs = ids(COMMUNITY_PAGE_TABS);
    assert.equal(tabs.indexOf("enquiry-reports"), tabs.indexOf("moderation") + 1);
    assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT["enquiry-reports"].area, COMMUNITY_OPERATIONS_AREA);
    assert.deepEqual([...COMMUNITY_SUPPORT_TAB_CONTRACT["enquiry-reports"].rpcs].sort(), [
      "admin_enquiry_block_everywhere", "admin_enquiry_dismiss_report", "admin_list_reported_enquiries",
    ]);
    assert.match(read("pages/CommunitySupportPage.jsx"), /activeTab === "enquiry-reports" && capabilities\.canCommunity && <ReportedEnquiriesPanel \/>/);
  });
});

describe("W6-5 the inbox counts match the inbox", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const rows = [
    // a staff-created thread: the old Overview never counted these
    { id: "i1", source_kind: "internal_thread", status: "new", assigned_staff_id: "s1", last_message_at: "2026-10-26T11:20:00Z", next_update_at: "2026-10-26T18:00:00Z" },
    { id: "t1", source_kind: "support_ticket", status: "open", assigned_staff_id: null, last_message_at: "2026-10-25T09:00:00Z", next_update_at: "2026-10-26T10:00:00Z" },
    { id: "t2", source_kind: "support_ticket", status: "pending", assigned_staff_id: "s1", last_message_at: "2026-10-26T08:00:00Z", next_update_at: null },
    { id: "t3", source_kind: "support_ticket", status: "resolved", assigned_staff_id: null, last_message_at: "2026-10-24T08:00:00Z" },
    { id: "t4", source_kind: "support_ticket", status: "closed", assigned_staff_id: "s1", last_message_at: "2026-10-26T09:00:00Z" },
  ];

  it("each filter's count is the number of rows that filter lists", () => {
    const counts = supportInboxCounts(rows, now);
    for (const { id } of SUPPORT_INBOX_FILTERS) {
      assert.equal(counts[id], supportInboxRows(rows, id, now).length, id);
    }
    assert.deepEqual(counts, { open: 3, unassigned: 1, overdue: 1, resolved: 2, all: 5 });
  });

  it("the inbox opens on Open, longest waiting first; Resolved is newest first", () => {
    assert.equal(SUPPORT_INBOX_FILTERS[0].id, "open");
    assert.deepEqual(supportInboxRows(rows, "open", now).map((r) => r.id), ["t1", "t2", "i1"]);
    assert.deepEqual(supportInboxRows(rows, "resolved", now).map((r) => r.id), ["t4", "t3"]);
    assert.deepEqual(supportInboxRows(rows, "overdue", now).map((r) => r.id), ["t1"]);
  });

  it("the desk shows those counts and hands them to the page's Inbox badge", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /const inboxCounts = useMemo\(\(\) => supportInboxCounts\(tickets\), \[tickets\]\);/);
    assert.match(desk, /supportInboxRows\(tickets, inboxFilter\)/);
    assert.match(desk, /onCounts\?\.\(inboxCounts\)/);
    assert.match(read("pages/CommunitySupportPage.jsx"), /onCounts=\{onInboxCounts\}/);
    assert.equal(/support: Number\(data\.unanswered_tickets/.test(read("pages/CommunitySupportPage.jsx")), false);
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

  it("Support shows the banner to Admins only, and Retry reuses the Announcements path", () => {
    const page = read("pages/CommunitySupportPage.jsx");
    assert.match(page, /\{onSupportPage && capabilities\.isAdmin \? <FailedPushBanner \/> : null\}/);
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

describe("W6-7 Roadmap links", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  it("Work cards link to Community, and old console links still open the card", () => {
    assert.equal(roadmapDraftHref({ links: [{ kind: "roadmap_card", id }] }), `#/community?tab=roadmap&card=${id}`);
    assert.equal(roadmapCardFromHash(`#/community?tab=roadmap&card=${id}`), id);
    assert.equal(roadmapCardFromHash(`#/community-support?tab=roadmap&card=${id}`), id);
    assert.equal(isRoadmapHash(`#/support?tab=roadmap&card=${id}`), false);
    assert.equal(read("components/ops/WordingQueue.jsx").includes('href="#/community?tab=announcements"'), true);
  });
});
