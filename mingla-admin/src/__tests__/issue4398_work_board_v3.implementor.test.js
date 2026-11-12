// Issue #4398 (Work board v3) — implementor tests for Admin.
//
//   D-1  due labels: "Overdue N days" (red), "Due today", "Due tomorrow",
//        "Due <Weekday> <d> <Mon>" within six days, "Due <d> <Mon>" later,
//        "Done <d> <Mon>"; on the card face, in subtask rows and in the card
//        detail (the old "4d late" pill and the bare date are gone)
//   D-2  "Waiting on <watcher>" on a card in review, "for N days" from two
//        working days; "Sent back: <reason>" after a send back
//   R-1  the review step's buttons: only the watcher sees Confirm done and
//        Send back; the owner sees Mark done and, in review, that they cannot
//        confirm their own card; a release card has no Mark done
//   R-2  Send back needs 5 to 300 characters; Confirm and Send back call
//        ops_work_confirm and ops_work_send_back with the card's revision
//   P-1  the people picker in single mode cannot hold two people: picking
//        someone else changes the person ("Change"), the owner and watcher
//        fields of the card and of a new card are single
//   S-1  Settings > Automatic cards lists each kind with the card it goes
//        under and its state, and saves the routes through ops_setting_set
//   A-1  Messages > Mingla activity words each group (one line per kind per
//        day) and Mark all read clears Mingla activity only
//
// FAILS-ON-REVERT: on origin/main (eb1f1c058c) lib/dueLabel.js,
// lib/workReview.js and lib/activityModel.js do not exist, the card face
// still prints "4d late", PeopleField has no single mode, and opsService has
// no confirmWork / sendBackWork; every block below reds.
//
// Run: node --test src/__tests__/issue4398_work_board_v3.implementor.test.js
// (from mingla-admin, after `npm ci`; components are built with esbuild and
// Supabase is a recorder, so nothing leaves this machine).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dueLabel, waitingWords, workingDaysSince } from "../lib/dueLabel.js";
import { SEND_BACK_MAX, SEND_BACK_MIN, reviewRole } from "../lib/workReview.js";
import { activityDayLabel, activityDays, activityGroupWords } from "../lib/activityModel.js";
import { changePerson } from "../lib/peopleField.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));

const TODAY = "2026-11-11"; // a Wednesday
const SETH = { email: "seth@x.test", name: "Seth" };
const TAO = { email: "tao@x.test", name: "Taofeek" };
const card = (extra = {}) => ({ id: "c1", number: 378, title: "Edit and post the two videos", status: "todo", status_id: "s-todo",
  revision: 4, due_on: "2026-11-02", owners: [TAO], watchers: [SETH], ...extra });

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test"); }
  const fake = {
    name: "fake-supabase",
    setup(build) {
      build.onResolve({ filter: /lib\/supabase(\.js)?$/ }, () => ({ path: "fake-supabase", namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
        loader: "js",
        contents: `
const rec = (kind, args) => { (globalThis.__calls ||= []).push({ kind, ...args }); return Promise.resolve(globalThis.__answer ? globalThis.__answer(kind, args) : { data: null, error: null }); };
export const supabase = {
  rpc: (fn, params) => rec("rpc", { fn, params }),
  storage: { from: () => ({ upload: () => rec("upload", {}), createSignedUrl: () => rec("sign", {}), createSignedUrls: () => rec("signMany", {}) }) },
  auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};
export const SUPABASE_URL = "https://fake.test"; export const SUPABASE_ANON_KEY = "fake";
export async function invokeWithRefresh() { return { data: null, error: null }; }
`,
      }));
    },
  };
  const contents = `
import { renderToStaticMarkup } from "react-dom/server";
import { BoardCardFace } from "../components/ops/WorkBoard.jsx";
import { CardSubtasks } from "../components/ops/CardSubtasks.jsx";
import { PeopleField } from "../components/people/PeopleField.jsx";
import * as ops from "../services/opsService.js";
import * as dash from "../services/dashboardService.js";
export { ops, dash };
export function face(card) { return renderToStaticMarkup(<BoardCardFace card={card} today="${TODAY}" />); }
export function subtasks(props) { return renderToStaticMarkup(<CardSubtasks columns={[]} onOpenCard={() => {}} onChanged={() => {}} offerUndo={() => {}} onError={() => {}} {...props} />); }
export function people(props) { return renderToStaticMarkup(<PeopleField id="p" label="Owner" team={[{ email: "seth@x.test", name: "Seth", role: "Owner", open: 1 }, { email: "tao@x.test", name: "Taofeek", role: "Growth", open: 2 }]} onChange={() => {}} {...props} />); }
`;
  const out = await esbuild.build({
    stdin: { contents, resolveDir: HERE, sourcefile: "issue4398.harness.jsx", loader: "jsx" },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    plugins: [fake],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4398-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});
const reset = (answer = null) => { globalThis.__calls = []; globalThis.__answer = answer; };

describe("D-1 due labels anyone can read at a glance", () => {
  it("overdue, today, tomorrow, this week, later and done", () => {
    assert.deepEqual(dueLabel(card({ due_on: "2026-11-04" }), TODAY), { text: "Overdue 7 days", tone: "over", full: "Was due Wed 4 Nov 2026" });
    assert.equal(dueLabel(card({ due_on: "2026-11-10" }), TODAY).text, "Overdue 1 day");
    assert.equal(dueLabel(card({ due_on: TODAY }), TODAY).text, "Due today");
    assert.equal(dueLabel(card({ due_on: "2026-11-12" }), TODAY).text, "Due tomorrow");
    assert.equal(dueLabel(card({ due_on: "2026-11-13" }), TODAY).text, "Due Fri 13 Nov");
    assert.equal(dueLabel(card({ due_on: "2026-11-17" }), TODAY).text, "Due Tue 17 Nov", "six days ahead is still a weekday");
    assert.equal(dueLabel(card({ due_on: "2026-11-18" }), TODAY).text, "Due 18 Nov", "seven days ahead is the date");
    assert.equal(dueLabel(card({ status: "done", closed_at: "2026-11-11T10:00:00Z", due_on: "2026-11-02" }), TODAY).text, "Done 11 Nov");
    assert.equal(dueLabel(card({ due_on: null }), TODAY).tone, "none");
  });
  it("the card face shows the pill in red when late, and no longer prints \"4d late\"", () => {
    const html = h.face(card({ due_on: "2026-11-07" }));
    assert.match(html, /data-due="over"[^>]*>.*Overdue 4 days/);
    assert.match(html, /color-error-700/);
    assert.doesNotMatch(html, /\dd late/);
    assert.match(h.face(card({ due_on: "2026-11-13" })), /Due Fri 13 Nov/);
  });
  it("the face names the one owner and the one watcher", () => {
    assert.match(h.face(card()), /Taofeek owns · Seth watches/);
  });
  it("subtask rows carry the same label", () => {
    const html = h.subtasks({ card: { id: "p", depth: 0, status: "todo" }, subtasks: [
      { id: "s1", title: "Cut the first video", status: "todo", status_id: "x", due_on: "2026-11-09", owners: [TAO], subtasks: { total: 0, done: 0 } },
      { id: "s2", title: "Post it", status: "done", closed_at: "2026-11-10T12:00:00Z", status_id: "y", due_on: "2026-11-09", owners: [TAO], subtasks: { total: 0, done: 0 } },
    ] });
    assert.match(html, /data-due="over"[^>]*>Overdue 2 days/);
    assert.match(html, /data-due="done"[^>]*>Done 10 Nov/);
  });
  it("the card detail's Due chip uses the label too", () => {
    const src = code("components/ops/WorkDetail.jsx");
    assert.match(src, /dueLabel\(card, today\)/);
    assert.match(src, /DUE_TONE\[due\.tone\]/);
  });
});

describe("D-2 waiting on the watcher, sent back", () => {
  it("\"Waiting on Seth\", and after two working days \"for N days\"", () => {
    const c = card({ review: { requested_at: "2026-11-11T09:00:00Z", waiting_on: "Seth" } });
    assert.equal(waitingWords(c, new Date("2026-11-11T15:00:00Z")), "Waiting on Seth");
    assert.equal(waitingWords({ ...c, review: { ...c.review, requested_at: "2026-11-06T09:00:00" } }, new Date("2026-11-10T09:00:00")), "Waiting on Seth for 2 days",
      "Friday to Tuesday is two working days (the weekend does not count)");
    assert.equal(workingDaysSince("2026-11-07T10:00:00", new Date("2026-11-09T10:00:00")), 1, "Saturday to Monday is one");
  });
  it("the face shows the wait in review and the reason after a send back", () => {
    assert.match(h.face(card({ status: "doing", review: { requested_at: new Date().toISOString(), waiting_on: "Seth" } })), /data-review-wait=""[^>]*>Waiting on Seth/);
    assert.match(h.face(card({ status: "doing", sent_back: { reason: "Post the link to the video.", by_name: "Seth" } })), /data-sent-back=""[^>]*>Sent back: Post the link to the video\./);
  });
  it("a release card shows how much is left, and Made by Mingla", () => {
    const html = h.face(card({ auto: true, release_items: [{ key: "record", text: "Release record written", done: true }, { key: "guide", text: "Feature Guide line", done: false }, { key: "live_check", text: "Live check", done: false }] }));
    assert.match(html, /data-release-left=""[^>]*>2 of 3 left/);
    assert.match(html, /Made by Mingla/);
  });
});

describe("R-1 the buttons follow the review step", () => {
  it("only the watcher confirms a card in review", () => {
    const c = card({ status: "doing", review: { requested_at: "2026-11-11T09:00:00Z", requested_by_name: "Taofeek", waiting_on: "Seth" } });
    assert.equal(reviewRole(c, "seth@x.test").canConfirm, true);
    assert.equal(reviewRole(c, "tao@x.test").canConfirm, false, "the owner cannot confirm their own card");
    assert.match(reviewRole(c, "tao@x.test").words, /You cannot confirm your own card/);
    assert.equal(reviewRole(c, "kunle@x.test").canConfirm, false);
    assert.equal(reviewRole(card(), "seth@x.test").canConfirm, false, "nothing to confirm before the owner marks it done");
    assert.match(reviewRole(card(), "seth@x.test").words, /your close counts as the confirm/);
    assert.match(reviewRole(card(), "tao@x.test").words, /It goes to Seth to confirm/);
  });
  it("the card detail shows Confirm done and Send back only when reviewRole says so; a release card has no Mark done", () => {
    const src = code("components/ops/WorkDetail.jsx");
    assert.match(src, /card\.review && role\.canConfirm\) primary = <Button[^>]*data-confirm=""/);
    assert.match(src, /card\.review && role\.canConfirm\) more\.push\(\{ id: "reviewback"/);
    assert.match(src, /else if \(releaseItems\) primary = null;/);
    assert.match(src, /role\.isWatcher \? "Close as done" : "Mark done"/);
  });
});

describe("R-2 Confirm and Send back reach the server with the revision", () => {
  it("Send back needs 5 to 300 characters", () => {
    assert.equal(SEND_BACK_MIN, 5);
    assert.equal(SEND_BACK_MAX, 300);
    const src = code("components/ops/WorkDetail.jsx");
    assert.match(src, /backReason\.trim\(\)\.length < SEND_BACK_MIN/);
    assert.match(src, /maxLength=\{SEND_BACK_MAX\}/);
  });
  it("confirmWork and sendBackWork call the watcher-only functions", async () => {
    reset(() => ({ data: { card: {} }, error: null }));
    await h.ops.confirmWork("c1", 9);
    await h.ops.sendBackWork("c1", "Post the link.", 10);
    assert.deepEqual(globalThis.__calls.map((c) => [c.fn, c.params]), [
      ["ops_work_confirm", { p_id: "c1", p_expected_revision: 9 }],
      ["ops_work_send_back", { p_id: "c1", p_reason: "Post the link.", p_expected_revision: 10 }],
    ]);
  });
});

describe("P-1 one owner and one watcher in the picker", () => {
  it("picking someone else changes the person; it never holds two", () => {
    assert.deepEqual(changePerson(["tao@x.test"], "seth@x.test"), { value: ["seth@x.test"], change: { added: "seth@x.test", removed: "tao@x.test", changed: true } });
    assert.equal(changePerson(["tao@x.test"], "TAO@x.test"), null, "the same person is no change");
    assert.deepEqual(changePerson([], "seth@x.test").value, ["seth@x.test"]);
  });
  it("in single mode the box says Change and the last person cannot be removed", () => {
    const html = h.people({ single: true, min: 1, value: ["tao@x.test"] });
    assert.match(html, /placeholder="Change"/);
    assert.match(html, /aria-label="Change the owner"/);
    assert.match(html, /<button[^>]*aria-label="Remove Taofeek"[^>]*disabled=""/);
  });
  it("the card's and the new card form's owner and watcher are single", () => {
    const detail = code("components/ops/WorkDetail.jsx");
    assert.match(detail, /label="Owner" single/);
    assert.match(detail, /label="Watcher" single/);
    const add = code("components/ops/WorkAddForm.jsx");
    assert.match(add, /label="Owner" single/);
    assert.match(add, /label="Watcher" single/);
  });
});

describe("S-1 Settings > Automatic cards", () => {
  it("lists each kind with where it goes and its state, and saves the routes as card ids", () => {
    const src = code("components/ops/TeamSettingsPanels.jsx");
    assert.match(src, /export function AutomaticCardRoutes/);
    assert.match(src, /Closed: using #\$\{r\.using\?\.number\}/);
    assert.match(src, /"Nowhere to go"/);
    assert.match(src, /ops\.setOpsSetting\("auto_card_routes", next\)/);
    assert.match(src, /<AutomaticCardRoutes online=\{online\} \/>/);
    assert.match(src, /Number\(c\.depth \|\| 0\) <= 1/, "only cards at most one level down are offered");
  });
});

describe("A-1 Messages > Mingla activity", () => {
  it("one line per kind per day, in words", () => {
    assert.equal(activityGroupWords({ kind: "guide", group: "guide", count: 13, items: [] }).head, "13 Feature Guide entries turned Live");
    assert.equal(activityGroupWords({ kind: "bot", group: "added", count: 6, items: [
      { card: { parent: { number: 2971, title: "Finish release records" } } }, { card: { parent: { number: 2971, title: "Finish release records" } } }] }).head,
      "Mingla added 6 cards under #2971 Finish release records");
    assert.equal(activityGroupWords({ kind: "bot", group: "closed", count: 1, items: [] }).head, "Mingla closed 1 card because the problem was fixed");
    assert.equal(activityGroupWords({ kind: "edit", group: "edit", count: 3, items: [] }).head, "3 cards edited");
    assert.equal(activityDayLabel("2026-11-11", TODAY), "Today");
    assert.equal(activityDayLabel("2026-11-10", TODAY), "Yesterday");
    assert.equal(activityDayLabel("2026-11-06", TODAY), "Fri 6 Nov");
    const days = activityDays([{ day: "2026-11-10", kind: "edit", group: "edit", count: 1 }, { day: "2026-11-11", kind: "guide", group: "guide", count: 2 }], TODAY);
    assert.deepEqual(days.map((d) => d.label), ["Today", "Yesterday"]);
  });
  it("Mark all read clears Mingla activity only; the tab sits in Messages", async () => {
    reset(() => ({ data: { marked: 3 }, error: null }));
    await h.dash.markActivityRead("mingla");
    await h.dash.getActivity(14);
    assert.deepEqual(globalThis.__calls.map((c) => [c.fn, c.params]), [
      ["team_activity_mark_read", { p_tab: "mingla" }], ["team_activity", { p_days: 14 }]]);
    assert.match(code("components/messages/MessagesActivity.jsx"), /markActivityRead\("mingla"\)/);
    assert.match(code("lib/messagesModel.js"), /\{ id: "activity", label: "Mingla activity" \}/);
  });
});

describe("R-3 reopening is never a dead end", () => {
  it("a card without one owner and one watcher shows the server's words and the single pickers, then reopens with them", () => {
    const src = code("components/ops/WorkDetail.jsx");
    assert.match(src, /error\?\.token === "card_people"/);
    assert.match(src, /setReopenNeed\(opsErrorWords\(error\)\)/);
    assert.match(src, /data-reopen-people=""[\s\S]{0,400}role="alert"[\s\S]{0,200}\{reopenNeed\}/);
    assert.match(src, /reopen-owner`\} label="Owner" single/);
    assert.match(src, /reopen-watcher`\} label="Watcher" single/);
    assert.match(src, /reopenOwner\.length !== 1 \|\| reopenWatcher\.length !== 1/);
  });
  it("reopenWork sends the picked people only when there are some", async () => {
    reset(() => ({ data: { card: {} }, error: null }));
    await h.ops.reopenWork("c1", null, 5);
    await h.ops.reopenWork("c1", null, 6, { owner: "tao@x.test", watcher: "seth@x.test" });
    assert.deepEqual(globalThis.__calls.map((c) => c.params), [
      { p_id: "c1", p_reason: null, p_expected_revision: 5 },
      { p_id: "c1", p_reason: null, p_expected_revision: 6, p_owner: "tao@x.test", p_watcher: "seth@x.test" },
    ]);
  });
});
