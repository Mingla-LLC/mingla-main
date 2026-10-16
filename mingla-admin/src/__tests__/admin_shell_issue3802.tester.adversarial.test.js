// Issue #3802 (admin shell) — tester adversarial suite.
//
// The implementor's suite (admin_shell_issue3802.implementor.happy.test.js)
// pins the approved menu, the tokens and the one page header as written. This
// one attacks the same frame from the sides it does not cover: every
// combination of access a person can hold, hostile addresses, broken browser
// storage, numbers computed from the stylesheet instead of read off it, and
// class names that look right but do nothing.
//
//   TA-1  addresses: every menu id resolves for exactly the people who may
//         open it, across every combination of areas; hostile ids go home
//   TA-2  the menu each combination of areas is shown: never an empty group,
//         never a page the address would refuse, always in the approved order
//   TA-3  fold state at its edges: hostile stored values, storage that throws
//         on every call, values that cannot be stored, round trips
//   TA-4  the breadcrumb at its edges: every id, hostile ids, broken menus;
//         never a control, never a changed menu
//   TA-5  stacking, computed: the highest number the shell uses is under the
//         lowest board layer, and the shell uses only the named tokens
//   TA-6  class names that silently do nothing: a bare `[--token]` is not a
//         value in Tailwind v4; every token the shell reads is defined in both
//         themes; no retired token is still read anywhere
//   TA-7  the campaign stepper still fits beside the new menu and gutter
//   TA-8  the phone menu and sign out: hidden means unreachable, a choice
//         closes it, a failed sign out says so
//   TA-9  the pages moving later, and the detail views, add no frame of their
//         own inside the new shell
//
// Source text and pure modules only: nothing to install, no browser.
// Invariant: I-3802-ADMIN-SHELL-ONE-FRAME (docs/INVARIANT_REGISTRY.md).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import {
  AREA,
  ROLE_HOME_TITLES,
  canOpenPage,
  homePageFor,
  pageTitle,
  resolveRoute,
  visibleNavGroups,
} from "../lib/access.js";
import {
  NAV_FOLD_STORAGE_KEY,
  breadcrumbFor,
  browserStorage,
  isGroupOpen,
  readFoldedGroups,
  toggleFoldedGroup,
  writeFoldedGroups,
} from "../lib/shellNav.js";
import { CRM_LAYER_Z } from "../lib/crmLayers.js";
import { COMPACT_BREAKPOINT_PX } from "../components/campaign-builder/stepperResponsive.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SIDEBAR = stripComments(read("components/layout/Sidebar.jsx"));
const HEADER = stripComments(read("components/layout/Header.jsx"));
const SHELL = stripComments(read("components/layout/AppShell.jsx"));
const PAGE_HEADER = stripComments(read("components/ui/PageHeader.jsx"));
const CRUMBS = stripComments(read("components/ui/Breadcrumbs.jsx"));
const CSS = read("globals.css");
const SHELL_FILES = { SIDEBAR, HEADER, SHELL, PAGE_HEADER, CRUMBS };

const APPROVED_LABELS = [null, "Pipeline", "Business", "Money", "Explorer app", "Growth", "Company", "System"];
const ALL_IDS = NAV_ITEMS.map((i) => i.id);
const KNOWN = ["home", ...ALL_IDS];
const AREAS = Object.values(AREA);
const ROLES = ["owner", "admin", "growth", "partner"];

// Every subset of the areas the server can send: 2^n people per role.
function everyAreaSet() {
  const sets = [];
  for (let mask = 0; mask < 1 << AREAS.length; mask++) sets.push(AREAS.filter((_, i) => mask & (1 << i)));
  return sets;
}
const everyone = () =>
  ROLES.flatMap((role) => everyAreaSet().map((areas) => ({ email: `${role}@example.test`, role, status: "active", areas })));
const isSubsequence = (small, big) => {
  let i = 0;
  for (const x of big) if (i < small.length && small[i] === x) i++;
  return i === small.length;
};

describe("#3802 TA-1: an address opens a page for exactly the people who may open it", () => {
  it("walks every role, every combination of areas and every page", () => {
    assert.ok(AREAS.length >= 5, "the area list is read from lib/access.js");
    let checked = 0;
    for (const who of everyone()) {
      const home = homePageFor(who);
      for (const id of KNOWN) {
        const route = resolveRoute(id, who, KNOWN);
        const may = canOpenPage(who, id);
        const tag = `${who.role}/${who.areas.join("+") || "nothing"} -> ${id}`;
        if (home === null) {
          assert.equal(route.pageId, null, `${tag}: someone with no home is shown no page`);
        } else if (may) {
          assert.deepEqual(route, { pageId: id, denied: false, requestedId: id }, tag);
        } else {
          assert.deepEqual(route, { pageId: home, denied: true, requestedId: id }, tag);
        }
        // Whatever the address, the page shown is one this person may open.
        if (route.pageId !== null) assert.equal(canOpenPage(who, route.pageId), true, `${tag}: shown a page they may not open`);
        checked++;
      }
    }
    assert.equal(checked, ROLES.length * 2 ** AREAS.length * KNOWN.length);
  });

  it("an address that names no page goes home quietly, however it is spelled", () => {
    const owner = { email: "o@example.test", role: "owner", status: "active", areas: [...AREAS] };
    const growth = { email: "g@example.test", role: "growth", status: "active", areas: ["role_home", "crm"] };
    const hostile = ["", " ", "Overview", "overview ", "overview/", "../overview", "__proto__", "constructor", "toString", "hasOwnProperty", "home\u0000", "business-orders?x=1", null, undefined, 0, 42, {}, [], ["overview"], "Pipeline", "System", "help", "team"];
    for (const bad of hostile) {
      for (const who of [owner, growth]) {
        const route = resolveRoute(bad, who, KNOWN);
        assert.equal(route.denied, false, `${String(bad)}: an unknown address is not a refusal`);
        assert.equal(route.pageId, homePageFor(who), String(bad));
      }
    }
  });

  it("a group name is never an address", () => {
    for (const label of APPROVED_LABELS.filter(Boolean)) {
      assert.equal(KNOWN.includes(label), false);
      assert.equal(KNOWN.includes(label.toLowerCase().replace(/\s+/g, "-")), false, `${label} must not collide with a page id`);
    }
  });

  it("an invited person, or one with a role the app does not know, is shown no menu and no page", () => {
    for (const who of [
      { email: "i@example.test", role: "growth", status: "invited", areas: [...AREAS] },
      { email: "x@example.test", role: "owner", status: "suspended", areas: [...AREAS] },
      { email: "n@example.test", role: "owner", status: "active", areas: null },
      { email: "s@example.test", role: "owner", status: "active", areas: "admin_console" },
    ]) {
      assert.deepEqual(visibleNavGroups(NAV_GROUPS, who), [], JSON.stringify(who));
      for (const id of KNOWN) assert.equal(resolveRoute(id, who, KNOWN).pageId, null, `${JSON.stringify(who)} -> ${id}`);
    }
  });
});

describe("#3802 TA-2: the menu, for every combination of areas", () => {
  it("holds exactly the pages the address would open, in the approved order, with no empty group", () => {
    for (const who of everyone()) {
      const groups = visibleNavGroups(NAV_GROUPS, who);
      const tag = `${who.role}/${who.areas.join("+") || "nothing"}`;
      const shown = groups.flatMap((g) => g.items.map((i) => i.id));
      assert.deepEqual([...shown].sort(), KNOWN.filter((id) => canOpenPage(who, id)).sort(), `${tag}: menu and addresses disagree`);
      assert.equal(new Set(shown).size, shown.length, `${tag}: a page twice`);
      assert.equal(groups.some((g) => g.items.length === 0), false, `${tag}: an empty group`);
      assert.ok(isSubsequence(shown.filter((id) => id !== "home"), ALL_IDS), `${tag}: pages out of the approved order`);
      // Home, when held, is first and alone in its group; then the approved groups, in order.
      const labels = groups.map((g) => g.label);
      if (canOpenPage(who, "home")) {
        assert.deepEqual(groups[0].items.map((i) => i.id), ["home"], tag);
        assert.ok(isSubsequence(labels.slice(1), APPROVED_LABELS), `${tag}: groups out of order: ${labels.join(",")}`);
      } else {
        assert.equal(shown.includes("home"), false, tag);
        assert.ok(isSubsequence(labels, APPROVED_LABELS), `${tag}: groups out of order: ${labels.join(",")}`);
      }
      // A labelled group is shown once at most.
      const named = labels.filter(Boolean);
      assert.equal(new Set(named).size, named.length, tag);
    }
  });

  it("filtering the menu for one person never changes the menu itself", () => {
    const before = JSON.stringify(NAV_GROUPS);
    for (const who of everyone()) visibleNavGroups(NAV_GROUPS, who);
    assert.equal(JSON.stringify(NAV_GROUPS), before);
    assert.deepEqual(NAV_GROUPS.map((g) => g.label), APPROVED_LABELS);
  });

  it("the two non-admin roles see nothing from Business, Money, Explorer app, Growth or Company", () => {
    for (const role of ["growth", "partner"]) {
      const who = { email: `${role}@example.test`, role, status: "active", areas: ["role_home", "crm", "beta_leads"] };
      const labels = visibleNavGroups(NAV_GROUPS, who).map((g) => g.label);
      assert.deepEqual(labels, [null, "Pipeline", "System"], role);
      // [TEST-MOD-APPROVED #3802] Content Calendar deliberately shares CRM access with the pipeline pages.
      for (const id of ALL_IDS.filter((x) => !["hosts", "creators", "drafts", "beta-leads", "content-calendar", "agent", "guide"].includes(x))) {
        assert.equal(canOpenPage(who, id), false, `${role} must not open ${id}`);
      }
    }
  });

  it("no group label is blank, padded or repeated, so the fold memory cannot mix two groups up", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    assert.equal(labels.filter((l) => l === null).length, 1, "exactly one group has no label");
    assert.equal(labels[0], null, "and it is the first");
    for (const l of labels.filter((x) => x !== null)) {
      assert.equal(typeof l, "string");
      assert.equal(l, l.trim());
      assert.ok(l.length > 0);
    }
    assert.equal(new Set(labels).size, labels.length);
  });
});

describe("#3802 TA-3: fold state at its edges", () => {
  const memory = (initial) => {
    const map = new Map(initial === undefined ? [] : [[NAV_FOLD_STORAGE_KEY, initial]]);
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
  };
  const LABELS = APPROVED_LABELS.filter(Boolean);

  it("anything stored that is not a list of names reads as nothing folded", () => {
    const junk = ["", " ", "null", "true", "0", "42", '"Money"', "{}", '{"0":"Money","length":1}', '{"__proto__":["Money"]}', "[", "[[\"Money\"]]", "[null,1,true,{},[]]", "undefined", "NaN", "<html>", "\u0000"];
    for (const raw of junk) assert.deepEqual(readFoldedGroups(memory(raw)), [], JSON.stringify(raw));
    // getItem that answers with something other than text
    for (const value of [0, 1, true, {}, [], ["Money"], undefined, Symbol("x")]) {
      assert.deepEqual(readFoldedGroups({ getItem: () => value }), [], String(value));
    }
  });

  it("names are kept once each, blanks dropped, and everything else in the list ignored", () => {
    assert.deepEqual(readFoldedGroups(memory('["Money","Money",""," ",null,7,"Growth",{"label":"System"}]')), ["Money", " ", "Growth"]);
    // A name that is no longer a group is harmless: it folds nothing.
    for (const g of NAV_GROUPS) assert.equal(isGroupOpen(g, ["Help", "Team", " "], "overview"), true, String(g.label));
  });

  it("storage that throws on every call, or is missing, never throws out of these functions", () => {
    const hostile = [
      null,
      undefined,
      {},
      { getItem: null, setItem: null },
      { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } },
      new Proxy({}, { get() { throw new Error("no property may be read"); } }),
    ];
    for (const storage of hostile) {
      assert.deepEqual(readFoldedGroups(storage), []);
      assert.equal(writeFoldedGroups(storage, ["Money"]), false);
    }
  });

  it("a value that cannot be written down is refused, not thrown", () => {
    const store = memory();
    const circular = [];
    circular.push(circular);
    assert.equal(writeFoldedGroups(store, circular), false);
    assert.equal(writeFoldedGroups(store, [10n]), false);
    assert.equal(store.map.size, 0, "nothing half-written");
  });

  it("the browser's own storage being blocked reads as no storage", () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
      assert.equal(browserStorage(), null);
      assert.deepEqual(readFoldedGroups(browserStorage()), []);
      assert.equal(writeFoldedGroups(browserStorage(), ["Money"]), false);
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { return undefined; } });
      assert.equal(browserStorage(), null);
    } finally {
      if (had) Object.defineProperty(globalThis, "localStorage", had);
      else delete globalThis.localStorage;
    }
  });

  it("every set of folded groups survives being stored and read back", () => {
    for (let mask = 0; mask < 1 << LABELS.length; mask++) {
      const folded = LABELS.filter((_, i) => mask & (1 << i));
      const store = memory();
      assert.equal(writeFoldedGroups(store, folded), true);
      assert.deepEqual(readFoldedGroups(store), folded);
      for (const g of NAV_GROUPS) {
        const expected = g.label === null ? true : !folded.includes(g.label);
        assert.equal(isGroupOpen(g, readFoldedGroups(store), "no-such-page"), expected, `${g.label} with ${folded.join(",")}`);
      }
    }
  });

  it("the group holding the page you are on is open whatever was stored, for every page", () => {
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        assert.equal(isGroupOpen(g, LABELS, item.id), true, item.id);
        for (const other of NAV_GROUPS.filter((x) => x !== g && x.label !== null)) {
          assert.equal(isGroupOpen(other, LABELS, item.id), false, `${other.label} must stay folded on ${item.id}`);
        }
      }
    }
  });

  it("isGroupOpen with broken arguments answers, and never says a labelled group is folded by accident", () => {
    const money = NAV_GROUPS.find((g) => g.label === "Money");
    for (const folded of [null, undefined, "Money", { 0: "Money", length: 1 }, 7, new Set(["Money"])]) {
      assert.equal(isGroupOpen(money, folded, "overview"), true, `folded=${String(folded)} is not a list, so nothing is folded`);
    }
    for (const group of [null, undefined, {}, { label: "" }, { label: 7, items: [] }, { label: null }]) {
      assert.equal(isGroupOpen(group, ["Money", ""], "overview"), true);
    }
    assert.equal(isGroupOpen({ label: "Money" }, ["Money"], "pricing"), false, "a group with no items holds no page");
    assert.equal(isGroupOpen(money, ["Money"], undefined), false);
    assert.equal(isGroupOpen(money, ["money"], "overview"), true, "names are matched exactly");
  });

  it("toggling twice is where you started, and the list handed in is never changed", () => {
    for (const label of LABELS) {
      const start = Object.freeze(["Growth", "System"]);
      const once = toggleFoldedGroup(start, label);
      const twice = toggleFoldedGroup(once, label);
      assert.deepEqual([...twice].sort(), [...start].sort(), label);
      assert.notEqual(once, start);
    }
    assert.deepEqual(toggleFoldedGroup(["Money", "Money"], "Money"), [], "a doubled name is removed whole");
  });
});

describe("#3802 TA-4: the breadcrumb at its edges", () => {
  it("every page: the last item is the page's own title, the first its group, and none is a control", () => {
    const admin = { email: "a@example.test", role: "admin", status: "active", areas: ["admin_console", "crm", "beta_leads"] };
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        const title = pageTitle(item.id, admin, NAV_ITEMS);
        const trail = breadcrumbFor(item.id, title, NAV_GROUPS);
        assert.equal(trail.at(-1).label, item.label, item.id);
        assert.equal(trail.length, g.label === null ? 1 : 2, item.id);
        if (g.label !== null) assert.equal(trail[0].label, g.label, item.id);
        for (const crumb of trail) assert.deepEqual(Object.keys(crumb), ["label"], `${item.id}: a crumb carries words only`);
      }
    }
  });

  it("a role home reads its own name for each role, alone", () => {
    for (const [role, title] of Object.entries(ROLE_HOME_TITLES)) {
      const who = { email: `${role}@example.test`, role, status: "active", areas: ["role_home"] };
      assert.deepEqual(breadcrumbFor("home", pageTitle("home", who, NAV_ITEMS), NAV_GROUPS), [{ label: title }]);
    }
  });

  it("hostile ids and broken menus give the title alone and never throw", () => {
    for (const id of [null, undefined, "", "__proto__", "constructor", "Pipeline", "overview ", 7, {}, []]) {
      assert.deepEqual(breadcrumbFor(id, "Somewhere", NAV_GROUPS), [{ label: "Somewhere" }], String(id));
    }
    // (A menu holding a null group is not in this list: breadcrumbFor reads g.items
    // on it and throws. The menu is a constant, so it cannot happen in the app; it
    // is reported on #3802 as a note rather than pinned here.)
    for (const menu of [null, undefined, "x", 7, {}, [], [{}], [{ label: "A" }], [{ label: "A", items: null }], [{ label: "", items: [{ id: "x" }] }], [{ label: 5, items: [{ id: "x" }] }]]) {
      assert.deepEqual(breadcrumbFor("x", "X", menu), [{ label: "X" }], JSON.stringify(menu));
    }
    assert.deepEqual(breadcrumbFor("overview", undefined, NAV_GROUPS), [{ label: undefined }]);
  });

  it("building a breadcrumb never changes the menu", () => {
    const before = JSON.stringify(NAV_GROUPS);
    for (const id of KNOWN) breadcrumbFor(id, "T", NAV_GROUPS);
    assert.equal(JSON.stringify(NAV_GROUPS), before);
  });

  it("the header hands the breadcrumb no way to navigate, and draws a group as text", () => {
    assert.equal(/onNavigate|homeId|onTabChange/.test(HEADER), false, "the header no longer navigates");
    assert.equal(/onClick/.test(read("lib/shellNav.js")), false);
    // A crumb with no onClick is a <span>; only one WITH onClick is a button.
    assert.match(CRUMBS, /item\.onClick \? \(\s*<button/);
    assert.match(CRUMBS, /aria-current="page"/);
  });
});

describe("#3802 TA-5: stacking, computed from the stylesheet", () => {
  const z = (name) => {
    const m = CSS.match(new RegExp(`--z-${name}:\\s*(\\d+);`));
    assert.ok(m, `--z-${name} must be a plain number`);
    return Number(m[1]);
  };
  // Work out the number a CSS z-index expression in the shell stands for.
  const valueOf = (expr) => {
    const calc = expr.match(/^calc\(var\(--z-([a-z]+)\) \+ (\d+)\)$/);
    if (calc) return z(calc[1]) + Number(calc[2]);
    const plain = expr.match(/^var\(--z-([a-z]+)\)$/);
    assert.ok(plain, `the shell may only stack with a --z-* token, found: ${expr}`);
    return z(plain[1]);
  };

  it("every stacking number the shell sets is a token, and the highest is under the lowest board layer", () => {
    const used = [];
    for (const [name, code] of Object.entries({ SIDEBAR, HEADER, SHELL })) {
      for (const m of code.matchAll(/zIndex:\s*"([^"]+)"/g)) used.push([name, valueOf(m[1])]);
      assert.equal(/zIndex:\s*[^"\s]/.test(code), false, `${name}: a stacking value that is not a quoted token`);
      assert.equal(/(?:^|[\s"'`])-?z-(?:\d|\[)/.test(code), false, `${name}: a z-* class`);
    }
    assert.ok(used.length >= 3, "the header, the phone menu and its backdrop each set one");
    const highest = Math.max(...used.map(([, n]) => n));
    const lowestLayer = Math.min(...Object.values(CRM_LAYER_Z));
    assert.ok(highest < lowestLayer, `shell reaches ${highest}; board layers start at ${lowestLayer}`);
    assert.ok(highest < z("modal"), "and under every modal");
    assert.ok(highest < z("toast"), "and under every toast");
  });

  it("the phone menu is above its own backdrop, and both are above the header", () => {
    const backdrop = SIDEBAR.match(/backdrop-blur-sm[\s\S]{0,200}?zIndex:\s*"([^"]+)"/);
    const drawer = SIDEBAR.match(/zIndex:\s*"(calc\([^"]+\))"/);
    const header = HEADER.match(/zIndex:\s*"([^"]+)"/);
    assert.ok(backdrop && drawer && header);
    assert.ok(valueOf(drawer[1]) > valueOf(backdrop[1]));
    assert.ok(valueOf(backdrop[1]) > valueOf(header[1]));
  });

  it("the page header and the breadcrumb set no stacking at all", () => {
    for (const code of [PAGE_HEADER, CRUMBS]) assert.equal(/zIndex|(?:^|[\s"'`])z-(?:\d|\[)|\bsticky\b|\bfixed\b/.test(code), false);
  });
});

describe("#3802 TA-6: class names and tokens that silently do nothing", () => {
  const light = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf('[data-theme="dark"] {'));
  const dark = CSS.slice(CSS.indexOf('[data-theme="dark"] {'), CSS.indexOf("/* ─── Global Reset"));
  const defined = (scope) => new Set([...scope.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));

  it("no shell file uses a bare [--token]: in Tailwind v4 that is not a value and the rule is dropped", () => {
    for (const [name, code] of Object.entries(SHELL_FILES)) {
      const bare = code.match(/[a-z-]+-\[--[a-z0-9-]+\]/g) || [];
      assert.deepEqual(bare, [], `${name}: write [var(--token)]`);
    }
    // The two that were dropped silently before this change.
    assert.ok(SHELL.includes("max-w-[var(--content-max-width)]"));
    assert.ok(SHELL.includes("bg-[var(--color-background-secondary)]"));
  });

  it("every token a shell file reads is defined", () => {
    const all = defined(CSS);
    for (const [name, code] of Object.entries(SHELL_FILES)) {
      for (const m of code.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(all.has(m[1]), `${name} reads ${m[1]}, which globals.css does not define`);
    }
  });

  it("every --sidebar-* colour the menu reads has a value in BOTH themes, and no menu colour is written out", () => {
    const inLight = defined(light);
    const inDark = defined(dark);
    const readTokens = new Set([...SIDEBAR.matchAll(/var\((--sidebar-[a-z-]+)\)/g)].map((m) => m[1]));
    const colours = [...readTokens].filter((t) => !/width$/.test(t));
    assert.ok(colours.length >= 7);
    for (const t of colours) {
      assert.ok(inLight.has(t), `${t} has no light value`);
      assert.ok(inDark.has(t), `${t} has no dark value`);
    }
    // Every colour class with a written-out value in the menu is a --sidebar-* token.
    // The one exception is the dimming behind the phone menu, which is not the menu.
    const arbitrary = [...SIDEBAR.matchAll(/\b(?:hover:)?(?:bg|text|border|ring|fill|stroke|from|to)-\[([^\]]+)\]/g)].map((m) => m[1]);
    const notTokens = arbitrary.filter((v) => !/^var\(--sidebar-[a-z-]+\)$/.test(v) && !/^\d+(?:\.\d+)?px$/.test(v));
    assert.deepEqual(notTokens, ["rgba(0,0,0,0.5)"], "only the backdrop behind the phone menu may be a written-out colour");
    assert.equal(/\b(?:white|black)\/\d+/.test(SIDEBAR), false, "no white/10 or black/50 style colours");
    assert.equal(/var\(--(?:gray|color)-/.test(SIDEBAR), false, "the menu reads no general colour token directly");
  });

  it("the dark theme changes colours only: it does not move the frame", () => {
    for (const size of ["--header-height", "--sidebar-width", "--sidebar-collapsed-width", "--page-gutter", "--content-max-width"]) {
      assert.ok(defined(light).has(size), `${size} is set once, in :root`);
      assert.equal(defined(dark).has(size), false, `${size} must not differ between themes`);
    }
  });

  it("the phone gutter rule comes after :root, so it wins, and nothing else redefines the gutter", () => {
    const rootAt = CSS.indexOf("--page-gutter:   24px");
    const phoneAt = CSS.search(/@media \(max-width: 639px\) \{\s*:root \{\s*--page-gutter:\s*16px/);
    assert.ok(rootAt > 0 && phoneAt > rootAt);
    assert.equal((CSS.match(/--page-gutter:/g) || []).length, 2);
  });

  it("the retired menu tokens are read nowhere in the app", () => {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
        return /\.(jsx?|css)$/.test(e.name) ? [p] : [];
      });
    const offenders = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      // --sidebar-active was the old accent; --sidebar-active-bg is the new fill.
      if (/var\(--sidebar-active\)/.test(text)) offenders.push(path.relative(SRC, file));
      for (const m of text.matchAll(/var\((--sidebar-[a-z-]+)\)/g)) {
        if (!defined(CSS).has(m[1])) offenders.push(`${path.relative(SRC, file)}: ${m[1]}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("#3802 TA-7: the campaign stepper still fits beside the new menu and gutter", () => {
  const px = (name) => {
    const m = CSS.match(new RegExp(`--${name}:\\s*(\\d+)px;`));
    assert.ok(m, `--${name}`);
    return Number(m[1]);
  };
  // components/campaign-builder/stepperResponsive.js: the ten steps need about
  // 1,070 to 1,100px at full size. Its comment still does the sum with the old
  // 260px menu and 128px of page padding; this does it with the real tokens.
  const FULL_STEPPER_NEEDS_PX = 1100;

  it("at the width where the stepper stops being compact, the full stepper has room", () => {
    const available = COMPACT_BREAKPOINT_PX - px("sidebar-width") - 2 * px("page-gutter");
    assert.ok(available >= FULL_STEPPER_NEEDS_PX, `only ${available}px beside the menu at ${COMPACT_BREAKPOINT_PX}px`);
  });

  it("the page width cap never squeezes the full stepper on a wide screen", () => {
    assert.ok(px("content-max-width") - 2 * px("page-gutter") >= FULL_STEPPER_NEEDS_PX);
  });

  it("the new frame gives the page more room than the old one did, at every width", () => {
    // Old frame: 260px menu, and the comment's 128px of padding.
    assert.ok(px("sidebar-width") + 2 * px("page-gutter") <= 260 + 128);
    assert.ok(px("sidebar-collapsed-width") < px("sidebar-width"));
  });
});

describe("#3802 TA-8: the phone menu and sign out", () => {
  it("the closed phone menu cannot be reached: hidden from assistive tech AND inert", () => {
    assert.match(SIDEBAR, /aria-hidden=\{mobileOpen \? undefined : true\}/);
    assert.match(SIDEBAR, /inert=\{mobileOpen \? undefined : true\}/);
  });

  it("choosing a page always closes it, including the page you are already on", () => {
    // The close is in the click itself, not in an effect that waits for the page to change.
    const openPage = SIDEBAR.match(/const openPage = \(id\) => \{([\s\S]*?)\};/);
    assert.ok(openPage);
    assert.match(openPage[1], /onTabChange\(id\);/);
    assert.match(openPage[1], /onMobileClose\(\);/);
    assert.match(SIDEBAR, /onClick=\{\(\) => openPage\(item\.id\)\}/);
    assert.equal(/useEffect\(\(\) => \{\s*if \(mobileOpen\) \w+\(\);/.test(SIDEBAR), false, "no effect that closes the menu as soon as it opens");
  });

  it("Escape is listened for only while it is open, and the listener is taken off again", () => {
    const effect = SIDEBAR.match(/if \(!mobileOpen\) return undefined;([\s\S]*?)\}, \[mobileOpen, onMobileClose\]\);/);
    assert.ok(effect, "the Escape effect");
    assert.match(effect[1], /e\.key === "Escape"/);
    assert.match(effect[1], /addEventListener\("keydown", onKey\)/);
    assert.match(effect[1], /removeEventListener\("keydown", onKey\)/);
  });

  it("the backdrop and the close button both close it, and the close button has a name", () => {
    assert.equal((SIDEBAR.match(/onClick=\{onMobileClose\}/g) || []).length, 2);
    assert.match(SIDEBAR, /aria-label="Close menu"/);
  });

  it("a sign out that fails says so and gives the button back", () => {
    const handler = SIDEBAR.match(/const handleSignOut = async \(\) => \{([\s\S]*?)\n {2}\};/);
    assert.ok(handler);
    assert.match(handler[1], /setSigningOut\(true\);[\s\S]*await signOut\(\);/);
    assert.match(handler[1], /catch[\s\S]*addToast\(\{[\s\S]*variant: "error"[\s\S]*setSigningOut\(false\);/);
    assert.match(SIDEBAR, /disabled=\{signingOut\}/);
  });

  it("in the icon rail every page keeps its name for a screen reader and on hover", () => {
    assert.match(SIDEBAR, /const spokenLabel = waiting > 0 \? `\$\{item\.label\}, \$\{waiting\} waiting` : item\.label;/);
    assert.match(SIDEBAR, /aria-label=\{spokenLabel\}/);
    assert.match(SIDEBAR, /title=\{rail \? spokenLabel : undefined\}/);
    assert.match(SIDEBAR, /<span className=\{rail \? "sr-only" : "min-w-0 truncate"\}>\{item\.label\}<\/span>/);
    // The rail never hides a page behind a folded group it has no heading to open.
    assert.match(SIDEBAR, /const open = rail \|\| isGroupOpen\(group, foldedGroups, activeTab\);/);
  });

  it("the email in the footer can be cut short but is still readable in full", () => {
    assert.match(SIDEBAR, /className="block truncate[^"]*"\s*title=\{session\.user\.email\}/);
    assert.match(SIDEBAR, /<span className="min-w-0 leading-tight">/);
  });
});

describe("#3802 TA-9: nothing inside the shell adds a second frame", () => {
  const LATER = ["AgentPage", "PipelinePage", "BetaLeadsPage", "RoleHomePage", "TeamDashboardPage"];
  const DETAIL = ["OfferingDetailView", "VenueDetailView"];

  it("the pages moving later, and the detail views, draw no <main>, no full-screen box and no width token of their own", () => {
    for (const name of [...LATER, ...DETAIL]) {
      const code = stripComments(read(`pages/${name}.jsx`));
      assert.equal(/<main\b/.test(code), false, `${name}: a second <main>`);
      assert.equal(/\b(?:min-h-screen|h-screen|w-screen)\b/.test(code), false, `${name}: a full-screen box inside the shell`);
      assert.equal(/content-max-width|page-gutter|header-height|sidebar-width/.test(code), false, `${name}: reads a shell token`);
    }
  });

  it("no page anywhere draws a second <main> or reads the shell's size tokens", () => {
    const pages = fs.readdirSync(path.join(SRC, "pages")).filter((f) => f.endsWith(".jsx"));
    assert.ok(pages.length >= 35);
    for (const file of pages) {
      const code = stripComments(read(`pages/${file}`));
      assert.equal(/<main\b/.test(code), false, `${file}: a second <main>`);
      assert.equal(/var\(--(?:page-gutter|content-max-width|sidebar-width|sidebar-collapsed-width)\)/.test(code), false, `${file}: the frame belongs to the shell`);
    }
  });

  it("the one page header holds the only <h1> and can never push the page sideways", () => {
    assert.equal((PAGE_HEADER.match(/<h1\b/g) || []).length, 1);
    assert.match(PAGE_HEADER, /<header className="flex min-w-0 flex-col/);
    assert.match(PAGE_HEADER, /flex flex-wrap items-start justify-between/, "actions wrap under the title when there is no room");
    assert.match(PAGE_HEADER, /\{actions && <div className="flex flex-wrap /, "and wrap among themselves");
    assert.match(PAGE_HEADER, /break-words/, "a long title breaks instead of overflowing");
    assert.equal(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb)-\d|max-w-\[var|mx-auto/.test(PAGE_HEADER.match(/<header className="([^"]+)"/)[1]), false, "the header adds no outer space");
  });

  it("the shell's page area is the only scroller, and it cannot grow wider than the window", () => {
    assert.match(SHELL, /<div className="flex h-screen overflow-hidden /);
    assert.match(SHELL, /<div className="flex min-w-0 flex-1 flex-col overflow-hidden">/);
    assert.match(SHELL, /<main className="flex-1 overflow-y-auto">/);
    assert.match(SHELL, /className="w-full min-w-0 max-w-\[var\(--content-max-width\)\] p-\[var\(--page-gutter\)\]"/);
  });
});
