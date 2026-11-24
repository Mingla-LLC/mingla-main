// Issue #4571 rework (after the final test, FAIL at ffcb44bc6d) — implementor
// tests for Admin.
//
//   R-1  (P2) a host whose demo_gate is locked is never offered a move into
//        Demo booked, Onboarded or Live: moveBlocker answers demo_required;
//        the tile and the card show the lock and "Book a demo" instead
//   R-2  (P1) a tile is `relative` and the board scroller is `relative`, so a
//        tile's sr-only text never escapes the scroller and widens the page
//        (390px phone grew to 675px)
//   R-3  (P2) the card's due-date choices start from the viewer's day
//        (localToday), not the UTC day
//   R-4  (P2) "Log call" opens the log form as an outbound phone call, on its
//        six outcomes
//   R-5  (P2) the sprint bar shows only the goal pills that fit, so "+N more"
//        is always inside the bar on a wide screen
//   R-6  (P3) an error toast belongs to its page: moving page drops it; the
//        same page (a card, a filter) keeps it
//   R-7  (P3) typing in the people field clears a refusal; Duplicate pairs
//        reloads after a merge; the sign-in input has no border shorthand next
//        to its focus borderColor
//   R-8  every #4571 Admin test has its CI sidecar
//
// FAILS-ON-REVERT: before the rework moveBlocker has no demo_required,
// goalPillsThatFit and lib/toastPage.js do not exist, the tile has no
// `relative`, RecordPanel uses new Date().toISOString() for its due choices,
// and the W3 tile test has no .ci-batch.json.
//
// Run: node --test src/__tests__/issue4571_rework.implementor.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoLocked, moveBlocker } from "../lib/crmModel.js";
import { GOAL_MORE_PILL, GOAL_PILL_MIN, GOAL_PILLS, goalPillsThatFit } from "../lib/workBoardModel.js";
import { pageOfHash, toastsForPage } from "../lib/toastPage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

const HOSTS = {
  id: "hosts",
  stages: [
    { id: "prospect", label: "Prospect" }, { id: "contacted", label: "Contacted" }, { id: "replied", label: "Replied" },
    { id: "meeting", label: "Demo booked (Google Meet)" }, { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true }, { id: "lost", label: "Lost", terminal: true },
  ],
};
const CREATORS = { id: "creators", stages: [{ id: "identified", label: "Identified" }, { id: "meeting", label: "Meeting" }] };

describe("R-1 the demo lock is never offered as a move", () => {
  const locked = { stage: "replied", demo_gate: { locked: true, reason: "Demo booked means a Google Meet booked through the scheduler." } };
  it("a locked host cannot move into the band, with the server's reason", () => {
    for (const to of ["meeting", "onboarded"]) {
      const b = moveBlocker(HOSTS, locked, to);
      assert.equal(b?.token, "demo_required");
      assert.equal(b?.message, locked.demo_gate.reason);
    }
    assert.equal(demoLocked(HOSTS, locked, "meeting"), true);
  });
  it("below the band, an unlocked host, a creator and a card without demo_gate are not blocked by it", () => {
    assert.equal(moveBlocker(HOSTS, locked, "lost"), null);
    assert.equal(moveBlocker(HOSTS, { stage: "replied", demo_gate: { locked: false } }, "meeting"), null);
    assert.equal(moveBlocker(CREATORS, { stage: "identified", demo_gate: { locked: true } }, "meeting"), null);
    assert.equal(moveBlocker(HOSTS, { stage: "replied" }, "meeting"), null);
  });
  it("the tile and the card swap the move for the lock and Book a demo", () => {
    const tile = read("components/crm/RecordCard.jsx");
    // #4571 design v5: one moveBlocker answer decides the lock (and the creator's Mark signed).
    assert.match(tile, /const block = next \? moveBlocker\(def, record, next\.id\) : null;/);
    assert.match(tile, /const nextLocked = block\?\.token === "demo_required";/);
    assert.match(tile, /\{next && nextLocked && \(/);
    assert.match(tile, /\{next && !nextLocked && !signGate && \(/);
    assert.match(tile, />\s*Book a demo\s*</);
    const card = read("components/crm/RecordPanel.jsx");
    assert.match(card, /\{nextLocked \? \(/);
    assert.match(card, /data-next-locked=""/);
    assert.match(card, /data-gate-action=""/);
    assert.match(card, /demoLocked\(def, record, s\.id\)/, "the stage menu disables a locked stage");
  });
});

describe("R-2 a tile's hidden text stays inside the board", () => {
  it("the tile and the board scroller are positioned", () => {
    assert.match(read("components/crm/RecordCard.jsx"), /"relative group flex min-w-0 flex-col gap-2/);
    assert.match(read("components/crm/PipelineBoard.jsx"), /className="relative max-w-full overflow-x-auto/);
  });
});

describe("R-3 Today is the viewer's day", () => {
  it("the card's due choices use localToday()", () => {
    const card = read("components/crm/RecordPanel.jsx");
    assert.match(card, /dueChoices\(localToday\(\)\)/);
    assert.doesNotMatch(card, /dueChoices\(new Date\(\)\.toISOString\(\)/);
  });
});

describe("R-4 Log call goes straight to the outcomes", () => {
  it("every Log call bumps callTick, and the log form turns into an outbound phone touch", () => {
    const card = read("components/crm/RecordPanel.jsx");
    assert.equal((card.match(/onClick=\{openLogCall\}|onLogCall=\{openLogCall\}/g) || []).length, 2);
    assert.match(card, /callTick=\{callTick\}/);
    const form = read("components/crm/LogForm.jsx");
    assert.match(form, /useState\(callTick > 0 \? "touch" : "note"\)/);
    assert.match(form, /setKind\("touch"\);\s*setChannel\("phone"\);\s*setDirection\("outbound"\);/);
    assert.match(form, /outcomesRef\.current\?\.querySelector\?\.\("button"\)\?\.focus\?\.\(\)/);
  });
});

describe("R-5 sprint pills fit the bar", () => {
  it("no width yet: the usual three", () => {
    assert.equal(goalPillsThatFit(null, 7), GOAL_PILLS);
    assert.equal(goalPillsThatFit(undefined, 2), 2);
  });
  it("all goals that fit show with no +N more", () => {
    assert.equal(goalPillsThatFit(1000, 3), 3);
  });
  it("a narrow strip keeps room for +N more and readable pills", () => {
    // The tester's 1280 board: 351px for the goals.
    const n = goalPillsThatFit(351, 7);
    assert.equal(n, 2);
    assert.ok(n * (GOAL_PILL_MIN + 6) + GOAL_MORE_PILL <= 351);
    assert.equal(goalPillsThatFit(60, 7), 0);
  });
  it("the bar measures its strip on a wide screen and the strip never scrolls there", () => {
    const bar = read("components/ops/SprintBar.jsx");
    assert.match(bar, /goalFold\(goals, goalPillsThatFit\(stripWidth,/);
    assert.match(bar, /ref=\{stripRef\} data-sprint-goals=""/);
    assert.doesNotMatch(bar, /data-sprint-goals=""[^>]*overflow-x-auto/);
  });
});

describe("R-6 an error toast belongs to its page", () => {
  it("pageOfHash reads the page, not the card or filters", () => {
    assert.equal(pageOfHash("#/outreach?tab=hosts&card=abc"), "outreach");
    assert.equal(pageOfHash("#/work-board"), "work-board");
    assert.equal(pageOfHash(""), "");
  });
  it("another page drops the old page's errors and keeps everything else", () => {
    const toasts = [
      { id: 1, variant: "error", page: "outreach" },
      { id: 2, variant: "success", page: "outreach" },
      { id: 3, variant: "error", page: "work-board" },
    ];
    assert.deepEqual(toastsForPage(toasts, "work-board").map((t) => t.id), [2, 3]);
    assert.deepEqual(toastsForPage(toasts, "outreach").map((t) => t.id), [1, 2]);
  });
  it("the provider stamps the page and listens for page changes", () => {
    const ctx = read("context/ToastContext.jsx");
    assert.match(ctx, /const toast = \{ id, variant, title, description, action, page \};/);
    assert.match(ctx, /addEventListener\("hashchange", onRoute\)/);
  });
});

describe("R-7 small fixes", () => {
  it("typing clears a refusal in the people field", () => {
    assert.match(read("components/people/PeopleField.jsx"), /setHi\(0\); if \(message\) tell\(""\);/);
  });
  it("Duplicate pairs and Show archived reload after archive, merge or undo", () => {
    assert.match(read("components/crm/RecordPanel.jsx"), /pipe\.refetch\(\{ quiet: true \}\); onHygieneChanged\?\.\(\);/);
    assert.match(read("pages/PipelinePage.jsx"), /onHygieneChanged=\{\(\) => setActivityTick\(\(n\) => n \+ 1\)\}/);
  });
  it("the sign-in inputs use border longhands", () => {
    for (const f of ["components/LoginScreen.jsx", "components/InviteSetupScreen.jsx"]) {
      const src = read(f);
      const input = src.slice(src.indexOf("const inputStyle = {"), src.indexOf("};", src.indexOf("const inputStyle = {")));
      assert.doesNotMatch(input, /\bborder:/, f);
      assert.match(input, /borderColor:/, f);
    }
  });
});

describe("R-8 every #4571 Admin test runs in CI", () => {
  it("each has a .ci-batch.json sidecar naming it", () => {
    const tests = fs.readdirSync(here).filter((f) => /^issue4571_.*\.test\.js$/.test(f));
    assert.ok(tests.length >= 7);
    for (const t of tests) {
      const side = path.join(here, `${t}.ci-batch.json`);
      assert.ok(fs.existsSync(side), `${t} has no CI sidecar`);
      assert.match(fs.readFileSync(side, "utf8"), new RegExp(`node --test src/__tests__/${t.replace(/\./g, "\\.")}`));
    }
  });
});
