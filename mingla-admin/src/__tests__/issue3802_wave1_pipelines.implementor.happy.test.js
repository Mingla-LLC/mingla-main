// Issue #3802 (Wave 1) — implementor suite for the Hosts and Creators boards.
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802, "one frame for every page, menu grouped by job").
// Changed here, and only this: P-7 pinned the OLD menu (a "Team" group
// appended last, Beta leads before Hosts). It now pins the approved one: Hosts
// and Creators lead the "Pipeline" group, which also holds Beta Leads, Tool
// Leads and the Team dashboard. Who sees what is asserted exactly as before.
//
//
//   P-1  one name, one key: the same twelve inputs the server suite uses (W1-4)
//   P-2  filters: search, ICP, region, Mine, and all of them together
//   P-3  the arrow on a card: never into Live, never into Lost or Passed
//   P-4  due dates: overdue, today, later, none
//   P-5  addresses: round trip, defaults left out, hostile values dropped
//   P-6  access: the boards follow the areas the server returned
//   P-7  the menu each role sees
//   P-8  source contracts: one caller of the server functions, no later-wave UI
//   P-9  the route gate still never mounts a refused page
//   P-10 server answers are shown in plain words, never raw
//   P-11 moves the screen stops before asking the server
//   P-12 duplicates while typing, by-region counts, owners, list order
//
// Fails-on-revert is recorded on the issue for P-1 (crmModel.nameKey), P-3
// (crmModel.nextStage), P-6 (PAGE_AREA_OVERRIDES in access.js) and P-8 (the
// single file that calls the server functions).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS } from "../lib/constants.js";
import { AREA, PAGE_AREA_OVERRIDES, areaForPage, canOpenPage, resolveRoute, visibleNavGroups } from "../lib/access.js";
import {
  MOVE_BLOCK_COPY,
  NO_REGION,
  byRegionTable,
  displayName,
  displayOwners,
  dueState,
  errorCopy,
  errorWords,
  filterRecords,
  findDuplicates,
  groupByStage,
  moveBlocker,
  nameKey,
  nextStage,
  parseServerError,
  regionSlug,
  sortForList,
  stageBadgeVariant,
  stageNeedsSignedAgreement,
} from "../lib/crmModel.js";
import {
  EMPTY_CRM_STATE,
  buildCrmHash,
  buildCrmSearch,
  cleanCrmState,
  hashPageId,
  parseCrmHash,
  parseCrmSearch,
} from "../lib/crmUrl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
    return /\.(js|jsx)$/.test(e.name) ? [full] : [];
  });

const APP_JSX = read("App.jsx");
const SERVICE = read("services/crmService.js");
const PAGE = read("pages/PipelinePage.jsx");
const TOAST = read("components/ui/Toast.jsx");
const TOAST_CONTEXT = read("context/ToastContext.jsx");
const AUDIT_LOG_SRC = read("lib/auditLog.js");

// The stage and ICP lists exactly as the server's crm_pipeline_def() returns them.
const HOSTS = {
  id: "hosts",
  label: "Hosts",
  singular: "host",
  stages: [
    { id: "prospect", label: "Prospect", hint: "Not contacted yet" },
    { id: "contacted", label: "Contacted", hint: "First message sent" },
    { id: "replied", label: "Replied", hint: "They answered" },
    { id: "meeting", label: "Meeting", hint: "Call or visit booked" },
    { id: "onboarded", label: "Onboarded", hint: "Has a Mingla account" },
    { id: "live", label: "Live", hint: "Has a public listing", auto: true },
    { id: "lost", label: "Lost", hint: "Not now, with a reason", terminal: true },
  ],
  icps: [
    { id: "restaurant_bar", label: "Restaurant or bar" },
    { id: "event_organizer", label: "Event organizer" },
  ],
};
const CREATORS = {
  id: "creators",
  label: "Creators",
  singular: "creator",
  stages: [
    { id: "identified", label: "Identified", hint: "Not contacted yet" },
    { id: "contacted", label: "Contacted", hint: "First message sent" },
    { id: "replied", label: "Replied", hint: "They answered" },
    { id: "negotiating", label: "Negotiating", hint: "Talking terms" },
    { id: "booked", label: "Booked", hint: "Agreement signed" },
    { id: "posted", label: "Posted", hint: "First post is up" },
    { id: "passed", label: "Passed", hint: "Not now, with a reason", terminal: true },
  ],
  icps: [{ id: "ambassador", label: "Ambassador" }],
};
const REGIONS = [
  { id: "r-lagos", name: "Lagos", is_live: true },
  { id: "r-ny", name: "New York", is_live: true },
  { id: "r-chi", name: "Chicago", is_live: false },
];
const TEAM = [
  { email: "seth@test.local", display_name: "Seth", role: "owner", status: "active" },
  { email: "tunde@test.local", display_name: "Tunde", role: "growth", status: "active" },
  { email: "maya@test.local", display_name: "Maya", role: "partner", status: "active" },
];
const rec = (over) => ({
  id: "x",
  pipeline: "hosts",
  name: "X",
  icp: null,
  region_id: null,
  stage: "prospect",
  owners: [],
  due_on: null,
  agreement: null,
  ...over,
});
const RECORDS = [
  rec({ id: "1", name: "Palm Court Kitchen", icp: "restaurant_bar", region_id: "r-lagos", stage: "prospect", owners: ["tunde@test.local"], due_on: "2026-10-10" }),
  rec({ id: "2", name: "Lagos Eats", icp: "event_organizer", region_id: "r-lagos", stage: "replied", owners: ["maya@test.local", "tunde@test.local"], due_on: "2026-10-12" }),
  rec({ id: "3", name: "Harbour Jazz", icp: "event_organizer", region_id: "r-ny", stage: "live", owners: ["seth@test.local"] }),
  rec({ id: "4", name: "No Region Bar", icp: "restaurant_bar", stage: "lost", owners: [], due_on: "2026-11-01" }),
];

// The area lists the server returns for each role after Wave 1's database
// change (admin_team_role_areas in migration 20270820003802).
const owner = { email: "o@test.local", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm", "beta_leads"] };
const admin = { email: "a@test.local", role: "admin", status: "active", areas: ["admin_console", "crm", "beta_leads"] };
const growth = { email: "g@test.local", role: "growth", status: "active", areas: ["role_home", "crm", "beta_leads"] };
const partner = { email: "p@test.local", role: "partner", status: "active", areas: ["role_home", "crm", "beta_leads"] };

function parsePageIds() {
  const m = APP_JSX.match(/const PAGES\s*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "expected to find `const PAGES = { ... }`");
  return [...m[1].matchAll(/^\s*"?([a-zA-Z][\w-]*)"?\s*:/gm)].map((mm) => mm[1]);
}
const PAGE_IDS = parsePageIds();

describe("#3802 P-1: one name, one key (the server suite's twelve inputs)", () => {
  // Shared verbatim with W1-4 in
  // supabase/migrations/__tests__/issue_3802_wave1_crm_pipelines.implementor.happy.pg17.test.sql
  const TABLE = [
    ["Palm Court Kitchen", "palmcourtkitchen"],
    ["palm-court kitchen", "palmcourtkitchen"],
    ["@PalmCourtKitchen", "palmcourtkitchen"],
    ["  PALM   COURT  KITCHEN ", "palmcourtkitchen"],
    ["Palm Court Kitchen.", "palmcourtkitchen"],
    ["Palm_Court/Kitchen!", "palmcourtkitchen"],
    ["Palm Court Kitchen 2", "palmcourtkitchen2"],
    ["@lagos.eats", "lagoseats"],
    ["Lagos Eats", "lagoseats"],
    ["100% Fun", "100fun"],
    ["!!!", "!!!"],
    ["A", "a"],
  ];
  it("gives the server's key for all twelve", () => {
    assert.equal(TABLE.length, 12);
    for (const [input, want] of TABLE) assert.equal(nameKey(input), want, `key of [${input}]`);
  });
  it("ignores characters nobody can see, and never throws", () => {
    assert.equal(nameKey("Palm\u200B Court\u00A0Kitchen\uFEFF"), "palmcourtkitchen");
    assert.equal(nameKey("Palm\u2028Court\u2029Kitchen"), "palmcourtkitchen");
    assert.equal(nameKey(""), "");
    assert.equal(nameKey(null), "");
    assert.equal(nameKey(undefined), "");
    assert.equal(nameKey(42), "");
  });
  it("the server's file still carries the same table", () => {
    const sql = fs.readFileSync(
      path.resolve(SRC, "../../supabase/migrations/__tests__/issue_3802_wave1_crm_pipelines.implementor.happy.pg17.test.sql"),
      "utf8"
    );
    for (const [input, want] of TABLE) {
      assert.ok(sql.includes(`('${input}',`), `server table lost the input [${input}]`);
      assert.ok(sql.includes(`'${want}')`), `server table lost the key [${want}]`);
    }
  });
});

describe("#3802 P-2: filters", () => {
  const ids = (f) => filterRecords(RECORDS, f).map((r) => r.id);
  it("no filter returns everything", () => {
    assert.deepEqual(ids({}), ["1", "2", "3", "4"]);
    assert.deepEqual(ids(), ["1", "2", "3", "4"]);
  });
  it("search matches part of a name, in any case and spacing", () => {
    assert.deepEqual(ids({ q: "palm" }), ["1"]);
    assert.deepEqual(ids({ q: "  LAGOS " }), ["2"]);
    assert.deepEqual(ids({ q: "palmcourt" }), ["1"]);
    assert.deepEqual(ids({ q: "nothing like it" }), []);
  });
  it("ICP, region and Mine each narrow the list", () => {
    assert.deepEqual(ids({ icp: "event_organizer" }), ["2", "3"]);
    assert.deepEqual(ids({ regionId: "r-lagos" }), ["1", "2"]);
    assert.deepEqual(ids({ regionId: NO_REGION }), ["4"]);
    assert.deepEqual(ids({ mine: true, me: "tunde@test.local" }), ["1", "2"]);
    assert.deepEqual(ids({ mine: true, me: "nobody@test.local" }), []);
    assert.deepEqual(ids({ mine: true, me: "" }), []);
  });
  it("combined filters all apply", () => {
    assert.deepEqual(ids({ q: "eats", icp: "event_organizer", regionId: "r-lagos", mine: true, me: "maya@test.local" }), ["2"]);
    assert.deepEqual(ids({ icp: "event_organizer", regionId: "r-lagos", mine: true, me: "seth@test.local" }), []);
  });
  it("odd input is an empty list, not a crash", () => {
    assert.deepEqual(filterRecords(null, {}), []);
    assert.deepEqual(filterRecords(undefined), []);
  });
});

describe("#3802 P-3: the arrow on a card", () => {
  const next = (def, stage) => nextStage(def, rec({ stage }))?.id ?? null;
  it("hosts: step by step up to Onboarded, then no arrow", () => {
    assert.equal(next(HOSTS, "prospect"), "contacted");
    assert.equal(next(HOSTS, "contacted"), "replied");
    assert.equal(next(HOSTS, "replied"), "meeting");
    assert.equal(next(HOSTS, "meeting"), "onboarded");
    assert.equal(next(HOSTS, "onboarded"), null, "Live sets itself: no arrow into it");
    assert.equal(next(HOSTS, "live"), null, "the next stage is Lost, which asks for a reason");
    assert.equal(next(HOSTS, "lost"), null, "a closed record has no arrow");
  });
  it("creators: step by step up to Posted, never into Passed", () => {
    assert.equal(next(CREATORS, "identified"), "contacted");
    assert.equal(next(CREATORS, "negotiating"), "booked");
    assert.equal(next(CREATORS, "booked"), "posted");
    assert.equal(next(CREATORS, "posted"), null);
    assert.equal(next(CREATORS, "passed"), null);
  });
  it("an unknown stage or a missing definition gives no arrow", () => {
    assert.equal(next(HOSTS, "not-a-stage"), null);
    assert.equal(nextStage(null, rec({})), null);
    assert.equal(nextStage(HOSTS, null), null);
  });
  it("no arrow ever points at a stage that sets itself or closes the record", () => {
    for (const def of [HOSTS, CREATORS]) {
      for (const s of def.stages) {
        const n = nextStage(def, rec({ stage: s.id }));
        if (n) assert.ok(!n.auto && !n.terminal, `${def.id}/${s.id} points at ${n.id}`);
      }
    }
  });
});

describe("#3802 P-4: due dates", () => {
  it("the boundaries around today", () => {
    assert.equal(dueState("2026-10-11", "2026-10-12"), "overdue");
    assert.equal(dueState("2026-10-12", "2026-10-12"), "today");
    assert.equal(dueState("2026-10-13", "2026-10-12"), "later");
    assert.equal(dueState("2025-12-31", "2026-01-01"), "overdue");
    assert.equal(dueState("2026-01-01", "2025-12-31"), "later");
  });
  it("no date, or something that is not a date, is none", () => {
    for (const v of [null, undefined, "", "soon", "12/10/2026", 20261012]) assert.equal(dueState(v, "2026-10-12"), "none");
  });
});

describe("#3802 P-5: addresses", () => {
  const CARD = "5a1f0c3e-1111-4222-8333-444455556666";
  it("defaults are left out", () => {
    assert.equal(buildCrmHash("hosts", EMPTY_CRM_STATE), "#/hosts");
    assert.equal(buildCrmHash("creators", {}), "#/creators");
    assert.equal(buildCrmHash("hosts", { view: "board", mine: false, q: "" }), "#/hosts");
  });
  it("the spec's two examples", () => {
    assert.equal(buildCrmHash("hosts", { region: "lagos", icp: "event_organizer" }), "#/hosts?icp=event_organizer&region=lagos");
    assert.deepEqual(parseCrmHash("#/hosts?region=lagos&icp=event_organizer"), { ...EMPTY_CRM_STATE, region: "lagos", icp: "event_organizer" });
    assert.deepEqual(parseCrmHash(`#/creators?view=list&mine=1&card=${CARD}`), { ...EMPTY_CRM_STATE, view: "list", mine: true, card: CARD });
  });
  it("every combination round-trips", () => {
    const states = [
      { view: "list" },
      { view: "region", q: "palm court" },
      { q: "100% fun & more?", icp: "restaurant_bar" },
      { region: "new-york", mine: true },
      { card: "new" },
      { view: "list", q: "a", icp: "ugc_one_off", region: "none", mine: true, card: CARD },
    ];
    for (const s of states) {
      const full = { ...EMPTY_CRM_STATE, ...s };
      assert.deepEqual(parseCrmHash(buildCrmHash("hosts", full)), full, JSON.stringify(s));
      assert.deepEqual(parseCrmSearch(buildCrmSearch(full)), full, JSON.stringify(s));
    }
  });
  it("hostile and malformed values are dropped, never thrown", () => {
    const bad = [
      "#/hosts?view=__proto__&icp=__proto__",
      "#/hosts?view=grid",
      "#/hosts?__proto__=1&constructor=2&mine=yes",
      `#/hosts?q=${"x".repeat(81)}`,
      "#/hosts?icp=Restaurant%20Bar",
      "#/hosts?icp=<script>",
      "#/hosts?region=../../etc",
      "#/hosts?region=Lagos",
      "#/hosts?card=not-a-uuid",
      "#/hosts?card=javascript:alert(1)",
      "#/hosts?%E0%A4%A",
      "#/hosts?",
      "",
    ];
    for (const hash of bad) {
      const s = parseCrmHash(hash);
      assert.deepEqual(s, EMPTY_CRM_STATE, hash);
      assert.equal(Object.getPrototypeOf(s), Object.prototype);
    }
    for (const v of [null, undefined, 7, {}, []]) assert.deepEqual(parseCrmHash(v), EMPTY_CRM_STATE);
    assert.equal({}.polluted, undefined);
  });
  it("a hostile state cannot be written into an address either", () => {
    assert.equal(buildCrmHash("hosts", { view: "grid", icp: "A B", region: "x/y", card: "nope", q: "y".repeat(81) }), "#/hosts");
  });
  it("an ICP or region that names nothing real is dropped once the lists are known", () => {
    const lists = { icpIds: ["restaurant_bar"], regionSlugs: ["lagos", "none"] };
    assert.deepEqual(cleanCrmState({ icp: "ambassador", region: "atlantis", view: "list", q: "a" }, lists), { ...EMPTY_CRM_STATE, view: "list", q: "a" });
    assert.deepEqual(cleanCrmState({ icp: "restaurant_bar", region: "lagos" }, lists), { ...EMPTY_CRM_STATE, icp: "restaurant_bar", region: "lagos" });
  });
  it("the page id is the first path segment only", () => {
    assert.equal(hashPageId("#/hosts?card=new"), "hosts");
    assert.equal(hashPageId("#/creators/extra?x=1"), "creators");
    assert.equal(hashPageId(""), "");
  });
  it("region names become readable slugs", () => {
    assert.equal(regionSlug("Lagos"), "lagos");
    assert.equal(regionSlug("New York"), "new-york");
    assert.equal(regionSlug("Fort Lauderdale"), "fort-lauderdale");
    assert.equal(regionSlug("S\u00e3o Paulo"), "sao-paulo");
    assert.equal(regionSlug(null), "");
  });
});

describe("#3802 P-6: the boards follow the areas the server returned", () => {
  it("the two board pages are listed against the crm area, and nothing else changed", () => {
    assert.equal(AREA.CRM, "crm");
    assert.equal(PAGE_AREA_OVERRIDES.hosts, "crm");
    assert.equal(PAGE_AREA_OVERRIDES.creators, "crm");
    assert.equal(areaForPage("hosts"), "crm");
    assert.equal(areaForPage("creators"), "crm");
    assert.ok(PAGE_IDS.includes("hosts") && PAGE_IDS.includes("creators"));
  });
  it("Sales and marketing and Founding partner open the approved personal workflow pages", () => {
    for (const a of [growth, partner]) {
      const open = PAGE_IDS.filter((id) => canOpenPage(a, id));
      assert.deepEqual(open.sort(), ["agent", "beta-leads", "creators", "drafts", "home", "hosts"], a.role);
    }
  });
  it("a page nobody listed is still closed to them", () => {
    for (const a of [growth, partner]) {
      assert.equal(canOpenPage(a, "a-page-added-tomorrow"), false);
      assert.equal(canOpenPage(a, "team-dashboard"), false);
      assert.equal(canOpenPage(a, "admin"), false);
      assert.equal(canOpenPage(a, "business-payments"), false);
    }
    assert.equal(areaForPage("a-page-added-tomorrow"), AREA.ADMIN_CONSOLE);
  });
  it("owner and admin open the boards, and still every other page they could", () => {
    for (const id of PAGE_IDS) {
      if (id === "home") continue;
      assert.equal(canOpenPage(owner, id), true, `owner '${id}'`);
      assert.equal(canOpenPage(admin, id), id !== "admin", `admin '${id}'`);
    }
  });
  it("without the crm area, even an owner or admin does not open the boards", () => {
    const ownerBefore = { ...owner, areas: ["admin_console", "team_manage"] };
    const adminBefore = { ...admin, areas: ["admin_console"] };
    for (const a of [ownerBefore, adminBefore]) {
      assert.equal(canOpenPage(a, "hosts"), false);
      assert.equal(canOpenPage(a, "creators"), false);
      assert.equal(canOpenPage(a, "overview"), true);
    }
    assert.equal(canOpenPage({ ...growth, areas: ["role_home"] }, "hosts"), false);
  });
  it("an invited person, or no access at all, opens neither", () => {
    assert.equal(canOpenPage({ ...growth, status: "invited" }, "hosts"), false);
    assert.equal(canOpenPage(null, "creators"), false);
    assert.deepEqual(resolveRoute("hosts", { ...growth, areas: ["role_home"] }, PAGE_IDS), { pageId: "home", denied: true, requestedId: "hosts" });
    assert.deepEqual(resolveRoute("hosts", growth, PAGE_IDS), { pageId: "hosts", denied: false, requestedId: "hosts" });
  });
  it("Beta leads opens to the whole team through its own area, and nobody lands anywhere new", () => {
    assert.equal(Object.hasOwn(PAGE_AREA_OVERRIDES, "beta-leads"), true);
    assert.equal(PAGE_AREA_OVERRIDES["beta-leads"], "beta_leads");
    assert.equal(canOpenPage(growth, "beta-leads"), true);
    assert.deepEqual(Object.keys(PAGE_AREA_OVERRIDES).sort(), ["admin", "agent", "beta-leads", "creators", "drafts", "home", "hosts"]);
  });
});

describe("#3802 P-7: the menu each role sees", () => {
  const ids = (a) => visibleNavGroups(NAV_GROUPS, a).flatMap((g) => g.items).map((i) => i.id);
  it("Sales and marketing and Founding partner see the approved workflow pages", () => {
    assert.deepEqual(ids(growth), ["home", "hosts", "creators", "drafts", "beta-leads", "agent"]);
    assert.deepEqual(ids(partner), ["home", "hosts", "creators", "drafts", "beta-leads", "agent"]);
  });
  it("owner and admin see the Pipeline group straight after the top of the menu", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: a "Team" group, second to last.
    for (const a of [owner, admin]) {
      const groups = visibleNavGroups(NAV_GROUPS, a);
      assert.equal(groups[0].label, null);
      const pipeline = groups[1];
      assert.equal(pipeline.label, "Pipeline");
      assert.deepEqual(pipeline.items.map((i) => `${i.id}:${i.label}:${i.icon}`), ["hosts:Hosts:Handshake", "creators:Creators:Sparkles", "drafts:Drafts to send:FileText", "beta-leads:Beta Leads:Inbox", "tool-leads:Tool Leads:Wrench", "team-dashboard:Team dashboard:BarChart3"]);
    }
    assert.ok(ids(owner).includes("admin"));
    assert.ok(!ids(admin).includes("admin"));
  });
  it("the group is in the one menu list, once, and its icons are ones the sidebar knows", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: "Team" is second to last, with Store.
    assert.equal(NAV_GROUPS.filter((g) => g.label === "Pipeline").length, 1);
    assert.equal(NAV_GROUPS[1].label, "Pipeline");
    const sidebar = read("components/layout/Sidebar.jsx");
    const map = sidebar.slice(sidebar.indexOf("ICON_MAP"));
    assert.ok(/\bHandshake\b/.test(map) && /\bSparkles\b/.test(map));
  });
});

describe("#3802 P-8: source contracts", () => {
  const files = walk(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));
  it("only crmService.js calls a crm_ server function", () => {
    const callers = files.filter((f) => /rpc\(\s*["'`]crm_/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(callers.map((f) => path.relative(SRC, f)), [path.join("services", "crmService.js")]);
  });
  it("crmService.js calls exactly nineteen of the twenty client functions (never bulk add)", () => {
    const called = [...SERVICE.matchAll(/rpc\(\s*"(crm_[a-z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(called, [
      "crm_beta_lead_to_host",
      "crm_beta_leads_list",
      "crm_config",
      "crm_contact_check",
      "crm_duplicate_check",
      "crm_home_summary",
      "crm_link_search",
      "crm_record_create",
      "crm_record_delete",
      "crm_record_get",
      "crm_record_log",
      "crm_record_move_stage",
      "crm_record_restore",
      "crm_record_set_owners",
      "crm_record_undo_stage_move",
      "crm_record_update",
      "crm_records_list",
      "crm_target_set",
      "crm_team_summary",
    ]);
    // Bulk add is for the agent connector (a later wave); the screen never calls it.
    assert.ok(!SERVICE.includes("crm_records_bulk_create"));
  });
  it("no file reads or writes a pipeline table directly", () => {
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      assert.ok(!/from\(\s*["'`]crm_/.test(src), `${path.relative(SRC, f)} touches a crm_ table`);
    }
  });
  it("the page and the board components never import the Supabase client", () => {
    assert.ok(!/from\s+["'][^"']*lib\/supabase["']/.test(PAGE));
    assert.ok(!PAGE.includes("supabase"));
    for (const f of walk(path.join(SRC, "components", "crm"))) {
      assert.ok(!/lib\/supabase/.test(fs.readFileSync(f, "utf8")), path.relative(SRC, f));
    }
    for (const rel of ["lib/crmModel.js", "lib/crmUrl.js"]) {
      const src = read(rel);
      assert.ok(!/^import\s/m.test(src), `${rel} must stay a pure module with no imports`);
    }
  });
  it("a write never goes out while offline, and every failure is turned into a token", () => {
    assert.ok(/navigator\.onLine === false\)\s*\{\s*throw new CrmError\(\{ token: "network"/.test(SERVICE));
    assert.ok(SERVICE.includes("throw new CrmError(parseServerError(err))"));
    assert.ok(SERVICE.includes("throw new CrmError(parsed)"));
  });
  it("create and log always carry a request key", () => {
    assert.ok(/crm_record_create[\s\S]{0,160}p_request_key: requestKey \|\| newRequestKey\(\)/.test(SERVICE));
    assert.ok(/crm_record_log[\s\S]{0,160}p_request_key: requestKey \|\| newRequestKey\(\)/.test(SERVICE));
  });
  it("a toast can carry an action and its own lifetime", () => {
    assert.ok(TOAST.includes("toast.action?.label"));
    assert.ok(TOAST.includes("toast.action.onClick?.()"));
    assert.ok(TOAST.includes("onDismiss(toast.id)"));
    assert.ok(TOAST_CONTEXT.includes("{ variant = \"info\", title, description, action, duration }"));
    assert.ok(/typeof duration === "number" && duration > 0 \? duration : AUTO_DISMISS_MS\[variant\]/.test(TOAST_CONTEXT));
  });
  it("nothing from a later wave is on these screens", () => {
    const banned = ["Ask your agent", "Drafts to send", "Draft, not sent", "@mention", "mention", "will get an email", "Getting started", "by agent"];
    const sources = [PAGE, ...walk(path.join(SRC, "components", "crm")).map((f) => fs.readFileSync(f, "utf8"))];
    for (const src of sources) for (const word of banned) assert.ok(!src.includes(word), `found "${word}"`);
  });
  it("Lost and Passed ask for the reason before anything moves", () => {
    const at = PAGE.indexOf("setReasonFor({ record, to });");
    assert.ok(at > 0);
    assert.ok(/if \(stageDef\(def, to\)\?\.terminal\) \{[\s\S]{0,160}setReasonFor\(\{ record, to \}\);\s*return;/.test(PAGE));
    const prompt = read("components/crm/ReasonPrompt.jsx");
    assert.ok(prompt.includes("Why is this lost?") && prompt.includes("Why did we pass?"));
    assert.ok(prompt.includes("disabled={!trimmed}"));
  });
  it("Undo after an add is offered only to people who may delete", () => {
    assert.ok(/action: canDelete\s*\? \{ label: "Undo", onClick: \(\) => handleDelete\(record\) \}\s*: \{ label: "Open"/.test(PAGE));
    assert.ok(PAGE.includes("const canDelete = !!config?.me?.can_delete;"));
  });
  it("the pipeline actions have plain-English labels in the activity list", () => {
    for (const [action, label] of Object.entries({
      "crm.record_create": "Added a host or creator",
      "crm.record_update": "Edited a host or creator",
      "crm.stage_move": "Moved a card",
      "crm.stage_undo": "Undid a move",
      "crm.stage_auto_live": "A host went live",
      "crm.owners_set": "Changed owners",
      "crm.log_add": "Logged activity",
      "crm.record_delete": "Deleted a host or creator",
      "crm.record_restore": "Restored a host or creator",
      "crm.bulk_create": "Added records in bulk",
    })) {
      assert.ok(AUDIT_LOG_SRC.includes(`"${action}": "${label}"`), action);
    }
  });
});

describe("#3802 P-9: the route gate still never mounts a refused page", () => {
  it("the page shown is chosen from the resolved route, not from the address", () => {
    assert.ok(APP_JSX.includes("const ActivePage = PAGES[route.pageId];"));
    assert.ok(APP_JSX.includes("? resolveRoute(nav.requested, access, PAGE_IDS)"));
    assert.equal((APP_JSX.match(/<ActivePage\b/g) || []).length, 1);
    assert.ok(!/PAGES\[nav\.requested\]|PAGES\[requestedPageId\(\)\]/.test(APP_JSX.replace(/PAGES\[hash\] \? hash/, "")));
  });
  it("the address is read by its first segment, so a board's filters survive the guard", () => {
    assert.ok(APP_JSX.includes('window.location.hash.replace("#/", "").split("?")[0].split("/")[0]'));
    assert.ok(APP_JSX.includes("if (requestedPageId() !== route.pageId) {"));
  });
  it("the two board pages are registered once each", () => {
    assert.equal(PAGE_IDS.filter((id) => id === "hosts").length, 1);
    assert.equal(PAGE_IDS.filter((id) => id === "creators").length, 1);
    assert.ok(APP_JSX.includes('import { HostsPage, CreatorsPage } from "./pages/PipelinePage";'));
  });
});

describe("#3802 P-10: server answers are shown in plain words", () => {
  it("a function's own refusal keeps its token and words", () => {
    const e = parseServerError({ code: "22023", message: "reason_required: Add one line saying why, so the next person knows.", details: null });
    assert.deepEqual(e, { token: "reason_required", message: "Add one line saying why, so the next person knows.", detail: "" });
    assert.equal(errorCopy(e.token, e.message), "Add one line saying why, so the next person knows.");
  });
  it("try_again is recognised by its token, whatever code it arrives with", () => {
    for (const code of ["40001", "22023", "", undefined]) {
      const e = parseServerError({ code, message: "try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again." });
      assert.equal(e.token, "try_again");
      assert.ok(!errorCopy(e.token, e.message).includes("request"));
    }
  });
  it("the tokens the merged server contract added are covered", () => {
    const undo = "This host is no longer linked to a brand with a public listing, so it cannot go back to Live. Move the card to Onboarded by hand; Live sets itself once the linked brand has a public listing.";
    assert.equal(errorCopy("undo_not_live", undo), undo);
    assert.equal(errorCopy("agreement_required", "Mark the agreement as signed before moving to Posted."), "Mark the agreement as signed before moving to Posted.");
    assert.equal(errorCopy("undo_expired", "That move can no longer be undone. Move the card back by hand."), "That move can no longer be undone. Move the card back by hand.");
    const dup = parseServerError({ code: "22023", message: 'duplicate_name: "Palm Court Kitchen" is already in Hosts. Open it instead.', details: "5a1f0c3e-1111-4222-8333-444455556666" });
    assert.equal(dup.token, "duplicate_name");
    assert.equal(dup.detail, "5a1f0c3e-1111-4222-8333-444455556666");
  });
  it("messages written for a caller of the function never reach the screen", () => {
    const technical = [
      ["unknown_field", '"stage" cannot be changed here. Use crm_record_move_stage for stage and crm_record_set_owners for owners.'],
      ["unknown_owner", "x@y.z is not on the team. Use an address from crm_config().team."],
      ["invalid_brand", "That brand is not on Mingla, or was deleted. Pick one with crm_link_search('brand', name)."],
      ["invalid_region", "That region is not in the Launch Cities list. Use an id from crm_config().regions."],
      ["request_key_required", "Send a request key (8 to 80 letters, digits, - or _) so a repeat changes nothing."],
      ["invalid_due_on", "Send the date as YYYY-MM-DD, for example 2026-10-31."],
      ["invalid_icp", "x is not an ICP for hosts. Use one of: restaurant_bar."],
      ["invalid_stage", "x is not a stage of hosts. Use one of: prospect."],
    ];
    for (const [token, message] of technical) {
      const words = errorCopy(token, message);
      assert.ok(words.length > 10, token);
      assert.ok(!/crm_|\(\)|YYYY|request key|restaurant_bar|prospect\./.test(words), `${token}: ${words}`);
    }
  });
  it("anything that is not one of the functions' answers gets a calm line, never the raw text", () => {
    const raw = [
      { code: "PGRST202", message: "Could not find the function public.crm_config without parameters in the schema cache" },
      { code: "42883", message: "function public.crm_config() does not exist" },
      { code: "PGRST301", message: "JWT expired" },
      { code: "42501", message: "permission denied for function crm_config" },
      { code: "XX000", message: 'null value in column "x" violates not-null constraint' },
      { message: "TypeError: Failed to fetch" },
      new TypeError("Load failed"),
      { message: "upstream down" },
      null,
      undefined,
      "boom",
    ];
    for (const err of raw) {
      const words = errorWords(err);
      assert.ok(typeof words === "string" && words.length > 10);
      assert.ok(!/PGRST|JWT|schema cache|permission denied|violates|TypeError|fetch|upstream|boom|function/i.test(words), words);
    }
    assert.equal(parseServerError(raw[0]).token, "not_ready");
    assert.equal(parseServerError(raw[2]).token, "signed_out");
    assert.equal(parseServerError(raw[3]).token, "forbidden");
    assert.equal(parseServerError(raw[5]).token, "network");
    assert.equal(parseServerError(raw[6]).token, "network");
    assert.equal(parseServerError(raw[7]).token, "unknown");
  });
  it("a token this screen has never seen gets the generic line, not the server text", () => {
    assert.equal(errorCopy("some_future_token", "SELECT * FROM secrets"), errorCopy("unknown", ""));
    assert.equal(errorCopy("constructor", "x"), errorCopy("unknown", ""));
    assert.equal(errorCopy("__proto__", "x"), errorCopy("unknown", ""));
  });
  it("forbidden says who can, in the server's words when it has them", () => {
    assert.equal(errorCopy("forbidden", "Only an owner or admin can delete. Mark it as lost instead."), "Only an owner or admin can delete. Mark it as lost instead.");
    assert.ok(errorCopy("forbidden", "").includes("Ask the owner"));
  });
  it("an error the service already parsed is used as it is", () => {
    assert.equal(errorWords({ token: "not_found", message: "anything" }), errorCopy("not_found", ""));
    assert.equal(errorWords({ token: "stage_is_live", message: MOVE_BLOCK_COPY.stage_is_live }), MOVE_BLOCK_COPY.stage_is_live);
  });
});

describe("#3802 P-11: moves the screen stops before asking the server", () => {
  it("dropping on Live explains that Live sets itself", () => {
    const b = moveBlocker(HOSTS, rec({ stage: "onboarded" }), "live");
    assert.equal(b.token, "stage_sets_itself");
    assert.equal(b.message, "Live sets itself when the linked brand has a public listing. Move the card to Onboarded and link the brand instead.");
  });
  it("a Live host moves only to Lost", () => {
    for (const to of ["prospect", "contacted", "replied", "meeting", "onboarded"]) {
      assert.equal(moveBlocker(HOSTS, rec({ stage: "live" }), to).token, "stage_is_live", to);
    }
    assert.equal(moveBlocker(HOSTS, rec({ stage: "live" }), "lost"), null);
  });
  it("a creator needs a signed agreement for Booked and for Posted, from any stage", () => {
    for (const from of ["identified", "contacted", "replied", "negotiating", "passed"]) {
      for (const agreement of [null, "none", "sent"]) {
        assert.equal(moveBlocker(CREATORS, rec({ pipeline: "creators", stage: from, agreement }), "booked").token, "agreement_required");
        assert.equal(moveBlocker(CREATORS, rec({ pipeline: "creators", stage: from, agreement }), "posted").token, "agreement_required");
      }
      assert.equal(moveBlocker(CREATORS, rec({ pipeline: "creators", stage: from, agreement: "signed" }), "booked"), null);
    }
    assert.equal(moveBlocker(CREATORS, rec({ pipeline: "creators", stage: "negotiating", agreement: null }), "passed"), null);
    assert.ok(moveBlocker(CREATORS, rec({ pipeline: "creators", stage: "negotiating" }), "posted").message.includes("Posted"));
  });
  it("the agreement rule is a creators rule only", () => {
    assert.equal(stageNeedsSignedAgreement(CREATORS, "booked"), true);
    assert.equal(stageNeedsSignedAgreement(CREATORS, "posted"), true);
    assert.equal(stageNeedsSignedAgreement(CREATORS, "passed"), false);
    assert.equal(stageNeedsSignedAgreement(CREATORS, "negotiating"), false);
    assert.equal(stageNeedsSignedAgreement(HOSTS, "onboarded"), false);
  });
  it("an ordinary move is not stopped; the same stage is a no-op", () => {
    assert.equal(moveBlocker(HOSTS, rec({ stage: "prospect" }), "meeting"), null);
    assert.equal(moveBlocker(HOSTS, rec({ stage: "meeting" }), "prospect"), null);
    assert.equal(moveBlocker(HOSTS, rec({ stage: "prospect" }), "prospect").token, "same");
    assert.equal(moveBlocker(HOSTS, rec({ stage: "prospect" }), "nope").token, "same");
  });
});

describe("#3802 P-12: duplicates, counts, owners, order", () => {
  it("an exact duplicate is found whatever the spelling", () => {
    for (const typed of ["palm court kitchen", "@PalmCourtKitchen", "Palm-Court  Kitchen."]) {
      assert.equal(findDuplicates(RECORDS, typed).exact?.id, "1", typed);
    }
  });
  it("a shorter or longer name finds the similar one; two letters find nothing", () => {
    assert.deepEqual(findDuplicates(RECORDS, "Palm Court").similar.map((r) => r.id), ["1"]);
    assert.deepEqual(findDuplicates(RECORDS, "Palm Court Kitchen Lagos").similar.map((r) => r.id), ["1"]);
    assert.equal(findDuplicates(RECORDS, "Palm Court").exact, null);
    assert.deepEqual(findDuplicates(RECORDS, "pa"), { exact: null, similar: [] });
    assert.deepEqual(findDuplicates(RECORDS, ""), { exact: null, similar: [] });
    assert.deepEqual(findDuplicates(RECORDS, "Palm Court Kitchen", "1"), { exact: null, similar: [] });
  });
  it("at most five look-alikes are offered", () => {
    const many = Array.from({ length: 9 }, (_, i) => rec({ id: `m${i}`, name: `Sunset Bar ${i}` }));
    assert.equal(findDuplicates(many, "Sunset Bar").similar.length, 5);
  });
  it("by region: only regions with a record, then No region, with stage counts", () => {
    const rows = byRegionTable(HOSTS, RECORDS, REGIONS);
    assert.deepEqual(rows.map((r) => `${r.name}:${r.total}:${r.slug}`), ["Lagos:2:lagos", "New York:1:new-york", "No region:1:none"]);
    assert.equal(rows[0].counts.prospect, 1);
    assert.equal(rows[0].counts.replied, 1);
    assert.equal(rows[1].counts.live, 1);
    assert.equal(rows[2].counts.lost, 1);
    assert.deepEqual(byRegionTable(HOSTS, [], REGIONS), []);
  });
  it("a record whose region left the list is still counted", () => {
    const rows = byRegionTable(HOSTS, [rec({ id: "9", region_id: "r-gone" })], REGIONS);
    assert.deepEqual(rows.map((r) => `${r.name}:${r.total}`), ["No region:1"]);
  });
  it("group by stage keeps every column, even an empty one", () => {
    const g = groupByStage(HOSTS, RECORDS);
    assert.deepEqual(Object.keys(g), HOSTS.stages.map((s) => s.id));
    assert.deepEqual(g.prospect.map((r) => r.id), ["1"]);
    assert.deepEqual(g.meeting, []);
  });
  it("owners read as names, Unassigned when nobody, and a clash shows the address", () => {
    assert.equal(displayOwners(RECORDS[1], TEAM), "Maya, Tunde");
    assert.equal(displayOwners(RECORDS[3], TEAM), "Unassigned");
    assert.equal(displayOwners(rec({ owners: ["gone.person@test.local"] }), TEAM), "Gone");
    const twoTundes = [...TEAM, { email: "tunde.b@test.local", display_name: "Tunde" }];
    assert.equal(displayOwners(rec({ owners: ["tunde@test.local"] }), twoTundes), "tunde@test.local");
  });
  it("the name comes from the address the way the server derives it", () => {
    assert.equal(displayName("tunde.a@usemingla.com"), "Tunde");
    assert.equal(displayName("maya_k@usemingla.com"), "Maya");
    assert.equal(displayName("seth@usemingla.com"), "Seth");
    assert.equal(displayName(""), "");
    assert.equal(displayName(null), "");
  });
  it("the list is ordered by due date, no date last, then by name", () => {
    assert.deepEqual(sortForList(RECORDS).map((r) => r.id), ["1", "2", "4", "3"]);
  });
  it("stage badges use the agreed colours", () => {
    for (const s of ["live", "onboarded", "booked", "posted"]) assert.equal(stageBadgeVariant(s), "success");
    for (const s of ["replied", "meeting", "negotiating"]) assert.equal(stageBadgeVariant(s), "info");
    for (const s of ["lost", "passed"]) assert.equal(stageBadgeVariant(s), "error");
    for (const s of ["prospect", "contacted", "identified", "constructor"]) assert.equal(stageBadgeVariant(s), "default");
  });
});
