// Issue #4130 (Wave 0) — the admin menu, routing and access match the approved
// polish design, and the shared fixes later waves build on.
//
//   W0-1  the menu: nine groups, 26 pages, in the approved order; Needs you,
//         My agent and Guide are not menu entries
//   W0-2  every retired page id redirects to its new home, keeping its query
//   W0-3  every redirect lands on a real page and, for a hub, a real tab;
//         no retired id is still a page or a menu entry
//   W0-4  access: a merged page opens for the union of the pages it replaced,
//         never wider, and each tab only for whoever could open its old page
//   W0-5  a hosted page reads and writes its own query inside the hub address
//   W0-6  every page lights its own menu entry (#4130 Wave 6: Support and
//         Community are real pages; was: lit by the console's tab)
//   W0-7  the Work entry counts only this person's own waiting cards
//   W0-8  a stat card's trend is green when up, red when down, grey when level
//   W0-9  list export and sort cover every filtered row, with a stated cap;
//         a failed load is the shared LoadError with Retry
//
// Run: node --test src/__tests__/issue_4130_wave0_shell.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEADER_PAGE_ITEMS, NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import { AREA, PAGE_ACCESS_UNION, canOpenOwnPage, canOpenPage, visibleNavGroups } from "../lib/access.js";
import {
  PAGE_HUB_TABS,
  RETIRED_PAGE_REDIRECTS,
  hostedHash,
  hostedSearch,
  hubTabFromHash,
  hubTabHash,
  redirectHash,
} from "../lib/adminRoutes.js";
import { TREND_TONES, trendTone, trendUpFromDirection } from "../lib/trendTone.js";
import { CLIENT_SORT_ROW_CAP, EXPORT_ROW_CAP, fetchAllRows, sortRowsBy } from "../lib/listAll.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const APP = read("App.jsx");
function pageIds() {
  const block = APP.match(/const PAGES = \{([\s\S]*?)\n\};/);
  assert.ok(block, "App.jsx must define PAGES");
  return [...stripComments(block[1]).matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w]*))\s*:/gm)].map((m) => m[1] || m[2]);
}
const PAGE_IDS = pageIds();

// The approved sidebar (~/.mingla-private/4130 design, "sidebar").
const MENU = [
  ["Home", ["overview:Dashboard", "work-board:Work", "notifications:Notifications"]],
  ["Outreach", ["outreach:Hosts and creators", "inbound:Inbound leads", "content-calendar:Calendar", "team-dashboard:Team dashboard"]],
  ["Support", ["support:Support", "community:Community"]],
  ["Business", ["people:People", "brands:Brands", "business-offerings:Offerings"]],
  ["Money", ["mingla-money:Mingla money", "business-payments:Payments", "business-orders:Orders", "business-money-ledger:Money ledger", "refund-operations:Refund operations", "subscriptions:Subscriptions", "pricing:Pricing and limits"]],
  ["Explorer app", ["placepool:Place pool"]],
  ["Growth", ["ad-engine:Ads"]],
  ["Company", ["admin:Team and roles", "data-room:Data room"]],
  ["System", ["platform-health:Platform health", "feature-flags:Feature flags", "settings:Settings"]],
];

// The approved "Retired and merged" table, as the spec's redirect list.
const REDIRECTS = {
  drafts: ["work-board", undefined],
  users: ["people", "explorers"],
  "business-people": ["people", "hosts"],
  "business-brands": ["brands", "brands"],
  "brand-sites": ["brands", "websites"],
  "business-venues": ["brands", "venues"],
  claims: ["brands", "claims"],
  "beta-leads": ["inbound", "beta"],
  "tool-leads": ["inbound", "tools"],
  hosts: ["outreach", "hosts"],
  creators: ["outreach", "creators"],
  "launch-cities": ["placepool", "cities"],
  signals: ["placepool", "pipeline"],
  "deck-tuner": ["placepool", "deck-tuner"],
  "place-intelligence-trial": ["settings", "intelligence-trial"],
  "stripe-mode": ["platform-health", "stripe"],
  "api-health": ["platform-health", "providers"],
  "queue-health": ["platform-health", "queue"],
  careers: ["admin", "careers"],
  // #4130 Wave 6: Support and Community are real pages now; the old Email
  // page is Support's Email tab. #/community-support is redirected by its
  // tab (issue_4130_wave6_support_community.implementor.test.js).
  email: ["support", "email"],
};

const owner = { email: "o@example.test", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm", "beta_leads"] };
const admin = { email: "a@example.test", role: "admin", status: "active", areas: ["admin_console", "crm", "beta_leads"] };
const growth = { email: "g@example.test", role: "growth", status: "active", areas: ["role_home", "crm", "beta_leads"] };

describe("#4130 W0-1: the menu is the approved sidebar", () => {
  it("nine groups, 26 pages, labels and order exactly as approved", () => {
    assert.deepEqual(NAV_GROUPS.map((g) => g.label), MENU.map(([label]) => label));
    for (const [i, [label, items]] of MENU.entries()) {
      assert.deepEqual(NAV_GROUPS[i].items.map((it) => `${it.id}:${it.label}`), items, label);
    }
    assert.equal(NAV_ITEMS.length, 26);
  });
  it("Needs you, My agent and Guide are not menu entries; My agent and Guide keep their pages in the header", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    for (const gone of ["drafts", "agent", "guide"]) assert.equal(ids.includes(gone), false, gone);
    assert.deepEqual(HEADER_PAGE_ITEMS.map((i) => i.id), ["agent", "guide"]);
    for (const id of ["agent", "guide"]) assert.ok(PAGE_IDS.includes(id), `${id} keeps its route`);
    const header = stripComments(read("components/layout/Header.jsx"));
    assert.ok(header.includes('openPage("guide")') && header.includes('openPage("agent")'));
  });
  it("new pages with nothing to hold yet say they are coming, and show no numbers", () => {
    const hubs = stripComments(read("pages/shellHubs.jsx"));
    // #4130: Wave 2a built Mingla money, so it is no longer a placeholder.
    assert.ok(/"mingla-money": MinglaMoneyPage/.test(APP));
    assert.ok(/"feature-flags": FeatureFlagsPlaceholder/.test(APP));
    assert.equal((hubs.match(/Coming in this release/g) || []).length, 1, "one shared placeholder");
    const words = [...hubs.matchAll(/(?:title|description|coming)="([^"]*)"/g)].map((m) => m[1]);
    // #4130: one placeholder left (Feature flags) after Wave 2a.
    assert.ok(words.length >= 3);
    for (const w of words) assert.equal(/\d/.test(w), false, `no figures on a placeholder: ${w}`);
  });
});

describe("#4130 W0-2: retired page ids redirect to their new homes", () => {
  it("the map is exactly the approved one", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(RETIRED_PAGE_REDIRECTS).map(([id, t]) => [id, [t.page, t.tab]])),
      REDIRECTS
    );
  });
  it("each old address lands on its page and tab", () => {
    for (const [id, [page, tab]] of Object.entries(REDIRECTS)) {
      assert.equal(redirectHash(`#/${id}`), tab ? `#/${page}?tab=${tab}` : `#/${page}`, id);
    }
  });
  it("deep links keep every query value; a stale tab gives way to the new one", () => {
    assert.equal(redirectHash("#/business-venues?venueId=v1"), "#/brands?tab=venues&venueId=v1");
    assert.equal(redirectHash("#/users?userId=u1"), "#/people?tab=explorers&userId=u1");
    assert.equal(redirectHash("#/hosts?view=list&card=new"), "#/outreach?tab=hosts&view=list&card=new");
    assert.equal(redirectHash("#/careers?tab=roles&x=1"), "#/admin?tab=careers&x=1");
    assert.equal(redirectHash("#/drafts?record=r1"), "#/work-board?record=r1");
  });
  it("a live page, an unknown address or a hostile one is left alone", () => {
    for (const hash of ["#/overview", "#/support", "#/community?tab=roadmap", "#/people?tab=hosts", "#/brands", "", "#/", "#/__proto__", "#/constructor", "#/toString", "#/Hosts", null, undefined, 7]) {
      assert.equal(redirectHash(hash), null, String(hash));
    }
  });
  it("App rewrites the address through the map before any page is chosen", () => {
    const code = stripComments(APP);
    assert.ok(code.includes("const next = redirectHash(window.location.hash);"));
    assert.ok(code.includes("if (isRetiredPageId(page)) return true;"));
    const getTab = code.slice(code.indexOf("function getTabFromHash()"));
    assert.ok(getTab.indexOf("canonicalizeLegacyCommunityHashes();") < getTab.indexOf("requestedPageId()"));
  });
});

describe("#4130 W0-3: every redirect lands somewhere real", () => {
  it("each target is a page, and each target tab is one of its hub's tabs", () => {
    for (const [id, { page, tab }] of Object.entries(RETIRED_PAGE_REDIRECTS)) {
      assert.ok(PAGE_IDS.includes(page), `${id} -> ${page} is not a page`);
      if (tab && Object.hasOwn(PAGE_HUB_TABS, page)) {
        assert.ok(PAGE_HUB_TABS[page].some((t) => t.id === tab), `${id} -> ${page}?tab=${tab} is not a tab`);
      }
    }
  });
  it("no retired id is still a page or a menu entry", () => {
    for (const id of Object.keys(RETIRED_PAGE_REDIRECTS)) {
      if (id === "careers") continue; // a tab of Team and roles, whose id is "admin"
      assert.equal(PAGE_IDS.includes(id), false, `${id} is still a page`);
    }
    const menu = NAV_ITEMS.map((i) => i.id).filter((id) => Object.hasOwn(RETIRED_PAGE_REDIRECTS, id));
    // #4130 Wave 6: was ["support", "community"], the two console entries.
    assert.deepEqual(menu, []);
  });
  it("every page the old menu opened is still drawn by its own component, inside a hub tab", () => {
    const hubs = read("pages/shellHubs.jsx");
    for (const [hub, tabs] of Object.entries(PAGE_HUB_TABS)) {
      assert.ok(PAGE_IDS.includes(hub), hub);
      for (const t of tabs) assert.ok(new RegExp(`(?:"${t.hosts}"|\\b${t.hosts}): [A-Z]\\w+Page\\b`).test(hubs), `${hub}: ${t.hosts} has no component`);
    }
  });
});

describe("#4130 W0-4: access is the union of the replaced pages, never wider", () => {
  const AREAS = Object.values(AREA);
  const everyone = () => {
    const out = [];
    for (let mask = 0; mask < 1 << AREAS.length; mask++) {
      const areas = AREAS.filter((_, i) => mask & (1 << i));
      for (const role of ["owner", "admin", "growth", "partner"]) out.push({ email: "x@example.test", role, status: "active", areas });
    }
    return out;
  };
  it("the union lists and the hub tabs name the same old pages", () => {
    for (const [hub, tabs] of Object.entries(PAGE_HUB_TABS)) {
      assert.deepEqual([...PAGE_ACCESS_UNION[hub]].sort(), tabs.map((t) => t.hosts).sort(), hub);
    }
    assert.deepEqual(PAGE_ACCESS_UNION.support, ["community-support"]);
    assert.deepEqual(PAGE_ACCESS_UNION.community, ["community-support"]);
  });
  it("for every combination of areas, a merged page opens exactly when one of its old pages did", () => {
    for (const who of everyone()) {
      for (const [hub, olds] of Object.entries(PAGE_ACCESS_UNION)) {
        assert.equal(canOpenPage(who, hub), olds.some((old) => canOpenOwnPage(who, old)), `${who.role}/${who.areas.join("+")} ${hub}`);
      }
    }
  });
  it("Team and roles: the Team tab stays the owner's; an admin gets the Careers tab only", () => {
    assert.equal(canOpenOwnPage(admin, "admin"), false);
    assert.equal(canOpenOwnPage(admin, "careers"), true);
    assert.equal(canOpenPage(admin, "admin"), true);
    assert.equal(canOpenPage(growth, "admin"), false);
    const hub = stripComments(read("components/layout/PageHub.jsx"));
    assert.ok(hub.includes("canOpenOwnPage(access, tab.hosts)"), "a hub shows a tab only to whoever could open its old page");
  });
  it("the two non-admin roles see Home, Work, Hosts and creators, Inbound leads and Calendar", () => {
    const ids = visibleNavGroups(NAV_GROUPS, growth).flatMap((g) => g.items.map((i) => i.id));
    assert.deepEqual(ids, ["home", "work-board", "outreach", "inbound", "content-calendar"]);
    assert.equal(canOpenOwnPage(growth, "tool-leads"), false, "Web tool leads stays admin-only inside Inbound leads");
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, owner).flatMap((g) => g.items.map((i) => i.id)), NAV_ITEMS.map((i) => i.id));
  });
});

describe("#4130 W0-5: a hosted page keeps its own address inside the hub", () => {
  const alias = { page: "outreach", tab: "hosts", hosts: "hosts" };
  it("reads its query without the hub's tab, from the hub address or its old one", () => {
    assert.equal(hostedSearch("#/outreach?tab=hosts&view=list&card=c1", alias), "view=list&card=c1");
    assert.equal(hostedSearch("#/hosts?card=c1", alias), "card=c1");
    assert.equal(hostedSearch("#/people?tab=hosts", alias), null);
  });
  it("writes its query inside the hub address", () => {
    assert.equal(hostedHash(alias, "view=list"), "#/outreach?tab=hosts&view=list");
    assert.equal(hostedHash(alias, ""), "#/outreach?tab=hosts");
  });
  it("the hub reads its tab from its own address or an old one that redirects into it", () => {
    assert.equal(hubTabFromHash("#/brands?tab=venues&venueId=1", "brands"), "venues");
    assert.equal(hubTabFromHash("#/business-venues?venueId=1", "brands"), "venues");
    assert.equal(hubTabFromHash("#/people?tab=hosts", "brands"), "");
    assert.equal(hubTabHash("people", "hosts"), "#/people?tab=hosts");
  });
  it("useHashQuery uses the hub address while hosted, and the page's own otherwise", () => {
    const hook = stripComments(read("hooks/useHashQuery.js"));
    assert.ok(hook.includes("useContext(HostedPageContext)"));
    assert.ok(hook.includes("hostedHash({ page: aliasPage, tab: aliasTab, hosts: pageId }, value)"));
    assert.ok(hook.includes("`#/${pageId}${value ? `?${value}` : \"\"}`"));
  });
});

// #4130 Wave 6: was "Support and Community light up by the console's tab";
// they are real pages now, so every page lights its own entry.
describe("#4130 W0-6: every page lights its own menu entry", () => {
  it("the shell titles and lights the page on screen", () => {
    const shell = stripComments(read("components/layout/AppShell.jsx"));
    assert.ok(shell.includes("pageTitle(activeTab, access, [...NAV_ITEMS, ...HEADER_PAGE_ITEMS])"));
    assert.equal(shell.includes("activeMenuId"), false);
    assert.ok(NAV_ITEMS.some((i) => i.id === "support") && NAV_ITEMS.some((i) => i.id === "community"));
    assert.ok(PAGE_IDS.includes("support") && PAGE_IDS.includes("community"));
  });
});

describe("#4130 W0-7: the Work entry counts only your own waiting cards", () => {
  it("the badge sits on Work and reads cards, not drafts", () => {
    const sidebar = stripComments(read("components/layout/Sidebar.jsx"));
    assert.ok(sidebar.includes('const waiting = item.id === "work-board" ? reviewCount.cards : 0;'));
    assert.equal(sidebar.includes('item.id === "drafts"'), false);
    const hook = stripComments(read("hooks/useReviewCount.js"));
    assert.ok(hook.includes("const cards = needsPerson + draftNeeded + wording;"));
    assert.ok(hook.includes('canOpenPage(access, "work-board")'));
    assert.ok(/needs_person_mine/.test(hook) && /draft_needed_mine/.test(hook) && /wording_mine/.test(hook), "only the _mine counts");
  });
});

describe("#4130 W0-8: a stat card's trend colour follows its direction", () => {
  it("up is green and rising, down is red and falling, anything else is grey and level", () => {
    assert.equal(trendTone(true), TREND_TONES.up);
    assert.equal(trendTone(false), TREND_TONES.down);
    for (const other of [undefined, null, 0, 1, "up", "true"]) assert.equal(trendTone(other), TREND_TONES.flat, String(other));
    assert.match(TREND_TONES.up.className, /success/);
    assert.match(TREND_TONES.down.className, /error/);
    assert.equal(/success|error/.test(TREND_TONES.flat.className), false);
  });
  it("the Dashboard's directions become trendUp", () => {
    assert.equal(trendUpFromDirection("up"), true);
    assert.equal(trendUpFromDirection("down"), false);
    assert.equal(trendUpFromDirection("flat"), undefined);
    assert.equal(trendUpFromDirection(undefined), undefined);
  });
  it("the card draws the tone, and the Dashboard passes the direction", () => {
    const card = stripComments(read("components/ui/Card.jsx"));
    assert.ok(card.includes("trendTone(trendUp).className"));
    assert.equal(/#ef4444"\s*\}|"text-\[#ef4444\]"/.test(card.slice(card.indexOf("export function StatCard"), card.indexOf("export function SectionCard"))), false);
    const overview = stripComments(read("pages/OverviewPage.jsx"));
    assert.ok(overview.includes("trendUp={trendUpFromDirection(trend?.direction)}"));
  });
});

describe("#4130 W0-9: export and sort cover every filtered row", () => {
  // A fake server: `total` rows, paged, counting its calls.
  const server = (total) => {
    const calls = [];
    const fetchPage = async ({ page, pageSize, search, filters }) => {
      calls.push({ page, pageSize, search, filters });
      const from = page * pageSize;
      const rows = Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => ({ id: from + i, n: (from + i) % 7 }));
      return { rows, total };
    };
    return { fetchPage, calls };
  };
  it("walks every page with the same search and filters", async () => {
    const s = server(1234);
    const all = await fetchAllRows(s.fetchPage, { search: "palm", filters: { status: "paid" } }, { pageSize: 500, cap: 5000 });
    assert.equal(all.rows.length, 1234);
    assert.equal(all.total, 1234);
    assert.equal(all.truncated, false);
    assert.deepEqual(s.calls.map((c) => c.page), [0, 1, 2]);
    for (const c of s.calls) assert.deepEqual([c.search, c.filters], ["palm", { status: "paid" }]);
  });
  it("stops at the cap and says so", async () => {
    const all = await fetchAllRows(server(12000).fetchPage, {}, { pageSize: 500, cap: EXPORT_ROW_CAP });
    assert.equal(all.rows.length, EXPORT_ROW_CAP);
    assert.equal(all.total, 12000);
    assert.equal(all.truncated, true);
  });
  it("an empty list is one request; a failed request throws instead of exporting a part", async () => {
    const s = server(0);
    assert.deepEqual(await fetchAllRows(s.fetchPage, {}), { rows: [], total: 0, truncated: false });
    assert.equal(s.calls.length, 1);
    let n = 0;
    const flaky = async ({ page, pageSize }) => {
      n += 1;
      if (page === 1) throw new Error("network");
      return { rows: Array.from({ length: pageSize }, (_, i) => ({ id: i })), total: pageSize * 3 };
    };
    await assert.rejects(fetchAllRows(flaky, {}, { pageSize: 10 }), /network/);
    assert.equal(n, 2);
  });
  it("sorts numbers as numbers, text in reading order, empty values last both ways", () => {
    const rows = [{ v: 10 }, { v: null }, { v: 2 }, { v: "" }, { v: 33 }];
    assert.deepEqual(sortRowsBy(rows, "v", "asc").map((r) => r.v), [2, 10, 33, null, ""]);
    assert.deepEqual(sortRowsBy(rows, "v", "desc").map((r) => r.v), [33, 10, 2, null, ""]);
    const names = [{ n: "Brand 10" }, { n: "brand 2" }, { n: "Alpha" }];
    assert.deepEqual(sortRowsBy(names, "n", "asc").map((r) => r.n), ["Alpha", "brand 2", "Brand 10"]);
    assert.deepEqual(sortRowsBy(rows, "v", null), rows, "no direction leaves the order alone");
    assert.notEqual(sortRowsBy(rows, "v", "asc"), rows, "never sorts the list it was given");
  });
  it("EntityListView exports and sorts the whole filtered list and uses the shared load error", () => {
    const view = stripComments(read("components/entity/EntityListView.jsx"));
    assert.ok(view.includes("{ cap: EXPORT_ROW_CAP }"));
    assert.ok(view.includes("{ cap: CLIENT_SORT_ROW_CAP }"));
    assert.ok(view.includes("exportCsv(csv.columns, out, csv.filename);"));
    assert.equal(view.includes("exportCsv(csv.columns, rows, csv.filename)"), false, "never just the page on screen");
    assert.ok(view.includes("Export all"));
    assert.ok(view.includes("if (sortKey && sortDir && !serverSort)"));
    assert.ok(view.includes('<LoadError title="Couldn\'t load this list" message={error} onRetry={load} />'));
    assert.ok(CLIENT_SORT_ROW_CAP > 0 && EXPORT_ROW_CAP >= CLIENT_SORT_ROW_CAP);
    for (const page of ["PeopleConsolePage.jsx", "BrandsConsolePage.jsx", "OfferingsConsolePage.jsx"]) {
      assert.ok(/fetchPage=\{\w+\}\s*serverSort/.test(read(`pages/${page}`)), `${page} sorts on its server`);
    }
  });
  it("LoadError says what failed and offers Retry", () => {
    const err = stripComments(read("components/ui/LoadError.jsx"));
    assert.ok(err.includes('role="alert"'));
    assert.ok(err.includes("Retry"));
    assert.ok(err.includes('variant="error"'));
  });
});
