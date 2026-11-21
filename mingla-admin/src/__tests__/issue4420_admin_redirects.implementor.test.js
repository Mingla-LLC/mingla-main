// MINGLA-INVARIANT: I-4420-OLD-ADDRESSES-LAND: every retired Community, console and Roadmap address is rewritten to a page that exists, never a blank page; the table in lib/supportCommunityTabs.js RETIRED_TAB_REDIRECTS is the one source.
// MINGLA-INVARIANT: I-4420-FEATURE-GUIDE-ACCESS-UNCHANGED: the Feature guide screen opens to exactly who could open its old Community tab (full admins and the Support area), and nobody gains or loses Support, Announcements or the Communications Overview.
// MINGLA-INVARIANT: I-4420-NO-DEAD-ROUTE: every menu id and every App route names a page component imported from a file that exists.
//
// Issue #4420 (step 6) — Community and the Roadmap screen are retired, the
// Feature guide is its own Communications screen, Brand groups "Send to
// Product" became "Create ticket".
//
//   R-1  the full old-address table (#/community and every tab, the console
//        #/community-support and every tab, #/roadmap and its card, with the
//        query values each carried), through App's own redirectHash
//   R-2  the menu: no Community, no Roadmap; Feature guide under Communications
//   R-3  access: the Feature guide screen per persona equals its old tab; the
//        pages around it are unchanged
//   R-4  no route or menu id points at a missing page component; retired
//        files are gone; the capability contract names live panels only
//   R-5  shipped-wording approval stays completable on the Work card; nothing
//        links to the retired Roadmap screen
//   R-6  Brand groups Create ticket: brand linked, messages quoted, made from
//        brand_group; no Send to Product left
//
// FAILS-ON-REVERT: before this change `#/community?tab=feature-guide` has no
// redirect and lib/supportCommunityTabs.js has no RETIRED_TAB_REDIRECTS, so
// the import below fails and every block reds.
//
// Run: node --test src/__tests__/issue4420_admin_redirects.implementor.test.js
// (from mingla-admin; pure logic and source assertions: no install needed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { redirectHash, isRetiredPageId } from "../lib/adminRoutes.js";
import {
  RETIRED_TAB_REDIRECTS,
  consoleRedirectHash,
  pageTabsFor,
} from "../lib/supportCommunityTabs.js";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
  canOpenPage,
} from "../lib/access.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { brandGroupTicketPrefill } from "../lib/supportInboxModel.js";
import { buildTicketPayload } from "../lib/ticketModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(src, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(src, rel));

// Every page id App.jsx mounts, and the file each component is imported from.
function appRoutes() {
  const app = read("App.jsx");
  const imports = new Map();
  for (const m of app.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.\/pages\/[^"]+)"/g)) {
    for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) imports.set(name, m[2]);
  }
  const block = app.slice(app.indexOf("const PAGES = {"), app.indexOf("};", app.indexOf("const PAGES = {")));
  const routes = new Map();
  for (const m of block.matchAll(/^\s*("?[a-z][a-z0-9-]*"?):\s*([A-Za-z]+),/gm)) routes.set(m[1].replace(/"/g, ""), m[2]);
  return { imports, routes };
}
const ROUTE_IDS = [...appRoutes().routes.keys()];

const persona = (areas, role = "growth") => ({ email: "p@x.test", role, status: "active", areas });
const PERSONAS = {
  fullAdmin: persona([AREA.ADMIN_CONSOLE, AREA.TEAM_MANAGE, AREA.CRM, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA], "admin"),
  supportStaff: persona([COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA]),
  communityOnly: persona([COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA]),
  emailWriter: persona([AREA.EMAIL_DRAFTS, "blog"]),
  crmOnly: persona([AREA.CRM, AREA.BETA_LEADS]),
  nothing: persona([]),
};

describe("R-1 every old address lands on a page that exists", () => {
  const TABLE = [
    // #/community and each of its six tabs (plus the query values they carried)
    ["#/community", "#/support"],
    ["#/community?tab=ideas", "#/work-board?type=tickets"],
    ["#/community?tab=ideas&post=p1", "#/work-board?type=tickets"],
    ["#/community?tab=questions&post=q1", "#/work-board?type=tickets"],
    ["#/community?tab=moderation&report=r1", "#/work-board?type=tickets"],
    ["#/community?tab=product", "#/work-board?type=tickets"],
    ["#/community?tab=product&signal=11111111-1111-1111-1111-111111111111", "#/work-board?type=tickets"],
    ["#/community?tab=enquiry-reports", "#/support?filter=reported"],
    ["#/community?tab=enquiry-reports&reported=e1", "#/support?filter=reported&reported=e1"],
    ["#/community?tab=feature-guide", "#/feature-guide"],
    ["#/community?tab=feature-guide&capability=checkout-tickets", "#/feature-guide?capability=checkout-tickets"],
    // tabs that moved earlier (#4383, #4452) keep working from #/community
    ["#/community?tab=announcements", "#/announcements"],
    ["#/community?tab=brand-groups&group=g1", "#/brand-groups?group=g1"],
    ["#/community?group=g1", "#/brand-groups?group=g1"],
    ["#/community?brand=b1", "#/brand-groups?brand=b1"],
    ["#/community?tab=roadmap", "#/announcements"],
    ["#/community?tab=roadmap&card=c1", "#/announcements"],
    ["#/community?tab=nonsense", "#/support"],
    // the console's server-built alert links
    ["#/community-support", "#/support"],
    ["#/community-support?tab=support&ticket=t1", "#/support?ticket=t1"],
    ["#/community-support?tab=team", "#/support?tab=team"],
    ["#/community-support?tab=ideas", "#/work-board?type=tickets"],
    ["#/community-support?tab=questions", "#/work-board?type=tickets"],
    ["#/community-support?tab=moderation", "#/work-board?type=tickets"],
    ["#/community-support?tab=product&signal=s1", "#/work-board?type=tickets"],
    ["#/community-support?tab=enquiry-reports", "#/support?filter=reported"],
    ["#/community-support?tab=feature-guide", "#/feature-guide"],
    ["#/community-support?tab=roadmap&card=c1", "#/announcements"],
    ["#/community-support?tab=email", "#/email"],
    ["#/community-support?tab=overview", "#/support"],
    ["#/community-support?tab=availability", "#/support"],
    ["#/community-support?tab=", "#/support"],
    // the Roadmap screen and its card links
    ["#/roadmap", "#/announcements"],
    ["#/roadmap?card=c1", "#/announcements"],
    ["#/roadmap?card=c1&view=scheduled", "#/announcements"],
    // Support's own addresses are not rewritten
    ["#/support?tab=blog&post=x", "#/blog?post=x"],
  ];

  for (const [from, to] of TABLE) {
    it(`${from} -> ${to}`, () => {
      assert.equal(redirectHash(from), to);
    });
  }

  it("every target is a page App mounts (never a blank page)", () => {
    for (const [from] of TABLE) {
      const page = redirectHash(from).slice(2).split("?")[0];
      assert.ok(ROUTE_IDS.includes(page), `${from} lands on ${page}, which App does not mount`);
    }
  });

  it("community, roadmap and community-support are retired ids; live pages are not rewritten", () => {
    for (const id of ["community", "roadmap", "community-support"]) assert.equal(isRetiredPageId(id), true, id);
    for (const hash of ["#/support", "#/support?conversation=c1", "#/feature-guide", "#/announcements", "#/work-board?type=tickets"]) {
      assert.equal(redirectHash(hash), null, hash);
    }
    assert.equal(ROUTE_IDS.includes("community"), false);
    assert.equal(ROUTE_IDS.includes("roadmap"), false);
  });

  it("every retired-tab row points at a mounted page (the table is data)", () => {
    for (const [tab, rule] of Object.entries(RETIRED_TAB_REDIRECTS)) {
      assert.ok(ROUTE_IDS.includes(rule.page), `${tab} -> ${rule.page}`);
      assert.equal(consoleRedirectHash(`#/community?tab=${tab}`).split("?")[0], `#/${rule.page}`);
    }
  });

  it("adversarial: hostile or odd tab values still land on Support", () => {
    for (const tab of ["__proto__", "constructor", "toString", "%00", "feature-guide%20"]) {
      const out = redirectHash(`#/community?tab=${tab}`);
      assert.ok(out.startsWith("#/support"), `${tab} -> ${out}`);
    }
  });
});

describe("R-2 the menu", () => {
  const ids = NAV_ITEMS.map((i) => i.id);
  it("lists neither Community nor Roadmap", () => {
    assert.equal(ids.includes("community"), false);
    assert.equal(ids.includes("roadmap"), false);
  });
  it("lists the Feature guide under Communications, and Support under Support", () => {
    const comms = NAV_GROUPS.find((g) => g.label === "Communications");
    assert.ok(comms.items.some((i) => i.id === "feature-guide" && i.label === "Feature guide"));
    assert.ok(comms.items.some((i) => i.id === "announcements"));
    const support = NAV_GROUPS.find((g) => g.label === "Support");
    assert.deepEqual(support.items.map((i) => i.id), ["support"]);
  });
  it("Support keeps Inbox and People and roles", () => {
    assert.deepEqual(pageTabsFor("support").map((t) => t.id), ["support", "team"]);
    assert.equal(pageTabsFor("community"), null);
  });
});

describe("R-3 access is unchanged around the move", () => {
  // The old Feature guide tab: open to whoever could open the Community page
  // (the console's union) AND see the tab (full admins or the Support area).
  const oldFeatureGuide = (access) =>
    canOpenPage(access, "community-support") &&
    (access.areas.includes(AREA.ADMIN_CONSOLE) || access.areas.includes(SUPPORT_OPERATIONS_AREA));
  const EXPECT = {
    fullAdmin: { "feature-guide": true, support: true, announcements: true, communications: true },
    supportStaff: { "feature-guide": true, support: true, announcements: false, communications: true },
    communityOnly: { "feature-guide": false, support: true, announcements: false, communications: false },
    emailWriter: { "feature-guide": false, support: false, announcements: false, communications: true },
    crmOnly: { "feature-guide": false, support: false, announcements: false, communications: false },
    nothing: { "feature-guide": false, support: false, announcements: false, communications: false },
  };
  for (const [name, access] of Object.entries(PERSONAS)) {
    it(`${name}: Feature guide equals the old tab; Support, Announcements, Overview as before`, () => {
      assert.equal(canOpenPage(access, "feature-guide"), oldFeatureGuide(access), "Feature guide vs old tab");
      for (const [page, want] of Object.entries(EXPECT[name])) {
        assert.equal(canOpenPage(access, page), want, `${name} ${page}`);
      }
    });
  }
  it("invited (not active) people open none of them", () => {
    const invited = { ...PERSONAS.fullAdmin, status: "invited" };
    for (const page of ["feature-guide", "support", "announcements", "communications"]) assert.equal(canOpenPage(invited, page), false, page);
  });
  it("the Support page shows the inbox to the Support area and People and roles to admins only", () => {
    const tabs = pageTabsFor("support");
    assert.deepEqual(communitySupportTabsForAccess(PERSONAS.supportStaff, tabs).map((t) => t.id), ["support"]);
    assert.deepEqual(communitySupportTabsForAccess(PERSONAS.fullAdmin, tabs).map((t) => t.id), ["support", "team"]);
    assert.deepEqual(communitySupportTabsForAccess(PERSONAS.communityOnly, tabs).map((t) => t.id), []);
  });
  it("the Feature guide screen passes canManage only to full admins, as the tab did", () => {
    const page = read("pages/communications/FeatureGuidePage.jsx");
    assert.match(page, /<FeatureGuidePanel canManage=\{isAdmin\} \/>/);
  });
});

describe("R-4 no dead routes, no dead files, a contract of live panels", () => {
  it("every App route names a component imported from a page file that exists and exports it", () => {
    const { imports, routes } = appRoutes();
    assert.ok(routes.size > 30, `parsed ${routes.size} routes`);
    for (const [id, component] of routes) {
      const from = imports.get(component);
      assert.ok(from, `${id}: ${component} is not imported from ./pages`);
      const file = `${from.replace(/^\.\//, "")}.jsx`;
      assert.ok(exists(file), `${id}: ${file} is missing`);
      assert.match(read(file), new RegExp(`export (function|const) ${component}\\b`), `${id}: ${file} does not export ${component}`);
    }
  });
  it("every menu id is an App route", () => {
    for (const item of NAV_ITEMS) assert.ok(ROUTE_IDS.includes(item.id), `menu ${item.id} has no route`);
  });
  it("every menu icon is in the Sidebar's icon map", () => {
    const sidebar = read("components/layout/Sidebar.jsx");
    for (const item of NAV_ITEMS) assert.match(sidebar, new RegExp(`\\b${item.icon.replace("Map", "Map(: MapIcon)?")}\\b`), item.icon);
  });
  it("the retired files are gone", () => {
    for (const rel of [
      "pages/CommunitySupportPage.jsx",
      "pages/communications/RoadmapPage.jsx",
      "components/community/RoadmapPanel.jsx",
      "components/community/IdeasPanel.jsx",
      "components/community/QuestionsPanel.jsx",
      "components/community/ModerationPanel.jsx",
      "components/community/ReportedEnquiriesPanel.jsx",
      "components/community/CommunitySupportNavigation.jsx",
      "components/community/CutoverPanel.jsx",
      "components/community/AvailabilityPanel.jsx",
      "components/support/SendToProductModal.jsx",
    ]) assert.equal(exists(rel), false, rel);
  });
  it("the capability contract has no retired rows and every panel it names exists", () => {
    for (const id of ["ideas", "questions", "moderation", "enquiry-reports", "product", "roadmap"]) {
      assert.equal(Object.hasOwn(COMMUNITY_SUPPORT_TAB_CONTRACT, id), false, id);
    }
    const fg = COMMUNITY_SUPPORT_TAB_CONTRACT["feature-guide"];
    assert.equal(fg.page, "feature-guide");
    assert.equal(fg.area, SUPPORT_OPERATIONS_AREA);
    assert.equal(fg.panel, "components/community/FeatureGuidePanel.jsx");
    for (const rpc of ["admin_list_reported_enquiries", "admin_enquiry_dismiss_report", "admin_enquiry_block_everywhere"]) {
      assert.ok(COMMUNITY_SUPPORT_TAB_CONTRACT.support.rpcs.includes(rpc), rpc);
    }
    for (const [id, row] of Object.entries(COMMUNITY_SUPPORT_TAB_CONTRACT)) {
      assert.ok(exists(row.panel), `${id}: ${row.panel}`);
      assert.ok(row.page === "support" || ROUTE_IDS.includes(row.page), `${id}: page ${row.page}`);
    }
  });
  it("the Feature guide impact contract names the new screen and no deleted file", () => {
    const contract = JSON.parse(fs.readFileSync(path.resolve(src, "../../docs/contracts/feature-guide-impact.json"), "utf8"));
    const guide = contract.mappings.find((m) => m.capability_key === "staff-feature-guide");
    assert.ok(guide.paths.includes("mingla-admin/src/components/community/FeatureGuidePanel.jsx"));
    assert.ok(guide.paths.includes("mingla-admin/src/pages/communications/FeatureGuidePage.jsx"));
    // The files this step deleted are named nowhere (other stale paths in the
    // contract predate #4420 and are not this test's subject).
    const deleted = /(CommunitySupportPage|RoadmapPage|RoadmapPanel|IdeasPanel|QuestionsPanel|ModerationPanel|ReportedEnquiriesPanel|CommunitySupportNavigation|CutoverPanel|community\/AvailabilityPanel|SendToProductModal)\.jsx$/;
    for (const m of contract.mappings) {
      for (const p of m.paths) assert.doesNotMatch(p, deleted, `${m.capability_key}: ${p}`);
    }
    for (const p of ["pages/SupportPage.jsx", "components/community/BrandGroupTicketModal.jsx"]) {
      assert.ok(contract.mappings.some((m) => m.paths.includes(`mingla-admin/src/${p}`)), p);
    }
  });
});

describe("R-5 shipped-wording approval still works without the Roadmap screen", () => {
  it("the Work card's own wording editor is still mounted for roadmap approval cards", () => {
    assert.match(read("components/ops/WorkDetail.jsx"), /<CardWording card=\{card\}/);
    const panels = read("components/ops/CardPersonPanels.jsx");
    assert.match(panels, /isRoadmapApproval\(card\)/);
    assert.match(panels, /<WordingCard /);
    const wording = read("components/ops/WordingQueue.jsx");
    assert.match(wording, /upsertRoadmapCard\(/);
    assert.match(wording, />Publish</);
    assert.match(wording, />Not needed</);
  });
  it("nothing in Admin links to the retired Roadmap screen", () => {
    for (const rel of ["components/ops/WorkDetail.jsx", "components/ops/ReviewQueue.jsx", "components/ops/WordingQueue.jsx", "lib/opsModel.js"]) {
      const text = read(rel);
      assert.doesNotMatch(text, /#\/roadmap/, rel);
      assert.doesNotMatch(text, /roadmapDraftHref|Open the draft in Roadmap|open the Roadmap/, rel);
    }
  });
});

describe("R-6 Brand groups make tickets", () => {
  it("the pre-fill links the brand, quotes the messages and fits the ticket limits", () => {
    const out = brandGroupTicketPrefill({ brandId: "b-1", brandName: "Lagos Lights", lines: ["Ada: The checkout page\nfreezes", "Tobi: same here"] });
    assert.equal(out.brandId, "b-1");
    assert.equal(out.title, "Lagos Lights: The checkout page freezes");
    assert.equal(out.whatIsWrong, "From the Lagos Lights Brand group:\n> Ada: The checkout page freezes\n> Tobi: same here");
    const long = brandGroupTicketPrefill({ brandId: "b-1", brandName: "B", lines: ["x".repeat(9000)] });
    assert.ok(long.title.length <= 160);
    assert.ok(long.whatIsWrong.length <= 4000);
  });
  it("adversarial: no brand means no ticket (the server would refuse brand_group without one)", () => {
    assert.equal(brandGroupTicketPrefill({ brandId: "", brandName: "X", lines: ["a"] }), null);
    assert.equal(brandGroupTicketPrefill({}), null);
  });
  it("the payload is made from brand_group with the brand id and no conversation", () => {
    const payload = buildTicketPayload({ type: "bug", title: "T", whatIsWrong: "W", productArea: "Checkout", owners: ["a@x.test"], due: "", conversationIds: [], brandId: "b-1" }, { createdFrom: "brand_group" });
    assert.equal(payload.created_from, "brand_group");
    assert.equal(payload.brand_id, "b-1");
    assert.equal(Object.hasOwn(payload, "conversation_ids"), false);
  });
  it("the panel opens the ticket form, not Send to Product", () => {
    const panel = read("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /<BrandGroupTicketModal/);
    assert.doesNotMatch(panel, /SendToProductModal|listProductSignals|Sent to Product/);
    const modal = read("components/community/BrandGroupTicketModal.jsx");
    assert.match(modal, /createdFrom="brand_group"/);
    assert.match(modal, /brandId=\{prefill\.brandId\}/);
    for (const rel of ["components/community/BrandGroupComposer.jsx", "components/community/BrandGroupThread.jsx"]) {
      const text = read(rel);
      assert.match(text, />Create ticket</, rel);
      assert.doesNotMatch(text, />Create product signal</, rel);
    }
  });
});
