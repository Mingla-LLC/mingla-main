// Issue #4270 (Wave 1) — tester adversarial suite for the Admin Work board
// and work card rules. It attacks edges the implementor's happy path leaves
// alone:
//
//   XA-1  the column order under ties, missing dates, numbers as strings,
//         server-shaped timestamps (whole seconds vs fractions) and never
//         mutating the server's list
//   XA-2  Done's "this week" at the Monday boundary, on a Monday and on a
//         Sunday
//   XA-3  the Files link check against hostile and boundary input, kept in
//         step with the server's rule (https, 9 to 2,000 characters, no
//         spaces of any kind)
//   XA-4  the Status dropdown: a done card, the retired status, no card,
//         and the same status chosen again never write
//   XA-5  a tag on a done or removed card is no tag; the tag can come from
//         either key
//   XA-6  the Due today state never turns a failed or half read into 0
//   XA-7  "No owner" is shown on a tagged card too; the retired words are
//         gone from every label the board and the card show
//
// Run: node --test src/__tests__/issue4270_work_board.tester.adversarial.test.js
// (from mingla-admin). Pure: no React, no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAG_LABELS,
  WORK_COLUMNS,
  WORK_STATUSES,
  cardReasons,
  columnCards,
  dueTodayState,
  filesUrlProblem,
  isTagged,
  kitStateChip,
  personReasonLabel,
  sortColumn,
  statusChoice,
  workStatusLabel,
} from "../lib/opsModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const titles = (list) => list.map((c) => c.title).join("|");

describe("XA-1 the column order", () => {
  it("open columns: same due day goes by card number, not title or input order", () => {
    const cards = [
      { title: "alpha", number: 30, due_on: "2026-11-05", status: "todo" },
      { title: "zulu", number: 4, due_on: "2026-11-05", status: "todo" },
      { title: "mike", number: 12, due_on: "2026-11-05", status: "todo" },
    ];
    assert.equal(titles(sortColumn(cards, "todo")), "zulu|mike|alpha");
  });
  it("card numbers that arrive as strings still sort as numbers (9 before 10)", () => {
    const cards = [
      { title: "ten", number: "10", due_on: "2026-11-05" },
      { title: "nine", number: "9", due_on: "2026-11-05" },
    ];
    assert.equal(titles(sortColumn(cards, "doing")), "nine|ten");
  });
  it("a due date with a time part sorts by its day; a card with no date goes last in every column", () => {
    const open = [
      { title: "none", number: 1, due_on: null },
      { title: "later", number: 2, due_on: "2026-11-09T00:00:00+00:00" },
      { title: "late", number: 3, due_on: "2026-10-30" },
    ];
    assert.equal(titles(sortColumn(open, "todo")), "late|later|none");
    const done = [
      { title: "none", number: 1, due_on: null, closed_at: "2026-11-04T10:00:00+00:00" },
      { title: "old", number: 2, due_on: "2026-11-01", closed_at: "2026-11-04T11:00:00+00:00" },
      { title: "new", number: 3, due_on: "2026-11-03", closed_at: "2026-11-02T09:00:00+00:00" },
    ];
    assert.equal(titles(sortColumn(done, "done")), "new|old|none");
  });
  it("Done on the same due day: latest closed first, even across whole-second and fractional timestamps; then number", () => {
    const done = [
      { title: "whole", number: 5, due_on: "2026-11-03", closed_at: "2026-11-04T10:00:00+00:00" },
      { title: "frac", number: 6, due_on: "2026-11-03", closed_at: "2026-11-04T10:00:00.5+00:00" },
      { title: "earlier", number: 7, due_on: "2026-11-03", closed_at: "2026-11-04T09:59:59.999999+00:00" },
      { title: "twin-b", number: 9, due_on: "2026-11-03", closed_at: "2026-11-04T08:00:00+00:00" },
      { title: "twin-a", number: 8, due_on: "2026-11-03", closed_at: "2026-11-04T08:00:00+00:00" },
    ];
    assert.equal(titles(sortColumn(done, "done")), "frac|whole|earlier|twin-a|twin-b");
  });
  it("never reorders the list it was given", () => {
    const cards = [
      { title: "b", number: 2, due_on: "2026-11-06" },
      { title: "a", number: 1, due_on: "2026-11-05" },
    ];
    const before = titles(cards);
    sortColumn(cards, "todo");
    columnCards(cards.map((c) => ({ ...c, status: "todo" })), "todo", "2026-11-04");
    assert.equal(titles(cards), before);
  });
  it("garbage in is an empty column, not a crash", () => {
    assert.deepEqual(sortColumn(null, "todo"), []);
    assert.deepEqual(sortColumn(undefined, "done"), []);
    assert.deepEqual(columnCards("nope", "todo", "2026-11-04"), []);
  });
});

// #4270 rework (P3-3, P3-5): which done cards are "this week" is the
// server's call (closed since Monday 00:00 in the viewer's time zone, the
// pg17 X-WINDOW and R-WEEK checks); the client never re-cuts Done with a
// second clock. A card still marked person is To do with its tag.
describe("XA-2 Done is the server's week; a retired person card is To do", () => {
  const done = (title, closed_at) => ({ title, number: title.length, status: "done", due_on: "2026-11-01", closed_at });
  const cards = [
    done("sunday-late", "2026-11-01T23:59:59+00:00"),
    done("monday-start", "2026-11-02T00:00:00+00:00"),
    { title: "open", number: 1, status: "todo", due_on: "2026-11-01" },
  ];
  it("Done lists every done card it is given, and never an open one", () => {
    assert.deepEqual(columnCards(cards, "done").map((c) => c.title).sort(), ["monday-start", "sunday-late"]);
  });
  it("To do never holds a done card; a card in the retired status is To do", () => {
    const list = [
      { title: "done", number: 1, status: "done", due_on: "2026-11-01", closed_at: "2026-11-04T01:00:00+00:00" },
      { title: "retired", number: 2, status: "person", person_reason: "send", due_on: "2026-11-01" },
      { title: "todo", number: 3, status: "todo", due_on: "2026-11-01" },
    ];
    assert.equal(titles(columnCards(list, "todo")), "retired|todo");
  });
});

describe("XA-3 the Files link check matches the server's rule", () => {
  const refused = [
    "http://drive.example.com/x",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "HTTPS://drive.example.com/x",
    "ftp://drive.example.com/x",
    "//drive.example.com/x",
    "https://",
    "https:/drive.example.com",
    "https://a b",
    "https://a\tb",
    "https://a\nb",
    "https://a b",
    "https://a b",
    "https://example.com/" + "a".repeat(1981),
  ];
  for (const value of refused) {
    it(`refuses ${JSON.stringify(value.length > 60 ? value.slice(0, 40) + "… (" + value.length + " chars)" : value)}`, () => {
      assert.equal(filesUrlProblem(value), "Links start with https://");
    });
  }
  it("keeps exactly 2,000 characters, a 9-character link and a padded link", () => {
    const max = "https://example.com/" + "a".repeat(1980);
    assert.equal(max.length, 2000);
    assert.equal(filesUrlProblem(max), "");
    assert.equal(filesUrlProblem("https://a"), "");
    assert.equal(filesUrlProblem("   https://drive.example.com/padded   "), "");
  });
  it("empty, blank, null and undefined mean no link (the card clears it)", () => {
    for (const v of ["", "   ", null, undefined]) assert.equal(filesUrlProblem(v), "");
  });
  // #4255 W3: the Files link is one of the card's link files; a link opens in
  // a new tab with noopener, and a link is refused past 2,000 characters.
  it("the card's links open in a new tab without handing the page an opener", () => {
    const src = read("hooks/useCardFiles.js");
    // #4255 fix-up (ORCH-1381): through the one openExternal owner, which opens
    // with no feature string and sets opener to null itself.
    assert.match(src, /if \(file\.kind === "link"\) \{ openExternal\(file\.url\); return; \}/);
    assert.match(src, /import \{ openExternal \} from "\.\.\/lib\/openExternal";/);
    assert.match(read("lib/openExternal.js"), /win\.opener = null;/);
    assert.match(read("components/ops/CardFiles.jsx"), /maxLength=\{2000\}/, "the field stops at 2,000 characters");
  });
});

describe("XA-4 the Status dropdown never writes by accident", () => {
  it("a done card: no choice in the dropdown does anything", () => {
    const card = { status: "done" };
    for (const next of ["todo", "doing", "done", "person"]) assert.equal(statusChoice(card, next), null);
  });
  it("the retired status, an unknown value and nothing chosen do nothing", () => {
    for (const status of ["todo", "doing"]) {
      for (const next of ["person", "Person", "DONE", "", null, undefined]) assert.equal(statusChoice({ status }, next), null);
    }
  });
  it("choosing the status the card already has does nothing", () => {
    assert.equal(statusChoice({ status: "todo" }, "todo"), null);
    assert.equal(statusChoice({ status: "doing" }, "doing"), null);
  });
  it("no card, no write", () => {
    assert.equal(statusChoice(null, "done"), null);
    assert.equal(statusChoice(undefined, "doing"), null);
  });
  it("a tagged card choosing Done goes to proof (a person closes it), never straight to a status write", () => {
    assert.equal(statusChoice({ status: "todo", person_reason: "send" }, "done"), "close");
    assert.equal(statusChoice({ status: "doing", tag: "spend" }, "done"), "close");
  });
  it("the dropdown offers exactly To do, In progress, Done", () => {
    assert.deepEqual(WORK_STATUSES.map((s) => s.value), ["todo", "doing", "done"]);
    assert.equal(workStatusLabel("person"), "");
  });
});

describe("XA-5 a tag only counts on an open card", () => {
  it("done or removed: not tagged, whatever the keys say", () => {
    assert.equal(isTagged({ status: "done", person_reason: "send", tag: "send" }), false);
    assert.equal(isTagged({ status: "todo", person_reason: "send", archived: true }), false);
    assert.equal(isTagged(null), false);
    assert.equal(isTagged({ status: "todo", person_reason: "" }), false);
  });
  it("either key tags an open card", () => {
    assert.equal(isTagged({ status: "todo", tag: "publish" }), true);
    assert.equal(isTagged({ status: "doing", person_reason: "other" }), true);
  });
  it("the label never falls back to the retired words", () => {
    assert.equal(personReasonLabel({ person_reason: "nonsense" }), "Needs your OK");
    assert.equal(personReasonLabel({}), "Needs your OK");
    assert.equal(personReasonLabel({ auto_kind: "roadmap_shipped", person_reason: "other" }), "Approve what hosts are told");
    assert.equal(personReasonLabel({ tag: "spend", person_reason: "send" }), "You spend", "tag wins over the old key");
  });
  it("a tagged card's chip warns; a done tagged card's chip says Done", () => {
    assert.equal(kitStateChip({ card: { status: "todo", person_reason: "send" }, state: "card" }).tone, "warning");
    assert.equal(kitStateChip({ card: { status: "done", person_reason: "send" }, state: "card" }).label, "Done");
  });
});

describe("XA-6 Due today never invents a 0", () => {
  it("a failed read is an error, not 0", () => {
    assert.deepEqual(dueTodayState({ data: null, error: new Error("offline") }), { status: "error", dueToday: null, overdue: null });
  });
  it("a half answer (one count missing or not a number) is an error, not 0", () => {
    assert.equal(dueTodayState({ data: { due_today_mine: 2 } }).status, "error");
    assert.equal(dueTodayState({ data: { overdue_mine: 1 } }).status, "error");
    assert.equal(dueTodayState({ data: { due_today_mine: "two", overdue_mine: 1 } }).status, "error");
    assert.equal(dueTodayState({ data: { due_today_mine: Infinity, overdue_mine: 0 } }).status, "error");
  });
  it("an older server that only sends waiting_on_person_mine is an error, never read as due today", () => {
    assert.equal(dueTodayState({ data: { waiting_on_person_mine: 5 } }).status, "error");
  });
  it("numbers as strings are read; still loading is loading", () => {
    assert.deepEqual(dueTodayState({ data: { due_today_mine: "3", overdue_mine: "0" } }), { status: "ready", dueToday: 3, overdue: 0 });
    assert.equal(dueTodayState({ data: null, error: null }).status, "loading");
  });
  it("the Work menu badge adds due today and overdue only when both are read", () => {
    const src = read("hooks/useReviewCount.js");
    assert.match(src, /work\.status === "ready" \? work\.dueToday \+ work\.overdue : null/);
  });
});

describe("XA-7 owners and words", () => {
  it("a tagged open card with no owner says No owner (D1)", () => {
    assert.ok(cardReasons({ status: "todo", person_reason: "send", owners: [] }).includes("No owner"));
    assert.ok(cardReasons({ status: "doing", tag: "spend" }).includes("No owner"));
    assert.deepEqual(cardReasons({ status: "done", owners: [] }), []);
  });
  it("no column, status or tag label uses the retired words", () => {
    const words = [
      ...WORK_COLUMNS.flatMap((c) => [c.label, c.note]),
      ...WORK_STATUSES.map((s) => s.label),
      ...Object.values(TAG_LABELS),
    ].join(" | ");
    assert.doesNotMatch(words, /needs? a person|waiting on a person|waiting on you/i);
    assert.deepEqual(WORK_COLUMNS.map((c) => c.key), ["todo", "doing", "done"]);
  });
  it("the board, the card, the strip, the Dashboard and the menu say nothing about waiting on a person", () => {
    for (const rel of ["components/ops/WorkBoard.jsx", "components/ops/WorkDetail.jsx", "components/ops/SprintBar.jsx",
      "pages/WorkBoardPage.jsx", "pages/OverviewPage.jsx", "lib/dashboardToday.js", "components/layout/Sidebar.jsx",
      "components/ops/TeamOpsPanels.jsx", "components/ops/MyCardsPanels.jsx"]) {
      const shown = read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
      assert.doesNotMatch(shown, /["'`>][^"'`<]*(Waiting on a person|Needs a person|need a person|Waiting on you)/, rel);
    }
  });
});
