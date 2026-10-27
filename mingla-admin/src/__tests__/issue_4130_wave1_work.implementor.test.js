// Issue #4130 (Wave 1) — Work and the Team dashboard, as approved.
//
//   W1-1  the Work address: four views (Board default), the person filter,
//         search, and the draft drawers that replace Needs you
//   W1-2  the periods each view reads, in the viewer's own time: standup
//         since yesterday 09:00, Monday to now, 8 weeks, this month and the
//         same days of last month
//   W1-3  waiting drafts: a draft for a host or creator on an open send card
//         opens from that card ("Draft ready"); every other waiting draft is
//         listed on its own in Waiting on a person, so none is lost
//   W1-4  the standup rows and the plain-text standup
//   W1-5  the words: what changed, on-time percent, deltas
//   W1-6  rendered: the first column is "Waiting on a person", it lists the
//         loose drafts with "Draft ready", a send card carrying a draft says
//         so, and the column links to every draft (sent and discarded too)
//   W1-7  everything the old Needs you page did is reachable from Work:
//         drafts (edit, copy, mark sent, discard, undo) inside the card and
//         draft drawers, spend and publish approvals on the card, roadmap
//         wording in the card; the board, Today, This week and This month
//         read the new server functions through the one service
//   W1-8  the Team dashboard: one row of numbers first, then the pipeline
//         charts, the due list, the targets and the runway collapsed; the
//         one-time settings moved out to exported panels for Settings
//   W1-9  the migration: three read-only functions, each gated like its
//         page's existing reads, none runnable by anon or PUBLIC
//
// Run: node --test src/__tests__/issue_4130_wave1_work.implementor.test.js
// (from mingla-admin). W1-6 builds the real component with esbuild (run
// `npm ci` first; without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  WORK_VIEWS,
  deltaWords,
  draftItemTitle,
  eventVerb,
  feedTime,
  monthRange,
  onTimePercent,
  parseWorkView,
  percentDeltaWords,
  previousMonthRange,
  recentWeeksRange,
  splitDrafts,
  standupPeople,
  standupRows,
  standupSince,
  standupText,
  weekRange,
} from "../lib/workViews.js";
import { pulseRange, pulseTiles, stageMoves } from "../lib/teamPulse.js";
import { WORK_COLUMNS, workStatusLabel } from "../lib/opsModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const ROOT = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));

const A = "41300000-0000-4000-8000-00000000000a";
const B = "41300000-0000-4000-8000-00000000000b";
const HOST1 = "41300000-0000-4000-8000-0000000000a1";
const HOST2 = "41300000-0000-4000-8000-0000000000a2";
const D1 = "41300000-0000-4000-8000-0000000000d1";
const D2 = "41300000-0000-4000-8000-0000000000d2";
const D3 = "41300000-0000-4000-8000-0000000000d3";

const sendCard = { id: A, number: 7, title: "Send welcome to Rooftop", status: "person", person_reason: "send", links: [{ kind: "host", id: HOST1, label: "Rooftop" }], owners: [{ email: "abi@x.test", name: "Abimbola" }], proof: [] };
const spendCard = { id: B, number: 8, title: "Approve boost", status: "person", person_reason: "spend", links: [{ kind: "host", id: HOST2, label: "Gallery" }], owners: [{ email: "seth@x.test", name: "Seth" }], proof: [] };
const drafts = [
  { id: D1, state: "waiting", record: { id: HOST1, name: "Rooftop", pipeline: "hosts" }, created_via: "claude" },
  { id: D2, state: "waiting", record: { id: HOST2, name: "Gallery", pipeline: "hosts" }, created_via: "codex" },
  { id: D3, state: "waiting", record: null, created_via: "claude" },
];

describe("W1-1 the Work address", () => {
  it("four views, Board by default; no By person view", () => {
    assert.deepEqual(WORK_VIEWS.map((v) => v.label), ["Board", "Today", "This week", "This month"]);
    assert.equal(parseWorkView("").view, "board");
    assert.equal(parseWorkView("view=today").view, "today");
    assert.equal(parseWorkView("view=person").view, "board");
  });
  it("the person filter is a teammate's address; search is capped; draft drawers take ids only", () => {
    assert.equal(parseWorkView("owner=Abi@X.test").owner, "abi@x.test");
    assert.equal(parseWorkView("owner=abimbola").owner, null);
    assert.equal(parseWorkView(`q=${"x".repeat(300)}`).q.length, 160);
    assert.equal(parseWorkView(`draft=${D1}`).draft, D1);
    assert.equal(parseWorkView("draft=nope").draft, null);
    assert.equal(parseWorkView(`record=${HOST1}`).record, HOST1);
    assert.equal(parseWorkView("drafts=all").allDrafts, true);
  });
});

describe("W1-2 periods, in the viewer's time", () => {
  const now = new Date(2026, 9, 28, 8, 30); // Wednesday 28 Oct 08:30 local
  it("standup counts from yesterday 09:00", () => {
    const s = standupSince(now);
    assert.deepEqual([s.getDate(), s.getHours(), s.getMinutes()], [27, 9, 0]);
  });
  it("this week is Monday 00:00 to now; the chart covers 8 weeks", () => {
    const w = weekRange(now);
    assert.deepEqual([w.from.getDay(), w.from.getDate(), w.from.getHours()], [1, 26, 0]);
    const h = recentWeeksRange(now, 8);
    assert.equal(Math.round((w.from - h.from) / 86_400_000), 49);
  });
  it("this month from the 1st; last month's same days, never past its end", () => {
    assert.equal(monthRange(now).from.getDate(), 1);
    const p = previousMonthRange(now);
    assert.deepEqual([p.from.getMonth(), p.from.getDate()], [8, 1]);
    assert.ok(p.to <= new Date(2026, 9, 1));
    const late = previousMonthRange(new Date(2026, 2, 31, 12));
    assert.ok(late.to <= new Date(2026, 2, 1), "31 March compares with no more than all of February");
  });
});

describe("W1-3 waiting drafts on the board", () => {
  it("a draft for a host on an open send card is that card's; the rest are listed on their own", () => {
    const { byCard, loose } = splitDrafts(drafts, [sendCard, spendCard]);
    assert.equal(byCard.get(A), 1);
    assert.equal(byCard.has(B), false, "a spend card does not carry message drafts");
    assert.deepEqual(loose.map((d) => d.id), [D2, D3]);
  });
  it("a draft named in a send card's proof is that card's too; sent drafts are not waiting", () => {
    const card = { ...sendCard, links: [], proof: [{ kind: "draft", id: D3 }] };
    const { byCard, loose } = splitDrafts([...drafts, { id: "x", state: "sent", record: null }], [card]);
    assert.equal(byCard.get(A), 1);
    assert.deepEqual(loose.map((d) => d.id), [D1, D2]);
  });
  it("a closed or removed card covers nothing", () => {
    const { loose } = splitDrafts(drafts, [{ ...sendCard, status: "done" }, { ...sendCard, id: "z", archived: true }]);
    assert.equal(loose.length, 3);
  });
  it("a draft on its own says who it is for, or that the card is gone", () => {
    assert.equal(draftItemTitle(drafts[0]), "Send a message to Rooftop");
    assert.match(draftItemTitle(drafts[2]), /card is gone/);
  });
});

describe("W1-4 the standup", () => {
  const people = [{ email: "abi@x.test", name: "Abimbola" }, { email: "seth@x.test", name: "Seth" }, { email: "new@x.test", name: "New", invited: true }];
  const cards = [
    { id: "1", title: "Shoot reels", status: "doing", owners: [{ email: "abi@x.test" }] },
    { id: "2", title: "Blocked thing", status: "doing", blocked: true, owners: [{ email: "abi@x.test" }] },
    sendCard,
    spendCard,
  ];
  it("one row per teammate (not invites): done since 09:00, in progress, blocked or waiting", () => {
    const rows = standupRows(standupPeople(people, null), cards, [{ email: "abi@x.test", closed: 2 }]);
    assert.deepEqual(rows.map((r) => r.email), ["abi@x.test", "seth@x.test"]);
    assert.equal(rows[0].done, 2);
    assert.deepEqual(rows[0].doing.map((c) => c.id), ["1"]);
    assert.deepEqual(rows[0].blocked.map((c) => c.id), ["2", A]);
    assert.deepEqual(rows[1].blocked.map((c) => c.id), [B]);
    assert.equal(rows[1].done, 0);
  });
  it("picking a person shows only that person", () => {
    assert.deepEqual(standupPeople(people, "seth@x.test").map((p) => p.email), ["seth@x.test"]);
  });
  it("Copy standup is one plain line per person", () => {
    const text = standupText(standupRows(standupPeople(people, null), cards, [{ email: "abi@x.test", closed: 1 }]), new Date(2026, 9, 26));
    assert.equal(text.split("\n")[0], "Standup 26 Oct (since yesterday 09:00)");
    assert.equal(text.split("\n")[1], "Abimbola: done 1 card. Today: Shoot reels. Blocked or waiting: Blocked thing; Send welcome to Rooftop.");
    assert.equal(text.split("\n")[2], "Seth: done 0 cards. Today: nothing in progress. Blocked or waiting: Approve boost.");
  });
});

describe("W1-5 the words", () => {
  it("what changed", () => {
    assert.equal(eventVerb({ action: "closed" }), "closed");
    assert.equal(eventVerb({ action: "status", to_status: "doing" }), "moved to In progress");
    assert.equal(eventVerb({ action: "status", to_status: "person" }), "moved to Waiting on a person");
    assert.equal(eventVerb({ action: "something_new" }), "changed");
  });
  it("feed times are local: today, yesterday, then the date", () => {
    const now = new Date(2026, 9, 26, 10, 0);
    assert.equal(feedTime(new Date(2026, 9, 26, 9, 42).toISOString(), now), "09:42");
    assert.equal(feedTime(new Date(2026, 9, 25, 18, 20).toISOString(), now), "Yesterday 18:20");
  });
  it("on time and deltas never invent a number", () => {
    assert.equal(onTimePercent(0, 0), null);
    assert.equal(onTimePercent(4, 3), 75);
    assert.deepEqual(deltaWords(4, 3, "last week"), { text: "+1 vs last week", up: true });
    assert.deepEqual(deltaWords(2, 5, "last week"), { text: "3 fewer than last week", up: false });
    assert.deepEqual(deltaWords(4, null, "last week"), { text: "", up: undefined });
    assert.deepEqual(percentDeltaWords(13, 11, "September"), { text: "+18% vs September", up: true });
    assert.deepEqual(percentDeltaWords(3, 0, "September"), { text: "", up: undefined });
  });
});

describe("W1-6 rendered: Waiting on a person", () => {
  let render;
  before(async () => {
    let esbuild;
    try {
      esbuild = await import("esbuild");
    } catch {
      assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
    }
    const harness = `
import { renderToStaticMarkup } from "react-dom/server";
import { WorkColumns } from "../components/ops/WorkColumns.jsx";
export function render(props) { return renderToStaticMarkup(<WorkColumns onSelect={() => {}} onOpenDraft={() => {}} {...props} />); }
`;
    const out = await esbuild.build({
      stdin: { contents: harness, resolveDir: HERE, sourcefile: "work-columns.harness.jsx", loader: "jsx" },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4130-columns-")), "harness.mjs");
    fs.writeFileSync(file, out.outputFiles[0].text);
    ({ render } = await import(pathToFileURL(file).href));
  });

  // #4130 (rework): the column's number is cards only (the send card with a
  // ready draft included), the same definition as the Dashboard, the Work
  // menu and the Team dashboard; loose drafts get their own "+N drafts".
  it("the first column is Waiting on a person and counts its cards; loose drafts are listed with their own count", () => {
    const { byCard, loose } = splitDrafts(drafts, [sendCard, spendCard]);
    const html = render({ cards: [sendCard, spendCard], drafts: loose, draftsByCard: byCard, allDraftsHref: "#/work-board?drafts=all" });
    assert.equal(WORK_COLUMNS[0].label, "Waiting on a person");
    assert.equal(workStatusLabel("person"), "Waiting on a person");
    const first = html.slice(0, html.indexOf('id="work-col-todo"'));
    assert.match(first, /<span>Waiting on a person<\/span><span[^>]*><span[^>]*aria-label="2 cards"[^>]*>2<\/span><span[^>]*>\+2 drafts<\/span>/);
    assert.ok(!/Needs you/.test(html), "the retired name is gone");
    assert.match(first, /data-draft-item="41300000-0000-4000-8000-0000000000d2"[\s\S]*Send a message to Gallery/);
    assert.match(first, /data-draft-item="41300000-0000-4000-8000-0000000000d3"/);
    assert.equal((first.match(/data-draft-ready=""/g) || []).length, 1, "only the send card carrying a draft says Draft ready");
    assert.match(first, /Sends a message[\s\S]*Draft ready/);
    assert.match(first, /Spends money/);
    assert.match(first, /href="#\/work-board\?drafts=all"[^>]*>All my message drafts, sent and discarded</);
  });

  it("with no drafts the column still lists its cards and says nothing about drafts", () => {
    const html = render({ cards: [spendCard], drafts: [], draftsByCard: new Map() });
    assert.ok(!/data-draft-item|data-draft-ready|All my message drafts/.test(html));
  });
});

describe("W1-7 everything Needs you did is reachable from Work", () => {
  const page = code("pages/WorkBoardPage.jsx");
  const detail = code("components/ops/WorkDetail.jsx");
  const panels = code("components/ops/CardPersonPanels.jsx");
  const drafts = code("pages/DraftsPage.jsx");
  it("a send card shows its drafts with every draft action; a roadmap card shows the wording editor", () => {
    assert.match(detail, /<CardDrafts card=\{card\} \/>/);
    assert.match(detail, /<CardWording card=\{card\} onChanged=\{refresh\} \/>/);
    assert.match(panels, /<DraftsPage key=\{id\} embedded=\{\{ search: `record=\$\{id\}` \}\} \/>/);
    assert.match(panels, /<WordingCard card=\{wording\}/);
    for (const action of ["service.updateDraft", "service.markDraftSent", "service.discardDrafts", "service.restoreDraft", "service.undoDraftSent"]) {
      assert.ok(drafts.includes(action), action);
    }
  });
  it("embedded, the drafts screen is only the message drafts, kept in its own address", () => {
    assert.match(drafts, /export function DraftsPage\(\{ embedded = null \}\)/);
    assert.match(drafts, /const search = embedded \? localSearch : hashSearch;/);
    assert.match(drafts, /\{!embedded && <Segmented label="What to review"/);
  });
  it("spend and publish approvals stay the card's own actions", () => {
    assert.match(detail, /\["sendback", "approve_spend", "mark_sent", "mark_published"\]\.includes\(form\)/);
  });
  it("the page opens a draft, a record's drafts or all drafts in the drawer", () => {
    assert.match(page, /<DraftsPage key=\{view\.draft \|\| view\.record \|\| "all"\} embedded=\{\{ search: view\.draft \? `draft=\$\{view\.draft\}` : view\.record \? `record=\$\{view\.record\}` : "" \}\} \/>/);
    assert.match(page, /onOpenDraft=\{\(d\) => go\(\{ draft: d\.id \}\)\}/);
  });
  it("the person chips filter on the server; the views read the new functions through the one service", () => {
    assert.match(page, /useOpsWork\(\{ who, week: query\.week, owner: ownerFilter, q: view\.q \}\)/);
    assert.match(code("hooks/useOpsWork.js"), /\.\.\.\(owner \? \{ owner \} : \{\}\)/);
    const service = read("services/opsService.js");
    assert.match(service, /supabase\.rpc\("ops_events_since", \{ p_since: since, p_owner: owner \|\| null \}\)/);
    assert.match(service, /supabase\.rpc\("ops_period_summary", \{ p_from: from, p_to: to, p_owner: owner \|\| null, p_tz: tz \|\| null \}\)/);
    assert.match(read("services/crmService.js"), /supabase\.rpc\("crm_team_pulse", \{ p_from: from, p_to: to \}\)/);
    assert.match(code("components/ops/WorkViews.jsx"), /<LoadError title=\{title\} message=\{opsErrorWords\(read\.error\)\} onRetry=\{\(\) => read\.refetch\(\)\} \/>/);
  });
});

describe("W1-8 the Team dashboard", () => {
  const page = code("pages/TeamDashboardPage.jsx");
  it("numbers first, then pipelines, due list, targets, the runway collapsed", () => {
    const at = (needle) => { const i = page.indexOf(needle, page.indexOf("return (\n    <div")); assert.ok(i > 0, needle); return i; };
    const order = [at('aria-label="The team’s numbers"'), at('<MovesChart title="Hosts pipeline"'), at('<DueList\n'), at("<TargetsCard\n"), at("<details data-runway")];
    assert.deepEqual([...order].sort((x, y) => x - y), order);
  });
  it("the one-time settings left the dashboard and are exported for Settings", () => {
    for (const gone of ["<AutomaticSteps", "<BrandCardsBackfill", "<TeamOpsPanels", "<WeekByPerson", "<NextStepConversion"]) assert.ok(!page.includes(gone), gone);
    const settings = code("components/ops/TeamSettingsPanels.jsx");
    for (const name of ["AutomaticSteps", "BrandCardsBackfill", "TeamAutomationSettings"]) assert.match(settings, new RegExp(`export function ${name}\\(\\{ online \\}\\)`));
    assert.match(settings, /export \{ NextStepsToCards \};/);
  });
  it("six numbers in order; a number that did not load is a dash, never 0", () => {
    const config = { pipelines: { creators: { stages: [{ id: "booked", label: "Booked" }] } } };
    const pulse = { now: { hosts_contacted: 38, hosts_onboarded: 4, beta_leads: 21, moves: { creators: { booked: 3 } } }, before: { hosts_contacted: 26, hosts_onboarded: 4, beta_leads: 14, moves: { creators: { booked: 2 } } } };
    const runway = { counts: { full: 3, tight: 1, organic: 1, missed: 0, not_live: 1 }, at_risk: [{}, {}] };
    const tiles = pulseTiles({ pulse, targets: [{ monthly_target: 5, done: 4 }], runway, waiting: 5, config, period: "week" });
    assert.deepEqual(tiles.map((t) => t.key), ["contacted", "onboarded", "events", "creators", "leads", "waiting"]);
    assert.deepEqual(tiles.map((t) => t.value), [38, 4, 6, 3, 21, 5]);
    assert.equal(tiles[0].note, "+12 vs last week");
    assert.equal(tiles[1].note, "4 of 5 this month's target");
    assert.equal(tiles[2].note, "2 short on promotion time");
    assert.equal(tiles[2].alert, true);
    assert.equal(tiles[3].label, "Creators moved to Booked");
    const failed = pulseTiles({ pulse: null, targets: [], runway: null, waiting: null, config, period: "30d" });
    assert.deepEqual(failed.map((t) => t.value), [null, null, null, null, null, null]);
    assert.match(page, /\{tile\.value === null \? "–" : tile\.value\}/);
  });
  it("the pipeline charts follow the stage order and count moves into each stage", () => {
    const config = { pipelines: { hosts: { stages: [{ id: "prospect", label: "Prospect" }, { id: "contacted", label: "Contacted" }, { id: "live", label: "Live" }] } } };
    assert.deepEqual(stageMoves(config, "hosts", { contacted: 4, live: 1 }), [
      { id: "prospect", label: "Prospect", moved: 0 }, { id: "contacted", label: "Contacted", moved: 4 }, { id: "live", label: "Live", moved: 1 },
    ]);
    const now = new Date(2026, 9, 28, 12);
    assert.equal(pulseRange("week", now).from.getDay(), 1);
    assert.equal(Math.round((now - pulseRange("30d", now).from) / 86_400_000), 30);
  });
});

describe("W1-9 the migration", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20280110004130_issue_4130_work_views_and_team_pulse.sql"), "utf8");
  const fn = (name) => { const a = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); assert.ok(a > 0, name); return sql.slice(a, sql.indexOf("\n$$;", a)); };
  it("each read is gated like its page's existing reads", () => {
    assert.match(fn("ops_events_since"), /SELECT \* INTO v FROM public\.crm_ctx\(\);/);
    assert.match(fn("ops_period_summary"), /SELECT \* INTO v FROM public\.crm_ctx\(\);/);
    assert.match(fn("crm_team_pulse"), /IF NOT public\.is_admin_user\(\) THEN[\s\S]*SELECT \* INTO v FROM public\.crm_ctx\(\);/);
  });
  it("SECURITY DEFINER, a pinned search_path, never anon or PUBLIC, helpers for no client", () => {
    for (const name of ["ops_events_since", "ops_period_summary", "crm_team_pulse", "ops_events_window", "ops_period_cards"]) {
      assert.match(fn(name), /SECURITY DEFINER SET search_path = public, pg_temp/, name);
    }
    for (const sig of ["ops_events_since(timestamptz, text)", "ops_period_summary(timestamptz, timestamptz, text, text)", "crm_team_pulse(timestamptz, timestamptz)"]) {
      assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`), sig);
    }
    assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.ops_events_window(timestamptz, text) FROM PUBLIC, anon, authenticated;"));
    assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.ops_period_cards(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;"));
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\./i.test(sql), "read-only");
  });
});
