// Issue #3802 (admin shell) — one frame for every page, menu grouped by job.
//
//   S-1  the menu: eight groups, their order, and which pages each holds
//   S-2  every page id is in the menu exactly once, and every page of the app
//        is in the menu
//   S-3  who may open what did not move: the area of every page id
//   S-4  every menu icon resolves, no two items share one, nothing falls back
//   S-5  folding a group: remembered in the browser, never hides the page
//        you are on, never breaks when the browser refuses storage
//   S-6  the breadcrumb: Group › Page, the page alone at the top of the menu
//   S-7  the frame: one set of sizes, the menu follows the theme, the shell
//        sets the page gutter once
//   S-8  the one page header, and no page setting its own outer frame
//   S-9  rework after the tester's verdict: every state of a page carries its
//        title; the heading of the group you are in is not a switch; the
//        wordmark takes you home; the rail keeps the menu's left edge; a
//        broken menu never breaks the breadcrumb
//
// Invariant: I-3802-ADMIN-SHELL-ONE-FRAME (docs/INVARIANT_REGISTRY.md).
//
// Run: node --test src/__tests__/admin_shell_issue3802.implementor.happy.test.js
// (from mingla-admin). Hermetic: reads source text and pure modules only, so
// it needs nothing installed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import { AREA, PAGE_AREA_OVERRIDES, TEAM_NAV_GROUP, areaForPage, homePageFor, visibleNavGroups } from "../lib/access.js";
import {
  NAV_FOLD_STORAGE_KEY,
  breadcrumbFor,
  canFoldGroup,
  groupHoldsPage,
  isGroupOpen,
  readFoldedGroups,
  toggleFoldedGroup,
  writeFoldedGroups,
} from "../lib/shellNav.js";
import { CRM_LAYER_Z } from "../lib/crmLayers.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SIDEBAR = read("components/layout/Sidebar.jsx");
const HEADER = read("components/layout/Header.jsx");
const SHELL = read("components/layout/AppShell.jsx");
const CRUMBS = read("components/ui/Breadcrumbs.jsx");
const PAGE_HEADER = read("components/ui/PageHeader.jsx");
const CSS = read("globals.css");
const APP = read("App.jsx");

// The approved menu (spec section 1). Group label -> page ids, in order.
// #3720 Slice F — Support + Email folded into Community & Support (one primary item).
// [TEST-MOD-APPROVED #3720] Completion Wave 6 fills the reserved Data room
// slot and adds the all-role Notifications destination.
// #4130: Wave 0 — the menu from the approved polish design: nine groups,
// 26 pages, Home first. Retired ids redirect (lib/adminRoutes.js).
const MENU = [
  ["Home", ["overview", "work-board", "notifications"]],
  ["Outreach", ["outreach", "inbound", "content-calendar", "team-dashboard"]],
  ["Support", ["support", "community"]],
  ["Business", ["people", "brands", "business-offerings"]],
  ["Money", ["mingla-money", "business-payments", "business-orders", "business-money-ledger", "refund-operations", "subscriptions", "pricing"]],
  ["Explorer app", ["placepool"]],
  ["Growth", ["ad-engine"]],
  ["Company", ["admin", "data-room"]],
  ["System", ["platform-health", "feature-flags", "settings"]],
];

// The words on each menu item. #4130: the polish design's names.
const LABELS = {
  overview: "Dashboard", "work-board": "Work", notifications: "Notifications",
  outreach: "Hosts and creators", inbound: "Inbound leads", "content-calendar": "Calendar", "team-dashboard": "Team dashboard",
  support: "Support", community: "Community",
  people: "People", brands: "Brands", "business-offerings": "Offerings",
  "mingla-money": "Mingla money", "business-payments": "Payments", "business-orders": "Orders", "business-money-ledger": "Money ledger",
  "refund-operations": "Refund operations", subscriptions: "Subscriptions", pricing: "Pricing and limits",
  placepool: "Place pool",
  "ad-engine": "Ads",
  admin: "Team and roles", "data-room": "Data room",
  "platform-health": "Platform health", "feature-flags": "Feature flags", settings: "Settings",
};

const person = (role, areas) => ({ email: `${role}@example.test`, role, status: "active", areas });
const owner = person("owner", ["admin_console", "team_manage", "crm", "beta_leads"]);
const admin = person("admin", ["admin_console", "crm", "beta_leads"]);
const growth = person("growth", ["role_home", "crm", "beta_leads"]);
const partner = person("partner", ["role_home", "crm", "beta_leads"]);

// A storage that behaves like the browser's, and two that do not.
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}
const throwingStorage = {
  getItem() { throw new Error("storage is blocked"); },
  setItem() { throw new Error("storage is blocked"); },
};

describe("#3802 S-1: the menu is nine groups, in the approved order", () => {
  it("group labels, in order", () => {
    assert.deepEqual(NAV_GROUPS.map((g) => g.label), MENU.map(([label]) => label));
    // #4130: nine groups (Home and Support added, Pipeline became Outreach).
    assert.equal(NAV_GROUPS.length, 9);
  });
  it("each group holds exactly its pages, in order", () => {
    for (const [i, [label, ids]] of MENU.entries()) {
      assert.deepEqual(NAV_GROUPS[i].items.map((item) => item.id), ids, String(label));
    }
  });
  it("no menu item was renamed", () => {
    assert.deepEqual(Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i.label])), LABELS);
  });
  it("every item is an id, a label and an icon, and nothing else", () => {
    for (const item of NAV_ITEMS) assert.deepEqual(Object.keys(item).sort(), ["icon", "id", "label"], item.id);
    for (const group of NAV_GROUPS) assert.deepEqual(Object.keys(group).sort(), ["items", "label"]);
  });
  it("nothing that is not built is in the menu", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    for (const planned of ["calendar"]) assert.equal(ids.includes(planned), false, planned);
    assert.equal(/\bSoon\b/.test(stripComments(SIDEBAR)), false);
  });
});

describe("#3802 S-2: every page is in the menu exactly once", () => {
  it("no id twice", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    // [TEST-MOD-APPROVED #2879] Queue health added beside API health (+1).
    // [TEST-MOD-APPROVED #3980] Work board and Agent log (+2).
    // [TEST-MOD-APPROVED #3980] synced Wave 3 (D-11): Needs you, Work, Calendar; the Agent log is a tab on Work. (-1)
    // #4130: Wave 0 — 40 entries became 26 pages.
    assert.equal(ids.length, 26);
  });
  it("the menu plus governed Ads deep links are the app's pages (the role Home aside)", () => {
    const pagesBlock = APP.match(/const PAGES = \{([\s\S]*?)\n\};/);
    assert.ok(pagesBlock, "App.jsx must define PAGES");
    const pageIds = [...stripComments(pagesBlock[1]).matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w]*))\s*:/gm)].map((m) => m[1] || m[2]);
    // [TEST-MOD-APPROVED #3697] Campaign builder and campaign operations remain
    // valid deep links beneath the one Ads workspace, not competing sidebar destinations.
    // [TEST-MOD-APPROVED #3980] synced Wave 3 (D-11): Needs you, Work, Calendar; the Agent log is a tab on Work. #/agent-log stays a page that opens it.
    // #4130: Support and Community are addresses that open the Community &
    // Support console (community-support) until Wave 6; My agent and Guide
    // moved to the header and keep their pages.
    const menuPages = NAV_ITEMS.map((i) => i.id).filter((id) => id !== "support" && id !== "community");
    assert.deepEqual([...pageIds].sort(), ["home", "campaign-builder", "campaigns", "agent-log", "community-support", "agent", "guide", ...menuPages].sort());
  });
  it("the role Home group is still put first by lib/access.js, not by the menu list", () => {
    assert.equal(NAV_ITEMS.some((i) => i.id === "home"), false);
    assert.deepEqual(TEAM_NAV_GROUP, { label: null, items: [{ id: "home", label: "Home", icon: "Home" }] });
    assert.equal(visibleNavGroups(NAV_GROUPS, growth)[0].items[0].id, "home");
  });
});

describe("#3802 S-3: who may open what did not move", () => {
  it("the area map is exactly what it was", () => {
    assert.deepEqual(PAGE_AREA_OVERRIDES, {
      home: "role_home",
      admin: "team_manage",
      hosts: "crm",
      creators: "crm",
      drafts: "crm",
      "beta-leads": "beta_leads",
      "content-calendar": "crm",
      // [TEST-MOD-APPROVED #3980] both new pages open to everyone who works the pipelines.
      "work-board": "crm",
      "agent-log": "crm",
      agent: "crm",
      guide: "crm",
    });
    assert.deepEqual(AREA, { ADMIN_CONSOLE: "admin_console", TEAM_MANAGE: "team_manage", ROLE_HOME: "role_home", CRM: "crm", BETA_LEADS: "beta_leads" });
  });
  it("every other page still needs the full admin console", () => {
    for (const item of NAV_ITEMS) {
      const expected = Object.hasOwn(PAGE_AREA_OVERRIDES, item.id) ? PAGE_AREA_OVERRIDES[item.id] : "admin_console";
      assert.equal(areaForPage(item.id), expected, item.id);
    }
  });
  it("each role sees the pages it saw before, in the new order", () => {
    const ids = (a) => visibleNavGroups(NAV_GROUPS, a).flatMap((g) => g.items).map((i) => i.id);
    // [TEST-MOD-APPROVED #3980] growth and partner open the Work board and Agent log.
    // [TEST-MOD-APPROVED #3980] synced Wave 3 (D-11): Needs you, Work, Calendar; the Agent log is a tab on Work.
    // #4130: growth and partner see Work, Hosts and creators (their boards),
    // Inbound leads (their Beta leads tab) and Calendar; My agent and Guide
    // are in the header now. Admin sees Team and roles through its Careers
    // tab (the union of the pages it replaced, never wider).
    assert.deepEqual(ids(growth), ["home", "work-board", "outreach", "inbound", "content-calendar"]);
    assert.deepEqual(ids(partner), ["home", "work-board", "outreach", "inbound", "content-calendar"]);
    assert.deepEqual(ids(owner), NAV_ITEMS.map((i) => i.id));
    assert.deepEqual(ids(admin), NAV_ITEMS.map((i) => i.id));
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, owner).map((g) => g.label), MENU.map(([label]) => label));
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, growth).map((g) => g.label), [null, "Home", "Outreach"]);
  });
});

describe("#3802 S-4: every menu icon resolves", () => {
  const block = SIDEBAR.match(/const ICON_MAP = \{([\s\S]*?)\n\};/);
  const entries = block
    ? [...stripComments(block[1]).matchAll(/^\s*([A-Za-z][\w]*)(?:\s*:\s*([A-Za-z][\w]*))?\s*,?\s*$/gm)].map((m) => ({ key: m[1], local: m[2] || m[1] }))
    : [];
  const importBlock = SIDEBAR.match(/import \{([^}]*)\} from "lucide-react";/);
  // What each imported name is called inside the file ("Map as MapIcon" -> MapIcon).
  const imported = importBlock
    ? stripComments(importBlock[1]).split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/).pop())
    : [];
  const used = [...NAV_ITEMS, ...TEAM_NAV_GROUP.items];

  it("the registry is found and is not empty", () => {
    assert.ok(block, "Sidebar.jsx must define ICON_MAP");
    assert.ok(importBlock, "Sidebar.jsx must import its icons from lucide-react");
    // #4130: one icon per menu entry (26) plus the role Home.
    assert.ok(entries.length >= 27);
  });
  it("every icon a menu item names is registered", () => {
    const keys = new Set(entries.map((e) => e.key));
    for (const item of used) assert.ok(keys.has(item.icon), `${item.id}: "${item.icon}" is not in ICON_MAP`);
  });
  it("every registered icon is imported", () => {
    for (const e of entries) assert.ok(imported.includes(e.local), `${e.key} is registered but ${e.local} is not imported`);
  });
  it("one icon per item: no two items share one, and nothing unused is registered", () => {
    const names = used.map((i) => i.icon);
    assert.equal(new Set(names).size, names.length, "two menu items share an icon");
    assert.deepEqual(entries.map((e) => e.key).sort(), [...names].sort());
  });
  // #4130: Stripe mode is a tab of Platform health; its Wallet went to Mingla money.
  it("Mingla money and Platform health have their own icons", () => {
    assert.equal(NAV_ITEMS.find((i) => i.id === "mingla-money").icon, "Wallet");
    assert.equal(NAV_ITEMS.find((i) => i.id === "platform-health").icon, "HeartPulse");
    assert.notEqual(NAV_ITEMS.find((i) => i.id === "mingla-money").icon, NAV_ITEMS.find((i) => i.id === "overview").icon);
  });
  it("there is no fallback icon", () => {
    const code = stripComments(SIDEBAR);
    assert.ok(code.includes("const Icon = ICON_MAP[item.icon];"));
    assert.equal(/ICON_MAP\[[^\]]+\]\s*(\|\||\?\?)/.test(code), false, "an unknown icon name must not fall back to another icon");
  });
});

describe("#3802 S-5: folding a group", () => {
  // #4130: every menu group has a label now; the role Home group has none.
  const pipeline = NAV_GROUPS[1];
  const top = TEAM_NAV_GROUP;

  it("a group with a label folds; the one without never does", () => {
    assert.equal(isGroupOpen(pipeline, [], "overview"), true);
    assert.equal(isGroupOpen(pipeline, ["Outreach"], "overview"), false);
    assert.equal(isGroupOpen(top, [null, "null", ""], "people"), true);
  });
  it("the group holding the page you are on is always open", () => {
    for (const group of NAV_GROUPS.slice(1)) {
      for (const item of group.items) {
        assert.equal(isGroupOpen(group, NAV_GROUPS.map((g) => g.label), item.id), true, item.id);
      }
      assert.equal(isGroupOpen(group, [group.label], "overview"), false, group.label);
    }
  });
  it("toggling adds and removes one label and leaves the list it was given alone", () => {
    const before = ["Money"];
    assert.deepEqual(toggleFoldedGroup(before, "Growth"), ["Money", "Growth"]);
    assert.deepEqual(toggleFoldedGroup(["Money", "Growth"], "Money"), ["Growth"]);
    assert.deepEqual(before, ["Money"]);
  });
  it("the choice is remembered in the browser", () => {
    const storage = memoryStorage();
    assert.deepEqual(readFoldedGroups(storage), []);
    assert.equal(writeFoldedGroups(storage, ["Money", "System"]), true);
    assert.equal(storage.data[NAV_FOLD_STORAGE_KEY], JSON.stringify(["Money", "System"]));
    assert.deepEqual(readFoldedGroups(storage), ["Money", "System"]);
  });
  it("a browser that refuses storage, or holds rubbish, never breaks the menu", () => {
    assert.deepEqual(readFoldedGroups(throwingStorage), []);
    assert.equal(writeFoldedGroups(throwingStorage, ["Money"]), false);
    assert.deepEqual(readFoldedGroups(null), []);
    assert.deepEqual(readFoldedGroups(undefined), []);
    assert.equal(writeFoldedGroups(null, ["Money"]), false);
    for (const rubbish of ["", "{", "null", "7", '"Money"', '{"Money":true}']) {
      assert.deepEqual(readFoldedGroups(memoryStorage({ [NAV_FOLD_STORAGE_KEY]: rubbish })), [], rubbish);
    }
    assert.deepEqual(readFoldedGroups(memoryStorage({ [NAV_FOLD_STORAGE_KEY]: '["Money",3,null,"Money",{"a":1},"Growth"]' })), ["Money", "Growth"]);
  });
  it("the sidebar uses these, and reads and writes storage nowhere else", () => {
    const code = stripComments(SIDEBAR);
    assert.ok(code.includes("readFoldedGroups("));
    assert.ok(code.includes("writeFoldedGroups("));
    assert.ok(code.includes("isGroupOpen(group, foldedGroups, activeTab)"));
    assert.equal(/localStorage\.(getItem|setItem)/.test(code), false);
  });
});

describe("#3802 S-6: the breadcrumb", () => {
  it("Group › Page for a page inside a named group", () => {
    assert.deepEqual(breadcrumbFor("business-orders", "Orders", NAV_GROUPS), [{ label: "Money" }, { label: "Orders" }]);
    // #4130: My agent is in the header, not a menu group: its title stands alone.
    assert.deepEqual(breadcrumbFor("agent", "My agent", NAV_GROUPS), [{ label: "My agent" }]);
    for (const [label, ids] of MENU) {
      for (const id of ids) assert.deepEqual(breadcrumbFor(id, LABELS[id], NAV_GROUPS), [{ label }, { label: LABELS[id] }], id);
    }
  });
  it("the page alone at the top of the menu, on a role home, and for an id it does not know", () => {
    // #4130: Dashboard sits in the Home group now; the console's own id is
    // not a menu entry (the shell passes Support or Community instead).
    assert.deepEqual(breadcrumbFor("overview", "Dashboard", NAV_GROUPS), [{ label: "Home" }, { label: "Dashboard" }]);
    assert.deepEqual(breadcrumbFor("community-support", "Community & Support", NAV_GROUPS), [{ label: "Community & Support" }]);
    assert.deepEqual(breadcrumbFor("home", "My day", NAV_GROUPS), [{ label: "My day" }]);
    assert.deepEqual(breadcrumbFor("nope", "Dashboard", NAV_GROUPS), [{ label: "Dashboard" }]);
    assert.deepEqual(breadcrumbFor("constructor", "Dashboard", null), [{ label: "Dashboard" }]);
  });
  it("the group is plain text, never a control", () => {
    for (const crumb of breadcrumbFor("business-orders", "Orders", NAV_GROUPS)) assert.deepEqual(Object.keys(crumb), ["label"]);
    // The shared breadcrumb draws a button only for an item that has an action.
    const code = stripComments(CRUMBS);
    assert.ok(/\) : item\.onClick \? \(\s*<button/.test(code), "a button is drawn only when the item carries an action");
    assert.ok(/\) : \(\s*<span className="text-\[var\(--color-text-tertiary\)\]">\{item\.label\}<\/span>/.test(code), "an item with no action is plain text");
    assert.ok(code.includes('aria-current="page"'));
    assert.equal(/onNavigate|onClick:/.test(stripComments(HEADER)), false, "the header hands the breadcrumb no action");
  });
  it("the header draws it from the page's own title, which follows the role home", () => {
    const code = stripComments(HEADER);
    assert.ok(code.includes("items={breadcrumbFor(activeTab, title, NAV_GROUPS)}"));
    // #4130: titled by the menu entry (Support or Community for the console),
    // with My agent and Guide named from the header's list.
    assert.ok(stripComments(SHELL).includes("pageTitle(menuId, access, [...NAV_ITEMS, ...HEADER_PAGE_ITEMS])"));
  });
});

describe("#3802 S-7: the frame", () => {
  const token = (name, scope = CSS) => (scope.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
  const dark = CSS.slice(CSS.indexOf('[data-theme="dark"] {'), CSS.indexOf("/* ─── Global Reset"));
  const light = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf('[data-theme="dark"] {'));

  it("one set of sizes", () => {
    assert.equal(token("header-height"), "56px");
    assert.equal(token("sidebar-width"), "248px");
    assert.equal(token("sidebar-collapsed-width"), "64px");
    assert.equal(token("page-gutter", light), "24px");
    assert.equal(token("content-max-width"), "1600px");
    assert.match(CSS, /@media \(max-width: 639px\) \{\s*:root \{\s*--page-gutter:\s*16px;\s*\}\s*\}/);
  });
  it("the menu follows the theme: every menu colour has a light and a dark value", () => {
    for (const name of ["sidebar-bg", "sidebar-text", "sidebar-text-dim", "sidebar-text-active", "sidebar-border", "sidebar-hover", "sidebar-active-bg", "sidebar-accent"]) {
      assert.ok(token(name, light), `--${name} has no light value`);
      assert.ok(token(name, dark), `--${name} has no dark value`);
    }
    assert.notEqual(token("sidebar-bg", light), token("sidebar-bg", dark));
  });
  it("no hard-coded white or black in the menu", () => {
    const code = stripComments(SIDEBAR);
    assert.equal(/\b(?:text|bg|border|ring|fill|stroke)-(?:white|black)\b/.test(code), false);
    assert.equal(/#(?:fff|ffffff|000|000000)\b/i.test(code), false);
    assert.ok(code.includes("var(--sidebar-bg)"));
  });
  it("the logo row is as tall as the header, and both sit on the gutter", () => {
    const side = stripComments(SIDEBAR);
    const head = stripComments(HEADER);
    assert.ok(side.includes("h-[var(--header-height)]"), "the logo row takes its height from the header token");
    assert.ok(head.includes('height: "var(--header-height)"'));
    assert.ok(head.includes("px-[var(--page-gutter)]"));
  });
  it("the logo is the canonical wordmark, once, with no typed name beside it", () => {
    const code = stripComments(SIDEBAR);
    assert.equal((SIDEBAR.match(/packages\/brand-assets\/mingla-wordmark\.png/g) || []).length, 1);
    assert.equal(fs.existsSync(path.join(SRC, "assets", "mingla-wordmark.png")), false, "no second copy of the wordmark in the admin app");
    assert.equal(/>\s*Mingla\s*</.test(code), false, 'no typed "Mingla" beside the logo');
    assert.ok(/alt="Mingla"/.test(code));
    assert.equal(/h-7 w-7/.test(code), false, "the wordmark is not squeezed into a square");
  });
  it("the footer is one row with a named Sign out button, and the collapse control lives in the header", () => {
    const side = stripComments(SIDEBAR);
    const head = stripComments(HEADER);
    assert.ok(side.includes('aria-label="Sign out"'));
    assert.ok(side.includes("ROLE_LABELS[access.role]"));
    assert.equal(/Collapse (sidebar|menu)|Expand (sidebar|menu)/.test(side), false);
    assert.ok(head.includes('"Expand menu"') && head.includes('"Collapse menu"'));
    assert.ok(head.includes("onToggleCollapsed"));
  });
  it("the header search opens the palette the app already has", () => {
    const head = stripComments(HEADER);
    assert.ok(head.includes("onClick={onOpenSearch}"));
    assert.ok(stripComments(SHELL).includes("onOpenSearch={onOpenSearch}"));
    assert.ok(APP.includes("onOpenSearch={() => setCommandPaletteOpen(true)}"));
    assert.ok(APP.includes("open={commandPaletteOpen}"));
  });
  it("the shell stays under the board layers", () => {
    const z = (name) => Number(token(`z-${name}`));
    const lowestBoardLayer = Math.min(...Object.values(CRM_LAYER_Z));
    assert.ok(z("sticky") < lowestBoardLayer, "the header");
    assert.ok(z("overlay") + 1 < lowestBoardLayer, "the phone menu and its backdrop");
    assert.ok(stripComments(HEADER).includes('zIndex: "var(--z-sticky)"'));
    assert.equal(/z-\[?\d{2,}|zIndex:\s*\d/.test(stripComments(SIDEBAR) + stripComments(HEADER) + stripComments(SHELL)), false, "no stacking number of the shell's own");
  });
  it("the shell sets the page gutter once: all sides, left-aligned, one width", () => {
    const code = stripComments(SHELL);
    assert.ok(code.includes('className="w-full min-w-0 max-w-[var(--content-max-width)] p-[var(--page-gutter)]"'));
    assert.equal(/mx-auto/.test(code), false, "the page is left-aligned");
    assert.equal(/\b(?:sm|md|lg|xl|2xl):px-/.test(code), false, "one gutter, not one per screen width");
    assert.equal((code.match(/<main\b/g) || []).length, 1);
  });
});

describe("#3802 S-8: one page header, and no page setting its own frame", () => {
  const PAGES_DIR = path.join(SRC, "pages");
  // Every page that starts with the one header.
  const MIGRATED = [
    "AdEnginePage.jsx", "AdminPage.jsx", "AgentPage.jsx", "BetaLeadsPage.jsx", "BrandSitesPage.jsx", "BrandsConsolePage.jsx",
    "BusinessMoneyLedgerPage.jsx", "BusinessOrdersPage.jsx", "BusinessPaymentsPage.jsx", "CampaignBuilderPage.jsx",
    "CampaignsPage.jsx", "CareersPage.jsx", "ClaimsPage.jsx", "CommunitySupportPage.jsx", "ContentCalendarPage.jsx", "DataRoomPage.jsx", "DraftsPage.jsx", "EmailPage.jsx",
    // [TEST-MOD-APPROVED #3980] the Work board and Agent log draw the one header.
    "WorkBoardPage.jsx", "AgentLogPage.jsx",
    "GuidePage.jsx", "LaunchCitiesPage.jsx", "NotificationsPage.jsx", "OfferingsConsolePage.jsx", "OverviewPage.jsx", "PeopleConsolePage.jsx", "PipelinePage.jsx",
    "PlaceIntelligenceTrialPage.jsx", "PlacePoolManagementPage.jsx", "PricingPage.jsx", "QueueHealthPage.jsx", "RefundOperationsPage.jsx",
    "RoleHomePage.jsx", "SettingsPage.jsx", "SignalLibraryPage.jsx", "SubscriptionManagementPage.jsx",
    "SupportDeskPage.jsx", "TeamDashboardPage.jsx", "ToolLeadsPage.jsx", "VenuesConsolePage.jsx",
    // #4130: Wave 2a's Mingla money page draws the one header.
    "MinglaMoneyPage.jsx",
    // #4130: People replaces the Users page (deleted); Brands is its own page.
    "PeoplePage.jsx", "BrandsPage.jsx",
    // #4130 (Wave 4b): Place pool, Platform health and Feature flags are their
    // own pages; API health, Stripe mode and Deck tuner are folded in (deleted).
    "PlacePoolPage.jsx", "PlatformHealthPage.jsx", "FeatureFlagsPage.jsx",
  ];
  // The five pages that moved later (My agent, Hosts and Creators, Beta Leads,
  // Home, Team dashboard) are now in the list above; none is left to follow.
  const FOLLOW_UP = [];
  const page = (file) => stripComments(fs.readFileSync(path.join(PAGES_DIR, file), "utf8"));
  // The classes that make a frame of a page's own: padding, a width, centring.
  const OWN_FRAME = /(?:^|\s)(?:p|px|py|pt|pb|pl|pr)-(?:\d|\[)|(?:^|\s)max-w-|(?:^|\s)mx-auto(?:\s|$)/;

  // The outermost element a <PageHeader> is drawn in: the first tag after the
  // `return (` that precedes it.
  // A page with several returns may build its header once
  // (`const pageHeader = (<PageHeader … />)`) and draw `{pageHeader}` in each;
  // both spellings count as drawing it, and the definition itself is skipped.
  function rootsHoldingHeader(source) {
    const roots = [];
    for (const m of source.matchAll(/<PageHeader\b|\{pageHeader\}/g)) {
      const at = m.index;
      if (/const pageHeader = \(\s*$/.test(source.slice(0, at))) continue;
      const ret = source.lastIndexOf("return (", at);
      assert.ok(ret !== -1, "a <PageHeader> must sit inside a returned element");
      const tag = source.slice(ret, at).match(/<([A-Za-z][\w.]*)([^>]*)>/);
      assert.ok(tag, "the element holding <PageHeader> was not found");
      roots.push({ name: tag[1], className: (tag[2].match(/className="([^"]*)"/) || [])[1] ?? "" });
    }
    return roots;
  }

  it("every page is either on the one header or named for the follow-up", () => {
    const all = fs.readdirSync(PAGES_DIR).filter((f) => /Page\.jsx$/.test(f)).sort();
    assert.deepEqual([...MIGRATED, ...FOLLOW_UP].sort(), all);
    // [TEST-MOD-APPROVED #2879] Queue health page (+1 over #3720 Wave 6's 41).
    // [TEST-MOD-APPROVED #3980] Work board and Agent log pages (+2).
    // #4130: Mingla money page (+1, Wave 2a).
    // #4130: Users page deleted (-1); People and Brands pages added (+2).
    // #4130 (Wave 4b): three pages folded in (-3), three added (+3).
    assert.equal(MIGRATED.length, 46);
    assert.equal(FOLLOW_UP.length, 0);
  });

  it("every migrated page draws the one header", () => {
    for (const file of MIGRATED) {
      const source = page(file);
      assert.ok(source.includes('import { PageHeader } from "../components/ui/PageHeader";'), `${file} must import PageHeader`);
      assert.ok(/<PageHeader\b/.test(source), `${file} must draw <PageHeader>`);
    }
  });

  it("the title is the header's: no migrated page writes an <h1> or a <main> of its own", () => {
    for (const file of MIGRATED) {
      const source = page(file);
      assert.equal(/<h1\b/.test(source), false, `${file} has its own <h1>`);
      assert.equal(/<main\b/.test(source), false, `${file} has its own <main> inside the shell's`);
    }
    assert.equal((stripComments(PAGE_HEADER).match(/<h1\b/g) || []).length, 1);
  });

  it("no migrated page sets its own outer padding, width or centring", () => {
    for (const file of MIGRATED) {
      for (const root of rootsHoldingHeader(page(file))) {
        assert.equal(OWN_FRAME.test(root.className), false, `${file}: the page root sets its own frame ("${root.className}")`);
      }
    }
  });

  it("the old page wrappers are gone from every page", () => {
    const old = ['<div className="py-8', '<div className="py-6 ', "space-y-4 py-6", "max-w-6xl mx-auto", '<div className="p-8', '<main className="p-8', '<div className="p-6 space-y-6'];
    for (const file of [...MIGRATED, ...FOLLOW_UP]) {
      const source = page(file);
      for (const wrapper of old) assert.equal(source.includes(wrapper), false, `${file} still has ${wrapper}`);
    }
  });

  it("one spacing scale: 24px between a page's sections", () => {
    for (const file of MIGRATED) {
      for (const root of rootsHoldingHeader(page(file))) {
        if (root.name === "section") continue;
        assert.ok(/(?:^|\s)(?:gap-6|space-y-6)(?:\s|$)/.test(root.className), `${file}: "${root.className}" is not the 24px scale`);
      }
    }
  });

  it("the header itself: one title style, a description, actions, a way back, tabs on the divider", () => {
    const code = stripComments(PAGE_HEADER);
    assert.ok(code.includes("export function PageHeader({ title, description, meta, actions, back, tabs, titleId })"));
    const h1 = code.match(/<h1[\s\S]*?className="([^"]*)"/);
    assert.ok(h1);
    for (const cls of ["text-[22px]", "leading-7", "font-semibold", "tracking-[-0.02em]"]) {
      assert.ok(h1[1].split(/\s+/).includes(cls), `the title must be ${cls}`);
    }
    assert.ok(code.includes("onClick={back.onClick}"), "a back control always does something");
    assert.ok(/\{tabs && <div[^>]*>\{tabs\}<\/div>\}/.test(code));
    const root = code.match(/<header className="([^"]*)"/);
    assert.ok(root);
    assert.equal(OWN_FRAME.test(root[1]), false, "the header adds no frame of its own either");
  });

  it("the pages that had no title have one", () => {
    assert.ok(page("EmailPage.jsx").includes('title="Email"'));
    assert.ok(page("CampaignsPage.jsx").includes('title="Campaigns"'));
    assert.ok(page("CampaignBuilderPage.jsx").includes('<PageHeader title="Campaign Builder" />'));
    // Campaigns: the card's own heading moved up; the card no longer repeats it.
    assert.equal(/<SectionCard\s+title="Campaigns"/.test(page("CampaignsPage.jsx")), false);
  });
});

describe("#3802 S-9: rework after the tester's verdict", () => {
  const PAGES_DIR = path.join(SRC, "pages");
  const raw = (file) => fs.readFileSync(path.join(PAGES_DIR, file), "utf8");
  // Every page is on the one header now: none is left to follow.
  const FOLLOW_UP = [];
  const MIGRATED = fs.readdirSync(PAGES_DIR).filter((f) => /Page\.jsx$/.test(f) && !FOLLOW_UP.includes(f)).sort();

  // Every `return` of the exported page component that returns markup, with
  // whether that markup draws the page header. Found by indentation: the page
  // component's own returns sit 4 or 6 spaces in.
  // A page whose exported component only chooses between two views: the
  // views are where its states live, so they are the ones walked.
  // Hosts and Creators: the two exported pages each draw the one board page.
  const VIEWS = { "BrandSitesPage.jsx": ["BrandSitesList", "BrandSiteDetail"], "PipelinePage.jsx": ["PipelinePage"] };

  function pageReturns(file) {
    const names = VIEWS[file] ?? [null];
    return names.flatMap((name) => returnsOf(file, name));
  }

  function returnsOf(file, name) {
    const lines = raw(file).split("\n");
    const found = [];
    const opener = name ? new RegExp(`^(export )?function ${name}\\b`) : /^export (default )?function \w+Page\b/;
    let start = lines.findIndex((l) => opener.test(l));
    assert.ok(start !== -1, `${file}: the page component was not found`);
    let end = start + 1;
    while (end < lines.length && !/^}/.test(lines[end])) end += 1;
    for (let k = start; k < end; k += 1) {
      const indent = lines[k].match(/^ */)[0].length;
      if (indent < 2 || indent > 6 || !/^\s*(?:if \(.*\) )?return\b/.test(lines[k])) continue;
      const opensBlock = /return \($/.test(lines[k].trim());
      const head = opensBlock ? `${lines[k].trim()} ${(lines[k + 1] || "").trim()}` : lines[k];
      if (!/return \(? ?</.test(head)) continue;
      let last = k;
      if (/return \($/.test(lines[k].trim())) {
        last = k + 1;
        while (last < end && !lines[last].startsWith(`${" ".repeat(indent)});`)) last += 1;
      }
      const body = lines.slice(k, last + 1).join("\n");
      found.push({ line: k + 1, hasHeader: /<PageHeader\b|\{pageHeader\}/.test(body), body });
    }
    return found;
  }

  // Returns that are NOT a state of the page, counted per file, with why.
  // Anything else that returns markup without the header fails this suite.
  const NOT_A_PAGE_STATE = {
    // Two small renderers inside the page (a status line, a table row).
    "AdminPage.jsx": 2,
    // An opened record. Each draws the record's own title and a way back
    // (EntityDetailView, OfferingDetailView, VenueDetailView, or its own bar).
    "BrandsConsolePage.jsx": 1,
    // [TEST-MOD-APPROVED #3645] Paystack dispute detail is a second headerless
    // opened-record return alongside the existing Stripe dispute detail.
    "BusinessMoneyLedgerPage.jsx": 2,
    "BusinessOrdersPage.jsx": 1,
    "BusinessPaymentsPage.jsx": 1,
    "OfferingsConsolePage.jsx": 1,
    "PeopleConsolePage.jsx": 1,
    "VenuesConsolePage.jsx": 1,
    // #4130: the Users page is gone. People hands its full-record address to
    // the business People record; Brands hands its full record and the tools
    // folded inside it (Websites, Venues, Venue claims) to those pages, which
    // each draw their own header.
    "PeoplePage.jsx": 1,
    "BrandsPage.jsx": 2,
  };

  it("every state of every migrated page draws the page header", () => {
    // [TEST-MOD-APPROVED #2879] Queue health page (+1 over #3720 Wave 6's 41).
    // [TEST-MOD-APPROVED #3980] Work board and Agent log pages (+2).
    // #4130: Mingla money page (+1, Wave 2a).
    // #4130: Users page deleted (-1); People and Brands pages added (+2).
    // #4130 (Wave 4b): three pages folded in (-3), three added (+3).
    assert.equal(MIGRATED.length, 46);
    for (const file of MIGRATED) {
      const without = pageReturns(file).filter((r) => !r.hasHeader);
      assert.equal(
        without.length,
        NOT_A_PAGE_STATE[file] ?? 0,
        `${file}: a state without the page header at line ${without.map((r) => r.line).join(", ")}`,
      );
      assert.ok(pageReturns(file).some((r) => r.hasHeader), `${file}: no return draws the header`);
    }
  });

  it("the states that had no title now have one, and add no padding of their own", () => {
    const states = (file) => pageReturns(file).filter((r) => r.hasHeader);
    // Signal Library: loading, could not load, nothing defined, and the page itself.
    assert.equal(states("SignalLibraryPage.jsx").length, 4);
    assert.equal((raw("SignalLibraryPage.jsx").match(/\{pageHeader\}/g) || []).length, 4);
    assert.equal((raw("SignalLibraryPage.jsx").match(/<PageHeader\b/g) || []).length, 1, "one header, drawn four times");
    // "Ads console is off" on both pages, and Refund operations while it loads.
    for (const [file, title, words] of [
      ["CampaignBuilderPage.jsx", '<PageHeader title="Campaign Builder" />', "Ads console is off"],
      ["CampaignsPage.jsx", '<PageHeader title="Campaigns" />', "Ads console is off"],
      ["RefundOperationsPage.jsx", '<PageHeader title="Refund operations" />', "Loading refund operations"],
    ]) {
      const state = states(file).find((r) => r.body.includes(words));
      assert.ok(state, `${file}: the "${words}" state must draw the header`);
      assert.ok(state.body.includes(title), `${file}: ${title}`);
    }
    // Brand Sites: an opened site that is still loading, or could not be loaded.
    assert.equal(states("BrandSitesPage.jsx").length, 4, "the list, the site, the site loading, the site not loaded");
    assert.equal((raw("BrandSitesPage.jsx").match(/<PageHeader title="Brand Sites" back=\{\{ label: "Back to all sites", onClick: onBack \}\} \/>/g) || []).length, 2);
    // #4130: the Users page and its opened-person states are gone; a person
    // opens in the People page's drawer, under the People header.
    // None of these states wraps itself in padding: the first element of each is the plain 24px column.
    for (const file of MIGRATED) {
      for (const r of states(file)) {
        const root = r.body.match(/return \(?\s*<[A-Za-z]+(?: className="([^"]*)")?/);
        assert.ok(root, `${file}:${r.line}`);
        assert.equal(/(?:^|\s)(?:p|px|py|pt|pb)-(?:\d|\[)|max-w-|mx-auto/.test(root[1] ?? ""), false, `${file}:${r.line} "${root[1]}"`);
      }
    }
    assert.equal(/<div className="py-12">\s*<AlertCard kind="info"/.test(raw("SignalLibraryPage.jsx")), false);
  });

  it("Email already drew its header in every state: its spinner and setup card sit under it", () => {
    const email = pageReturns("EmailPage.jsx");
    assert.equal(email.length, 1, "the Email page has one return, and the sub-views render inside it");
    assert.ok(email[0].hasHeader);
    assert.ok(email[0].body.indexOf("<PageHeader") < email[0].body.indexOf("<ComposeSubView"));
  });

  it("the heading of the group you are in is not a switch", () => {
    const money = NAV_GROUPS.find((g) => g.label === "Money");
    assert.equal(canFoldGroup(money, "business-orders"), false);
    assert.equal(canFoldGroup(money, "overview"), true);
    // #4130: the role Home group is the only one with no label now.
    assert.equal(canFoldGroup(TEAM_NAV_GROUP, "people"), false, "the group with no label never folds");
    for (const broken of [null, undefined, {}, { label: "" }, { label: 7, items: [] }, "Money"]) assert.equal(canFoldGroup(broken, "x"), false);
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        assert.equal(canFoldGroup(group, item.id), false, item.id);
        assert.equal(groupHoldsPage(group, item.id), true);
      }
    }
    const code = stripComments(SIDEBAR);
    assert.ok(code.includes("const foldable = canFoldGroup(group, activeTab);"));
    // The button, the arrow and the click exist only for a group that can fold.
    const button = code.match(/\{hasLabel && !rail && foldable && \(\s*<button[\s\S]*?<\/button>\s*\)\}/);
    assert.ok(button, "the fold button is drawn only when the group can fold");
    assert.ok(button[0].includes("onClick={() => toggleGroup(group.label)}") && button[0].includes("<ChevronDown"));
    const words = code.match(/\{hasLabel && !rail && !foldable && \(\s*<div className="([^"]*)">\s*\{group\.label\}\s*<\/div>\s*\)\}/);
    assert.ok(words, "otherwise the heading is plain words");
    assert.equal(/cursor-pointer|hover:/.test(words[1]), false, "and does not look clickable");
    // toggleGroup is reached from that one button and nowhere else, so the
    // heading of the current group cannot change what is remembered.
    assert.equal((code.match(/toggleGroup\(/g) || []).length, 1);
    assert.equal((code.match(/<ChevronDown\b/g) || []).length, 1);
  });

  it("the wordmark is a way home, and a plain picture for someone with no home", () => {
    const code = stripComments(SIDEBAR);
    assert.ok(code.includes("const homeId = homePageFor(access);"));
    const home = code.match(/\{homeId \? \(\s*<button([\s\S]*?)>\s*\{renderLogo\(rail\)\}\s*<\/button>\s*\) : \(\s*renderLogo\(rail\)\s*\)\}/);
    assert.ok(home, "a button when there is a home, the bare logo when there is not");
    assert.ok(home[1].includes('aria-label="Mingla Admin home"'));
    assert.ok(home[1].includes("onClick={() => openPage(homeId)}"), "it goes through openPage, which also closes the phone menu");
    assert.ok(/focus-visible:outline-2/.test(home[1]) && home[1].includes("focus-visible:outline-[var(--sidebar-accent)]"), "a visible focus ring");
    assert.ok(home[1].includes('type="button"'));
    // One logo, drawn by both copies of the menu (phone and desktop, rail or not).
    assert.equal((code.match(/const renderLogo = \(rail\) =>/g) || []).length, 1);
    assert.equal((code.match(/<img\b/g) || []).length, 1);
    // Where it goes, per person.
    assert.equal(homePageFor(owner), "overview");
    assert.equal(homePageFor(growth), "home");
    assert.equal(homePageFor(null), null);
    assert.equal(homePageFor(person("growth", ["crm"])), null);
    // The breadcrumb stays as approved: still words only, still no root crumb.
    assert.deepEqual(breadcrumbFor("business-orders", "Orders", NAV_GROUPS), [{ label: "Money" }, { label: "Orders" }]);
    assert.equal(/onNavigate|onClick:/.test(stripComments(HEADER)), false);
  });

  it("the icon rail keeps the menu's left edge: the M and every icon start 24px in", () => {
    const code = stripComments(SIDEBAR);
    // Logo row: 24px of padding in both forms.
    assert.ok(code.includes('rail ? "pl-6 pr-0" : "px-6",'));
    // Menu rows: 12px of menu padding + 12px inside the row, in both forms.
    assert.ok(code.includes('<nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2.5"'));
    assert.ok(code.includes('rail ? "pl-3 pr-0" : "px-3",'));
    assert.equal(/rail \? "justify-center/.test(code), false, "nothing in the rail is centred to a different edge");
  });

  it("a broken menu never breaks the breadcrumb", () => {
    const broken = [null, undefined, 7, "Money", {}, { label: "A" }, { items: null }, { items: [null, 3, {}] }, { label: null, items: [{ id: "x" }] }];
    assert.deepEqual(breadcrumbFor("x", "Title", broken), [{ label: "Title" }]);
    assert.deepEqual(breadcrumbFor("y", "Title", [null, { label: "Real", items: [null, { id: "y" }] }]), [{ label: "Real" }, { label: "Title" }]);
    for (const menu of [null, undefined, 7, "x", {}, [null], [[]]]) assert.deepEqual(breadcrumbFor("x", "Title", menu), [{ label: "Title" }]);
    assert.equal(isGroupOpen(null, null, "x"), true);
    assert.equal(groupHoldsPage(null, "x"), false);
    assert.equal(groupHoldsPage({ items: "nope" }, "x"), false);
  });

  it("the stepper's note does its sum with today's frame, and its breakpoint did not move", () => {
    const stepper = fs.readFileSync(path.join(SRC, "components/campaign-builder/stepperResponsive.js"), "utf8");
    assert.ok(stepper.includes("export const COMPACT_BREAKPOINT_PX = 1536;"));
    assert.ok(stepper.includes("--sidebar-width 248px plus --page-gutter 24px on each side"));
    assert.ok(stepper.includes("1536 - 248 - 48 = 1240px"));
    assert.equal(/AppShell's `px-16`/.test(stepper), false, "the old padding is no longer described as current");
  });
});
