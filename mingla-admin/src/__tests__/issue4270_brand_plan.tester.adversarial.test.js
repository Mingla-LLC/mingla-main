// Issue #4270 (Wave 3, and the Wave 2 rework) — tester adversarial tests for
// the brand plan in Admin. Different angles from the implementor's tests:
//
//   Q-LINK   the plan link check refuses what the server refuses: http,
//            javascript:, data:, "https://" alone, a space inside, 2,001
//            characters; a padded https link is fine
//   Q-WEEK   week edges: a Sunday item belongs to the week of its Monday;
//            on a Sunday the next day is "Next week"; the Today line sits
//            after yesterday's items and before today's; an item without a
//            date is dropped; a week across the new year says "Week of 4 Jan"
//   Q-FORM   the Add to plan checks: spaces only, 161 characters, a two-letter
//            task (a two-letter post is fine), yesterday, a task with no
//            owner, a 501-character note; what is sent is trimmed and has no
//            empty link or note, and a post sends no watchers
//   Q-ROW    a rendered row: an event or a promised event that says
//            by "host" never shows "From Host app" or a link editor; a long
//            title is never cut; a host task's link opens in a new tab with
//            noopener; a row with no state shows no empty chip
//   Q-LINE   only a system message with no sender is a plan line; the Brand
//            group renders it with no reply or select control
//   Q-SEES   Host sees: a brand with an undated idea, a state without words,
//            a late-evening UTC time keeps its UTC day
//   Q-W2R    the Wave 2 rework: closing the host card goes back only when
//            this page opened it and never replaces history; a live item is
//            left out of Past and shows no plain state
//
// Run: node --test src/__tests__/issue4270_brand_plan.tester.adversarial.test.js
// (from mingla-admin; Q-ROW builds the real Plan row with esbuild: run
// `npm ci` first, without it the test FAILS, it never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  hostSeesWords,
  isPlanLine,
  planAddItem,
  planFormProblems,
  planLinkProblem,
  planWeeks,
} from "../lib/brandPlan.js";
import { hostCloseStep } from "../lib/panelStack.js";
import { hostPastRows, hostUpcomingRows } from "../lib/opsModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

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
import { PlanRow } from "../components/crm/HostPlanSection.jsx";
export function row(props) { return renderToStaticMarkup(<PlanRow online onSaveLink={async () => true} {...props} />); }`,
      resolveDir: HERE, sourcefile: "issue4270.tester.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-tester-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

describe("Q-LINK the plan link check", () => {
  it("refuses what the server refuses", () => {
    for (const bad of ["http://canva.com/x", "javascript:alert(1)", "data:text/html,hi", "https://", "https://a b.com", `https://${"a".repeat(1993)}`, "ftp://x.com"]) {
      assert.equal(planLinkProblem(bad), "Links start with https://", `refused: ${bad.slice(0, 40)}`);
    }
  });
  it("accepts a padded https link and an empty one", () => {
    assert.equal(planLinkProblem("  https://www.canva.com/design/x  "), "");
    assert.equal(planLinkProblem(""), "");
    assert.equal(planLinkProblem("   "), "");
    assert.equal(planLinkProblem(`https://${"a".repeat(1992)}`), "", "2,000 characters is the limit, not over it");
  });
});

describe("Q-WEEK week edges", () => {
  it("a Sunday item is in the week of its Monday; on a Sunday, Monday is Next week", () => {
    const sunday = "2026-11-08";
    const weeks = planWeeks([{ kind: "post", id: "s", on: "2026-11-08" }, { kind: "post", id: "m", on: "2026-11-09" }], sunday);
    assert.deepEqual(weeks.map((w) => [w.label, w.items.map((i) => i.id).join("")]), [["This week", "s"], ["Next week", "m"]]);
  });
  it("the Today line goes after yesterday's items and before today's", () => {
    const weeks = planWeeks([
      { kind: "post", id: "a", on: "2026-11-02" },
      { kind: "task", id: "b", on: "2026-11-03" },
      { kind: "post", id: "c", on: "2026-11-04" },
      { kind: "post", id: "d", on: "2026-11-05" },
    ], "2026-11-04");
    assert.equal(weeks[0].todayIndex, 2);
    const allPast = planWeeks([{ kind: "post", id: "a", on: "2026-11-02" }], "2026-11-04");
    assert.equal(allPast[0].todayIndex, 1, "with only earlier items the line goes last");
  });
  it("drops an item with no date and labels a week across the new year", () => {
    const weeks = planWeeks([{ kind: "post", id: "x", on: null }, { kind: "post", id: "y", on: "2027-01-06" }, null], "2026-12-16");
    assert.deepEqual(weeks.map((w) => w.label), ["This week", "Week of 4 Jan"]);
    assert.equal(weeks.flatMap((w) => w.items).length, 1);
  });
  it("a week before this one says Week of, not Last week", () => {
    const weeks = planWeeks([{ kind: "post", id: "old", on: "2026-10-28" }], "2026-11-04");
    assert.deepEqual(weeks.map((w) => w.label), ["Week of 26 Oct", "This week"]);
  });
});

describe("Q-FORM the Add to plan checks", () => {
  const today = "2026-11-04";
  const base = { type: "post", title: "Menu post", on: today, link: "", note: "", owners: ["gia@x.test"], watchers: [] };
  const fields = (form) => planFormProblems(form, today).map((p) => `${p.field}:${p.message}`);
  it("spaces only, too long, a two-letter task, yesterday, no owner, a long note", () => {
    assert.deepEqual(fields({ ...base, title: "    " }), ["title:Say what it is."]);
    assert.deepEqual(fields({ ...base, title: "x".repeat(161) }), ["title:Say what it is in up to 160 characters."]);
    assert.deepEqual(fields({ ...base, title: "x".repeat(160) }), []);
    assert.deepEqual(fields({ ...base, type: "task", title: "ab" }), ["title:Say what it is in 3 to 160 characters."]);
    assert.deepEqual(fields({ ...base, type: "post", title: "ab" }), []);
    assert.deepEqual(fields({ ...base, on: "2026-11-03" }), ["on:Pick today or a later date."]);
    assert.deepEqual(fields({ ...base, type: "task", owners: [] }), ["owners:Pick at least one owner."]);
    assert.deepEqual(fields({ ...base, note: "n".repeat(501) }), ["note:A note is up to 500 characters."]);
    assert.deepEqual(fields({ ...base, link: "http://x.com" }), ["link:Links start with https://"]);
  });
  it("sends a trimmed item with no empty link or note, and no watchers for a post", () => {
    assert.deepEqual(planAddItem({ ...base, title: "  Menu post  ", link: "   ", note: "  " }), { type: "post", title: "Menu post", on: today, owners: ["gia@x.test"] });
    const task = planAddItem({ ...base, type: "task", link: " https://dropbox.com/x ", note: " bring two ", watchers: ["k@x.test"] });
    assert.deepEqual(task, { type: "task", title: "Menu post", on: today, link: "https://dropbox.com/x", note: "bring two", owners: ["gia@x.test"], watchers: ["k@x.test"] });
    assert.equal(planAddItem({ ...base, type: "anything" }).type, "post", "an unknown type is never sent");
  });
});

describe("Q-ROW a rendered plan row", () => {
  it("an event or a promised event marked by host never says From Host app and has no link editor", () => {
    for (const kind of ["event", "experience", "trip", "promised"]) {
      const html = harness.row({ item: { kind, id: `${kind}1`, title: "Supper", on: "2026-11-12", state: "on_mingla", state_words: "On Mingla", link: null, can_link: false, by: "host" } });
      assert.doesNotMatch(html, /From Host app|Add link|Change link|data-plan-link/, kind);
    }
  });
  it("a long title is never cut and a host task's link opens safely in a new tab", () => {
    const title = "Bring the two printed banners and the menu stand to the venue before the doors open on Saturday";
    const html = harness.row({ item: { kind: "task", id: "t9", title, on: "2026-11-14", state: "todo", state_words: "To do", link: { url: "https://dropbox.com/s/x", site: "dropbox.com" }, can_link: true, by: "host", revision: 3 } });
    assert.ok(html.includes(title), "the whole title is rendered");
    assert.doesNotMatch(html, /truncate|text-ellipsis|line-clamp/);
    const anchor = /<a [^>]*data-plan-link=""[^>]*>/.exec(html)?.[0] || "";
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="[^"]*noopener[^"]*"/);
    assert.match(html, /data-from-host-app=""/);
  });
  it("a row with no state shows no empty chip", () => {
    const html = harness.row({ item: { kind: "event", id: "e2", title: "Pop-up", on: "2026-11-12", state: null, state_words: null, link: null, can_link: false, by: "host" } });
    assert.doesNotMatch(html, /rounded-full px-2 py-px text-\[11px\] font-semibold shrink-0[^"]*"><\/span>/);
    assert.doesNotMatch(html, /<span class="[^"]*shrink-0[^"]*"><\/span>/);
  });
});

describe("Q-LINE plan lines in Brand groups", () => {
  it("only a system message with no sender is a plan line", () => {
    assert.equal(isPlanLine({ message_type: "system", sender_id: null, content: "x" }), true);
    assert.equal(isPlanLine({ message_type: "system", sender_id: "u1", content: "x" }), false, "a system type from a person is not a quiet line");
    assert.equal(isPlanLine({ message_type: "text", sender_id: null, content: "x" }), false);
    assert.equal(isPlanLine(null), false);
  });
  it("the Brand group renders a plan line before any bubble, with no reply or select control", () => {
    const panel = code("components/community/BrandGroupsPanel.jsx");
    const m = /if \(isPlanLine\(message\)\) \{\s*return (<p [\s\S]*?<\/p>);\s*\}/.exec(panel);
    assert.ok(m, "the plan line branch returns a single <p>");
    assert.doesNotMatch(m[1], /onClick|button|Reply|select/i);
    assert.ok(panel.indexOf("if (isPlanLine(message))") < panel.indexOf("const mine = message.sender_id === myUserId"), "the plan line is decided before the bubble");
  });
});

describe("Q-SEES Host sees on the Calendar drawer", () => {
  it("covers a brand with an undated idea, a state without words and a late UTC time", () => {
    assert.equal(hostSeesWords({ brand_id: "b", host_state: null, host_state_words: null, publish_at: null }), "Not on the plan: add a date");
    assert.equal(hostSeesWords({ brand_id: "b", host_state: "in_review", publish_at: "2026-11-12T23:30:00+00:00" }), "In review · Thu 12 Nov");
    assert.equal(hostSeesWords({ brand_id: "", host_state: "planned", publish_at: "2026-11-12T12:00:00Z" }), "No brand");
    assert.equal(hostSeesWords(null), "No brand");
  });
});

describe("Q-W2R the Wave 2 rework", () => {
  it("closing the host card goes back only when this page opened it, and never replaces history", () => {
    assert.equal(hostCloseStep(true), "back");
    assert.equal(hostCloseStep(false), "push");
    const panel = code("components/community/BrandGroupsPanel.jsx");
    const close = /const closeHost = \(\) => \{([\s\S]*?)\n  \};/.exec(panel)?.[1] || "";
    assert.ok(close, "closeHost is found");
    assert.doesNotMatch(close, /replace:\s*true/);
    assert.match(close, /window\.history\.back\(\)/);
  });
  it("a live item is left out of Past and has no plain state among the upcoming rows", () => {
    const events = [
      { id: "x1", title: "Pottery Week", start_on: "2026-10-01", live: true, state: { k: "happened", name: "Happened" }, event_type: "experience" },
      { id: "x2", title: "Supper", start_on: "2026-11-20", live: false, state: { k: "on_mingla", name: "On Mingla" }, event_type: "event" },
    ];
    const up = hostUpcomingRows(events, [], "2026-11-04");
    assert.deepEqual(up.filter((r) => r.kind === "event").map((r) => [r.id, r.live, r.state?.name ?? null]), [["x1", true, null], ["x2", false, "On Mingla"]]);
    assert.deepEqual(hostPastRows([{ id: "x1", title: "Pottery Week" }, { id: "x3", title: "Old gig" }], events).map((p) => p.id), ["x3"]);
  });
});
