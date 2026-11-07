// Issue #4270 (Wave 1 rework) — implementor regression tests for the tester's
// W1 defects on the Admin side.
//
//   R-1  P2-1: the board asks for each column on its own (per_status), and the
//        tabs and headers show each column's true count; a cut column says
//        "Showing the first N of M"; with Show or Linked to on, the count is
//        what is listed
//   R-2  P3-1: a tagged In progress card is listed once in the standup and
//        once in a period view, under Needs your OK
//   R-3  P3-3: Done is what the server sent (closed since Monday in your time
//        zone); the board does not cut it again with its own clock; the board
//        sends tz
//   R-4  P3-4: To review copy and the agent log say "needs your OK", never
//        "needs a person"
//   R-5  P3-5: a card the server still marks person is To do with its tag
//   R-6  P3-6: nothing due today but some late reads "3 overdue Work cards for you"
//
// Run: node --test src/__tests__/issue4270_w1_rework.implementor.test.js
// (from mingla-admin; R-1 builds WorkColumns with esbuild: run `npm ci` first,
// without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boardStatus, columnCards, isTagged, logActionWords, readPersonAsTodo } from "../lib/opsModel.js";
import { periodRows, standupRows, standupText } from "../lib/workViews.js";
import { needsYouToday } from "../lib/dashboardToday.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));
const card = (id, status, due, extra = {}) => ({ id, number: Number(id), title: `Card ${id}`, status, due_on: due, owners: [{ email: "seth@x.test", name: "Seth" }], ...extra });

let harness;
before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const out = await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
import { WorkColumns } from "../components/ops/WorkColumns.jsx";
export function columns(props) { return renderToStaticMarkup(<WorkColumns onSelect={() => {}} onOpenDraft={() => {}} {...props} />); }`,
      resolveDir: HERE, sourcefile: "issue4270.rework.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-rework-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

describe("R-1 a long To do never empties In progress or Done (P2-1)", () => {
  const cards = [card("1", "todo", "2026-11-02"), card("2", "todo", "2026-11-03"), card("3", "doing", "2026-11-05"), card("4", "done", "2026-11-03", { closed_at: "2026-11-03T08:00:00Z" })];
  const columnInfo = { todo: { total: 412, shown: 300, truncated: true }, doing: { total: 1, shown: 1, truncated: false }, done: { total: 1, shown: 1, truncated: false } };
  it("tabs and headers show each column's true count from the server", () => {
    const html = harness.columns({ cards, columnInfo });
    assert.match(html, /id="work-col-tab-todo"[^>]*>[\s\S]*?To do<\/span> <span class="tabular-nums">412<\/span>/);
    assert.match(html, /id="work-col-tab-doing"[^>]*>[\s\S]*?In progress<\/span> <span class="tabular-nums">1<\/span>/);
    assert.match(html, /aria-label="412 cards"/);
  });
  it("only the cut column says so, with the numbers", () => {
    const html = harness.columns({ cards, columnInfo });
    assert.match(html, /data-column-cut="todo"[^>]*>\s*Showing the first 300 of 412\. Filter by owner or search to see the rest\./);
    assert.doesNotMatch(html, /data-column-cut="doing"|data-column-cut="done"/);
    assert.match(html, /data-column="doing"[\s\S]*?Card 3/);
  });
  it("without the server's numbers (Show or Linked to on), the count is what is listed", () => {
    const html = harness.columns({ cards, columnInfo: null });
    assert.match(html, /id="work-col-tab-todo"[^>]*>[\s\S]*?To do<\/span> <span class="tabular-nums">2<\/span>/);
    assert.doesNotMatch(html, /data-column-cut=/);
  });
  it("the board asks for each column on its own and drops the one-page notice", () => {
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /useOpsWork\(\{[^}]*limit: BOARD_LIMIT, perStatus: true/);
    assert.match(page, /columnInfo=\{view\.show \|\| view\.linked \? null : list\.data\?\.columns \|\| null\}/);
    assert.doesNotMatch(page, /Showing the first \$\{BOARD_LIMIT\} cards/);
    const hook = code("hooks/useOpsWork.js");
    assert.match(hook, /\.\.\.\(perStatus \? \{ per_status: true \} : \{\}\)/);
  });
});

describe("R-2 a tagged In progress card is listed once (P3-1)", () => {
  const people = [{ email: "seth@x.test", name: "Seth" }];
  const open = [card("1", "doing", "2026-11-04", { title: "Draft the newsletter", person_reason: "send", tag: "send" }), card("2", "doing", "2026-11-04", { title: "Fix the venue page" })];
  it("the standup puts it under Blocked or waiting only", () => {
    const rows = standupRows(people, open, []);
    assert.deepEqual(rows[0].doing.map((c) => c.title), ["Fix the venue page"]);
    assert.deepEqual(rows[0].blocked.map((c) => c.title), ["Draft the newsletter"]);
    const text = standupText(rows, new Date("2026-11-04T09:00:00Z"));
    assert.equal(text.split("Draft the newsletter").length - 1, 1);
  });
  it("a period view counts it once, under Needs your OK", () => {
    const win = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z"), dueBy: "2026-11-30" };
    const { totals } = periodRows(open, win, people);
    assert.deepEqual(totals, { done: 0, doing: 1, blocked: 0, waiting: 1 });
  });
});

describe("R-3 one meaning of Done this week (P3-3)", () => {
  it("Done lists every done card the server sent, whatever day it closed", () => {
    const list = [card("1", "done", "2026-11-01", { closed_at: "2026-11-02T03:00:00Z" }), card("2", "done", "2026-10-30", { closed_at: "2026-11-01T23:30:00Z" })];
    // 2 closed on Sunday evening UTC; in Lagos that is Monday. The server decides.
    assert.deepEqual(columnCards(list, "done").map((c) => c.id), ["1", "2"]);
  });
  it("the board sends its time zone with the list", () => {
    assert.match(code("hooks/useOpsWork.js"), /tz: browserTimeZone\(\)/);
    assert.doesNotMatch(code("lib/opsModel.js"), /slice\(0, 10\) >= monday/);
  });
});

describe("R-4 no screen says a card needs a person (P3-4)", () => {
  it("To review and the agent log use the new words", () => {
    const drafts = read("pages/DraftsPage.jsx");
    assert.doesNotMatch(drafts, /needs? a person/i);
    assert.match(drafts, /Only what needs your OK: messages to send/);
    assert.match(drafts, /Nothing needs your OK right now/);
    assert.equal(logActionWords("needs_person"), "tagged a card for your OK");
  });
});

describe("R-5 a card still marked person is To do (P3-5)", () => {
  it("the service reads it as To do with its tag; it shows in To do", () => {
    const data = readPersonAsTodo({ cards: [card("1", "person", "2026-11-04", { person_reason: "spend" }), card("2", "doing", "2026-11-04")] });
    assert.deepEqual(data.cards.map((c) => `${c.status}/${c.tag || "-"}`), ["todo/spend", "doing/-"]);
    assert.equal(isTagged(data.cards[0]), true);
    assert.deepEqual(columnCards([card("9", "person", "2026-11-04", { person_reason: "send" })], "todo").map((c) => c.id), ["9"]);
    assert.equal(boardStatus({ status: "person" }), "todo");
    assert.equal(readPersonAsTodo({ card: card("3", "person", "2026-11-04", { person_reason: "other" }) }).card.status, "todo");
  });
  it("every ops call goes through it", () => {
    assert.match(code("services/opsService.js"), /return readPersonAsTodo\(result\.data\);/);
  });
});

describe("R-6 only late cards (P3-6)", () => {
  it("reads as overdue, never 0 due today", () => {
    const items = needsYouToday({ work: { status: "ready", data: { dueToday: 0, overdue: 3 } } });
    const work = items.find((i) => i.id === "work-due");
    assert.equal(work.title, "3 overdue Work cards for you");
    assert.equal(work.detail, "Nothing is due today.");
    const both = needsYouToday({ work: { status: "ready", data: { dueToday: 2, overdue: 1 } } }).find((i) => i.id === "work-due");
    assert.equal(both.title, "2 Work cards due today for you");
    assert.equal(both.detail, "1 overdue");
  });
});
