// Issue #4255 (Waves 2 and 3) — the Admin UI simplification, implementor suite.
//
//   S-1  the side panels: up to two, docked and non-modal; panel one stays
//        mounted (hidden, never removed) while panel two covers it on a narrow
//        screen; what is typed in panel one is kept per item across panel two
//        opening, closing and changing, and is cleared on sign-out; a linked
//        item inside a panel is a button that opens panel two, never a link
//        that leaves the page; the address keeps panel one and names panel two
//        as side=<kind>:<id>
//   S-2  Hosts and creators: the board is the only view; every card that
//        passes the filters is in exactly one column, so the column counts add
//        up to the cards shown; a stale card is only in Stale, tagged with its
//        stage; big columns show 8 then "Show all N"; the funnel counts the
//        same cards
//   S-3  Work: four tabs, one filter for every tab (the board and the three
//        period tabs run the same workFilter); This week and This month use
//        the Today layout; "+N more" is a button that shows every card; the
//        period read pages through every card and asks for the cards closed
//        inside the window
//   S-4  Calendar: Month and Board only, no list view, Make a card and Plan a
//        post in the event panel and the header
//
// Run: node --test src/__tests__/issue4255_admin_simplify.implementor.test.js
// (from mingla-admin). The rendered parts build the real components with
// esbuild (run `npm ci` first; without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanSide, linkSide, parseSide, parseSideValue, popTrail, pushTrail, sideHref, withSide } from "../lib/panelStack.js";
import { boardColumns, columnShown, isStale, stageCounts, COLUMN_PAGE } from "../lib/outreachView.js";
import { buildCrmSearch, parseCrmSearch } from "../lib/crmUrl.js";
import { WORK_VIEWS, parseWorkView, periodBucket, periodRows, periodShown, periodWindow, workFilter } from "../lib/workViews.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));

const CARD = "42550000-0000-4000-8000-0000000000c1";
const HOST = "42550000-0000-4000-8000-0000000000a1";

const HARNESS = `
import { renderToStaticMarkup } from "react-dom/server";
import { PanelLinksContext, PanelStack, SideLink } from "../components/ui/PanelStack.jsx";
import { Drawer } from "../components/ui/Drawer.jsx";
import { usePanelDraft } from "../hooks/usePanelDraft.js";
import { PipelineBoard } from "../components/crm/PipelineBoard.jsx";
import { PeriodList } from "../components/ops/WorkViews.jsx";
export * as drafts from "../lib/panelDrafts.js";
export { runSignOutCleanup } from "../lib/signOutCleanup.js";
export { listAllWork, loadPeriod } from "../components/ops/workToday.js";

let setter = null;
function Note({ id }) {
  const [value, setValue, kept] = usePanelDraft("work:" + id + ":note", "");
  setter = setValue;
  return <textarea data-note={id} data-kept={kept.kept ? "1" : "0"} value={value} readOnly />;
}
export function typeNote(text) { setter(text); }

export function stack({ second = false, narrow = false, links = true } = {}) {
  const noop = () => {};
  const first = (
    <Drawer open onClose={noop} title="Card A">
      <Note id="A" />
      <SideLink side={{ kind: "host", id: "${HOST}" }} href="#/outreach?tab=hosts&card=${HOST}">Rooftop</SideLink>
    </Drawer>
  );
  const two = second ? <Drawer open onClose={noop} title="Rooftop"><p data-host-panel="">host</p></Drawer> : null;
  const panels = { trail: [], back: noop, closeSide: noop, titles: { current: {} } };
  const tree = <PanelStack stack={panels} narrow={narrow} first={first} second={two} />;
  return renderToStaticMarkup(links ? <PanelLinksContext.Provider value={{ openSide: noop }}>{tree}</PanelLinksContext.Provider> : tree);
}

export function board(props) {
  return renderToStaticMarkup(<PipelineBoard regions={[]} team={[]} pendingIds={new Set()} onOpen={() => {}} onMove={() => {}} {...props} />);
}

export function periodList(props) {
  return renderToStaticMarkup(<PeriodList bucket={{ key: "doing", label: "Doing" }} onToggle={() => {}} onOpenCard={() => {}} {...props} />);
}
`;

let harness;
before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  // The rendered components never talk to the database here.
  const noSupabase = {
    name: "no-supabase",
    setup(build) {
      build.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: "supabase-stub", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const supabase = { rpc: async () => ({ data: null, error: null }) };", loader: "js" }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: HERE, sourcefile: "issue4255.harness.jsx", loader: "jsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [noSupabase],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4255-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

// ── S-1 the side panels ──────────────────────────────────────────────────

describe("S-1 the side panels", () => {
  it("typed text in panel one survives panel two opening, closing and covering it", () => {
    harness.drafts.clearPanelDrafts();
    assert.match(harness.stack(), /<textarea data-note="A" data-kept="0"[^>]*><\/textarea>/);
    harness.typeNote("Called them, waiting on the menu");
    const withSecond = harness.stack({ second: true });
    assert.match(withSecond, /data-note="A" data-kept="1"[^>]*>Called them, waiting on the menu<\/textarea>/, "kept while panel two is open");
    assert.match(withSecond, /data-host-panel=""/);
    assert.match(withSecond, /data-panel-stack="side-by-side"/);
    const narrow = harness.stack({ second: true, narrow: true });
    // D10: panel two covers panel one with Back; panel one is hidden, never removed.
    assert.match(narrow, /data-panel-stack="covered"/);
    assert.match(narrow, /data-panel-slot="1" aria-hidden="true" class="[^"]*\bhidden\b[^"]*">[\s\S]*Called them, waiting on the menu/);
    assert.match(narrow, /data-panel-back=""[\s\S]*Back to /);
    assert.match(harness.stack(), /data-kept="1"[^>]*>Called them, waiting on the menu</, "and still there once panel two closed");
  });

  it("the panels are docked and non-modal: no scrim, aria-modal false, one Esc owner", () => {
    const html = harness.stack({ second: true });
    assert.equal((html.match(/role="dialog" aria-modal="false"/g) || []).length, 2);
    assert.ok(!/aria-modal="true"/.test(html), "a docked panel never traps the page");
    assert.ok(!/bg-black\/40/.test(html), "no scrim");
    const drawer = code("components/ui/Drawer.jsx");
    assert.match(drawer, /if \(!open \|\| suspended \|\| slot\) return undefined;/, "inside a panel the drawer neither locks the page nor handles Esc");
    const panelStack = code("components/ui/PanelStack.jsx");
    assert.match(panelStack, /const top = hasSecond \? entries\.current\[2\] : entries\.current\[1\];/, "Esc closes the top panel");
    assert.match(panelStack, /if \(document\.querySelector\('\[aria-modal="true"\]'\)\) return;/);
  });

  it("saving or discarding forgets the draft; signing out clears every draft", () => {
    harness.drafts.clearPanelDrafts();
    harness.typeNote("half a note");
    assert.equal(harness.drafts.hasPanelDrafts(), true);
    harness.typeNote("");
    assert.equal(harness.drafts.hasPanelDrafts(), false, "back to the saved value is no draft");
    harness.typeNote("again");
    harness.runSignOutCleanup();
    assert.equal(harness.drafts.hasPanelDrafts(), false, "Constitution rule 6: logout clears everything");
    // Clearing a saved field is a change worth keeping.
    harness.drafts.setPanelDraft("work:B:title", "");
    assert.equal(harness.drafts.getPanelDraft("work:B:title"), "");
    harness.drafts.clearPanelDrafts();
  });

  it("a linked item inside a panel is a button that opens panel two, never a link away", () => {
    const html = harness.stack();
    assert.match(html, new RegExp(`<button type="button" data-side-link="host:${HOST}"[^>]*>Rooftop</button>`));
    assert.ok(!html.includes(`href="#/outreach?tab=hosts&amp;card=${HOST}"`));
    // Outside a page with panels the same link is the plain link it always was.
    assert.match(harness.stack({ links: false }), new RegExp(`<a href="#/outreach\\?tab=hosts&amp;card=${HOST}"[^>]*>Rooftop</a>`));
    // Every link the spec lists goes through SideLink now.
    for (const [file, side] of [
      ["components/ops/EventPanel.jsx", 'kind: "host"'],
      ["components/ops/EventPanel.jsx", 'kind: "card"'],
      ["components/ops/EventSteps.jsx", 'kind: "card"'],
      ["components/ops/CardPersonPanels.jsx", 'kind: "drafts"'],
      ["components/drafts/DraftCard.jsx", "kind: draft.record.pipeline"],
      ["components/ops/WorkDetail.jsx", "side={linkSide(l)}"],
      ["components/crm/RecordDrawer.jsx", 'kind: "drafts"'],
      ["components/crm/OnMinglaSection.jsx", 'kind: "card"'],
    ]) {
      assert.ok(code(file).includes("<SideLink") && code(file).includes(side), `${file} opens ${side} in panel two`);
    }
    assert.match(code("components/ops/WorkDetail.jsx"), /draftHref && <a href=\{draftHref\} target="_blank"/, "the Roadmap draft opens in a new tab, so the card is kept");
  });

  it("the address keeps panel one and names panel two; odd values never open anything", () => {
    assert.equal(withSide(`card=${CARD}&view=today`, { kind: "host", id: HOST }), `card=${CARD}&view=today&side=host%3A${HOST}`);
    assert.deepEqual(parseSide(`card=${CARD}&side=host:${HOST}`), { kind: "host", id: HOST });
    assert.equal(withSide(`card=${CARD}&side=host:${HOST}`, null), `card=${CARD}`);
    for (const bad of ["side=host", "side=job:" + HOST, "side=host:nope", "side=__proto__:x", "side=drafts:everything", "side=" + "x".repeat(100)]) {
      assert.equal(parseSide(bad), null, bad);
    }
    assert.deepEqual(parseSideValue("drafts:all"), { kind: "drafts", id: "all" });
    assert.equal(cleanSide({ kind: "card", id: CARD.toUpperCase() }).id, CARD);
    assert.equal(sideHref({ kind: "creator", id: HOST }), `#/outreach?tab=creators&card=${HOST}`);
    assert.deepEqual(linkSide({ kind: "expected", id: HOST }), { kind: "expected", id: HOST });
    assert.equal(linkSide({ kind: "github", id: HOST }), null);
    // Hosts and creators keeps panel two in its own address too.
    assert.equal(parseCrmSearch(buildCrmSearch({ card: CARD, side: `card:${HOST}` })).side, `card:${HOST}`);
  });

  it("opening another linked item keeps a Back trail", () => {
    const a = { kind: "host", id: HOST };
    const b = { kind: "card", id: CARD };
    let trail = pushTrail([], { side: a, title: "Rooftop" }, b);
    assert.deepEqual(trail, [{ side: a, title: "Rooftop" }]);
    assert.deepEqual(pushTrail(trail, { side: b, title: "Card" }, b), trail, "reopening what is shown changes nothing");
    const back = popTrail(trail);
    assert.deepEqual(back.back.side, a);
    assert.deepEqual(back.trail, []);
    assert.deepEqual(popTrail([]), { trail: [], back: null });
  });
});

// ── S-2 Hosts and creators ───────────────────────────────────────────────

const HOSTS_DEF = {
  label: "Hosts",
  stages: [
    { id: "prospect", label: "Prospect" },
    { id: "contacted", label: "Contacted" },
    { id: "replied", label: "Replied" },
    { id: "meeting", label: "Meeting" },
    { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true },
    { id: "lost", label: "Lost", terminal: true },
  ],
};
const TODAY = "2026-11-03";

function hostCards() {
  const cards = [];
  let n = 0;
  const add = (stage, due, count) => {
    for (let i = 0; i < count; i++) cards.push({ id: `h${n++}`, name: `Host ${n}`, stage, due_on: due, owners: [], region_id: null, icp: "" });
  };
  add("prospect", "2026-10-20", 12); // stale, early stage (the 589 the old board hid)
  add("prospect", "2026-11-10", 3);
  add("contacted", "2026-10-01", 9); // stale
  add("contacted", null, 4);
  add("replied", "2026-11-03", 2);
  add("meeting", "2026-10-30", 1); // stale, late stage
  add("lost", "2026-09-01", 3); // never stale
  return cards;
}

describe("S-2 Hosts and creators: one honest board", () => {
  it("every card is in exactly one column, so the counts add up to the cards shown", () => {
    const cards = hostCards();
    const columns = boardColumns(HOSTS_DEF, cards, TODAY);
    assert.deepEqual(columns.map((c) => c.id), ["stale", "prospect", "contacted", "replied", "meeting", "onboarded", "live", "lost"]);
    const placed = columns.flatMap((c) => c.cards.map((r) => r.id));
    assert.equal(placed.length, cards.length, "no card dropped");
    assert.equal(new Set(placed).size, cards.length, "no card twice");
    // Early stages are on the board: the old late-stage board showed 1 of these 22 stale cards.
    const stale = columns.find((c) => c.id === "stale");
    assert.equal(stale.cards.length, 22);
    assert.equal(stale.cards.length, cards.filter((r) => isStale(r, TODAY)).length, "the Stale count is the one stale rule");
  });

  it("a stale card is only in Stale, oldest first; Lost is never stale", () => {
    const columns = boardColumns(HOSTS_DEF, hostCards(), TODAY);
    for (const col of columns.filter((c) => c.kind === "stage")) {
      assert.ok(col.cards.every((r) => !isStale(r, TODAY)), `${col.id} holds no stale card`);
    }
    const stale = columns.find((c) => c.id === "stale").cards;
    assert.deepEqual([...stale].map((r) => r.due_on), [...stale].map((r) => r.due_on).sort());
    assert.equal(columns.find((c) => c.id === "lost").cards.length, 3);
    // A future next-step date takes a card out of Stale and back to its stage.
    const moved = hostCards().map((r) => (r.id === "h0" ? { ...r, due_on: "2026-11-20" } : r));
    const after = boardColumns(HOSTS_DEF, moved, TODAY);
    assert.ok(!after.find((c) => c.id === "stale").cards.some((r) => r.id === "h0"));
    assert.ok(after.find((c) => c.id === "prospect").cards.some((r) => r.id === "h0"));
  });

  it("a card naming a stage the pipeline lost goes to Other, never off the board", () => {
    const warned = [];
    const columns = boardColumns(HOSTS_DEF, [{ id: "x", stage: "retired", due_on: null }], TODAY, { warn: (m) => warned.push(m) });
    assert.deepEqual(columns.at(-1).cards.map((r) => r.id), ["x"]);
    assert.equal(warned.length, 1);
  });

  it("the funnel counts the same cards as the board (stale cards in their stage)", () => {
    const cards = hostCards();
    const counts = stageCounts(cards);
    const columns = boardColumns(HOSTS_DEF, cards, TODAY);
    const open = HOSTS_DEF.stages.filter((s) => !s.terminal).reduce((n, s) => n + (counts[s.id] || 0), 0);
    const onBoardOpen = columns.filter((c) => !c.terminal).reduce((n, c) => n + c.cards.length, 0);
    assert.equal(open, onBoardOpen, "funnel total = Stale + open columns");
  });

  it("a big column shows 8, then Show all N; Lost starts folded; the header counts every card", () => {
    const columns = boardColumns(HOSTS_DEF, hostCards(), TODAY);
    const stale = columns.find((c) => c.id === "stale");
    assert.equal(COLUMN_PAGE, 8);
    assert.deepEqual(columnShown(stale, false).shown.length, 8);
    assert.deepEqual(columnShown(stale, false).hidden, 14);
    assert.equal(columnShown(stale, true).shown.length, 22);
    assert.equal(columnShown(columns.find((c) => c.id === "lost"), false).shown.length, 0);
    const html = harness.board({ def: HOSTS_DEF, columns, today: TODAY });
    assert.match(html, /data-column-count="stale"[^>]*>22</);
    assert.match(html, /data-show-all="stale"[^>]*>Show all 22</);
    assert.match(html, /data-show-all="lost"[^>]*>Show 3</);
    const staleSection = html.slice(html.indexOf('data-column="stale"'), html.indexOf('data-column="prospect"'));
    assert.equal((staleSection.match(/data-record-id=/g) || []).length, 8);
    assert.equal((staleSection.match(/data-stage-tag=/g) || []).length, 8, "every stale card says its stage");
    assert.match(staleSection, /data-stage-tag="contacted"[\s\S]*?>Contacted</);
    // The Stale column takes no drop (it is not a stage).
    assert.ok(!/data-column="stale"[^>]*data-stage=/.test(html));
    for (const col of columns) assert.match(html, new RegExp(`data-column-count="${col.id}"[^>]*>${col.cards.length}<`), col.id);
  });

  it("the page: board only, no list or By region, no agent strip, dropdown filters, the board built from every filtered card", () => {
    const page = code("pages/PipelinePage.jsx");
    assert.ok(!/PipelineList|PipelineByRegion|lateStage|AgentPromptStrip|state\.view/.test(page));
    assert.ok(!fs.existsSync(path.join(SRC, "components/crm/PipelineList.jsx")));
    assert.ok(!fs.existsSync(path.join(SRC, "components/crm/PipelineByRegion.jsx")));
    assert.match(page, /const columns = useMemo\(\(\) => \(def \? boardColumns\(def, dueShown\.map\(forDisplay\), today\) : \[\]\), \[def, dueShown, today\]\);/);
    assert.match(page, /const funnelCounts = useMemo\(\(\) => stageCounts\(dueShown\), \[dueShown\]\);/);
    assert.match(page, /<FunnelStrip def=\{def\} stages=\{funnelCounts\}/);
    // The agent strip stays on the pages that still use it.
    assert.match(read("pages/BetaLeadsPage.jsx"), /<AgentPromptStrip/);
    const toolbar = code("components/crm/PipelineToolbar.jsx");
    for (const name of ["owner", "due", "icp"]) assert.match(toolbar, new RegExp(`<FilterSelect\\s+name="${name}"`));
    assert.match(toolbar, /data-filter="region"/);
    assert.ok(!/Segmented|By region|VIEWS/.test(toolbar));
    // Old links still open: a list or region view is the board; the old host toggles are Due choices.
    assert.equal(buildCrmSearch(parseCrmSearch("view=list&filter=nonext&mine=1")), "mine=1&due=nonext");
    assert.equal(buildCrmSearch(parseCrmSearch("view=region")), "");
    assert.equal(parseCrmSearch("owner=None").owner, "none");
  });
});

// ── S-3 Work ─────────────────────────────────────────────────────────────

const ME = "seth@x.test";
function workCards() {
  return [
    { id: "1", number: 1, title: "Call Rooftop", status: "doing", owners: [{ email: ME, name: "Seth" }], watchers: [], links: [{ kind: "host", id: HOST }], due_on: "2026-11-03" },
    { id: "2", number: 2, title: "Post the recap", status: "todo", owners: [{ email: "abi@x.test", name: "Abimbola" }], watchers: [{ email: ME }], links: [], anchor: { kind: "event", id: "e" }, due_on: "2026-10-28", overdue: true },
    { id: "3", number: 3, title: "Fix the agreement", status: "doing", blocked: true, owners: [{ email: "abi@x.test", name: "Abimbola" }], watchers: [], links: [{ kind: "creator", id: HOST }], due_on: null },
    { id: "4", number: 4, title: "Approve boost", status: "person", owners: [{ email: ME, name: "Seth" }], watchers: [], links: [], due_on: "2026-11-30" },
    { id: "5", number: 5, title: "Shipped the flyer", status: "done", owners: [{ email: ME, name: "Seth" }], watchers: [], links: [], closed_at: "2026-11-03T08:00:00Z" },
    { id: "6", number: 6, title: "Old win", status: "done", owners: [{ email: ME, name: "Seth" }], watchers: [], links: [], closed_at: "2026-10-01T08:00:00Z" },
  ];
}

describe("S-3 Work: one filter, four tabs, one layout", () => {
  it("exactly four tabs, Board first; old tab addresses land in the right place (D9)", () => {
    assert.deepEqual(WORK_VIEWS.map((v) => v.label), ["Board", "Today", "This week", "This month"]);
    assert.equal(parseWorkView("").view, "board");
    assert.equal(parseWorkView("tab=attention").show, "attention");
    assert.equal(parseWorkView("tab=activity").view, "today");
    assert.equal(parseWorkView("who=watching").show, "watch");
    assert.equal(parseWorkView("show=bogus&linked=bogus").show, "");
    assert.equal(parseWorkView("show=bogus&linked=bogus").linked, "");
  });

  it("the one filter: owner, Show, Linked to and search", () => {
    const ids = (f) => workFilter(workCards(), { me: ME, today: "2026-11-03", ...f }).map((c) => c.id);
    assert.deepEqual(ids({}), ["1", "2", "3", "4", "5", "6"]);
    assert.deepEqual(ids({ owner: ME }), ["1", "4", "5", "6"]);
    assert.deepEqual(ids({ show: "watch" }), ["2"]);
    assert.deepEqual(ids({ show: "attention" }), ["2", "3", "4"], "overdue, blocked, waiting on a person");
    assert.deepEqual(ids({ show: "overdue" }), ["2"]);
    assert.deepEqual(ids({ show: "blocked" }), ["3"]);
    assert.deepEqual(ids({ linked: "host" }), ["1"]);
    assert.deepEqual(ids({ linked: "creator" }), ["3"]);
    assert.deepEqual(ids({ linked: "calendar" }), ["2"]);
    assert.deepEqual(ids({ q: "recap" }), ["2"]);
    assert.deepEqual(ids({ q: "card 4" }), ["4"]);
    assert.deepEqual(ids({ owner: ME, show: "attention" }), ["4"]);
  });

  it("every tab runs the same filter: the board and the three period tabs", () => {
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /const cards = useMemo\(\(\) => workFilter\(allCards, filters\)/);
    assert.match(page, /const periodCards = useMemo\(\(\) => workFilter\(period\.data\?\.cards \|\| \[\], filters\)/);
    assert.match(page, /<WorkColumns cards=\{cards\}/);
    assert.match(page, /<PeriodView win=\{win\} read=\{period\} cards=\{periodCards\}/);
    // One filter bar above the tabs; one row of tabs.
    assert.ok(page.indexOf('data-work-filters=""') < page.indexOf("<Tabs tabs={WORK_VIEWS"));
    assert.equal((page.match(/<Tabs /g) || []).length, 1);
    assert.ok(!/NeedsAttention|AttentionChips|PersonChips|parseWorkTab|WorkToday|WorkWeek|WorkMonth/.test(page));
    // The board reads only while it is on screen; the period tabs read their window.
    assert.match(page, /useOpsWork\(\{ who, week: query\.week, owner: ownerFilter, q: view\.q, enabled: onBoard \}\)/);
    assert.match(page, /enabled: !onBoard,/);
    assert.ok(!fs.existsSync(path.join(SRC, "components/ops/NeedsAttention.jsx")));
    assert.ok(!/WorkGroups/.test(code("components/ops/WorkColumns.jsx")));
  });

  it("Today, This week and This month: Done closed inside the window, open cards due by its end", () => {
    const now = new Date(2026, 10, 3, 10, 0); // Tue 3 Nov 10:00 local
    const week = periodWindow("week", now);
    assert.equal(week.dueBy, "2026-11-08");
    assert.equal(week.from.getDate(), 2);
    const month = periodWindow("month", now);
    assert.equal(month.dueBy, "2026-11-30");
    const today = periodWindow("today", now);
    assert.equal(today.dueBy, "2026-11-03");
    const cards = workCards().map((c) => (c.closed_at ? { ...c, closed_at: c.id === "5" ? new Date(2026, 10, 3, 8).toISOString() : c.closed_at } : c));
    assert.equal(periodBucket(cards[4], week), "done");
    assert.equal(periodBucket(cards[5], week), null, "closed before the window");
    assert.equal(periodBucket(cards[3], week), null, "due after Sunday");
    assert.equal(periodBucket(cards[3], month), "waiting");
    assert.equal(periodBucket(cards[2], today), "blocked", "undated counts");
    assert.equal(periodBucket(cards[1], today), null, "a To do card is in no list");
    const { totals, rows } = periodRows(cards, month, [{ email: ME, name: "Seth" }, { email: "abi@x.test", name: "Abimbola" }]);
    assert.deepEqual(totals, { done: 1, doing: 1, blocked: 1, waiting: 1 });
    assert.deepEqual(rows.map((r) => r.name), ["Seth", "Abimbola"]);
    assert.deepEqual(rows[0].waiting.map((c) => c.id), ["4"]);
    // The three tabs share one layout component.
    const views = code("components/ops/WorkViews.jsx");
    assert.match(views, /export function PeriodView\(/);
    assert.ok(!/export function WorkToday|export function WorkWeek|export function WorkMonth|recharts/.test(views));
    assert.match(views, /\{win\.view === "today" && \(\s*<>\s*<WhatChanged [\s\S]*?<AgentActivity \/>/, "Activity at the foot of Today (D9)");
  });

  it('"+N more" is a button and shows every card', () => {
    const list = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, title: `Card ${i}` }));
    assert.deepEqual(periodShown(list, false), { shown: list.slice(0, 3), more: 4 });
    assert.deepEqual(periodShown(list, true), { shown: list, more: 0 });
    const closed = harness.periodList({ cards: list, expanded: false });
    assert.match(closed, /<button type="button" data-period-more="doing" aria-expanded="false"[^>]*>\+4 more<\/button>/);
    assert.equal((closed.match(/data-card-id=/g) || []).length, 3);
    const open = harness.periodList({ cards: list, expanded: true });
    assert.equal((open.match(/data-card-id=/g) || []).length, 7);
    assert.match(open, /aria-expanded="true"[^>]*>Show less<\/button>/);
    assert.ok(!/\+\d+ more/.test(harness.periodList({ cards: list.slice(0, 3), expanded: false })), "no button when nothing is hidden");
  });

  it("the period read pages through every card and asks for the cards closed inside the window", async () => {
    const calls = [];
    const pages = [{ cards: [{ id: "a" }, { id: "b" }], truncated: true }, { cards: [{ id: "c" }], truncated: false }];
    const list = async (q) => { calls.push(q); return pages[calls.length - 1]; };
    const all = await harness.listAllWork({ status: ["todo"] }, list);
    assert.deepEqual(all.cards.map((c) => c.id), ["a", "b", "c"], "every page, so +N more can list everything");
    assert.deepEqual(calls.map((q) => q.offset ?? 0), [0, 2]);
    assert.ok(calls.every((q) => q.limit === 300));

    const win = periodWindow("week", new Date(2026, 10, 3, 10));
    const asked = [];
    const answer = await harness.loadPeriod(win, { owner: ME, who: "all", q: "flyer" }, async (q) => {
      asked.push(q);
      return q.status[0] === "done" ? { cards: [{ id: "d", status: "done", closed_at: win.from.toISOString() }], truncated: false } : { cards: [{ id: "o", status: "doing" }], truncated: false };
    });
    assert.deepEqual(answer.cards.map((c) => c.id), ["o", "d"]);
    const done = asked.find((q) => q.status[0] === "done");
    assert.equal(done.closed_since, win.from.toISOString());
    assert.equal(done.closed_until, win.to.toISOString());
    assert.equal(done.owner, ME);
    assert.equal(done.q, "flyer");
    assert.deepEqual(asked.find((q) => q.status[0] !== "done").status, ["todo", "doing", "person"]);

    // [TRANSITIONAL] a server without the new migration: done_days, cut to the window.
    const old = await harness.loadPeriod(win, {}, async (q) => {
      if (q.closed_since) { const e = new Error("x"); e.token = "invalid_query"; e.message = 'The board cannot filter by "closed_since".'; throw e; }
      if (q.status[0] === "done") return { cards: [{ id: "in", closed_at: win.from.toISOString() }, { id: "before", closed_at: new Date(win.from.getTime() - 1).toISOString() }] };
      return { cards: [] };
    });
    assert.deepEqual(old.cards.map((c) => c.id), ["in"]);
  });
});

// ── S-4 Calendar ─────────────────────────────────────────────────────────

describe("S-4 Calendar: Month and Board only", () => {
  const page = code("pages/ContentCalendarPage.jsx");
  it("no list view: Month (default) and Board, an old list address opens Month", () => {
    assert.match(page, /const VIEW_OPTIONS = \[\s*\{ value: "calendar", label: "Month" \},\s*\{ value: "board", label: "Board" \},\s*\];/);
    assert.match(page, /view: p\.get\("view"\) === "board" \? "board" : "calendar"/);
    assert.ok(!/RunwayTable|PostsList|value: "list"|route\.view === "list"/.test(page));
  });
  it("Make a card and Plan a post sit in the event panel and the header; the tiles filter the month", () => {
    assert.match(page, /<EventPanel selection=\{route\.event\} onBack=\{closeFirst\} online=\{online\} embedded actions=\{actionsFor\(route\.event\)\} \/>/);
    assert.match(page, />Make a card<\/Button>[\s\S]*>Plan a post<\/Button>/);
    assert.match(page, /onClick=\{\(\) => openFirst\("add", "card"\)\}>Make a card<\/Button>/);
    assert.match(page, /onClick=\{\(\) => planPost\(null\)\}>Plan a post<\/Button>/);
    assert.match(page, /data-state-tile=\{key\}/);
    assert.ok(!/setParam\("view", "list"\)/.test(page));
  });
  it("anything clicked opens in the side panels; a host, card or post from it opens beside", () => {
    assert.match(page, /<PanelStack stack=\{stack\} first=\{first\} second=\{second\} \/>/);
    assert.match(page, /<PanelLinksContext\.Provider value=\{stack\.links\}>/);
    assert.match(code("components/ops/EventPanel.jsx"), /<SideLink side=\{\{ kind: "host", id: host\.record_id \}\}/);
    // A new card from the event panel opens beside the event.
    assert.match(page, /if \(id\) stack\.openSide\(\{ kind: "card", id \}\);/);
  });
});
