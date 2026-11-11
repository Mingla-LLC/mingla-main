// Issue #4383 — Admin Communications: one menu group for everything we tell
// hosts and explorers, each its own screen.
//
//   C-1  the menu: a Communications group after Support, its screens in
//        order, each with a registered icon and its own page (T1)
//   C-2  every old tab address lands on the new screen with its other query
//        values kept, in any order (T2); #/email is a live page again
//   C-3  roadmap card links: the new and both older forms open the card (T3)
//   C-4  access is unchanged: for nine personas the set of panels they can
//        open is the same before and after; growth loses only the empty
//        Support menu entry (T4, I-4383-COMMS-ACCESS-UNCHANGED)
//   C-5  unknown and hostile addresses never crash (T5)
//   C-6  the Email screen's sections live in the address (view=)
//
// MINGLA-INVARIANT: I-4383-COMMS-ACCESS-UNCHANGED | issue #4383 | Moving a panel to its own Communications screen never changes who can open it (C-4 persona table below).
//
// Run: node --test src/__tests__/issue_4383_communications.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import {
  AREA,
  BLOG_AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
  canOpenPage,
  normalizeAccess,
  resolveRoute,
  visibleNavGroups,
} from "../lib/access.js";
import { isRetiredPageId, redirectHash } from "../lib/adminRoutes.js";
import {
  COMMUNICATIONS_TAB_PAGES,
  COMMUNITY_PAGE_TABS,
  SUPPORT_PAGE_TABS,
} from "../lib/supportCommunityTabs.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { isRoadmapHash, roadmapCardFromHash, roadmapDraftHref } from "../lib/opsModel.js";
import { emailViewFromHash, emailViewHash, emailViewsFor } from "../lib/emailViews.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const APP = read("App.jsx");
const SIDEBAR = read("components/layout/Sidebar.jsx");

// The approved menu (spec §4.1). Push joins in Wave 2.
const COMMUNICATIONS = [
  ["communications", "Overview", "RadioTower"],
  ["announcements", "Announcements", "BellRing"],
  ["roadmap", "Roadmap", "Milestone"],
  ["email", "Email", "Mail"],
  ["blog", "Blog", "Newspaper"],
  ["links", "Links page", "Link"],
];

describe("C-1 the Communications menu group", () => {
  it("sits right after Support and holds its screens in order", () => {
    const labels = NAV_GROUPS.map((group) => group.label);
    assert.equal(labels.indexOf("Communications"), labels.indexOf("Support") + 1);
    const group = NAV_GROUPS.find((g) => g.label === "Communications");
    assert.deepEqual(group.items.map((item) => [item.id, item.label, item.icon]), COMMUNICATIONS);
    assert.equal(NAV_ITEMS.length, 40, "34 entries + the Communications group");
  });

  it("each screen is a page App draws, and its icon is registered", () => {
    for (const [id, , icon] of COMMUNICATIONS) {
      assert.match(APP, new RegExp(`\\n\\s+${id}: [A-Z]\\w+Page,`), `${id} has a page`);
      assert.match(SIDEBAR, new RegExp(`\\n  ${icon},`), `${icon} is in ICON_MAP`);
    }
  });

  it("Support keeps the inbox and People and roles; Community opens on Ideas", () => {
    assert.deepEqual(SUPPORT_PAGE_TABS.map((t) => [t.id, t.label]), [["support", "Inbox"], ["team", "People and roles"]]);
    assert.deepEqual(COMMUNITY_PAGE_TABS.map((t) => t.id), ["ideas", "questions", "moderation", "enquiry-reports", "brand-groups", "feature-guide", "product"]);
    assert.equal(COMMUNITY_PAGE_TABS.find((t) => t.id === "product").label, "Product board");
  });

  it("the moved panels are drawn by their own screens, not by Support or Community", () => {
    const console = read("pages/CommunitySupportPage.jsx");
    for (const gone of ["<EmailPage", "<BlogPanel", "<LinksPagePanel", "<AnnouncementsPanel", "<RoadmapPanel", "<FailedPushBanner", "community:new-announcement"]) {
      assert.equal(console.includes(gone), false, gone);
    }
    assert.match(read("pages/communications/AnnouncementsPage.jsx"), /<AnnouncementsPanel \/>/);
    assert.match(read("pages/communications/AnnouncementsPage.jsx"), /<FailedPushBanner \/>/);
    assert.match(read("pages/communications/RoadmapPage.jsx"), /<RoadmapPanel \/>/);
    assert.match(read("pages/communications/BlogPage.jsx"), /<BlogPanel onCounts=\{onCounts\} \/>/);
    assert.match(read("pages/communications/LinksPage.jsx"), /<LinksPagePanel \/>/);
    assert.equal(/embedded/.test(read("pages/EmailPage.jsx")), false, "Email is a screen, not an embed");
  });
});

describe("C-2 old addresses land on the new screens", () => {
  const POST = "00000000-0000-4000-8000-0000000000b1";
  const CARD = "00000000-0000-4000-8000-0000000000c1";
  const TABLE = [
    ["#/support?tab=email", "#/email"],
    [`#/support?tab=blog&view=editor&post=${POST}`, `#/blog?view=editor&post=${POST}`],
    [`#/support?view=editor&tab=blog&post=${POST}`, `#/blog?view=editor&post=${POST}`],
    ["#/support?tab=links", "#/links"],
    ["#/community?tab=announcements", "#/announcements"],
    [`#/community?tab=roadmap&card=${CARD}`, `#/roadmap?card=${CARD}`],
    [`#/community?card=${CARD}&tab=roadmap`, `#/roadmap?card=${CARD}`],
    ["#/community-support?tab=email&x=1", "#/email?x=1"],
    [`#/community-support?tab=blog&view=editor&post=${POST}`, `#/blog?view=editor&post=${POST}`],
    ["#/community-support?tab=links", "#/links"],
    ["#/community-support?tab=announcements", "#/announcements"],
    [`#/community-support?x=1&tab=roadmap&card=${CARD}`, `#/roadmap?x=1&card=${CARD}`],
    [`#/community-support?tab=support&ticket=${CARD}`, `#/support?ticket=${CARD}`],
  ];

  it("each row of the approved redirect table", () => {
    for (const [from, to] of TABLE) assert.equal(redirectHash(from), to, from);
  });

  it("the new screens, Support, Community and #/email are live addresses", () => {
    for (const live of ["#/email", "#/email?view=sent", "#/blog?view=editor&post=x", "#/links", "#/announcements", "#/roadmap?card=x", "#/communications", "#/community", "#/support", "#/support?tab=team", "#/community?tab=ideas"]) {
      assert.equal(redirectHash(live), null, live);
    }
    assert.equal(isRetiredPageId("email"), false);
    // #/community with no tab opens Ideas (the page's first tab).
    assert.equal(COMMUNITY_PAGE_TABS[0].id, "ideas");
  });

  it("every moved tab names a real page, and that page's old tab is gone everywhere", () => {
    for (const [tab, page] of Object.entries(COMMUNICATIONS_TAB_PAGES)) {
      assert.ok(COMMUNICATIONS.some(([id]) => id === page), `${tab} -> ${page}`);
      assert.equal([...SUPPORT_PAGE_TABS, ...COMMUNITY_PAGE_TABS].some((t) => t.id === tab), false, `${tab} is still a tab`);
      assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT[tab].page, page, `${tab} contract row names its screen`);
    }
  });

  it("in-app links point at the new screens", () => {
    assert.match(read("components/blog/BlogPanel.jsx"), /window\.location\.hash = `#\/blog\$\{query \? `\?\$\{query\}` : ""\}`;/);
    assert.match(read("lib/dashboardToday.js"), /href: "#\/announcements",/);
    assert.match(read("components/ops/WordingQueue.jsx"), /href="#\/announcements"/);
    assert.match(read("components/community/FailedPushBanner.jsx"), /see Communications, Announcements\./);
  });
});

describe("C-3 roadmap card links", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  it("the new form and both older forms open the card", () => {
    assert.equal(roadmapDraftHref({ links: [{ kind: "roadmap_card", id }] }), `#/roadmap?card=${id}`);
    for (const hash of [`#/roadmap?card=${id}`, `#/community?tab=roadmap&card=${id}`, `#/community-support?tab=roadmap&card=${id}`]) {
      assert.equal(roadmapCardFromHash(hash), id, hash);
    }
  });
  it("a Work card address is not a roadmap address", () => {
    assert.equal(isRoadmapHash(`#/work-board?card=${id}`), false);
    assert.equal(roadmapCardFromHash(`#/work-board?card=${id}`), null);
    assert.equal(roadmapCardFromHash("#/roadmap?card=not-a-card"), null);
  });
});

describe("C-4 nobody gains or loses a panel (I-4383-COMMS-ACCESS-UNCHANGED)", () => {
  // The server's areas per persona (#4255: every active teammate also holds
  // email_drafts and blog; owner, admin and partner hold admin_console).
  const TEAM = [AREA.EMAIL_DRAFTS, BLOG_AREA];
  const person = (role, areas, status = "active") => normalizeAccess({ email: `${role}@example.test`, role, status, areas });
  const PERSONAS = {
    owner: person("owner", [AREA.ADMIN_CONSOLE, AREA.TEAM_MANAGE, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    admin: person("admin", [AREA.ADMIN_CONSOLE, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    partner: person("partner", [AREA.ADMIN_CONSOLE, AREA.TEAM_MANAGE, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    growth: person("growth", [AREA.ROLE_HOME, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    supportOnly: person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, ...TEAM]),
    communityOnly: person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA, ...TEAM]),
    supportAndCommunity: person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA, ...TEAM]),
    invitedAdmin: person("admin", [AREA.ADMIN_CONSOLE, ...TEAM], "invited"),
    noAccess: person("growth", []),
  };
  const ALL = ["announcements", "blog", "brand-groups", "email", "enquiry-reports", "feature-guide", "ideas", "links", "moderation", "product", "questions", "roadmap", "support", "team"];
  const SUPPORT_AREA_PANELS = ["brand-groups", "feature-guide", "links", "support"];
  const COMMUNITY_AREA_PANELS = ["enquiry-reports", "ideas", "moderation", "questions"];
  // What each persona could open on origin/main before #4383 (the old
  // Support and Community tab lists through communitySupportTabsForAccess).
  const BEFORE = {
    owner: ALL,
    admin: ALL,
    partner: ALL,
    growth: ["blog", "email"],
    supportOnly: ["blog", "email", ...SUPPORT_AREA_PANELS].sort(),
    communityOnly: ["blog", "email", ...COMMUNITY_AREA_PANELS].sort(),
    supportAndCommunity: ["blog", "email", ...SUPPORT_AREA_PANELS, ...COMMUNITY_AREA_PANELS].sort(),
    invitedAdmin: [],
    noAccess: [],
  };

  function panelsAfter(access) {
    const out = [];
    for (const page of ["support", "community"]) {
      if (!canOpenPage(access, page)) continue;
      out.push(...communitySupportTabsForAccess(access, page === "support" ? SUPPORT_PAGE_TABS : COMMUNITY_PAGE_TABS).map((t) => t.id));
    }
    for (const screen of Object.values(COMMUNICATIONS_TAB_PAGES)) if (canOpenPage(access, screen)) out.push(screen);
    return out.sort();
  }

  it("each persona opens exactly the panels it opened before", () => {
    for (const [who, access] of Object.entries(PERSONAS)) {
      assert.deepEqual(panelsAfter(access), BEFORE[who], who);
    }
  });

  it("an address for a panel you could not open is still refused", () => {
    const known = NAV_ITEMS.map((i) => i.id);
    for (const [who, access] of Object.entries(PERSONAS)) {
      if (!access || access.status !== "active") continue;
      for (const screen of ["announcements", "roadmap", "email", "blog", "links"]) {
        const route = resolveRoute(screen, access, known);
        assert.equal(route.pageId === screen, BEFORE[who].includes(screen), `${who} -> ${screen}`);
      }
    }
  });

  it("Overview opens for whoever opens any Communications screen, and nobody else", () => {
    for (const [who, access] of Object.entries(PERSONAS)) {
      const any = ["announcements", "roadmap", "email", "blog", "links"].some((id) => canOpenPage(access, id));
      assert.equal(canOpenPage(access, "communications"), any, who);
    }
  });

  it("the only menu change: growth no longer sees an empty Support entry", () => {
    const menu = (access) => visibleNavGroups(NAV_GROUPS, access).flatMap((g) => g.items.map((i) => i.id));
    assert.equal(menu(PERSONAS.growth).includes("support"), false);
    assert.deepEqual(menu(PERSONAS.growth).filter((id) => COMMUNICATIONS.some(([c]) => c === id)), ["communications", "email", "blog"]);
    assert.deepEqual(menu(PERSONAS.supportOnly).filter((id) => COMMUNICATIONS.some(([c]) => c === id)), ["communications", "email", "blog", "links"]);
    assert.deepEqual(menu(PERSONAS.communityOnly).filter((id) => COMMUNICATIONS.some(([c]) => c === id)), ["communications", "email", "blog"]);
    for (const who of ["supportOnly", "communityOnly", "supportAndCommunity"]) {
      assert.ok(menu(PERSONAS[who]).includes("support") && menu(PERSONAS[who]).includes("community"), who);
    }
    assert.deepEqual(menu(PERSONAS.noAccess), []);
  });
});

describe("C-5 unknown and hostile addresses", () => {
  it("never crash and never resolve inherited keys", () => {
    for (const bad of ["#/__proto__", "#/constructor", "#/support?tab=__proto__", "#/community?tab=constructor", "#/communications?tab=x", "#/support?tab=%E0%A4%A", "", null, undefined, 7]) {
      assert.doesNotThrow(() => redirectHash(bad), String(bad));
    }
    assert.equal(redirectHash("#/support?tab=__proto__"), null);
    assert.equal(redirectHash("#/communications?tab=x"), null);
    const admin = normalizeAccess({ email: "a@example.test", role: "admin", status: "active", areas: [AREA.ADMIN_CONSOLE] });
    const known = NAV_ITEMS.map((i) => i.id);
    assert.equal(resolveRoute("__proto__", admin, known).pageId, "overview");
    assert.equal(resolveRoute("communications", admin, known).pageId, "communications");
  });
});

describe("C-6 the Email screen's sections", () => {
  const admin = { status: "active", role: "admin", areas: [AREA.ADMIN_CONSOLE] };
  const teammate = { status: "active", role: "growth", areas: [AREA.EMAIL_DRAFTS] };
  it("admins see Sent and Unsubscribes; teammates do not", () => {
    assert.deepEqual(emailViewsFor(admin).map((v) => v.id), ["write", "sent", "templates", "unsubscribes"]);
    assert.deepEqual(emailViewsFor(teammate).map((v) => v.id), ["write", "templates"]);
  });
  it("the section is read from and written to the address", () => {
    assert.equal(emailViewFromHash("#/email", emailViewsFor(admin)), "write");
    assert.equal(emailViewFromHash("#/email?view=sent", emailViewsFor(admin)), "sent");
    assert.equal(emailViewFromHash("#/email?view=sent", emailViewsFor(teammate)), "write", "an admin-only section falls back");
    assert.equal(emailViewFromHash("#/email?view=history", emailViewsFor(admin)), "sent", "the old History id");
    assert.equal(emailViewFromHash("#/email?view=send", emailViewsFor(admin)), "write", "the old Send id");
    assert.equal(emailViewFromHash("#/email?view=__proto__", emailViewsFor(admin)), "write");
    assert.equal(emailViewHash("write"), "#/email");
    assert.equal(emailViewHash("templates"), "#/email?view=templates");
    assert.equal(emailViewHash("nope"), "#/email");
  });
});
