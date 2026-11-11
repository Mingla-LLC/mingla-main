// Issue #4383 — INDEPENDENT TESTER adversarial proof for the Communications
// move. The implementor's C-4 checks nine hand-written personas against a
// hand-written "before" list. This file takes other angles:
//
//   X-1  a FROZEN copy of the origin/main rule (the old Support / Community
//        tab lists, the old tab filter and the old Support union, copied from
//        dda822635a) is the oracle, and EVERY area combination the server can
//        send (admin_team_my_operational_areas: a support/community area only
//        ever comes with community_support) under every role and status is
//        compared panel for panel. The only allowed difference anywhere is
//        the Support menu entry for someone with no community_support area.
//   X-2  every old address, opened by every one of those people, lands on
//        the panel iff they could open that panel before, with its other
//        query values intact.
//   X-3  a Founding partner (areas exactly admin_team_role_areas('partner'))
//        sees Community's product tab, labelled "Product board", and every
//        Communications screen.
//   X-4  hostile and malformed addresses never crash and never open a panel
//        the person could not open.
//
// FAILS-ON-REVERT: delete PAGE_ADDITIONAL_AREAS.links (lib/access.js) -> X-1
// and X-2 fail (Support-area teammates lose the Links page); delete the
// community TAB_PAGE_REDIRECTS row (lib/adminRoutes.js) -> X-2 fails.
//
// Run: node --test src/__tests__/issue_4383_communications.tester.adversarial.test.js
// (from mingla-admin). Hermetic: pure modules only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import {
  AREA,
  BLOG_AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  DATA_ROOM_AREA,
  SUPPORT_OPERATIONS_AREA,
  TEAM_NOTIFICATIONS_AREA,
  canOpenPage,
  homePageFor,
  normalizeAccess,
  resolveRoute,
  visibleNavGroups,
} from "../lib/access.js";
import { redirectHash } from "../lib/adminRoutes.js";
import { COMMUNITY_PAGE_TABS, SUPPORT_PAGE_TABS, pageTabFromHash } from "../lib/supportCommunityTabs.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";

// ─── The frozen origin/main rule (dda822635a), copied, not imported ───
const OLD_SUPPORT_TABS = ["support", "email", "blog", "links", "team"];
const OLD_COMMUNITY_TABS = ["announcements", "roadmap", "ideas", "questions", "moderation", "enquiry-reports", "brand-groups", "feature-guide", "product"];
function oldOwnPage(access, pageId) {
  if (!access || access.status !== "active") return false;
  const areas = access.areas;
  if (areas.includes(AREA.ADMIN_CONSOLE)) return true; // both pages default to admin_console
  if (pageId === "community-support") return areas.includes(COMMUNITY_SUPPORT_AREA);
  if (pageId === "support-content") return areas.includes(AREA.EMAIL_DRAFTS) || areas.includes(BLOG_AREA);
  return false;
}
function oldCanOpen(access, page) {
  if (page === "support") return oldOwnPage(access, "community-support") || oldOwnPage(access, "support-content");
  if (page === "community") return oldOwnPage(access, "community-support");
  return false;
}
function oldTabsFor(access, tabs) {
  const areas = access?.areas || [];
  const isAdmin = access?.status === "active" && areas.includes(AREA.ADMIN_CONSOLE);
  if (isAdmin) return tabs;
  const allowed = new Set();
  if (areas.includes(COMMUNITY_OPERATIONS_AREA)) ["ideas", "questions", "moderation", "enquiry-reports"].forEach((t) => allowed.add(t));
  if (areas.includes(SUPPORT_OPERATIONS_AREA)) ["support", "feature-guide", "brand-groups", "links"].forEach((t) => allowed.add(t));
  if (areas.includes(BLOG_AREA)) allowed.add("blog");
  if (areas.includes(AREA.EMAIL_DRAFTS)) allowed.add("email");
  return tabs.filter((t) => allowed.has(t));
}
function panelsBefore(access) {
  const out = new Set();
  if (oldCanOpen(access, "support")) oldTabsFor(access, OLD_SUPPORT_TABS).forEach((t) => out.add(t));
  if (oldCanOpen(access, "community")) oldTabsFor(access, OLD_COMMUNITY_TABS).forEach((t) => out.add(t));
  return [...out].sort();
}
// Where an old tab address landed before: the page, then that tab if the
// person could see it, else the page's first visible tab.
function landedBefore(access, page, tab) {
  if (!oldCanOpen(access, page)) return null;
  const visible = oldTabsFor(access, page === "support" ? OLD_SUPPORT_TABS : OLD_COMMUNITY_TABS);
  return visible.includes(tab) ? tab : visible[0] || null;
}

// ─── The new code, as the app runs it ───
const COMMS_SCREENS = ["email", "blog", "links", "announcements", "roadmap"];
const KNOWN = [...NAV_ITEMS.map((i) => i.id), "home"];
function panelsAfter(access) {
  const out = new Set();
  for (const [page, tabs] of [["support", SUPPORT_PAGE_TABS], ["community", COMMUNITY_PAGE_TABS]]) {
    if (canOpenPage(access, page)) communitySupportTabsForAccess(access, tabs).forEach((t) => out.add(t.id));
  }
  for (const screen of COMMS_SCREENS) if (canOpenPage(access, screen)) out.add(screen);
  return [...out].sort();
}
function landedAfter(access, hash) {
  const next = redirectHash(hash) || hash;
  const page = next.replace("#/", "").split("?")[0].split("/")[0];
  const route = resolveRoute(page, access, KNOWN);
  if (route.pageId !== page) return { panel: null, next };
  if (page === "support" || page === "community") {
    const visible = communitySupportTabsForAccess(access, page === "support" ? SUPPORT_PAGE_TABS : COMMUNITY_PAGE_TABS);
    const requested = pageTabFromHash(next, page);
    return { panel: visible.some((t) => t.id === requested) ? requested : visible[0]?.id || null, next };
  }
  return { panel: page, next };
}
const menuIds = (access) => visibleNavGroups(NAV_GROUPS, access).flatMap((g) => g.items.map((i) => i.id));

// Every area set the server can send (support/community areas imply
// community_support), crossed with every role and both statuses.
const OPTIONAL = [AREA.ADMIN_CONSOLE, AREA.EMAIL_DRAFTS, BLOG_AREA, AREA.CRM, AREA.ROLE_HOME, AREA.TEAM_MANAGE, TEAM_NOTIFICATIONS_AREA, DATA_ROOM_AREA];
const CS = [[], [COMMUNITY_SUPPORT_AREA], [COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA], [COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA], [COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA]];
function* everyone() {
  for (let mask = 0; mask < 1 << OPTIONAL.length; mask += 1) {
    const base = OPTIONAL.filter((_, i) => mask & (1 << i));
    for (const cs of CS) {
      for (const role of ["owner", "admin", "partner", "growth"]) {
        for (const status of ["active", "invited"]) {
          const access = normalizeAccess({ email: "x@example.test", role, status, areas: [...base, ...cs] });
          yield { label: `${role}/${status}/[${[...base, ...cs].join(",")}]`, access };
        }
      }
    }
  }
}

describe("X-1 every server-reachable person opens exactly the panels they opened on origin/main", () => {
  it("panel sets are identical for every area combination, role and status", () => {
    let n = 0;
    for (const { label, access } of everyone()) {
      assert.deepEqual(panelsAfter(access), panelsBefore(access), label);
      n += 1;
    }
    assert.equal(n, 256 * 5 * 4 * 2);
  });

  it("the only menu change is the Support entry, and only for people with no community_support area", () => {
    for (const { label, access } of everyone()) {
      const before = oldCanOpen(access, "support");
      const after = menuIds(access).includes("support");
      if (before !== after) {
        assert.equal(after, false, `${label}: Support appeared`);
        assert.equal(access.areas.includes(COMMUNITY_SUPPORT_AREA), false, `${label}: lost Support while holding community_support`);
        assert.equal(access.areas.includes(AREA.ADMIN_CONSOLE), false, label);
      }
      assert.equal(menuIds(access).includes("community"), oldCanOpen(access, "community"), `${label}: Community entry`);
    }
  });

  it("the new Push screen opens only for full admins (admin_console, active)", () => {
    for (const { label, access } of everyone()) {
      assert.equal(canOpenPage(access, "push"), access.status === "active" && access.areas.includes(AREA.ADMIN_CONSOLE), label);
    }
  });
});

describe("X-2 every old address lands on the panel iff the person could open it before", () => {
  const OLD = [
    ["#/support?tab=email", "support", "email", "email"],
    ["#/support?tab=blog&view=editor&post=P1", "support", "blog", "blog"],
    ["#/support?tab=links", "support", "links", "links"],
    ["#/community?tab=announcements", "community", "announcements", "announcements"],
    ["#/community?tab=roadmap&card=C1", "community", "roadmap", "roadmap"],
    ["#/community-support?tab=email&view=scheduled", "support", "email", "email"],
    ["#/community-support?tab=blog&post=P2", "support", "blog", "blog"],
    ["#/community-support?tab=links", "support", "links", "links"],
    ["#/community-support?tab=announcements", "community", "announcements", "announcements"],
    ["#/community-support?tab=roadmap&card=C2", "community", "roadmap", "roadmap"],
  ];
  it("for every person and every old address", () => {
    for (const { label, access } of everyone()) {
      // A person with no home page (no role_home, no admin_console) opens
      // nothing at all, before and after (resolveRoute); the server never sends that.
      if (access.status !== "active" || !homePageFor(access)) continue;
      const before = panelsBefore(access);
      for (const [hash, , tab, screen] of OLD) {
        const { panel } = landedAfter(access, hash);
        if (before.includes(tab)) assert.equal(panel, screen, `${label} ${hash}`);
        else assert.notEqual(panel, screen, `${label} ${hash} opened a panel it never had`);
      }
    }
  });
  it("Support and Community addresses that did not move still land where they did", () => {
    for (const { label, access } of everyone()) {
      // A person with no home page (no role_home, no admin_console) opens
      // nothing at all, before and after (resolveRoute); the server never sends that.
      if (access.status !== "active" || !homePageFor(access)) continue;
      for (const [page, tab] of [["support", "support"], ["support", "team"], ["community", "ideas"], ["community", "brand-groups"], ["community", "product"], ["community", "feature-guide"]]) {
        const was = landedBefore(access, page, tab);
        const { panel } = landedAfter(access, `#/${page}?tab=${tab}`);
        if (was === tab) assert.equal(panel, tab, `${label} ${page}?tab=${tab}`);
        else assert.notEqual(panel, tab, `${label} ${page}?tab=${tab}`);
      }
    }
  });
  it("other query values survive, in any order", () => {
    assert.equal(redirectHash("#/support?view=editor&tab=blog&post=P1"), "#/blog?view=editor&post=P1");
    assert.equal(redirectHash("#/community?card=C1&tab=roadmap&x=%20y"), "#/roadmap?card=C1&x=+y");
    assert.equal(redirectHash("#/community-support?ticket=T&tab=announcements"), "#/announcements?ticket=T");
    assert.equal(redirectHash("#/support?tab=email&tab=blog"), "#/email", "a repeated tab takes the first and drops the rest");
  });
});

describe("X-3 a Founding partner (coordinator assertion)", () => {
  // admin_team_role_areas('partner') on the replayed schema, plus the
  // operational areas a partner gets (team_notifications, data_room, blog).
  const partner = normalizeAccess({
    email: "partner@example.test", role: "partner", status: "active",
    areas: ["admin_console", "team_manage", "crm", "beta_leads", "email_drafts", TEAM_NOTIFICATIONS_AREA, DATA_ROOM_AREA, BLOG_AREA],
  });
  it("sees Community's product tab, labelled Product board", () => {
    assert.equal(canOpenPage(partner, "community"), true);
    const tabs = communitySupportTabsForAccess(partner, COMMUNITY_PAGE_TABS);
    const product = tabs.find((t) => t.id === "product");
    assert.ok(product, "product tab visible");
    assert.equal(product.label, "Product board");
    assert.equal(landedAfter(partner, "#/community?tab=product").panel, "product");
    assert.equal(landedAfter(partner, "#/community-support?tab=product").panel, "product");
  });
  it("sees every Communications screen", () => {
    const menu = menuIds(partner);
    for (const id of ["communications", "push", "announcements", "roadmap", "email", "blog", "links"]) assert.ok(menu.includes(id), id);
  });
});

describe("X-4 hostile addresses", () => {
  const growth = normalizeAccess({ email: "g@example.test", role: "growth", status: "active", areas: ["role_home", "crm", "email_drafts", BLOG_AREA] });
  const HOSTILE = [
    "#/support?tab=__proto__", "#/community?tab=constructor", "#/community-support?tab=hasOwnProperty",
    "#/support?tab=toString&view=x", "#/SUPPORT?tab=email", "#/support?tab=Email", "#/support?tab=%E0%A4%A",
    "#/announcements?tab=roadmap", "#/push?tab=email", "#/communications?tab=__proto__", "#/__proto__", "#/", "", "#",
    "#/support?tab=announcements", "#/community?tab=email",
  ];
  it("never throws and never opens an admin screen for a growth teammate", () => {
    for (const hash of HOSTILE) {
      let landed;
      assert.doesNotThrow(() => { landed = landedAfter(growth, hash); }, hash);
      assert.ok(!["announcements", "roadmap", "push", "links"].includes(landed.panel), `${hash} -> ${landed.panel}`);
    }
  });
  it("a moved tab on the wrong page is not redirected to a screen", () => {
    assert.equal(redirectHash("#/support?tab=announcements"), null);
    assert.equal(redirectHash("#/community?tab=email"), null);
  });
});
