// #4255 tester adversarial — Admin Messages and the Work board v2, from angles
// the implementor suites do not take: forged and malformed input, boundaries,
// and error paths.
//
//   T-1 #/messages?thread=… only opens a well-formed chat id (no path or
//       script smuggled into the panel state); a notice link that leaves
//       Admin opens nothing
//   T-2 the badge never reads NaN, a string or a negative as a number, and a
//       failed first read shows no badge rather than 0
//   T-3 a drop is decided by the column, not the card's old status words; a
//       conflict always reads the one sentence, any other failure keeps its
//       own words (Constitution rule 3)
//   T-4 files: exactly 25 MB passes, one byte more is refused before upload
//       with the spec's words; empty files, SVG, HTML and scripts are refused
//       whatever their name; links must be https
//   T-5 the one-line header folds at the contract's widths (1024 folded,
//       1440 full, 390 compact)
//
// FAILS-ON-REVERT (proved by editing the line, re-running, restoring; see the
// #4255 tester verdict): the uuid test in threadFromSearch (T-1); the
// `badge == null && inbox == null` guard in messagesBadge (T-2); the
// FILE_MAX_BYTES comparison in fileProblem (T-4).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messagesBadge, rowTarget, threadFromSearch } from "../lib/messagesModel.js";
import {
  FILE_MAX_BYTES,
  MOVE_CONFLICT_WORDS,
  fileProblem,
  headerFit,
  linkProblem,
  moveErrorWords,
  planMove,
} from "../lib/workBoardModel.js";

const T = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("T-1 only a well-formed chat id opens", () => {
  it("accepts a chat id, upper or lower case", () => {
    assert.equal(threadFromSearch(`?tab=chats&thread=${T}`), T);
    assert.equal(threadFromSearch(`thread=${T.toUpperCase()}`), T.toUpperCase());
  });
  it("refuses smuggled paths, scripts, partial ids and doubled values", () => {
    for (const bad of [
      `?thread=${T}/../../admin`,
      `?thread=${T}%3Cscript%3E`,
      `?thread=../${T}`,
      `?thread=${T.slice(0, 35)}`,
      "?thread=javascript:alert(1)",
      `?thread=%20${T}`,
      "",
      null,
      undefined,
      42,
    ]) {
      assert.equal(threadFromSearch(bad), null, String(bad));
    }
  });
  it("a notice whose link leaves Admin opens nothing", () => {
    for (const link of ["https://evil.example/#/work-board", "javascript:alert(1)", "//evil.example/#/messages"]) {
      assert.equal(rowTarget({ kind: "alert", link }), null, link);
    }
  });
  it("a chat row with no chat id does not open an empty chat", () => {
    const target = rowTarget({ kind: "chat", threadId: null, link: null });
    assert.equal(target, null);
  });
});

describe("T-2 the badge is a count or nothing", () => {
  it("nothing read yet: no badge (not 0)", () => {
    assert.equal(messagesBadge({ badge: null, inbox: null }), null);
  });
  it("junk chat counts read as 0, never NaN", () => {
    for (const chats of ["many", Number.NaN, undefined, null]) {
      const n = messagesBadge({ badge: { staff: true, chats }, inbox: { mentions: [], alerts: [] } });
      assert.equal(n, 0, String(chats));
    }
  });
  it("only the inbox read (the badge call failed): the inbox still counts", () => {
    const n = messagesBadge({
      badge: null,
      inbox: { mentions: [{ id: "m", kind: "mention", source_kind: "work_card", card_id: T, read_at: null, created_at: new Date().toISOString() }], alerts: [] },
    });
    assert.equal(n, 1);
  });
});

describe("T-3 drops and conflicts", () => {
  const todo = { id: "c-todo", grp: "todo" };
  const review = { id: "c-review", grp: "doing" };
  const done = { id: "c-done", grp: "done" };
  it("same column: nothing; Closed: proof first; a closed card dragged to another Closed column just moves", () => {
    assert.deepEqual(planMove({ status_id: "c-review", status: "doing" }, review), { kind: "same" });
    assert.deepEqual(planMove({ status_id: "c-todo", status: "todo" }, done), { kind: "close" });
    assert.deepEqual(planMove({ status_id: "c-done", status: "done" }, { id: "c-shipped", grp: "done" }), { kind: "move" });
    assert.deepEqual(planMove({ status_id: "c-done", status: "done" }, todo), { kind: "move" });
    assert.deepEqual(planMove(null, todo), { kind: "none" });
    assert.deepEqual(planMove({ status_id: "x" }, null), { kind: "none" });
  });
  it("a conflict reads the one sentence; other failures keep their words", () => {
    assert.equal(moveErrorWords({ token: "stale_write", message: "x" }, () => "fallback"), MOVE_CONFLICT_WORDS);
    assert.equal(moveErrorWords({ token: "column_archived", message: "That column was archived." }, (e) => e.message), "That column was archived.");
    assert.equal(moveErrorWords(null, () => "Couldn't move the card."), "Couldn't move the card.");
  });
});

describe("T-4 files and links before upload", () => {
  it("exactly 25 MB passes; one byte more is refused with the spec's words", () => {
    assert.equal(fileProblem({ name: "deck.pdf", type: "application/pdf", size: FILE_MAX_BYTES }), "");
    assert.equal(fileProblem({ name: "deck.pdf", type: "application/pdf", size: FILE_MAX_BYTES + 1 }), "deck.pdf is over 25 MB. Share it as a link instead.");
  });
  it("empty files are refused", () => {
    assert.match(fileProblem({ name: "x.png", type: "image/png", size: 0 }), /empty/);
  });
  it("SVG, HTML and scripts are refused, whatever the name says", () => {
    for (const f of [
      { name: "logo.svg", type: "image/svg+xml", size: 10 },
      { name: "page.html", type: "text/html", size: 10 },
      { name: "run.js", type: "text/javascript", size: 10 },
      { name: "setup.exe", type: "application/x-msdownload", size: 10 },
    ]) {
      assert.notEqual(fileProblem(f), "", f.name);
    }
  });
  it("links: https only, no spaces, under 2,000 characters", () => {
    assert.equal(linkProblem("https://drive.google.com/file/d/abc"), "");
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://a b.com", `https://x.com/${"a".repeat(2000)}`, "https://", ""]) {
      assert.notEqual(linkProblem(bad), "", bad.slice(0, 40));
    }
  });
});

describe("T-5 the header fits the contract's widths", () => {
  it("1440 full, 1024 folded, 390 compact, and the edges", () => {
    assert.equal(headerFit(1440), "full");
    assert.equal(headerFit(1024), "folded");
    assert.equal(headerFit(390), "compact");
    assert.equal(headerFit(639), "compact");
    assert.equal(headerFit(640), "folded");
    assert.equal(headerFit("wide"), "compact");
  });
});
