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
import { AREA, PAGE_AREA_OVERRIDES, TEAM_NAV_GROUP, areaForPage, visibleNavGroups } from "../lib/access.js";
import {
  NAV_FOLD_STORAGE_KEY,
  breadcrumbFor,
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
const MENU = [
  [null, ["overview", "support"]],
  ["Pipeline", ["hosts", "creators", "beta-leads", "tool-leads", "team-dashboard"]],
  ["Business", ["business-people", "business-brands", "brand-sites", "business-venues", "business-offerings", "claims"]],
  ["Money", ["business-payments", "business-orders", "business-money-ledger", "refund-operations", "subscriptions", "pricing"]],
  ["Explorer app", ["users", "placepool", "launch-cities", "signals", "deck-tuner", "place-intelligence-trial"]],
  ["Growth", ["ad-engine", "campaign-builder", "campaigns", "email"]],
  ["Company", ["admin", "careers"]],
  ["System", ["stripe-mode", "api-health", "settings", "agent"]],
];

// The words on each menu item, exactly as they were before the regrouping.
const LABELS = {
  overview: "Dashboard", support: "Support", hosts: "Hosts", creators: "Creators",
  "beta-leads": "Beta Leads", "tool-leads": "Tool Leads", "team-dashboard": "Team dashboard",
  "business-people": "People", "business-brands": "Brands", "brand-sites": "Brand Sites",
  "business-venues": "Venues", "business-offerings": "Offerings", claims: "Venue claims",
  "business-payments": "Payments", "business-orders": "Orders", "business-money-ledger": "Money ledger",
  "refund-operations": "Refund operations", subscriptions: "Subscriptions", pricing: "Pricing",
  users: "Users", placepool: "Place Pool", "launch-cities": "Launch Cities", signals: "Signal Library",
  "deck-tuner": "Deck tuner", "place-intelligence-trial": "Intelligence Trial",
  "ad-engine": "Ads console", "campaign-builder": "Campaign Builder", campaigns: "Campaigns", email: "Email",
  admin: "Team and roles", careers: "Careers",
  "stripe-mode": "Stripe mode", "api-health": "API health", settings: "Settings", agent: "My agent",
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

describe("#3802 S-1: the menu is eight groups, in the approved order", () => {
  it("group labels, in order", () => {
    assert.deepEqual(NAV_GROUPS.map((g) => g.label), MENU.map(([label]) => label));
    assert.equal(NAV_GROUPS.length, 8);
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
    for (const planned of ["drafts", "calendar", "data-room", "guide"]) assert.equal(ids.includes(planned), false, planned);
    assert.equal(/\bSoon\b/.test(stripComments(SIDEBAR)), false);
  });
});

describe("#3802 S-2: every page is in the menu exactly once", () => {
  it("no id twice", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 35);
  });
  it("the menu and the app's pages are the same set (the role Home aside)", () => {
    const pagesBlock = APP.match(/const PAGES = \{([\s\S]*?)\n\};/);
    assert.ok(pagesBlock, "App.jsx must define PAGES");
    const pageIds = [...stripComments(pagesBlock[1]).matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w]*))\s*:/gm)].map((m) => m[1] || m[2]);
    assert.deepEqual([...pageIds].sort(), ["home", ...NAV_ITEMS.map((i) => i.id)].sort());
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
      "beta-leads": "beta_leads",
      agent: "crm",
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
    assert.deepEqual(ids(growth), ["home", "hosts", "creators", "beta-leads", "agent"]);
    assert.deepEqual(ids(partner), ["home", "hosts", "creators", "beta-leads", "agent"]);
    assert.deepEqual(ids(owner), NAV_ITEMS.map((i) => i.id));
    assert.deepEqual(ids(admin), NAV_ITEMS.map((i) => i.id).filter((id) => id !== "admin"));
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, owner).map((g) => g.label), MENU.map(([label]) => label));
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, growth).map((g) => g.label), [null, "Pipeline", "System"]);
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
    assert.ok(entries.length >= 36);
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
  it("Stripe mode has its own icon", () => {
    assert.equal(NAV_ITEMS.find((i) => i.id === "stripe-mode").icon, "Wallet");
    assert.notEqual(NAV_ITEMS.find((i) => i.id === "stripe-mode").icon, NAV_ITEMS.find((i) => i.id === "overview").icon);
  });
  it("there is no fallback icon", () => {
    const code = stripComments(SIDEBAR);
    assert.ok(code.includes("const Icon = ICON_MAP[item.icon];"));
    assert.equal(/ICON_MAP\[[^\]]+\]\s*(\|\||\?\?)/.test(code), false, "an unknown icon name must not fall back to another icon");
  });
});

describe("#3802 S-5: folding a group", () => {
  const pipeline = NAV_GROUPS[1];
  const top = NAV_GROUPS[0];

  it("a group with a label folds; the one without never does", () => {
    assert.equal(isGroupOpen(pipeline, [], "overview"), true);
    assert.equal(isGroupOpen(pipeline, ["Pipeline"], "overview"), false);
    assert.equal(isGroupOpen(top, [null, "null", ""], "users"), true);
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
    assert.deepEqual(breadcrumbFor("agent", "My agent", NAV_GROUPS), [{ label: "System" }, { label: "My agent" }]);
    for (const [label, ids] of MENU.slice(1)) {
      for (const id of ids) assert.deepEqual(breadcrumbFor(id, LABELS[id], NAV_GROUPS), [{ label }, { label: LABELS[id] }], id);
    }
  });
  it("the page alone at the top of the menu, on a role home, and for an id it does not know", () => {
    assert.deepEqual(breadcrumbFor("overview", "Dashboard", NAV_GROUPS), [{ label: "Dashboard" }]);
    assert.deepEqual(breadcrumbFor("support", "Support", NAV_GROUPS), [{ label: "Support" }]);
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
    assert.ok(stripComments(SHELL).includes("pageTitle(activeTab, access, NAV_ITEMS)"));
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
    "AdEnginePage.jsx", "AdminPage.jsx", "ApiHealthPage.jsx", "BrandSitesPage.jsx", "BrandsConsolePage.jsx",
    "BusinessMoneyLedgerPage.jsx", "BusinessOrdersPage.jsx", "BusinessPaymentsPage.jsx", "CampaignBuilderPage.jsx",
    "CampaignsPage.jsx", "CareersPage.jsx", "ClaimsPage.jsx", "DeckScoreTunerPage.jsx", "EmailPage.jsx",
    "LaunchCitiesPage.jsx", "OfferingsConsolePage.jsx", "OverviewPage.jsx", "PeopleConsolePage.jsx",
    "PlaceIntelligenceTrialPage.jsx", "PlacePoolManagementPage.jsx", "PricingPage.jsx", "RefundOperationsPage.jsx",
    "SettingsPage.jsx", "SignalLibraryPage.jsx", "StripeModePage.jsx", "SubscriptionManagementPage.jsx",
    "SupportDeskPage.jsx", "ToolLeadsPage.jsx", "UserManagementPage.jsx", "VenuesConsolePage.jsx",
  ];
  // The five pages another piece of #3802 work is editing. They move to the
  // one header in a follow-up; until then they are named here, so a page can
  // never be in neither list.
  const FOLLOW_UP = ["AgentPage.jsx", "BetaLeadsPage.jsx", "PipelinePage.jsx", "RoleHomePage.jsx", "TeamDashboardPage.jsx"];
  const page = (file) => stripComments(fs.readFileSync(path.join(PAGES_DIR, file), "utf8"));
  // The classes that make a frame of a page's own: padding, a width, centring.
  const OWN_FRAME = /(?:^|\s)(?:p|px|py|pt|pb|pl|pr)-(?:\d|\[)|(?:^|\s)max-w-|(?:^|\s)mx-auto(?:\s|$)/;

  // The outermost element a <PageHeader> is drawn in: the first tag after the
  // `return (` that precedes it.
  function rootsHoldingHeader(source) {
    const roots = [];
    let at = source.indexOf("<PageHeader");
    while (at !== -1) {
      const ret = source.lastIndexOf("return (", at);
      assert.ok(ret !== -1, "a <PageHeader> must sit inside a returned element");
      const tag = source.slice(ret, at).match(/<([A-Za-z][\w.]*)([^>]*)>/);
      assert.ok(tag, "the element holding <PageHeader> was not found");
      roots.push({ name: tag[1], className: (tag[2].match(/className="([^"]*)"/) || [])[1] ?? "" });
      at = source.indexOf("<PageHeader", at + 1);
    }
    return roots;
  }

  it("every page is either on the one header or named for the follow-up", () => {
    const all = fs.readdirSync(PAGES_DIR).filter((f) => /Page\.jsx$/.test(f)).sort();
    assert.deepEqual([...MIGRATED, ...FOLLOW_UP].sort(), all);
    assert.equal(MIGRATED.length, 30);
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
    // Campaigns: the card's own heading moved up; it is not written twice.
    assert.equal((page("CampaignsPage.jsx").match(/title="Campaigns"/g) || []).length, 1);
  });
});
