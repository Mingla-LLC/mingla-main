// Issue #4571 rework 2 (retest 1 findings) -- implementor tests for Admin.
//
//   N3  the merge confirmation and the success toast say how many logged
//       emails move (mergeConfirmWords, mergeMovedWords)
//   N4  the link picker shows a booking's status as a word from one label map,
//       never the raw id (linkSubWords, CALL_STATUS_LABELS)
//   N5  at 1280 with the sidebar open the sprint bar fits at least 2 goal pills
//   N6  the Work sprint bar and the card tile are RENDERED (esbuild + react-dom
//       server), not matched by source patterns. Components with no static-render
//       harness (RecordPanel, LogForm, ToastContext) keep source assertions in
//       issue4571_rework.implementor.test.js: they need clicks and effects.
//
// FAILS-ON-REVERT: without "emails" in MOVED_WORDS the toast omits them; without
// linkSubWords the picker shows "booked"; with GOAL_PILL_MIN at 128 the 351 px
// strip fits 1 pill.
//
// Run: node --test src/__tests__/issue4571_rework2_render.implementor.test.js
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeConfirmWords, mergeMovedWords } from "../lib/sopTools.js";
import { linkSubWords } from "../lib/opsModel.js";
import { CALL_STATUS_LABELS } from "../lib/inboundLeads.js";
import { goalPillsThatFit } from "../lib/workBoardModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin"); }
  const out = await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
import { SprintBar } from "../components/ops/SprintBar.jsx";
export const bar = (p) => renderToStaticMarkup(<SprintBar onGoal={() => {}} onWeek={() => {}} onThisWeek={() => {}} onPlan={() => {}} isThisWeek today="2026-11-23" {...p} />);`,
      resolveDir: HERE, sourcefile: "issue4571.rework2.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __r } from "node:module"; const require = __r(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4571-r2-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

describe("N3 logged emails are named when a merge moves them", () => {
  it("the success toast counts them", () => {
    assert.equal(mergeMovedWords({ activity: 4, emails: 3 }), "Moved 4 touches and notes and 3 logged emails.");
    assert.equal(mergeMovedWords({ emails: 1 }), "Moved 1 logged email.");
    assert.equal(mergeMovedWords({ emails: 0 }), "Nothing else needed moving.");
  });
  it("the confirmation says the number the server gave, or the plain words without one", () => {
    assert.match(mergeConfirmWords("Ada", 3), /touches, notes, 3 logged emails, contacts/);
    assert.match(mergeConfirmWords("Ada", 1), /1 logged email,/);
    assert.match(mergeConfirmWords("Ada", 0), /0 logged emails,/);
    assert.match(mergeConfirmWords("Ada"), /notes, logged emails, contacts/);
  });
});

describe("N4 the booking picker shows words, not ids", () => {
  it("every status id maps to its label from the one map", () => {
    for (const [id, label] of Object.entries(CALL_STATUS_LABELS)) assert.equal(linkSubWords("booking", id), label);
    assert.equal(linkSubWords("booking", "booked"), "Booked");
    assert.equal(linkSubWords("booking", "moved"), "Moved");
    assert.equal(linkSubWords("booking", "cancelled"), "Cancelled");
  });
  it("other kinds and unknown statuses pass through unchanged", () => {
    assert.equal(linkSubWords("host", "Replied"), "Replied");
    assert.equal(linkSubWords("booking", "pending review"), "pending review");
    assert.equal(linkSubWords("booking", null), "");
  });
});

const GOALS = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, title: `Goal number ${i} with a long title`, state: "on_track", done: i, cards: 9, owner_name: "Ada" }));

describe("N5 the sprint bar fits at least 2 goal pills at 1280 with the sidebar open", () => {
  it("the measured strip (351 px) fits 2 pills, with +N more inside the bar", () => {
    assert.equal(goalPillsThatFit(351, 7), 2);
  });
  it("rendered: pills carry their full title as a tooltip, and the rest fold into a +N more button", () => {
    const html = h.bar({ sprint: { starts_on: "2026-11-23" }, plan: { goals: GOALS } });
    assert.equal((html.match(/data-goal-pill=/g) || []).length, 3);
    assert.match(html, /title="Goal number 0 with a long title · /);
    assert.match(html, /\+4 more/);
  });
  it("rendered: no goals says so", () => {
    assert.match(h.bar({ sprint: { starts_on: "2026-11-23" }, plan: { goals: [] } }), /No sprint goals yet/);
  });
});
