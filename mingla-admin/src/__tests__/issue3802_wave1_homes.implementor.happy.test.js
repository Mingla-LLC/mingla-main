// Issue #3802 (Wave 1) — role homes, monthly targets, Beta leads for the whole
// team, invite follow-ups, and the board fixes that came with them.
//
//   M-1   one name, one key: the same inputs the server suite checks (H-3)
//   M-2   a stale-card sentence never leaves a space before the full stop
//   M-3   tiles, bars and target pills are built from the server's numbers
//   M-4   addresses: a target's slice, the person filter, the New filter
//   M-5   who may open Home, the Team dashboard and Beta leads
//   M-6   every answer to "Add to Hosts" has words
//   M-7   every new refusal reaches the screen as a sentence, never a token
//   M-8   source contracts: one caller of the server functions; the homes
//         read no database and show nothing from a later wave
//   M-9   every move names the stage it saw; a refused one is explained
//   M-10  the five re-test items (save once, focus after Undo, phone toasts,
//         a held card keeps its history entry, no stray space)
//   M-11  the three smoke-test items (a drop on Live says why, a reloaded
//         card is full height at once, toasts sit beside an open card)
//   M-12  the invite follow-ups
//
// Fails-on-revert is recorded on the issue.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BETA_CONVERT_STATUSES,
  betaConvertMessage,
  betaLeadButton,
  betaSuggestionLine,
  betaTypeLabel,
  dueTotals,
  errorCopy,
  errorWords,
  freshnessVerdict,
  funnelRows,
  longDate,
  nameKey,
  parseTarget,
  targetPill,
  weekIsEmpty,
  weekRows,
} from "../lib/crmModel.js";
import {
  buildBetaSearch,
  buildCrmHash,
  buildTeamSearch,
  parseBetaSearch,
  parseCrmHash,
  parseTeamSearch,
  targetSliceHash,
} from "../lib/crmUrl.js";
import { AREA, PAGE_AREA_OVERRIDES, areaForPage, canOpenPage, homePageFor, resolveRoute, visibleNavGroups } from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";
import { ACCEPT_COPY, acceptBody, acceptConflictMessage } from "../lib/inviteLink.js";

const __filename = fileURLToPath(import.meta.url);
const SRC = path.resolve(path.dirname(__filename), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = read("pages/PipelinePage.jsx");
const HOME = read("pages/RoleHomePage.jsx");
const TEAM = read("pages/TeamDashboardPage.jsx");
const BETA = read("pages/BetaLeadsPage.jsx");
const ADMIN_PAGE = read("pages/AdminPage.jsx");
const ACCEPT = read("components/InviteAcceptScreen.jsx");
const DRAWER = read("components/crm/RecordDrawer.jsx");
const BOARD = read("components/crm/PipelineBoard.jsx");
const TOAST = read("components/ui/Toast.jsx");
const SERVICE = read("services/crmService.js");
const HOOK = read("hooks/useCrmPipeline.js");
const SUMMARY = read("hooks/useCrmSummary.js");
const KEYS = read("hooks/useCrmConfig.js");
const APP = read("App.jsx");
const HOME_DIR = path.join(SRC, "components/crm/home");
const HOME_FILES = fs.readdirSync(HOME_DIR).filter((f) => f.endsWith(".jsx")).sort();
const HOME_PARTS = HOME_FILES.map((f) => fs.readFileSync(path.join(HOME_DIR, f), "utf8"));
const MIGRATION = fs.readFileSync(
  path.resolve(SRC, "../../supabase/migrations/20270823003802_issue_3802_wave1_homes_targets_beta.sql"),
  "utf8"
);

// lib/auditLog.js imports the database client, so its labels are read as text.
const ACTION_LABELS = Object.fromEntries(
  [...read("lib/auditLog.js").matchAll(/^\s*"([a-z_.]+)":\s*"([^"]+)",?$/gm)].map((m) => [m[1], m[2]])
);

const cp = (...points) => String.fromCodePoint(...points);
const owner = { email: "o@test.local", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm", "beta_leads"] };
const admin = { email: "a@test.local", role: "admin", status: "active", areas: ["admin_console", "crm", "beta_leads"] };
const growth = { email: "g@test.local", role: "growth", status: "active", areas: ["role_home", "crm", "beta_leads"] };
const partner = { email: "p@test.local", role: "partner", status: "active", areas: ["role_home", "crm", "beta_leads"] };
const PAGE_IDS = [...APP.match(/const PAGES\s*=\s*\{([\s\S]*?)\n\}/)[1].matchAll(/^\s*"?([a-zA-Z][\w-]*)"?\s*:/gm)].map((m) => m[1]);

describe("#3802 M-1: one name, one key (the server suite's inputs, H-3)", () => {
  // Shared with H-3 in
  // supabase/migrations/__tests__/issue_3802_wave1_homes_targets_beta.implementor.happy.pg17.test.sql
  const TABLE = [
    ["Palm Court", "palmcourt"],
    [cp(0xff30, 0xff41, 0xff4c, 0xff4d, 0x20, 0xff23, 0xff4f, 0xff55, 0xff52, 0xff54), "palmcourt"], // full-width
    [cp(0xfb01) + "sh", "fish"], // ligature
    ["Caf" + cp(0xe9), "caf" + cp(0xe9)], // composed accent
    ["Cafe" + cp(0x301), "caf" + cp(0xe9)], // decomposed accent
    [cp(0x1f355), cp(0x1f355)], // emoji
    [cp(0x1f355, 0xfe0f), cp(0x1f355)], // emoji with a variation mark
    [cp(0x645, 0x637, 0x639, 0x645), cp(0x645, 0x637, 0x639, 0x645)], // non-Latin
    ["&&&", "&&&"],
    [cp(0x212a), "k"], // kelvin sign
    [cp(0x2800), ""], // a blank braille cell
    [cp(0xe0041, 0xe0042), ""], // tag characters
    [cp(0xfe0f), ""], // a variation mark alone
    [cp(0xe0100), ""], // an ideographic variation mark alone
    [cp(0x1d173, 0x1d17a), ""], // musical format characters
    [cp(0x301), ""], // a combining mark alone
    [cp(0x110bd, 0x13430, 0x1bca0), ""], // format characters from three scripts
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
    ["@ @", "@@"],
    ["@!", "@!"],
  ];
  it("every input gives the key the server gives", () => {
    for (const [input, want] of TABLE) assert.equal(nameKey(input), want, `key of [${JSON.stringify(input)}]`);
  });
  it("full-width and plain letters, and composed and decomposed accents, are one record", () => {
    assert.equal(nameKey(cp(0xff28, 0xff13) + " Palm Court"), nameKey("H3 Palm Court"));
    assert.equal(nameKey("Cafe" + cp(0x301) + " Lune"), nameKey("Caf" + cp(0xe9) + " Lune"));
  });
  it("a tone-marked name keeps the key it had", () => {
    assert.equal(nameKey(cp(0x1eb8, 0x300) + "gb" + cp(0xe1)), cp(0x1eb9) + "gb" + cp(0xe1));
  });
  it("the characters nobody can see are written as code points, never typed into the source", () => {
    const model = read("lib/crmModel.js");
    const classes = model.match(/const NAME_KEY_(DROPPED|MARKS) =\s*\/\[[^\n]*\]\+\/gu;/g) || [];
    assert.equal(classes.length, 2);
    for (const c of classes) assert.ok(/^[\x20-\x7e\n]*$/.test(c), "a name key class holds a character that is not plain ASCII");
    assert.match(model, /name\.normalize\("NFKC"\)\.toLowerCase\(\)\.normalize\("NFKC"\)\.replace\(NAME_KEY_DROPPED, ""\)/);
    assert.match(model, /if \(seen\.replace\(NAME_KEY_MARKS, ""\) === ""\) return "";/);
  });
});

describe("#3802 M-2: a stale-card sentence never leaves a space before the full stop", () => {
  const DEF = { stages: [{ id: "a", label: "Prospect" }, { id: "b", label: "Contacted" }, { id: "c", label: "Replied" }] };
  const shown = { id: "1", name: "Palm Court", stage: "a" };
  const NOW = Date.parse("2026-10-12T12:00:00Z");
  const move = (to, actor, at) => [{ kind: "stage_move", to_stage: to, actor_email: actor, actor_name: actor ? "Maya" : null, occurred_at: at }];
  const cases = [
    ["someone, with a time, same move", freshnessVerdict(DEF, shown, { ...shown, stage: "b" }, "b", move("b", "maya@x.co", "2026-10-12T11:57:00Z"), NOW).description, "Maya moved it there 3m ago. Nothing else was changed."],
    ["someone, no time, same move", freshnessVerdict(DEF, shown, { ...shown, stage: "b" }, "b", move("b", "maya@x.co", null), NOW).description, "Maya moved it there. Nothing else was changed."],
    ["someone, a time that is not one", freshnessVerdict(DEF, shown, { ...shown, stage: "b" }, "b", move("b", "maya@x.co", "not a time"), NOW).description, "Maya moved it there. Nothing else was changed."],
    ["by itself, with a time", freshnessVerdict(DEF, shown, { ...shown, stage: "b" }, "b", move("b", null, "2026-10-12T11:00:00Z"), NOW).description, "It moved there by itself 1h ago. Nothing else was changed."],
    ["by itself, no time", freshnessVerdict(DEF, shown, { ...shown, stage: "b" }, "b", move("b", null, ""), NOW).description, "It moved there by itself. Nothing else was changed."],
    ["someone, no time, another stage", freshnessVerdict(DEF, shown, { ...shown, stage: "c" }, "b", move("c", "maya@x.co", null), NOW).description, "Maya moved it from Prospect to Replied. Your move was not made. The board is up to date now: move the card again if you still want to."],
    ["by itself, no time, another stage", freshnessVerdict(DEF, shown, { ...shown, stage: "c" }, "b", move("c", null, null), NOW).description, "It moved from Prospect to Replied by itself. Your move was not made. The board is up to date now: move the card again if you still want to."],
  ];
  for (const [label, got, want] of cases) {
    it(label, () => {
      assert.equal(got, want);
      assert.ok(!/\s[.,]/.test(got), "a space sits before a full stop");
      assert.ok(!/ {2}/.test(got), "two spaces in a row");
    });
  }
});

describe("#3802 M-3: tiles, bars and pills are built from the server's numbers", () => {
  it("what is due adds overdue and today, and nothing else", () => {
    assert.deepEqual(dueTotals({ overdue: 2, today: 3, rows: [] }), { overdue: 2, today: 3, total: 5 });
    assert.deepEqual(dueTotals({ overdue: 0, today: 0 }), { overdue: 0, today: 0, total: 0 });
    for (const odd of [null, undefined, {}, { overdue: "x", today: -4 }, { overdue: NaN }]) {
      assert.deepEqual(dueTotals(odd), { overdue: 0, today: 0, total: 0 });
    }
  });
  it("the pill is green at the target, amber once started, plain at zero", () => {
    assert.equal(targetPill(10, 10), "success");
    assert.equal(targetPill(12, 10), "success");
    assert.equal(targetPill(1, 10), "warning");
    assert.equal(targetPill(0, 10), "default");
    assert.equal(targetPill(null, 10), "default");
    assert.equal(targetPill(3, 0), "warning");
  });
  it("a bar's width comes from the largest count; a zero is a zero-width bar, never a made-up minimum", () => {
    const rows = funnelRows([{ id: "a", label: "A", count: 4 }, { id: "b", label: "B", count: 1 }, { id: "c", label: "C", count: 0 }]);
    assert.deepEqual(rows.map((r) => r.width), [100, 25, 0]);
    assert.deepEqual(rows.map((r) => r.count), [4, 1, 0]);
    assert.deepEqual(funnelRows([{ id: "a", label: "A", count: 0 }, { id: "b", label: "B", count: 0 }]).map((r) => r.width), [0, 0]);
    assert.deepEqual(funnelRows(null), []);
    assert.deepEqual(funnelRows([{ id: "a", count: "7" }]), [{ id: "a", label: "a", count: 7, width: 100 }]);
  });
  it("this week by person keeps the server's order, marks someone who left, and knows an empty week", () => {
    const rows = weekRows([
      { email: "seth@x.co", display_name: "Seth", role: "owner", status: "active", touches: 0, stage_moves: 0, added: 0, overdue: 0, due_today: 0 },
      { email: "tunde.a@x.co", display_name: "Tunde", role: "growth", status: "active", touches: 3, stage_moves: 2, added: 1, overdue: 1, due_today: 4 },
      { email: "tunde.b@x.co", display_name: "Tunde", role: "growth", status: "invited", touches: 0 },
      { email: "gone@x.co", display_name: "Gone", role: null, status: "former", touches: 1 },
      { display_name: "nobody" },
    ]);
    assert.deepEqual(rows.map((r) => r.name), ["Seth", "tunde.a@x.co", "tunde.b@x.co", "Gone"]);
    assert.deepEqual(rows[1], { email: "tunde.a@x.co", name: "tunde.a@x.co", role: "growth", former: false, invited: false, touches: 3, stageMoves: 2, added: 1, overdue: 1, dueToday: 4 });
    assert.equal(rows[2].invited, true);
    assert.equal(rows[3].former, true);
    assert.equal(rows[3].role, "");
    assert.equal(weekIsEmpty(rows), false);
    assert.equal(weekIsEmpty(weekRows([{ email: "a@x.co", touches: 0, stage_moves: 0, added: 0, overdue: 9 }])), true);
  });
  it("a typed target is a whole number from 1 to 1000 or it is nothing", () => {
    assert.equal(parseTarget("1"), 1);
    assert.equal(parseTarget(" 1000 "), 1000);
    for (const bad of ["", "0", "1001", "12.5", "1e3", "-3", "ten", "１２", null, undefined, "12 a month"]) assert.equal(parseTarget(bad), null, String(bad));
  });
  it("the date line is the viewer's own day in words", () => {
    assert.equal(longDate("2026-10-12"), "Monday 12 October");
    assert.equal(longDate("not a date"), "");
    assert.equal(longDate(null), "");
  });
});

describe("#3802 M-4: addresses", () => {
  it("a target opens its slice of the Hosts board, and the board reads it back", () => {
    assert.equal(targetSliceHash("event_organizer", "lagos"), "#/hosts?icp=event_organizer&region=lagos");
    assert.deepEqual({ icp: parseCrmHash(targetSliceHash("event_organizer", "new-york")).icp, region: parseCrmHash(targetSliceHash("event_organizer", "new-york")).region }, { icp: "event_organizer", region: "new-york" });
    assert.equal(targetSliceHash("<script>", "../x"), "#/hosts");
    assert.equal(buildCrmHash("hosts", { view: "list", mine: true }), "#/hosts?view=list&mine=1");
    assert.equal(buildCrmHash("creators", { view: "list" }), "#/creators?view=list");
  });
  it("the Team dashboard's person filter round-trips, and anything that is not an address is dropped", () => {
    assert.equal(buildTeamSearch({ person: "Tunde@UseMingla.com" }), "person=tunde%40usemingla.com");
    assert.deepEqual(parseTeamSearch(buildTeamSearch({ person: "tunde@usemingla.com" })), { person: "tunde@usemingla.com" });
    assert.equal(buildTeamSearch({}), "");
    assert.equal(buildTeamSearch(null), "");
    for (const hostile of ["person=", "person=tunde", "person=a b@x.co", "person=a@b@c", "person=%3Cscript%3E", "person=a%26b@x.co", "person=" + "a".repeat(80) + "@x.co", "%E0%A4%A", "other=1", ""]) {
      assert.deepEqual(parseTeamSearch(hostile), { person: "" }, hostile);
    }
    assert.deepEqual(parseTeamSearch(undefined), { person: "" });
    assert.equal(buildTeamSearch({ person: "not an address" }), "");
  });
  it("the Beta leads filter is New or nothing", () => {
    assert.deepEqual(parseBetaSearch("show=new"), { show: "new" });
    for (const other of ["", "show=all", "show=NEW", "show=new%20", "show=1", "new", null, 42]) assert.deepEqual(parseBetaSearch(other), { show: "all" }, String(other));
    assert.equal(buildBetaSearch({ show: "new" }), "show=new");
    assert.equal(buildBetaSearch({ show: "all" }), "");
    assert.equal(buildBetaSearch({ show: "anything" }), "");
    assert.equal(buildBetaSearch(null), "");
  });
  it("the pages build these addresses with the helpers, never by hand", () => {
    for (const [name, src] of [["RoleHomePage", HOME], ["TeamDashboardPage", TEAM], ["BetaLeadsPage", BETA], ...HOME_FILES.map((f, i) => [f, HOME_PARTS[i]])]) {
      const code = stripComments(src);
      assert.ok(!/["'`]#\/(hosts|creators)\?/.test(code), `${name} writes a board address by hand`);
      assert.ok(!/card=\$\{/.test(code), `${name} writes a card address by hand`);
    }
    assert.match(HOME, /buildCrmHash\("hosts", listState\)/);
    assert.match(read("components/crm/home/TargetsCard.jsx"), /href=\{targetSliceHash\(t\.icp, regionSlug\(t\.region_name\)\)\}/);
    assert.match(read("components/crm/home/DueList.jsx"), /href=\{buildCrmHash\(pipeline, \{ card: r\.id \}\)\}/);
  });
});

describe("#3802 M-5: who may open Home, the Team dashboard and Beta leads", () => {
  it("Home is for the two role-home roles; owner and admin still land on the Dashboard", () => {
    assert.equal(homePageFor(growth), "home");
    assert.equal(homePageFor(partner), "home");
    assert.equal(homePageFor(owner), "overview");
    assert.equal(homePageFor(admin), "overview");
  });
  it("the Team dashboard has no entry in the access map, so it is owner and admin only", () => {
    assert.equal(Object.hasOwn(PAGE_AREA_OVERRIDES, "team-dashboard"), false);
    assert.equal(areaForPage("team-dashboard"), AREA.ADMIN_CONSOLE);
    assert.ok(PAGE_IDS.includes("team-dashboard"));
    assert.equal(canOpenPage(owner, "team-dashboard"), true);
    assert.equal(canOpenPage(admin, "team-dashboard"), true);
    assert.equal(canOpenPage(growth, "team-dashboard"), false);
    assert.equal(canOpenPage(partner, "team-dashboard"), false);
    assert.deepEqual(resolveRoute("team-dashboard", growth, PAGE_IDS), { pageId: "home", denied: true, requestedId: "team-dashboard" });
    assert.deepEqual(resolveRoute("team-dashboard", admin, PAGE_IDS), { pageId: "team-dashboard", denied: false, requestedId: "team-dashboard" });
  });
  it("Beta leads follows its own area, for all four roles, and is closed without it", () => {
    assert.equal(AREA.BETA_LEADS, "beta_leads");
    assert.equal(areaForPage("beta-leads"), "beta_leads");
    for (const a of [owner, admin, growth, partner]) assert.equal(canOpenPage(a, "beta-leads"), true, a.role);
    assert.equal(canOpenPage({ ...partner, areas: ["role_home", "crm"] }, "beta-leads"), false);
    assert.equal(canOpenPage({ ...admin, areas: ["admin_console", "crm"] }, "beta-leads"), false, "the area decides, not the admin console");
    assert.equal(canOpenPage({ ...growth, status: "invited" }, "beta-leads"), false);
  });
  it("a page nobody listed is still owner and admin only", () => {
    assert.equal(areaForPage("a-page-added-tomorrow"), AREA.ADMIN_CONSOLE);
    assert.equal(canOpenPage(growth, "a-page-added-tomorrow"), false);
    assert.deepEqual(Object.keys(PAGE_AREA_OVERRIDES).sort(), ["admin", "beta-leads", "creators", "home", "hosts"]);
  });
  it("the Team dashboard is in the Team group for owner and admin only", () => {
    const ids = (a) => visibleNavGroups(NAV_GROUPS, a).flatMap((g) => g.items).map((i) => i.id);
    assert.ok(ids(owner).includes("team-dashboard") && ids(admin).includes("team-dashboard"));
    assert.ok(!ids(growth).includes("team-dashboard") && !ids(partner).includes("team-dashboard"));
    assert.match(APP, /"team-dashboard": TeamDashboardPage,/);
  });
});

describe("#3802 M-6: every answer to Add to Hosts has words", () => {
  const rec = { record: { id: "h1", name: "Suya Spot" } };
  it("the four statuses the server can answer with are the four the screen knows", () => {
    const answered = [...new Set([...MIGRATION.matchAll(/jsonb_build_object\('status', '([a-z]+)'/g)].map((m) => m[1]))].sort();
    assert.deepEqual(answered, [...BETA_CONVERT_STATUSES].sort());
  });
  it("created: what was carried over, or what is left to pick, for every mapping answer", () => {
    assert.deepEqual(betaConvertMessage({ status: "created", ...rec, icp_note: "set", region_note: "set", city: "Lagos" }), {
      variant: "success", title: "Suya Spot added to Hosts", description: "ICP and region carried over. You are the owner.",
    });
    assert.equal(betaConvertMessage({ status: "created", ...rec, icp_note: "several", region_note: "set" }).description, "They chose several types, so pick the ICP on the card.");
    assert.equal(betaConvertMessage({ status: "created", ...rec, icp_note: "none", region_note: "set" }).description, "Their type has no matching ICP, so pick one on the card.");
    assert.equal(betaConvertMessage({ status: "created", ...rec, icp_note: "set", region_note: "not_launch_city", city: "Atlantis" }).description, "'Atlantis' isn't a Launch City, so the region is empty. Pick one on the card.");
    assert.equal(betaConvertMessage({ status: "created", ...rec, icp_note: "set", region_note: "ambiguous", city: "Springfield" }).description, "More than one Launch City is called 'Springfield'. Pick the region on the card.");
    assert.equal(
      betaConvertMessage({ status: "created", ...rec, icp_note: "several", region_note: "not_launch_city", city: "Atlantis" }).description,
      "They chose several types, so pick the ICP on the card. 'Atlantis' isn't a Launch City, so the region is empty. Pick one on the card."
    );
  });
  it("exists, linked and duplicate each say what happened", () => {
    assert.deepEqual(betaConvertMessage({ status: "exists", ...rec }), { variant: "info", title: "Suya Spot is already in Hosts", description: "Someone added it first." });
    assert.deepEqual(betaConvertMessage({ status: "linked", ...rec }), { variant: "info", title: "Suya Spot was already in Hosts", description: "This lead is now linked to it." });
    assert.deepEqual(betaConvertMessage({ status: "duplicate", ...rec }), { variant: "info", title: "Suya Spot is already in Hosts", description: "A host with this name exists. Open it instead." });
  });
  it("an answer this screen does not know is an error in plain words, never blank", () => {
    for (const odd of [null, undefined, {}, { status: "surprise" }]) {
      const m = betaConvertMessage(odd, "The Lead");
      assert.equal(m.variant, "error");
      assert.equal(m.title, "That didn't go through. Try again.");
    }
    assert.equal(betaConvertMessage({ status: "exists" }, "The Lead").title, "The Lead is already in Hosts");
  });
  it("a row shows Add to Hosts until a host exists, and says what will be carried over", () => {
    assert.equal(betaLeadButton({ host: null }), "add");
    assert.equal(betaLeadButton({}), "add");
    assert.equal(betaLeadButton({ host: { id: "" } }), "add");
    assert.equal(betaLeadButton({ host: { id: "h1", linked: false } }), "open");
    const dot = cp(0xb7);
    assert.equal(betaSuggestionLine({ suggested: { icp_note: "set", icp_label: "Restaurant or bar", region_note: "set", region_name: "Lagos" } }), `As Restaurant or bar ${dot} Lagos`);
    assert.equal(betaSuggestionLine({ suggested: { icp_note: "several", region_note: "not_launch_city" } }), `ICP to pick on the card ${dot} Region to pick on the card`);
    assert.equal(betaSuggestionLine({}), `ICP to pick on the card ${dot} Region to pick on the card`);
    assert.equal(betaTypeLabel("cafe_bar"), "Caf" + cp(0xe9) + " / Bar");
    assert.equal(betaTypeLabel("something_new"), "something_new");
  });
  it("the button cannot send twice, and every outcome confirms", () => {
    assert.match(BETA, /if \(addingRef\.current\.has\(lead\.id\)\) return;/);
    assert.match(BETA, /disabled=\{!online \|\| adding\.has\(row\.id\)\}/);
    assert.match(BETA, /label: "Open host"/);
    assert.match(BETA, /title: "That lead is no longer here\."/);
    assert.match(BETA, /No new leads\. Every lead is already in Hosts\./);
    assert.match(BETA, /Showing the newest 1,000\./);
  });
});

describe("#3802 M-7: every new refusal reaches the screen as a sentence", () => {
  const tokens = [...new Set([...MIGRATION.matchAll(/RAISE EXCEPTION '(?:%', format\(')?([a-z_]+)(?::|')/g)].map((m) => m[1]))].filter(
    (t) => !["issue", "issue_3802_self_check_rollback", "address_in_use", "already_active", "invalid_token"].includes(t)
  );
  it("the migration's refusals were found", () => {
    for (const t of ["stage_changed", "invalid_target", "lead_name_unusable", "forbidden", "not_found", "invalid_region", "invalid_icp", "try_again"]) {
      assert.ok(tokens.includes(t), `${t} was not found in the migration`);
    }
  });
  it("each one becomes words with at least two of them, and never the token itself", () => {
    for (const t of tokens) {
      for (const sent of ["", undefined, t, "x"]) {
        const words = errorCopy(t, sent);
        assert.ok(/\s/.test(words) && words !== t && !/^[a-z_]+$/.test(words), `${t} shows as [${words}]`);
      }
    }
  });
  it("the new ones say the right thing", () => {
    assert.equal(
      errorCopy("stage_changed", "This card is in Replied now, not Contacted, so nothing was moved. Read the card again and move it from where it is."),
      "This card is in Replied now, not Contacted, so nothing was moved. Read the card again and move it from where it is."
    );
    assert.match(errorCopy("stage_changed", ""), /^Someone moved this card while you were looking at it, so nothing was moved\./);
    assert.equal(errorCopy("invalid_target", "A monthly target is a whole number from 1 to 1000. Send nothing to remove the target."), "A monthly target is a whole number from 1 to 1000.");
    assert.equal(errorCopy("lead_name_unusable", ""), "This lead's business name can't be used as a host name. Add the host by hand from Hosts.");
    assert.equal(errorCopy("forbidden", "Only an owner or admin can set targets."), "Only an owner or admin can set targets.");
    assert.equal(errorCopy("forbidden", "Only an owner or admin can open the team dashboard."), "Only an owner or admin can open the team dashboard.");
    assert.equal(errorCopy("forbidden", "Your account cannot open Beta leads. Ask the owner to give you team access."), "Your account cannot open Beta leads. Ask the owner to give you team access.");
    assert.equal(errorWords({ token: "stage_changed", message: "" }), errorCopy("stage_changed", ""));
  });
  it("the new audit actions have plain labels", () => {
    for (const action of [...new Set([...MIGRATION.matchAll(/'(crm\.[a-z_]+)'/g)].map((m) => m[1]))]) {
      assert.ok(Object.hasOwn(ACTION_LABELS, action) || action === "crm.reconcile_failed", `${action} has no label`);
    }
    assert.equal(ACTION_LABELS["crm.target_set"], "Set a monthly target");
    assert.equal(ACTION_LABELS["crm.target_remove"], "Removed a monthly target");
    assert.equal(ACTION_LABELS["crm.beta_lead_convert"], "Added a beta lead to Hosts");
    assert.equal(ACTION_LABELS["crm.beta_lead_link"], "Linked a beta lead to a host");
  });
});

describe("#3802 M-8: source contracts for the homes", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`) && /\.(js|jsx)$/.test(f));
  it("only crmService.js calls a crm_ server function, and it calls the five new ones", () => {
    const callers = files.filter((f) => /rpc\(\s*["'`]crm_/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(callers.map((f) => path.relative(SRC, f)), [path.join("services", "crmService.js")]);
    for (const fn of ["crm_home_summary", "crm_team_summary", "crm_target_set", "crm_beta_leads_list", "crm_beta_lead_to_host"]) {
      assert.ok(SERVICE.includes(`rpc("${fn}"`), fn);
    }
  });
  it("the homes, the Team dashboard and Beta leads never import the database client", () => {
    for (const [name, src] of [["RoleHomePage", HOME], ["TeamDashboardPage", TEAM], ["BetaLeadsPage", BETA], ["useCrmSummary", SUMMARY], ...HOME_FILES.map((f, i) => [f, HOME_PARTS[i]])]) {
      assert.ok(!/lib\/supabase/.test(src), `${name} imports the database client`);
      assert.ok(!/supabase\./.test(stripComments(src)), `${name} uses the database client`);
    }
    assert.ok(!BETA.includes("admin_beta_leads_list"));
  });
  it("every number on a home comes from the summary hook; none is written in the page", () => {
    assert.match(HOME, /const summary = useCrmSummary\("home"\);/);
    assert.match(TEAM, /const summary = useCrmSummary\("team"\);/);
    assert.match(BETA, /const summary = useCrmSummary\("betaLeads"\);/);
    for (const [name, src] of [["RoleHomePage", HOME], ["TeamDashboardPage", TEAM]]) {
      const tiles = [...src.matchAll(/<StatTile\b[\s\S]*?\/>/g)].map((m) => m[0]);
      assert.ok(tiles.length >= 3, `${name} has its tiles`);
      for (const t of tiles) assert.ok(/value=\{[a-zA-Z]/.test(t) && !/value=\{\d/.test(t) && !/value="/.test(t), `${name} has a tile with a typed number: ${t}`);
    }
    for (const part of HOME_PARTS) assert.ok(!/Math\.random|Example|example figures|placeholder numbers/i.test(stripComments(part).replace(/placeholder="[^"]*"/g, "")));
  });
  it("the summary hook keeps to the signed-in person and to memory", () => {
    assert.match(SUMMARY, /const key = read\.key\(access\?\.email\);/);
    assert.match(SUMMARY, /const current = state\.key === key;/);
    assert.match(SUMMARY, /\/\/ A failed quiet refresh keeps what is on screen\.\s*if \(quiet\) return;/);
    assert.match(SUMMARY, /SUMMARY_REFRESH_MS = 60_000/);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|zustand|createContext\(/.test(stripComments(SUMMARY)));
    assert.match(KEYS, /home: \(email\) => summaryKey\("home", email\),/);
    assert.match(KEYS, /team: \(email\) => summaryKey\("team", email\),/);
    assert.match(KEYS, /betaLeads: \(email\) => summaryKey\("beta-leads", email\),/);
    for (const k of ["crmKeys.home", "crmKeys.team", "crmKeys.betaLeads"]) assert.ok(SUMMARY.includes(k), `${k} is not used`);
  });
  it("nothing from a later wave is on a home", () => {
    const banned = /\b(draft|drafts|mention|mentions|posts due|content calendar|support ticket|tickets|data room|morning sweep|getting started|agent prompt|by agent|replies waiting)\b/i;
    for (const [name, src] of [["RoleHomePage", HOME], ["TeamDashboardPage", TEAM], ...HOME_FILES.map((f, i) => [f, HOME_PARTS[i]])]) {
      const shown = [...stripComments(src).matchAll(/>([^<>{}]+)</g), ...stripComments(src).matchAll(/["'`]([^"'`\n]{3,})["'`]/g)].map((m) => m[1]);
      for (const text of shown) assert.ok(!banned.test(text), `${name} shows [${text.trim()}]`);
    }
  });
  it("every empty state says what to do and offers the way there", () => {
    assert.match(HOME, /Nothing due\. Set a next action and a date on a \$\{singular\} and it will show here\./);
    assert.match(read("components/crm/home/DueList.jsx"), /Open \{plural\}/);
    assert.match(read("components/crm/home/StageFunnel.jsx"), /No \{plural\} yet\./);
    assert.match(read("components/crm/home/StageFunnel.jsx"), /Add the first \{singular\}/);
    assert.match(HOME, /emptyHint="An owner or admin sets them on the Team dashboard\."/);
    assert.match(TEAM, /emptyHint="Add the first one below\."/);
    assert.match(TEAM, /"Nothing is due or overdue\."/);
    assert.match(read("components/crm/home/WeekByPerson.jsx"), /Nothing logged yet this week\./);
    assert.match(read("components/crm/home/TargetsCard.jsx"), /"A region no longer in the list"/);
    assert.match(HOME, /Your home isn't switched on yet\. Try again in a few minutes, or tell an admin\./);
  });
  it("tiles and rows are real links", () => {
    assert.match(read("components/crm/home/StatTile.jsx"), /<a href=\{href\} onClick=\{onClick\} className=\{TILE_CLASS\}>/);
    assert.match(read("components/crm/home/DueList.jsx"), /min-h-11/);
    assert.match(read("components/crm/home/StageFunnel.jsx"), /<a\s+href=\{board\}/);
  });
  it("a target is set, changed and removed through the one service call, with an Undo", () => {
    assert.match(TEAM, /res = await setTarget\(regionId, icp, number\);/);
    assert.match(TEAM, /label: "Undo"/);
    assert.match(TEAM, /writeAgain\.current\(regionId, icp, previous, \{ where: label, undo: false \}\)/);
    const editor = read("components/crm/home/TargetEditor.jsx");
    assert.match(editor, /There is already a target for this\. Change its number in the table\./);
    assert.match(editor, /Remove this target\?/);
    assert.match(editor, /if \(e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*save\(\);/);
    assert.match(editor, /\} else if \(e\.key === "Escape"\) \{/);
    assert.match(editor, /keepRef\.current\?\.focus\(\);/);
  });
});

describe("#3802 M-9: every move names the stage it saw", () => {
  it("the service always sends the expected stage, and the hook passes the stage on screen", () => {
    assert.match(SERVICE, /export function moveStage\(id, toStage, reason = null, expectedFrom = null\)/);
    assert.match(SERVICE, /p_expected_from: expectedFrom,/);
    assert.equal((SERVICE.match(/rpc\("crm_record_move_stage"/g) || []).length, 1);
    assert.match(HOOK, /crm\.moveStage\(record\.id, toStage, reason, record\.stage\);/);
    assert.equal((HOOK.match(/crm\.moveStage\(/g) || []).length, 1);
  });
  it("the server's function takes it, and refuses a stale one with the stage the card is in", () => {
    assert.match(MIGRATION, /p_id uuid, p_to text, p_reason text DEFAULT NULL, p_expected_from text DEFAULT NULL\) RETURNS jsonb/);
    assert.match(MIGRATION, /IF v_rec\.stage <> p_expected_from THEN\s*RAISE EXCEPTION '%', format\('stage_changed: /);
    assert.match(MIGRATION, /USING ERRCODE = '22023', DETAIL = v_rec\.stage;/);
  });
  it("a refused move reads the card again and says who moved it where, never a generic error", () => {
    assert.match(PAGE, /if \(err\?\.token === "stage_changed"\) \{[\s\S]{0,420}await explainStale\(record, to, err\);\s*return false;\s*\}/);
    const at = PAGE.indexOf('if (err?.token === "stage_changed")');
    assert.ok(at > 0 && at < PAGE.indexOf("if (moveErrorSink.current && err?.token !== \"not_found\")"), "the stale answer must come before the Lost/Passed error sink");
    assert.match(PAGE, /fresh = await pipe\.checkFresh\(shown\.id\);/);
    assert.match(PAGE, /const verdict = freshnessVerdict\(def, shown, fresh\.record, to, fresh\.activity\);/);
  });
});

describe("#3802 M-10: the five re-test items", () => {
  it("(a) closing mid-save waits for the save that is on its way instead of sending the field again", () => {
    assert.match(DRAWER, /const inFlight = useRef\(new Map\(\)\);/);
    assert.match(DRAWER, /inFlight\.current\.set\(key, entry\);/);
    assert.match(DRAWER, /if \(inFlight\.current\.get\(key\) === entry\) inFlight\.current\.delete\(key\);/);
    assert.match(DRAWER, /const flying = inFlight\.current\.get\(edit\.key\);/);
    assert.match(DRAWER, /if \(flying && sameValue\(flying\.value, value\)\) \{[\s\S]{0,220}sent = await flying\.promise;/);
    assert.match(DRAWER, /if \(flying\) await flying\.promise;/);
    assert.equal((DRAWER.match(/onClick=\{sendAll\}/g) || []).length, 2);
  });
  it("(b) a toast button pressed from the keyboard hands focus to the open card", () => {
    assert.match(TOAST, /function focusReturn\(toastEl\)/);
    assert.match(TOAST, /const inside = !!toastEl && toastEl\.contains\(document\.activeElement\);/);
    assert.match(TOAST, /const panels = document\.querySelectorAll\(DIALOG_PANEL\);/);
    assert.match(TOAST, /const restoreFocus = focusReturn\(rootRef\.current\);\s*onDismiss\(toast\.id\);\s*toast\.action\.onClick\?\.\(\);\s*restoreFocus\(\);/);
    assert.match(TOAST, /const restoreFocus = focusReturn\(rootRef\.current\);\s*onDismiss\(toast\.id\);\s*restoreFocus\(\);/);
    assert.match(TOAST, /const DIALOG_PANEL = '\[role="dialog"\]\[aria-modal="true"\]';/);
  });
  it("(c) on a phone only the newest toast is shown in full, with one row for the rest", () => {
    assert.match(TOAST, /className=\{index > 0 \? "max-sm:hidden" : undefined\}/);
    assert.match(TOAST, /\{more > 0 && \(/);
    assert.match(TOAST, /flex h-10 items-center justify-between[^"]*sm:hidden/);
    assert.match(TOAST, /\{more\} more/);
    assert.match(TOAST, /toasts\.forEach\(\(t\) => removeToast\(t\.id\)\);/);
    assert.match(TOAST, /Dismiss all/);
  });
  it("(d) a card that could not be saved gets a history entry of its own again", () => {
    assert.match(
      PAGE,
      /if \(!live \|\| ok\) return;[\s\S]{0,700}window\.history\.pushState\(null, "", window\.location\.href\);\s*cardEntryPushed\.current = true;\s*setSearch\(buildCrmSearch\(\{ \.\.\.stateRef\.current, card: shownCard \}\), \{ replace: true \}\);/
    );
    assert.ok(!/\/\/ Not saved: the card stays, so the address names it again\.\s*cardEntryPushed\.current = false;/.test(PAGE));
  });
  it("(e) the sentence is built from parts, so an empty one leaves no gap (see M-2)", () => {
    const model = read("lib/crmModel.js");
    assert.match(model, /function sentence\(\.\.\.parts\) \{\s*return `\$\{parts\.filter\(\(p\) => typeof p === "string" && p !== ""\)\.join\(" "\)\}\.`;/);
    assert.ok(!/moved it there \$\{when\}\./.test(model));
    assert.ok(!/by itself \$\{when\}\./.test(model));
  });
});

describe("#3802 M-11: the three smoke-test items", () => {
  it("a card let go over a column that will not take it is answered in plain words", () => {
    assert.match(BOARD, /onDragEnd=\{handleDragEnd\}/);
    assert.match(BOARD, /const handleDragEnd = \(e\) => \{/);
    assert.match(BOARD, /if \(!record \|\| wasDropped \|\| disabled\) return;/);
    assert.match(BOARD, /document\.elementsFromPoint\(e\.clientX, e\.clientY\)/);
    assert.match(BOARD, /if \(block && \(block\.token === "stage_sets_itself" \|\| block\.token === "stage_is_live"\)\) onMove\(record, stageId\);/);
    // The page answers that move with the reason and moves nothing.
    assert.match(PAGE, /addToast\(\{ variant: "warning", title: BLOCK_TITLES\[block\.token\] \|\| "That move isn't possible", description: block\.message \}\);/);
    assert.match(PAGE, /stage_sets_itself: "Live sets itself",/);
  });
  it("and that column still never looks like a place to drop", () => {
    assert.match(BOARD, /const isOver = over && !refused;/);
    assert.match(BOARD, /if \(refusal\(stage\.id\)\) \{\s*e\.dataTransfer\.dropEffect = "none";\s*return;\s*\}\s*e\.preventDefault\(\);/);
    assert.match(BOARD, /dropped\.current = true;/);
  });
  it("a card panel is drawn outside the page's own box, so its first paint is full height", () => {
    assert.match(PAGE, /import \{ createPortal \} from "react-dom";/);
    assert.match(PAGE, /\{ready && openId && createPortal\(\s*<RecordDrawer/);
    assert.match(PAGE, /\{ready && state\.card === NEW_CARD && !holding && createPortal\(\s*<Drawer open/);
    assert.equal((PAGE.match(/,\s*document\.body\s*\)\}/g) || []).length, 2);
  });
  it("with a card open on a wide screen the toasts sit beside it; on a phone they stay above its footer", () => {
    assert.match(TOAST, /const SIDE_PANEL = `aside\$\{DIALOG_PANEL\}`;/);
    assert.match(TOAST, /const besidePanel = usePanelWidth\(toasts\.length > 0\);/);
    assert.match(TOAST, /window\.matchMedia\("\(min-width: 640px\)"\)\.matches/);
    assert.match(TOAST, /const w = panel && wide \? panel\.offsetWidth : 0;/);
    assert.match(TOAST, /setWidth\(w > 0 && window\.innerWidth - w >= ROOM_BESIDE_PANEL \? w : 0\);/);
    assert.match(TOAST, /besidePanel > 0\s*\? \{ zIndex: "var\(--z-toast\)", bottom: "1\.5rem", right: `calc\(\$\{besidePanel\}px \+ 1\.5rem\)` \}\s*: \{ zIndex: "var\(--z-toast\)", bottom: "calc\(1\.5rem \+ var\(--toast-lift, 0px\)\)" \}/);
    assert.match(read("components/ui/Drawer.jsx"), /<aside\s+ref=\{panelRef\}\s+tabIndex=\{-1\}\s+role="dialog"\s+aria-modal="true"/);
  });
});

describe("#3802 M-12: the invite follow-ups", () => {
  it("Team and roles says why an address was refused and what to do, and keeps the address", () => {
    assert.match(ADMIN_PAGE, /address_in_use: "That address can't be used for team access\.",/);
    assert.match(ADMIN_PAGE, /already has a Mingla account that signs in another way \(a phone number, or Google or Apple\)\. Invite them on an address that has no Mingla account\./);
    assert.match(ADMIN_PAGE, /if \(result\.outcome === "refused" && result\.code === "address_in_use"\) setFormInUse\(email\);/);
    assert.equal((ADMIN_PAGE.match(/result\.code === "address_in_use"\) markRowInUse\(email, true\);/g) || []).length, 2);
    assert.match(ADMIN_PAGE, /setInviteEmail\(e\.target\.value\);\s*setFormInUse\(""\);/);
    // The typed address is only cleared when the invite went through.
    const refused = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf("toastInviteFailure(result);\n        // The typed address stays"));
    assert.ok(!/setInviteEmail\(""\)/.test(refused.slice(0, 300)));
  });
  it("the accept screen names the address, or says 'This address' when it was not told", () => {
    assert.equal(ACCEPT_COPY.account_conflict.title, "This email needs a different invite");
    assert.equal(
      acceptBody("account_conflict", { invitedEmail: "tunde@example.com" }),
      "tunde@example.com already has a Mingla account that signs in another way, so team access can't be added to it. There is nothing to sign in to yet. Ask the person who invited you to send the invite to a different email address."
    );
    assert.match(acceptBody("account_conflict", {}), /^This address already has a Mingla account/);
    for (const odd of ["<b>x</b>", "a b@c.d", "", null, 42, "x".repeat(300) + "@a.b"]) assert.match(acceptBody("account_conflict", { invitedEmail: odd }), /^This address /, String(odd));
    // The signed-in address still fills the state it always filled.
    assert.equal(acceptBody("signed_in_other", { email: "me@x.co" }), "You're signed in as me@x.co. Sign out to accept this invite.");
  });
  it("the message to send is ready, with and without the address", () => {
    assert.equal(
      acceptConflictMessage("tunde@example.com"),
      "Hi, my Mingla Admin invite to tunde@example.com can't be used because that address already has a Mingla account that signs in another way. Could you send the invite to a different email address of mine? Thanks."
    );
    assert.equal(
      acceptConflictMessage(""),
      "Hi, my Mingla Admin invite can't be used because the address already has a Mingla account that signs in another way. Could you send the invite to a different email address of mine? Thanks."
    );
    assert.equal(acceptConflictMessage("not an address"), acceptConflictMessage(null));
  });
  it("the screen shows the message, copies it, says so, and offers Close", () => {
    assert.match(ACCEPT, /setInvitedEmail\(typeof result\.email === "string" \? result\.email : ""\);/);
    assert.match(ACCEPT, /value=\{acceptConflictMessage\(invitedEmail\)\}/);
    assert.match(ACCEPT, /readOnly/);
    assert.match(ACCEPT, /await navigator\.clipboard\.writeText\(acceptConflictMessage\(invitedEmail\)\);/);
    assert.match(ACCEPT, /"Copied\. Paste it into a message to the person who invited you\."/);
    assert.match(ACCEPT, /"Copying was blocked\. Select the text above and copy it by hand\."/);
    assert.match(ACCEPT, /conflict && copyState === "copied" \? "Copied" : copy\.action\.label/);
    assert.match(ACCEPT, /const COPIED_MS = 3000;/);
    assert.match(ACCEPT, /onClick=\{onDone\}[\s\S]{0,600}Close\s*<\/button>/);
    // The link's secret is handled as before: sent on a press, never stored or logged.
    assert.ok(!/localStorage|sessionStorage/.test(ACCEPT));
    assert.ok(!/console\.[a-z]+\([^)]*token/.test(ACCEPT));
  });
});
