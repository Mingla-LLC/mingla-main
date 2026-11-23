// Issue #4571 final gate (the tester's P3-4, P3-5 and the brand_conflict
// words) -- implementor tests for Admin, RENDERED with esbuild +
// react-dom/server, not matched by source patterns.
//
//   F-1  the merge confirmation renders the logged-email count the server gave
//        (MergeConfirmLine, used by RecordHygiene)
//   F-2  the link picker renders a booking's status word, never the raw id
//        (PickerResult, used by RecordPicker)
//   F-3  a sprint goal pill's rendered minimum width is GOAL_PILL_MIN, the
//        width goalPillsThatFit counts with
//   F-4  the locked next-stage button's screen-reader words match its tooltip:
//        Onboarded and Live say "book a demo or link the brand" (RecordCard)
//   F-5  a brand_conflict refusal shows the server's sentence, not the
//        generic line
//
// FAILS-ON-REVERT: putting the old literal sentence back in RecordHygiene, the
// raw r.sub in RecordPicker, min-w-[8rem] on the pill, the old aria-label, or
// dropping brand_conflict from SERVER_WORDS each fails one test here.
//
// Run: node --test src/__tests__/issue4571_final_gate_render.implementor.test.js
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GOAL_PILL_MIN } from "../lib/workBoardModel.js";
import { errorWords } from "../lib/crmModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, "..", rel), "utf8");

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin"); }
  const out = await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
import { SprintBar } from "../components/ops/SprintBar.jsx";
import { PickerResult } from "../components/ops/RecordPicker.jsx";
import { MergeConfirmLine } from "../components/crm/RecordHygiene.jsx";
import { RecordCard } from "../components/crm/RecordCard.jsx";
import { ToastProvider } from "../context/ToastContext.jsx";
export const bar = (p) => renderToStaticMarkup(<SprintBar onGoal={() => {}} onWeek={() => {}} onThisWeek={() => {}} onPlan={() => {}} isThisWeek today="2026-11-23" {...p} />);
export const pick = (p) => renderToStaticMarkup(<ul><PickerResult onPick={() => {}} {...p} /></ul>);
export const confirm = (p) => renderToStaticMarkup(<MergeConfirmLine {...p} />);
export const card = (p) => renderToStaticMarkup(<ToastProvider><RecordCard onOpen={() => {}} onMove={() => {}} regions={[]} team={[]} today="2026-11-23" {...p} /></ToastProvider>);`,
      resolveDir: HERE, sourcefile: "issue4571.final.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __r } from "node:module"; const require = __r(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4571-final-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");

describe("F-1 the merge confirmation names the logged emails", () => {
  it("renders the number the server gave", () => {
    assert.match(text(h.confirm({ pick: { name: "Ada Grill", email_count: 3 } })), /touches, notes, 3 logged emails, contacts/);
    assert.match(text(h.confirm({ pick: { name: "Ada Grill", email_count: 1 } })), /1 logged email,/);
    assert.match(text(h.confirm({ pick: { name: "Ada Grill" } })), /notes, logged emails, contacts/);
  });
  it("RecordHygiene shows that line for the picked duplicate", () => {
    assert.match(read("components/crm/RecordHygiene.jsx"), /\{pick && <MergeConfirmLine pick=\{pick\} \/>\}/);
  });
});

describe("F-2 the link picker renders status words", () => {
  it("a booking's status is its label", () => {
    const html = h.pick({ kind: "booking", r: { id: "b1", label: "Ada Grill", sub: "booked" } });
    assert.match(html, /data-picker-sub="" [^>]*>Booked</);
    assert.doesNotMatch(html, />booked</);
    assert.match(h.pick({ kind: "booking", r: { id: "b2", label: "Ada", sub: "cancelled" } }), /data-picker-sub="" [^>]*>Cancelled</);
  });
  it("other kinds pass through; RecordPicker renders each result with it", () => {
    assert.match(h.pick({ kind: "host", r: { id: "h1", label: "Ada", sub: "Replied" } }), /data-picker-sub="" [^>]*>Replied</);
    assert.match(read("components/ops/RecordPicker.jsx"), /<PickerResult key=\{r\.id\} kind=\{kind\} r=\{r\} onPick=\{onPick\} \/>/);
  });
});

describe("F-3 the goal pill is as narrow as goalPillsThatFit counts", () => {
  it("the rendered min width equals GOAL_PILL_MIN", () => {
    const goals = [{ id: "g0", title: "Book ten demos", state: "on_track", done: 1, cards: 4 }];
    const html = h.bar({ sprint: { starts_on: "2026-11-23" }, plan: { goals } });
    const pill = html.match(/<button[^>]*data-goal-pill="g0"[^>]*>/);
    assert.ok(pill, "a goal pill renders");
    const m = pill[0].match(/min-w-\[([\d.]+)rem\]/);
    assert.ok(m, "the pill has a rem min width");
    assert.equal(Number(m[1]) * 16, GOAL_PILL_MIN);
  });
});

const HOSTS = {
  id: "hosts",
  stages: [
    { id: "prospect", label: "Prospect" }, { id: "contacted", label: "Contacted" }, { id: "replied", label: "Replied" },
    { id: "meeting", label: "Demo booked (Google Meet)" }, { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true }, { id: "lost", label: "Lost", terminal: true },
  ],
};
const gate = (locked) => ({ locked: locked.includes("meeting"), locked_stages: locked, reasons: {}, brand_linked: false });

describe("F-4 the locked button's screen-reader words match its tooltip", () => {
  it("Onboarded: book a demo or link the brand", () => {
    const html = h.card({ def: HOSTS, record: { id: "r1", name: "Ada Grill", stage: "meeting", demo_gate: gate(["onboarded", "live"]) } });
    assert.match(html, /aria-label="Onboarded is locked for Ada Grill\. Open the card to book a demo or link the brand\."/);
    assert.match(html, /title="Onboarded needs a linked demo or the host&#x27;s Mingla brand\. Open the card to book a demo or link the brand\."/);
  });
  it("Demo booked: book a demo", () => {
    const html = h.card({ def: HOSTS, record: { id: "r2", name: "Bo Bar", stage: "replied", demo_gate: gate(["meeting", "onboarded", "live"]) } });
    assert.match(html, /aria-label="Demo booked \(Google Meet\) is locked for Bo Bar\. Open the card to book a demo\."/);
  });
});

describe("F-5 a brand conflict says why", () => {
  it("the server's sentence is shown", () => {
    const msg = "A and B are linked to different Mingla brands (X and Y), so they are not the same host. Unlink the wrong brand from one card first, then merge.";
    assert.equal(errorWords({ token: "brand_conflict", message: msg }), msg);
  });
});

describe("F-6 the other merge and unmerge refusals say why", () => {
  const words = {
    invalid_merge: "Pick two different cards: the one to keep and the duplicate.",
    archived_card: "Unarchive the card first; only cards on the board are merged.",
    cannot_undo: "One of the two cards changed since (deleted, or no longer merged), so the merge cannot be undone.",
    too_late: "A merge can be undone for 7 days. Move what you need by hand; the merge log lists every row it moved.",
    already_undone: "This merge was already undone.",
  };
  for (const [token, msg] of Object.entries(words)) {
    it(`${token} shows the server's sentence`, () => {
      assert.equal(errorWords({ token, message: msg }), msg);
    });
  }
});
