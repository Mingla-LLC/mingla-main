// Issue #4270 (Wave 1) — implementor happy path for the Admin Work board and
// work card.
//
//   B-1  three columns (To do, In progress, Done); "Waiting on a person" is gone
//   B-2  the order (D3): To do and In progress late first, then by due date,
//        no date last; Done latest due first, then latest closed first
//   B-3  rendered: phone tabs with counts, three panels, tags on any column,
//        loose drafts at the top of To do; nothing scrolls sideways
//   B-4  the sprint strip says due today and overdue, never "need a person"
//   B-5  the Status dropdown: Done asks for proof first (no status write),
//        In progress starts the card, To do from In progress updates it
//   B-6  the Files link: https only, its host on the button
//   B-7  the Dashboard tile is "Due today for you"; the Work menu count is
//        due today plus overdue; a failed read is never 0
//   B-8  the board asks for 300 cards and says when there are more; phone
//        filters fold behind one Filters button
//
// Run: node --test src/__tests__/issue4270_work_board.implementor.test.js
// (from mingla-admin). B-3 and B-4 build the real components with esbuild
// (run `npm ci` first; without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  WORK_COLUMNS,
  WORK_STATUSES,
  columnCards,
  dueTodayState,
  filesHost,
  filesUrlProblem,
  isTagged,
  personReasonLabel,
  sortColumn,
  statusChoice,
} from "../lib/opsModel.js";
import { needsYouToday } from "../lib/dashboardToday.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));

const card = (id, status, due, extra = {}) => ({ id, number: Number(id), title: `Card ${id}`, status, due_on: due, owners: [{ email: "seth@x.test", name: "Seth" }], ...extra });

describe("B-1 three columns", () => {
  it("To do, In progress and Done; the statuses match", () => {
    assert.deepEqual(WORK_COLUMNS.map((c) => c.key), ["todo", "doing", "done"]);
    assert.deepEqual(WORK_COLUMNS.map((c) => c.label), ["To do", "In progress", "Done"]);
    assert.deepEqual(WORK_STATUSES.map((s) => s.value), ["todo", "doing", "done"]);
    assert.equal(WORK_COLUMNS[2].note, "This week, latest due first");
  });
  it("a tag is not a status: an open card with person_reason is tagged and says what the person does", () => {
    assert.equal(isTagged(card("1", "todo", "2026-11-04", { person_reason: "send" })), true);
    assert.equal(isTagged(card("1", "doing", "2026-11-04", { tag: "spend" })), true);
    assert.equal(isTagged(card("1", "done", "2026-11-04", { person_reason: "send" })), false);
    assert.equal(isTagged(card("1", "todo", "2026-11-04")), false);
    assert.equal(personReasonLabel({ person_reason: "send" }), "You send");
    assert.equal(personReasonLabel({ tag: "spend" }), "You spend");
    assert.equal(personReasonLabel({ person_reason: "publish" }), "You publish");
    assert.equal(personReasonLabel({ person_reason: "other" }), "Needs your OK");
    assert.equal(personReasonLabel({ person_reason: "publish", auto_kind: "roadmap_shipped" }), "Approve what hosts are told");
  });
});

describe("B-2 the order (D3)", () => {
  it("To do and In progress: late first, then today, then later, no date last, ties by number", () => {
    const list = [card("5", "todo", "2026-11-10"), card("2", "todo", "2026-11-01"), card("7", "todo", null), card("4", "todo", "2026-11-04"), card("3", "todo", "2026-11-01")];
    assert.deepEqual(sortColumn(list, "todo").map((c) => c.id), ["2", "3", "4", "5", "7"]);
    assert.deepEqual(sortColumn(list, "doing").map((c) => c.id), ["2", "3", "4", "5", "7"]);
  });
  it("Done: latest due first, then latest closed first", () => {
    const list = [
      card("1", "done", "2026-11-01", { closed_at: "2026-11-03T10:00:00Z" }),
      card("2", "done", "2026-11-05", { closed_at: "2026-11-03T09:00:00Z" }),
      card("3", "done", "2026-11-05", { closed_at: "2026-11-03T11:00:00Z" }),
    ];
    assert.deepEqual(sortColumn(list, "done").map((c) => c.id), ["3", "2", "1"]);
  });
  // #4270 rework (P3-3): the server decides which done cards are this week
  // (closed since Monday 00:00 in your time zone); the board only sorts them.
  it("columnCards filters by column then sorts; Done is what the server sent", () => {
    const cards = [
      card("1", "todo", "2026-11-09"), card("2", "todo", "2026-11-02"),
      card("3", "done", "2026-11-03", { closed_at: "2026-11-03T08:00:00Z" }),
      card("4", "done", "2026-10-20", { closed_at: "2026-11-02T08:00:00Z" }),
    ];
    assert.deepEqual(columnCards(cards, "todo").map((c) => c.id), ["2", "1"]);
    assert.deepEqual(columnCards(cards, "done").map((c) => c.id), ["3", "4"]);
  });
});

let harness;
before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const contents = `
import { renderToStaticMarkup } from "react-dom/server";
import { WorkColumns } from "../components/ops/WorkColumns.jsx";
import { SprintStrip } from "../components/ops/SprintStrip.jsx";
export function columns(props) { return renderToStaticMarkup(<WorkColumns onSelect={() => {}} onOpenDraft={() => {}} {...props} />); }
export function strip(props) { return renderToStaticMarkup(<SprintStrip onGoal={() => {}} onWeek={() => {}} onThisWeek={() => {}} {...props} />); }
`;
  const out = await esbuild.build({
    stdin: { contents, resolveDir: HERE, sourcefile: "issue4270.harness.jsx", loader: "jsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-board-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

describe("B-3 rendered: the board", () => {
  const today = "2026-11-04";
  const cards = [
    card("1", "todo", "2026-11-09"),
    card("2", "todo", "2026-11-02", { person_reason: "send", tag: "send" }),
    card("3", "doing", "2026-11-05", { person_reason: "spend", tag: "spend" }),
    card("4", "done", "2026-11-03", { closed_at: "2026-11-03T08:00:00Z", close_kind: "done" }),
  ];
  it("phone tabs carry each column's count; three panels; To do is open first", () => {
    const html = harness.columns({ cards, today });
    assert.match(html, /role="tablist" aria-label="Column"/);
    assert.match(html, /id="work-col-tab-todo"[^>]*aria-selected="true"[^>]*>[\s\S]*?To do<\/span> <span class="tabular-nums">2<\/span>/);
    assert.match(html, /id="work-col-tab-doing"[^>]*aria-selected="false"[^>]*>[\s\S]*?In progress<\/span> <span class="tabular-nums">1<\/span>/);
    assert.match(html, /id="work-col-tab-done"[^>]*>[\s\S]*?Done<\/span> <span class="tabular-nums">1<\/span>/);
    assert.equal((html.match(/data-column="/g) || []).length, 3);
    // On a phone only the chosen column shows; from 768px all three share the width.
    assert.match(html, /data-column="todo"[^>]*class="min-w-0 flex-col gap-2 flex"/);
    assert.match(html, /data-column="doing"[^>]*class="min-w-0 flex-col gap-2 hidden md:flex"/);
    assert.match(html, /grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3/);
    assert.ok(!/overflow-x-auto|minmax\(220px/.test(html), "nothing scrolls sideways");
  });
  it("To do lists the late card first; tags show in any column; no retired words", () => {
    const html = harness.columns({ cards, today });
    const todo = html.slice(html.indexOf('data-column="todo"'), html.indexOf('data-column="doing"'));
    assert.ok(todo.indexOf('data-card-id="2"') < todo.indexOf('data-card-id="1"'), "the late card is on top");
    assert.match(todo, /You send/);
    const doing = html.slice(html.indexOf('data-column="doing"'), html.indexOf('data-column="done"'));
    assert.match(doing, /You spend/);
    assert.match(html, /Late first, then by due date/);
    assert.match(html, /This week, latest due first/);
    assert.ok(!/Waiting on a person|Needs a person|need a person/.test(html));
  });
  it("loose drafts sit at the top of To do, with their link at its foot", () => {
    const drafts = [{ id: "42700000-0000-4000-8000-0000000000d1", state: "waiting", record: { id: "h", name: "Rooftop" }, created_via: "claude" }];
    const html = harness.columns({ cards, today, drafts, allDraftsHref: "#/work-board?drafts=all" });
    const todo = html.slice(html.indexOf('data-column="todo"'), html.indexOf('data-column="doing"'));
    assert.ok(todo.indexOf("data-draft-item=") < todo.indexOf('data-card-id="2"'));
    assert.match(todo, /\+1 draft/);
    assert.match(todo, /All my message drafts, sent and discarded/);
  });
  it("an empty column says Nothing here.", () => {
    const html = harness.columns({ cards: [], today });
    assert.equal((html.match(/Nothing here\./g) || []).length, 3);
  });
});

describe("B-4 the sprint strip", () => {
  it("says what is due today and overdue, never how many need a person", () => {
    const html = harness.strip({ sprint: { starts_on: "2026-11-02" }, counts: { todo: 3, doing: 1, done: 2 }, overdue: 2, dueToday: 1, online: true, isThisWeek: true });
    assert.match(html, />1 due today</);
    assert.match(html, />2 overdue</);
    assert.match(html, />4 open</);
    assert.ok(!/need a person/.test(html));
  });
});

describe("B-5 the Status dropdown", () => {
  it("Done asks for proof; In progress starts; To do from In progress updates; nothing else writes", () => {
    assert.equal(statusChoice({ status: "todo" }, "done"), "close");
    assert.equal(statusChoice({ status: "doing" }, "done"), "close");
    assert.equal(statusChoice({ status: "todo" }, "doing"), "start");
    assert.equal(statusChoice({ status: "doing" }, "todo"), "to_todo");
    assert.equal(statusChoice({ status: "todo" }, "todo"), null);
    assert.equal(statusChoice({ status: "done" }, "todo"), null);
  });
  it("choosing Done only opens the proof form; the dropdown shows Done until Cancel", () => {
    const detail = code("components/ops/WorkDetail.jsx");
    assert.match(detail, /const statusValue = form === "close" && !closed \? "done" : card\.status;/);
    assert.match(detail, /if \(what === "close"\) setForm\("close"\);/);
    assert.match(detail, /else if \(what === "start"\) \{ setForm\(""\); run\("start", \(\) => ops\.startWork\(card\.id, card\.revision\), "Started"\); \}/);
    assert.match(detail, /else if \(what === "to_todo"\) \{ setForm\(""\); update\(\{ status: "todo" \}, "Moved to To do"\); \}/);
    assert.match(detail, /data-status-select=""[\s\S]{0,80}value=\{statusValue\}/);
    assert.match(detail, /\{form === "close" && <ProofForm [^\n]*onCancel=\{\(\) => setForm\(""\)\}[^\n]*ops\.closeWork\(card\.id, proof/);
  });
  it("the card's order: header, Next step, Who and when, What to do, Links and files, the record", () => {
    const detail = code("components/ops/WorkDetail.jsx");
    const at = (needle) => { const i = detail.indexOf(needle); assert.ok(i > 0, needle); return i; };
    const order = [
      at('data-next-step=""'), at('<Section title="Who and when">'), at('<Section title="What to do">'),
      at("<FilesLink card={card}"), at('<Section title="Linked records"'), at("<GithubLinks card={card}"),
      at('<Section title="Result">'), at('<Fold id="notes"'), at('<Fold id="history"'), at('<Fold id="prompt"'), at('<Fold id="remove"'),
    ];
    assert.deepEqual([...order].sort((x, y) => x - y), order);
    for (const kept of ["Assign to me", "Mark blocked", "Push back", "Send back", "Reopen", "Override", "Unblock", "Open the draft in Roadmap", "<PlanSteps", "<NoteBox", "<CardHistory", "agentPromptFor(card)", "ops.archiveWork", "<CardDrafts card={card} />", "<CardWording card={card}", "<WorkingMark", "<RecordPicker", "<GithubWait"]) {
      assert.ok(detail.includes(kept), kept);
    }
  });
});

describe("B-6 the Files link", () => {
  it("https only, one link of up to 2,000 characters", () => {
    assert.equal(filesUrlProblem(""), "");
    assert.equal(filesUrlProblem("https://drive.google.com/drive/folders/abc"), "");
    assert.equal(filesUrlProblem("http://drive.google.com/x"), "Links start with https://");
    assert.equal(filesUrlProblem("javascript:alert(1)"), "Links start with https://");
    assert.equal(filesUrlProblem("https://drive.google.com/a b"), "Links start with https://");
    assert.equal(filesUrlProblem(`https://x.test/${"a".repeat(2000)}`), "Links start with https://");
    assert.equal(filesHost("https://drive.google.com/drive/folders/abc"), "drive.google.com");
    assert.equal(filesHost("not a link"), "files");
  });
  it("the card and the add form both offer it", () => {
    assert.match(code("components/ops/WorkDetail.jsx"), /update\(\{ files_url: url \}, words\)/);
    const add = code("components/ops/WorkAddForm.jsx");
    assert.match(add, /if \(filesUrl\.trim\(\)\) out\.files_url = filesUrl\.trim\(\);/);
    assert.match(add, /disabled=\{!online \|\| busy \|\| !!filesError\}/);
  });
});

describe("B-7 Due today for you", () => {
  it("one state for the tile and the menu count; a failed read is never 0", () => {
    assert.deepEqual(dueTodayState({ data: { due_today_mine: 2, overdue_mine: 3 } }), { status: "ready", dueToday: 2, overdue: 3 });
    assert.deepEqual(dueTodayState({ data: null, error: new Error("x") }), { status: "error", dueToday: null, overdue: null });
    const hook = code("hooks/useReviewCount.js");
    assert.match(hook, /cards: work\.status === "ready" \? work\.dueToday \+ work\.overdue : null,/);
    const page = code("pages/OverviewPage.jsx");
    assert.match(page, /<Kpi\s+label="Due today for you"\s+note=\{`\$\{Number\(review\.overdue \|\| 0\)\.toLocaleString\(\)\} overdue`\}/);
    assert.match(page, /<KpiFailed label="Due today for you"/);
    assert.ok(!/Waiting on you/.test(page));
    assert.match(code("components/layout/Sidebar.jsx"), /`\$\{item\.label\}, \$\{waiting\} due`/);
  });
  it("the Dashboard item names what is due today and how much is overdue", () => {
    const items = needsYouToday({ work: { status: "ready", data: { dueToday: 1, overdue: 4 } } });
    const work = items.find((i) => i.id === "work-due");
    assert.equal(work.title, "1 Work card due today for you");
    assert.equal(work.detail, "4 overdue");
    assert.equal(needsYouToday({ work: { status: "ready", data: { dueToday: 0, overdue: 0 } } }).find((i) => i.area === "work"), undefined);
  });
});

describe("B-8 the board page", () => {
  // #4270 rework (P2-1): 300 cards per column, and the cut line is per column (WorkColumns).
  it("asks for 300 cards per column; phone filters behind one button", () => {
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /const BOARD_LIMIT = 300;/);
    assert.match(page, /limit: BOARD_LIMIT, perStatus: true, enabled: onBoard/);
    assert.match(code("components/ops/WorkColumns.jsx"), /Filter by owner or search to see the rest\./);
    assert.match(page, /aria-expanded=\{filtersOpen\} aria-controls="work-filter-panel" data-filters-button=""/);
    assert.match(page, /\{filtersOpen \? "flex" : "hidden"\} w-full min-w-0 flex-col gap-2 sm:flex/);
    assert.match(page, /grid grid-cols-1 gap-2 md:grid-cols-3" aria-busy="true"/);
    assert.ok(!/person: 0/.test(page), "the strip counts no person status");
  });
});
